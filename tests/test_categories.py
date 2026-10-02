import json
import threading
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer

import sqlite3
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

from ourspace.database import Database
from ourspace.errors import ApiError
from ourspace.router import Router
from ourspace.http import create_handler
from ourspace.services.categories import CategoryService
from ourspace.services.dashboard import DashboardService
from ourspace.services.expenses import ExpenseService
from ourspace.services.settings import SettingsService
from ourspace.services.shopping import ShoppingService


class CategoryServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.database = Database(Path(self.temp_dir.name) / "category_test.db")
        self.database.initialize()
        self.settings = SettingsService(self.database)
        self.settings.configure({
            "couple_names": ["Yuki", "Haru"],
            "monthly_budget": 25_000,
            "started_on": (date.today() - timedelta(days=50)).isoformat(),
        })
        self.service = CategoryService(self.database)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_list_returns_default_categories(self):
        categories = self.service.list()
        self.assertGreaterEqual(len(categories), 7)
        keys = {c["key"] for c in categories}
        self.assertIn("groceries", keys)
        self.assertIn("dining", keys)
        self.assertIn("other", keys)
        for cat in categories:
            if cat["key"] == "groceries":
                self.assertEqual(cat["is_default"], 1)
                self.assertEqual(cat["label"], "日常購物")

    def test_create_custom_category(self):
        result = self.service.create({
            "key": "pet",
            "label": "毛孩日常",
            "icon": "sparkles",
            "color": "#ff9900",
        })
        self.assertTrue(result["ok"])
        categories = self.service.list()
        keys = {c["key"] for c in categories}
        self.assertIn("pet", keys)

        # Check in DB
        pet = next(c for c in categories if c["key"] == "pet")
        self.assertEqual(pet["label"], "毛孩日常")
        self.assertEqual(pet["color"], "#ff9900")
        self.assertEqual(pet["is_default"], 0)

    def test_create_duplicate_key_fails(self):
        self.service.create({"key": "travel", "label": "旅行度假"})
        with self.assertRaises(ApiError) as ctx:
            self.service.create({"key": "travel", "label": "重複旅行"})
        self.assertEqual(ctx.exception.status, 409)

    def test_create_invalid_key_fails(self):
        with self.assertRaises(ApiError):
            self.service.create({"key": "X", "label": "Too short"})
        with self.assertRaises(ApiError):
            self.service.create({"key": "invalid key with spaces!", "label": "Spaces"})

    def test_update_category(self):
        self.service.create({"key": "gaming", "label": "電玩遊戲", "color": "#112233"})
        self.service.update("gaming", {"label": "影音娛樂", "color": "#445566"})
        categories = self.service.list()
        gaming = next(c for c in categories if c["key"] == "gaming")
        self.assertEqual(gaming["label"], "影音娛樂")
        self.assertEqual(gaming["color"], "#445566")

    def test_default_category_can_be_edited_and_permanently_deleted(self):
        self.service.update("groceries", {"label": "超市", "icon": "cart", "color": "#123456"})
        item = next(c for c in self.service.list() if c["key"] == "groceries")
        self.assertEqual((item["label"], item["icon"], item["color"]), ("超市", "cart", "#123456"))
        self.service.delete("groceries")
        self.database.initialize()
        self.assertNotIn("groceries", {c["key"] for c in self.service.list()})

    def test_default_category_with_items_requires_migration(self):
        shopping = ShoppingService(self.database)
        item = shopping.create({"name": "牛奶", "category": "groceries"})
        with self.assertRaises(ApiError):
            self.service.delete("groceries")
        self.service.delete("groceries", "home")
        with self.database.connect() as conn:
            self.assertEqual(conn.execute("SELECT category FROM shopping_items WHERE id = ?", (item["id"],)).fetchone()[0], "home")

    def test_removed_fallback_categories_are_not_reused_for_new_items(self):
        self.service.delete("other")
        self.service.delete("groceries")
        ShoppingService(self.database).create({"name": "新項目"})
        ExpenseService(self.database).create({"title": "新開支", "amount": 10})
        with self.database.connect() as conn:
            for table in ("expenses", "shopping_items"):
                self.assertEqual(conn.execute(f"SELECT COUNT(*) FROM {table} WHERE category NOT IN (SELECT key FROM categories)").fetchone()[0], 0)

    def test_all_empty_categories_can_be_deleted_but_new_items_need_a_category(self):
        for item in self.service.list():
            self.service.delete(item["key"])
        self.database.initialize()
        self.assertEqual(self.service.list(), [])
        with self.assertRaisesRegex(ApiError, "新增分類"):
            ShoppingService(self.database).create({"name": "新項目"})
        with self.assertRaisesRegex(ApiError, "新增分類"):
            ExpenseService(self.database).create({"title": "新開支", "amount": 10})

    def test_delete_custom_category_reassigns_to_selected_category(self):
        self.service.create({"key": "fitness", "label": "健身運動"})
        expenses = ExpenseService(self.database)
        created = expenses.create({
            "title": "健身房月費",
            "amount": 500,
            "category": "fitness",
            "paid_by": "Yuki",
            "spent_on": date.today().isoformat(),
        })

        shopping = ShoppingService(self.database)
        created_shop = shopping.create({
            "name": "乳清蛋白",
            "quantity": 1,
            "category": "fitness",
        })

        # Verify initial category is fitness
        with self.database.connect() as conn:
            exp_cat = conn.execute("SELECT category FROM expenses WHERE id = ?", (created["id"],)).fetchone()[0]
            shop_cat = conn.execute("SELECT category FROM shopping_items WHERE id = ?", (created_shop["id"],)).fetchone()[0]
            self.assertEqual(exp_cat, "fitness")
            self.assertEqual(shop_cat, "fitness")

        # Delete category
        del_result, status = Router(self.database).dispatch(
            "DELETE", "/api/categories/fitness", {"target_category": "leisure"}, {},
        )
        self.assertEqual(status, 200)
        self.assertEqual(del_result["migrated"], {"expenses": 1, "shopping_items": 1})
        self.assertTrue(del_result["ok"])

        # Category is gone from categories table
        keys = {c["key"] for c in self.service.list()}
        self.assertNotIn("fitness", keys)

        # Expense and shopping item reassigned to selected target
        with self.database.connect() as conn:
            exp_cat = conn.execute("SELECT category FROM expenses WHERE id = ?", (created["id"],)).fetchone()[0]
            shop_cat = conn.execute("SELECT category FROM shopping_items WHERE id = ?", (created_shop["id"],)).fetchone()[0]
            self.assertEqual(exp_cat, "leisure")
            self.assertEqual(shop_cat, "leisure")

    def test_http_delete_reads_migration_target_from_json_body(self):
        self.service.create({"key": "source", "label": "原分類"})
        ShoppingService(self.database).create({"name": "項目", "category": "source"})
        handler = create_handler(Router(self.database), Path("static"))
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        client = HTTPConnection(*server.server_address, timeout=5)
        try:
            client.request("DELETE", "/api/categories/source", json.dumps({"target_category": "home"}),
                           {"Content-Type": "application/json"})
            response = client.getresponse()
            self.assertEqual(response.status, 200)
            self.assertEqual(json.loads(response.read())["target_category"], "home")
            with self.database.connect() as conn:
                self.assertEqual(conn.execute("SELECT category FROM shopping_items").fetchone()[0], "home")
                self.assertIsNone(conn.execute("SELECT 1 FROM categories WHERE key = 'source'").fetchone())
        finally:
            client.close()
            server.shutdown()
            server.server_close()
            thread.join()

    def test_empty_category_is_physically_deleted_and_stays_deleted(self):
        self.service.create({"key": "unused", "label": "多餘"})
        self.service.delete("unused")
        self.database.initialize()
        with self.database.connect() as conn:
            self.assertIsNone(conn.execute("SELECT * FROM categories WHERE key = 'unused'").fetchone())

    def test_populated_category_requires_valid_distinct_target(self):
        self.service.create({"key": "source", "label": "原分類"})
        item = ShoppingService(self.database).create({"name": "項目", "category": "source"})
        for target, status in [(None, 409), ("", 409), ("source", 400), ("missing", 404)]:
            with self.subTest(target=target):
                with self.assertRaises(ApiError) as ctx:
                    self.service.delete("source", target)
                self.assertEqual(ctx.exception.status, status)
                with self.database.connect() as conn:
                    self.assertIsNotNone(conn.execute("SELECT 1 FROM categories WHERE key = 'source'").fetchone())
                    self.assertEqual(conn.execute("SELECT category FROM shopping_items WHERE id = ?", (item["id"],)).fetchone()[0], "source")

    def test_completed_shopping_and_linked_expense_migrate_to_custom_target(self):
        for key in ("source", "target"):
            self.service.create({"key": key, "label": key})
        shopping = ShoppingService(self.database)
        item = shopping.create({"name": "已買", "category": "source"})
        shopping.complete(item["id"], {"actual_price": 123, "paid_by": "Yuki"})
        with self.database.connect() as conn:
            before = dict(conn.execute("SELECT * FROM shopping_items WHERE id = ?", (item["id"],)).fetchone())
            expense = dict(conn.execute("SELECT * FROM expenses WHERE id = ?", (before["expense_id"],)).fetchone())
        self.service.delete("source", "target")
        with self.database.connect() as conn:
            after = dict(conn.execute("SELECT * FROM shopping_items WHERE id = ?", (item["id"],)).fetchone())
            after_expense = dict(conn.execute("SELECT * FROM expenses WHERE id = ?", (before["expense_id"],)).fetchone())
        self.assertEqual(after, {**before, "category": "target"})
        self.assertEqual(after_expense, {**expense, "category": "target"})

    def test_failed_delete_rolls_back_migration(self):
        self.service.create({"key": "source", "label": "原分類"})
        ShoppingService(self.database).create({"name": "項目", "category": "source"})
        with self.database.connect() as conn:
            conn.execute("CREATE TRIGGER reject_delete BEFORE DELETE ON categories BEGIN SELECT RAISE(ABORT, 'test'); END")
        with self.assertRaises(sqlite3.IntegrityError):
            self.service.delete("source", "other")
        with self.database.connect() as conn:
            self.assertEqual(conn.execute("SELECT category FROM shopping_items").fetchone()[0], "source")
            self.assertIsNotNone(conn.execute("SELECT 1 FROM categories WHERE key = 'source'").fetchone())

    def test_custom_category_in_dashboard_breakdown(self):
        self.service.create({"key": "medical", "label": "醫療健康", "color": "#00aa88"})
        expenses = ExpenseService(self.database)
        expenses.create({
            "title": "診所看診",
            "amount": 380,
            "category": "medical",
            "paid_by": "Haru",
            "spent_on": date.today().isoformat(),
        })
        dashboard = DashboardService(self.database).get()
        categories = dashboard["categories"]
        self.assertTrue(any(c["key"] == "medical" for c in categories))
        breakdown = dashboard["breakdown"]
        medical_item = next((item for item in breakdown if item["category"] == "medical"), None)
        self.assertIsNotNone(medical_item)
        self.assertEqual(medical_item["amount"], 380.0)
        self.assertEqual(medical_item["label"], "醫療健康")


if __name__ == "__main__":
    unittest.main()
