from __future__ import annotations

from datetime import date

from .shared import Service
from ..errors import ApiError
from ..validation import category, iso_date, number, text


class ExpenseService(Service):
    def create(self, data: dict) -> dict:
        with self.database.connect() as connection:
            cursor = connection.execute(
                "INSERT INTO expenses(title, amount, category, paid_by, spent_on) VALUES (?, ?, ?, ?, ?)",
                self._values(data),
            )
            item_id = cursor.lastrowid
        return {"ok": True, "id": item_id}

    def update(self, item_id: int, data: dict) -> dict:
        with self.database.connect() as connection:
            cursor = connection.execute(
                "UPDATE expenses SET title = ?, amount = ?, category = ?, paid_by = ?, spent_on = ? WHERE id = ?",
                (*self._values(data), item_id),
            )
            if not cursor.rowcount:
                raise ApiError("找不到開支", 404)
        return {"ok": True}

    def delete(self, item_id: int) -> dict:
        with self.database.connect() as connection:
            cursor = connection.execute("DELETE FROM expenses WHERE id = ?", (item_id,))
            if not cursor.rowcount:
                raise ApiError("找不到開支", 404)
        return {"ok": True}

    @staticmethod
    def _values(data: dict) -> tuple:
        return (
            text(data.get("title"), label="開支名稱"),
            number(data.get("amount")),
            category(data.get("category", "other")),
            text(data.get("paid_by", "共同"), max_length=30, label="付款人"),
            iso_date(data.get("spent_on") or date.today().isoformat()),
        )
