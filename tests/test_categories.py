import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

from ourspace.database import Database
from ourspace.errors import ApiError
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

    def test_cannot_delete_default_category(self):
        with self.assertRaises(ApiError) as ctx:
            self.service.delete("groceries")
        self.assertEqual(ctx.exception.status, 400)

    def test_delete_custom_category_reassigns_to_other(self):
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
        del_result = self.service.delete("fitness")
        self.assertTrue(del_result["ok"])

        # Category is gone from categories table
        keys = {c["key"] for c in self.service.list()}
        self.assertNotIn("fitness", keys)

        # Expense and shopping item reassigned to other
        with self.database.connect() as conn:
            exp_cat = conn.execute("SELECT category FROM expenses WHERE id = ?", (created["id"],)).fetchone()[0]
            shop_cat = conn.execute("SELECT category FROM shopping_items WHERE id = ?", (created_shop["id"],)).fetchone()[0]
            self.assertEqual(exp_cat, "other")
            self.assertEqual(shop_cat, "other")

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
