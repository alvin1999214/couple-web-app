import sqlite3
from datetime import date

from .shared import Service
from ..errors import ApiError
from ..validation import category, iso_date, number, positive_integer, text


class ShoppingService(Service):
    def create(self, data: dict) -> dict:
        with self.database.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            cursor = connection.execute(
                "INSERT INTO shopping_items(name, quantity, category) VALUES (?, ?, ?)",
                self._item_values(data, connection),
            )
            item_id = cursor.lastrowid
        return {"ok": True, "id": item_id}

    def update(self, item_id: int, data: dict) -> dict:
        with self.database.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            cursor = connection.execute(
                "UPDATE shopping_items SET name = ?, quantity = ?, category = ? WHERE id = ?",
                (*self._item_values(data, connection), item_id),
            )
            if not cursor.rowcount:
                raise ApiError("找不到購物項目", 404)
        return {"ok": True}

    def complete(self, item_id: int, data: dict) -> dict:
        actual_price = number(data.get("actual_price"), label="實付金額")
        paid_by = text(data.get("paid_by", "共同"), max_length=30, label="付款人")
        spent_on = iso_date(data.get("spent_on") or date.today().isoformat())
        with self.database.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            item = connection.execute("SELECT * FROM shopping_items WHERE id = ?", (item_id,)).fetchone()
            if not item:
                raise ApiError("找不到購物項目", 404)
            if item["purchased"]:
                raise ApiError("此項目已完成及入帳", 409)
            cursor = connection.execute(
                "INSERT INTO expenses(title, amount, category, paid_by, spent_on, shopping_item_id) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (item["name"], actual_price, item["category"], paid_by, spent_on, item_id),
            )
            connection.execute(
                "UPDATE shopping_items SET purchased = 1, expense_id = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?",
                (cursor.lastrowid, item_id),
            )
            expense_id = cursor.lastrowid
        return {"ok": True, "expense_id": expense_id}

    def delete(self, item_id: int) -> dict:
        with self.database.connect() as connection:
            cursor = connection.execute("DELETE FROM shopping_items WHERE id = ?", (item_id,))
            if not cursor.rowcount:
                raise ApiError("找不到購物項目", 404)
        return {"ok": True}

    def clear_completed(self) -> dict:
        with self.database.connect() as connection:
            cursor = connection.execute("DELETE FROM shopping_items WHERE purchased = 1")
        return {"ok": True, "removed": cursor.rowcount}

    @staticmethod
    def _item_values(data: dict, connection: sqlite3.Connection | None = None) -> tuple:
        valid_keys = None
        if connection is not None:
            try:
                valid_keys = {row[0] for row in connection.execute("SELECT key FROM categories")}
            except sqlite3.OperationalError:
                pass
        return (
            text(data.get("name"), label="購物項目"),
            positive_integer(data.get("quantity", 1)),
            category(data.get("category", "groceries"), valid_keys=valid_keys),
        )

