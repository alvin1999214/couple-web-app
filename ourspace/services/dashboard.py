import sqlite3

from .settings import is_configured
from .shared import Service
from ..config import CATEGORY_META, DEFAULT_CURRENCY, DEFAULT_LAYOUT, DEFAULT_LOCALE, DEFAULT_SPLIT
from ..database import fetch_all, get_setting
from ..expense_filters import ExpenseFilter
from ..maintenance import prune_completed_shopping


class DashboardService(Service):
    def get(
        self,
        month: str | None = None,
        period: str | None = None,
        category: str | None = None,
        today: str | None = None,
    ) -> dict:
        with self.database.connect() as connection:
            if not is_configured(connection):
                return {"configured": False}

            prune_completed_shopping(connection)
            expense_filter = ExpenseFilter.from_query(month, period, category, today)
            where, params = expense_filter.sql()
            expenses = fetch_all(
                connection,
                "SELECT expenses.*, EXISTS(SELECT 1 FROM expense_invoices i WHERE i.expense_id = expenses.id) AS has_invoice "
                f"FROM expenses WHERE {where} "
                "ORDER BY spent_on DESC, id DESC",
                params,
            )
            total = round(sum(item["amount"] for item in expenses), 2)
            month_total = connection.execute(
                "SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE substr(spent_on, 1, 7) = ?",
                (expense_filter.month,),
            ).fetchone()[0]

            try:
                categories = fetch_all(connection, "SELECT * FROM categories ORDER BY is_default DESC, key ASC")
            except sqlite3.OperationalError:
                categories = [
                    {"key": k, "label": v["label"], "icon": v["icon"], "color": v["color"], "is_default": 1}
                    for k, v in CATEGORY_META.items()
                ]

            return {
                "configured": True,
                "month": expense_filter.month,
                "preferences": {"currency": DEFAULT_CURRENCY, "locale": DEFAULT_LOCALE},
                "settings": {
                    "monthly_budget": float(get_setting(connection, "monthly_budget")),
                    "couple_names": get_setting(connection, "couple_names"),
                    "started_on": get_setting(connection, "started_on"),
                    "split": get_setting(connection, "split", DEFAULT_SPLIT),
                },
                "layout": get_setting(connection, "layout", DEFAULT_LAYOUT),
                "categories": categories,
                "expenses": expenses,
                "expense_total": total,
                "month_expense_total": round(float(month_total), 2),
                "expense_count": len(expenses),
                "filter": expense_filter.as_dict(),
                "breakdown": self._breakdown(expenses, categories),
                "shopping": fetch_all(connection, "SELECT * FROM shopping_items ORDER BY purchased, id DESC"),
                "todos": fetch_all(
                    connection,
                    "SELECT * FROM todos ORDER BY done, due_date IS NULL, due_date, id DESC",
                ),
                "special_days": fetch_all(
                    connection,
                    "SELECT * FROM special_days ORDER BY event_date, id",
                ),
            }

    @staticmethod
    def _breakdown(expenses: list[dict], categories: list[dict] | None = None) -> list[dict]:
        result = []
        meta_by_key = {}
        if categories:
            for cat in categories:
                meta_by_key[cat["key"]] = {"label": cat["label"], "icon": cat["icon"], "color": cat["color"]}
        for k, v in CATEGORY_META.items():
            if k not in meta_by_key:
                meta_by_key[k] = v

        for cat_key, metadata in meta_by_key.items():
            total = sum(item["amount"] for item in expenses if item["category"] == cat_key)
            if total:
                result.append({"category": cat_key, "amount": round(total, 2), **metadata})
        return sorted(result, key=lambda item: item["amount"], reverse=True)
