import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

from ourspace.database import Database
from ourspace.errors import ApiError
from ourspace.services.admin import AdminService
from ourspace.services.expenses import ExpenseService
from ourspace.services.settings import SettingsService
from ourspace.services.todos import TodoService


class AdminServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.database = Database(Path(self.temp_dir.name) / "admin_test.db")
        self.database.initialize()
        self.settings = SettingsService(self.database)
        self.settings.configure({
            "couple_names": ["Yuki", "Haru"],
            "monthly_budget": 30_000,
            "started_on": (date.today() - timedelta(days=100)).isoformat(),
        })
        self.admin = AdminService(self.database)
        self.expenses = ExpenseService(self.database)
        self.todos = TodoService(self.database)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_overview_metrics(self):
        self.expenses.create({
            "title": "咖啡外賣",
            "amount": 75,
            "category": "dining",
            "paid_by": "Yuki",
            "spent_on": date.today().isoformat(),
        })
        self.todos.create({
            "title": "大掃除",
            "assignee": "一起",
        })

        overview = self.admin.overview()
        self.assertIn("counts", overview)
        self.assertEqual(overview["counts"]["expenses"], 1)
        self.assertEqual(overview["counts"]["todos"], 1)
        self.assertEqual(overview["total_expense_amount"], 75.0)
        self.assertEqual(overview["total_expense_count"], 1)
        self.assertGreaterEqual(overview["counts"]["categories"], 7)
        self.assertGreaterEqual(overview["counts"]["settings"], 4)
        self.assertIn("sqlite_version", overview)
        self.assertEqual(overview["schema_version"], 6)

    def test_get_table_expenses_and_filters(self):
        self.expenses.create({
            "title": "超市買餸",
            "amount": 250,
            "category": "groceries",
            "paid_by": "Yuki",
            "spent_on": "2026-09-01",
        })
        self.expenses.create({
            "title": "週末晚餐",
            "amount": 600,
            "category": "dining",
            "paid_by": "Haru",
            "spent_on": "2026-09-02",
        })

        # Test search
        search_res = self.admin.get_table("expenses", search="買餸")
        self.assertEqual(search_res["total"], 1)
        self.assertEqual(search_res["rows"][0]["title"], "超市買餸")

        # Test category filter
        filter_res = self.admin.get_table("expenses", filters={"category": "dining"})
        self.assertEqual(filter_res["total"], 1)
        self.assertEqual(filter_res["rows"][0]["title"], "週末晚餐")

        # Test paid_by filter
        payer_res = self.admin.get_table("expenses", filters={"paid_by": "Yuki"})
        self.assertEqual(payer_res["total"], 1)
        self.assertEqual(payer_res["rows"][0]["title"], "超市買餸")

    def test_unknown_table_raises_404(self):
        with self.assertRaises(ApiError) as ctx:
            self.admin.get_table("users_passwords_secret")
        self.assertEqual(ctx.exception.status, 404)

    def test_manage_settings(self):
        # Create new custom setting
        create_res = self.admin.create_setting({"key": "currency_symbol", "value": "HK$"})
        self.assertTrue(create_res["ok"])

        # Duplicate create fails
        with self.assertRaises(ApiError) as ctx:
            self.admin.create_setting({"key": "currency_symbol", "value": "$"})
        self.assertEqual(ctx.exception.status, 409)

        # Update setting
        update_res = self.admin.update_setting("currency_symbol", "HKD$")
        self.assertTrue(update_res["ok"])

        # Verify setting table reflects update
        table = self.admin.get_table("settings", search="currency_symbol")
        row = next(r for r in table["rows"] if r["key"] == "currency_symbol")
        self.assertEqual(row["parsed_value"], "HKD$")

        # Cannot delete protected settings
        with self.assertRaises(ApiError) as ctx:
            self.admin.delete_setting("monthly_budget")
        self.assertEqual(ctx.exception.status, 400)

        # Can delete custom setting
        del_res = self.admin.delete_setting("currency_symbol")
        self.assertTrue(del_res["ok"])

    def test_export_csv(self):
        self.expenses.create({
            "title": "甜品蛋糕",
            "amount": 128.5,
            "category": "dining",
            "paid_by": "Haru",
            "spent_on": "2026-09-05",
        })

        export = self.admin.export_csv("expenses")
        self.assertTrue(export["__download__"])
        self.assertTrue(export["filename"].startswith("teletubbyland-expenses-"))
        self.assertTrue(export["filename"].endswith(".csv"))

        content = export["content"]
        # Must start with UTF-8 BOM
        self.assertTrue(content.startswith("\ufeff"))
        # Header should have Chinese friendly column names
        self.assertIn("開支名稱", content)
        self.assertIn("金額 (HK$)", content)
        self.assertIn("甜品蛋糕", content)
        self.assertIn("128.5", content)


if __name__ == "__main__":
    unittest.main()
