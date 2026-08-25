import tempfile
import unittest
import sqlite3
from contextlib import closing
from datetime import date, timedelta
from pathlib import Path

from ourspace.config import DEFAULT_LAYOUT
from ourspace.database import Database
from ourspace.errors import ApiError
from ourspace.router import Router
from ourspace.services.dashboard import DashboardService
from ourspace.services.expenses import ExpenseService
from ourspace.services.settings import SettingsService
from ourspace.services.shopping import ShoppingService


class TeletubbylandTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.database = Database(Path(self.temp_dir.name) / "test.db")
        self.database.initialize()
        self.settings = SettingsService(self.database)

    def tearDown(self):
        self.temp_dir.cleanup()

    def configure(self):
        return self.settings.configure({
            "couple_names": ["Yuki", "Haru"],
            "monthly_budget": 30_000,
            "started_on": (date.today() - timedelta(days=100)).isoformat(),
        })

    def test_fresh_database_has_no_default_user_data(self):
        dashboard = DashboardService(self.database).get()
        self.assertEqual(dashboard, {"configured": False})
        with self.database.connect() as connection:
            for table in ("settings", "expenses", "shopping_items", "todos", "special_days"):
                count = connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                self.assertEqual(count, 0, f"{table} should start empty")

    def test_onboarding_configures_empty_dashboard(self):
        self.configure()
        dashboard = DashboardService(self.database).get()
        self.assertTrue(dashboard["configured"])
        self.assertEqual(dashboard["settings"]["couple_names"], ["Yuki", "Haru"])
        self.assertEqual(dashboard["settings"]["monthly_budget"], 30_000)
        self.assertEqual(dashboard["preferences"], {"currency": "HKD", "locale": "zh-HK"})
        self.assertEqual(dashboard["settings"]["split"]["percentages"], [50.0, 50.0])
        self.assertEqual(dashboard["expenses"], [])
        self.assertEqual(dashboard["shopping"], [])
        self.assertEqual(dashboard["todos"], [])
        self.assertEqual(dashboard["special_days"], [])

    def test_router_blocks_domain_actions_before_onboarding(self):
        router = Router(self.database)
        with self.assertRaises(ApiError) as context:
            router.dispatch("POST", "/api/todos", {"title": "不應建立"}, {})
        self.assertEqual(context.exception.status, 409)

    def test_completing_shopping_item_uses_actual_price(self):
        self.configure()
        shopping = ShoppingService(self.database)
        created = shopping.create({"name": "燕麥奶", "quantity": 2, "category": "groceries"})
        shopping.complete(created["id"], {
            "actual_price": 205.5,
            "paid_by": "共同",
            "spent_on": date.today().isoformat(),
        })

        with self.database.connect() as connection:
            item = connection.execute("SELECT * FROM shopping_items WHERE id = ?", (created["id"],)).fetchone()
            expense = connection.execute("SELECT * FROM expenses WHERE id = ?", (item["expense_id"],)).fetchone()
            self.assertEqual(item["purchased"], 1)
            self.assertEqual(expense["amount"], 205.5)

    def test_clearing_completed_shopping_keeps_expense(self):
        self.configure()
        shopping = ShoppingService(self.database)
        created = shopping.create({"name": "清潔用品", "quantity": 1})
        shopping.complete(created["id"], {"actual_price": 88, "paid_by": "Yuki"})
        result = shopping.clear_completed()
        self.assertEqual(result["removed"], 1)
        with self.database.connect() as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM shopping_items").fetchone()[0], 0)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM expenses").fetchone()[0], 1)

    def test_shopping_item_can_be_edited_without_changing_expenses(self):
        self.configure()
        shopping = ShoppingService(self.database)
        created = shopping.create({"name": "牛奶", "quantity": 1})
        shopping.update(created["id"], {"name": "燕麥奶", "quantity": 3, "category": "home"})
        item = DashboardService(self.database).get()["shopping"][0]
        self.assertEqual((item["name"], item["quantity"], item["category"]), ("燕麥奶", 3, "home"))

    def test_stale_completed_shopping_is_pruned_without_deleting_expense(self):
        self.configure()
        shopping = ShoppingService(self.database)
        created = shopping.create({"name": "舊購物項目", "quantity": 1})
        shopping.complete(created["id"], {"actual_price": 50, "paid_by": "共同"})
        with self.database.connect() as connection:
            connection.execute(
                "UPDATE shopping_items SET completed_at = datetime('now', '-31 days') WHERE id = ?",
                (created["id"],),
            )
        dashboard = DashboardService(self.database).get()
        self.assertEqual(dashboard["shopping"], [])
        self.assertEqual(len(dashboard["expenses"]), 1)

    def test_existing_database_gets_completed_at_migration(self):
        legacy_path = Path(self.temp_dir.name) / "legacy.db"
        with closing(sqlite3.connect(legacy_path)) as connection:
            with connection:
                connection.execute(
                    "CREATE TABLE shopping_items ("
                    "id INTEGER PRIMARY KEY, name TEXT, quantity INTEGER, category TEXT, "
                    "purchased INTEGER, expense_id INTEGER, created_at TEXT)"
                )
        legacy = Database(legacy_path)
        legacy.initialize()
        with legacy.connect() as connection:
            columns = {row["name"] for row in connection.execute("PRAGMA table_info(shopping_items)")}
        self.assertIn("completed_at", columns)

    def test_layout_validation_and_persistence(self):
        self.configure()
        layout = [dict(item) for item in reversed(DEFAULT_LAYOUT)]
        self.settings.update({"layout": layout})
        saved = DashboardService(self.database).get()["layout"]
        self.assertEqual(saved[0]["id"], layout[0]["id"])
        self.assertEqual([item["order"] for item in saved], list(range(6)))

    def test_custom_split_persists_complementary_percentages(self):
        self.configure()
        self.settings.update({"split": {"method": "custom", "percentage": 65}})
        split = DashboardService(self.database).get()["settings"]["split"]
        self.assertEqual(split["method"], "custom")
        self.assertEqual(split["percentages"], [65.0, 35.0])

    def test_income_split_calculates_percentages(self):
        self.configure()
        self.settings.update({"split": {"method": "income", "incomes": [30_000, 20_000]}})
        split = DashboardService(self.database).get()["settings"]["split"]
        self.assertEqual(split["method"], "income")
        self.assertEqual(split["percentages"], [60.0, 40.0])
        self.assertEqual(split["incomes"], [30_000, 20_000])

    def test_expense_can_be_edited_with_shared_validation(self):
        self.configure()
        expenses = ExpenseService(self.database)
        created = expenses.create({
            "title": "晚餐",
            "amount": 300,
            "category": "dining",
            "paid_by": "Yuki",
            "spent_on": date.today().isoformat(),
        })
        expenses.update(created["id"], {
            "title": "週末晚餐",
            "amount": 450,
            "category": "leisure",
            "paid_by": "Haru",
            "spent_on": date.today().isoformat(),
        })
        edited = DashboardService(self.database).get()["expenses"][0]
        self.assertEqual(edited["title"], "週末晚餐")
        self.assertEqual(edited["amount"], 450)
        self.assertEqual(edited["category"], "leisure")
        self.assertEqual(edited["paid_by"], "Haru")

    def test_dashboard_filters_expenses_by_day_and_category(self):
        self.configure()
        expenses = ExpenseService(self.database)
        today = date.today()
        expenses.create({"title": "今日超市", "amount": 120, "category": "groceries", "paid_by": "Yuki", "spent_on": today.isoformat()})
        expenses.create({"title": "今日晚餐", "amount": 280, "category": "dining", "paid_by": "Haru", "spent_on": today.isoformat()})
        expenses.create({"title": "昨日超市", "amount": 45, "category": "groceries", "paid_by": "Yuki", "spent_on": (today - timedelta(days=1)).isoformat()})

        dashboard = DashboardService(self.database).get(
            month=today.strftime("%Y-%m"),
            period="today",
            category="groceries",
            today=today.isoformat(),
        )

        self.assertEqual([item["title"] for item in dashboard["expenses"]], ["今日超市"])
        self.assertEqual(dashboard["expense_total"], 120)
        self.assertEqual(dashboard["expense_count"], 1)
        self.assertTrue(dashboard["filter"]["is_active"])
        self.assertEqual(dashboard["filter"]["date_from"], today.isoformat())
        self.assertEqual(dashboard["breakdown"][0]["category"], "groceries")

    def test_recent_seven_days_includes_today_and_previous_six_days(self):
        self.configure()
        expenses = ExpenseService(self.database)
        anchor = date(2026, 8, 25)
        for title, offset, amount in (("今日", 0, 10), ("第七日", 6, 20), ("範圍外", 7, 40)):
            expenses.create({
                "title": title,
                "amount": amount,
                "category": "other",
                "paid_by": "共同",
                "spent_on": (anchor - timedelta(days=offset)).isoformat(),
            })

        dashboard = DashboardService(self.database).get(period="last7", today=anchor.isoformat())

        self.assertEqual({item["title"] for item in dashboard["expenses"]}, {"今日", "第七日"})
        self.assertEqual(dashboard["expense_total"], 30)
        self.assertEqual(dashboard["filter"]["date_from"], "2026-08-19")
        self.assertEqual(dashboard["filter"]["date_to"], "2026-08-25")

    def test_calendar_month_switch_returns_historical_month_total(self):
        self.configure()
        expenses = ExpenseService(self.database)
        for title, spent_on, amount in (("舊租金", "2024-02-05", 9000), ("舊電費", "2024-02-28", 520), ("其他年份", "2025-02-05", 100)):
            expenses.create({"title": title, "amount": amount, "category": "home", "paid_by": "共同", "spent_on": spent_on})

        dashboard = DashboardService(self.database).get(month="2024-02", period="month", category="all")

        self.assertEqual(dashboard["month"], "2024-02")
        self.assertEqual(dashboard["month_expense_total"], 9520)
        self.assertEqual(dashboard["expense_total"], 9520)
        self.assertEqual(dashboard["filter"]["date_to"], "2024-02-29")
        self.assertFalse(dashboard["filter"]["is_active"])


if __name__ == "__main__":
    unittest.main()
