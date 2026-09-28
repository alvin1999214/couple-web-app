import sqlite3
from datetime import date

from .shared import Service
from ..errors import ApiError
from ..invoice_images import decode_invoice_image
from ..invoice_duplicates import find_invoice_duplicates
from ..validation import category, iso_date, number, text


class ExpenseService(Service):
    def create(self, data: dict) -> dict:
        invoice = decode_invoice_image(data["invoice_image"]) if "invoice_image" in data else None
        with self.database.connect() as connection:
            # Serialize checking and inserting so simultaneous uploads cannot both pass.
            connection.execute("BEGIN IMMEDIATE")
            values = self._values(data, connection)
            if invoice:
                duplicates = find_invoice_duplicates(connection, invoice[1], values[4], round(values[1], 2))
                reviewed = data.get("reviewed_invoice_ids", [])
                if not isinstance(reviewed, list) or any(type(item) is not int for item in reviewed):
                    raise ApiError("重複單據確認資料無效")
                if any(item["id"] not in reviewed for item in duplicates):
                    raise ApiError("這張單據可能已經上傳過了，請先查看已有圖片確認", 409,
                                   details={"code": "duplicate_invoice", "duplicates": duplicates})
            cursor = connection.execute(
                "INSERT INTO expenses(title, amount, category, paid_by, spent_on) VALUES (?, ?, ?, ?, ?)",
                values,
            )
            item_id = cursor.lastrowid
            if invoice:
                connection.execute(
                    "INSERT INTO expense_invoices(expense_id, content_type, image) VALUES (?, ?, ?)",
                    (item_id, *invoice),
                )
        return {"ok": True, "id": item_id}

    def invoice(self, item_id: int) -> dict:
        with self.database.connect() as connection:
            row = connection.execute(
                "SELECT content_type, image FROM expense_invoices WHERE expense_id = ?", (item_id,),
            ).fetchone()
        if row is None:
            raise ApiError("找不到此開支的單據", 404)
        return {"__image__": True, "content_type": row["content_type"], "content": row["image"]}

    def update(self, item_id: int, data: dict) -> dict:
        with self.database.connect() as connection:
            cursor = connection.execute(
                "UPDATE expenses SET title = ?, amount = ?, category = ?, paid_by = ?, spent_on = ? WHERE id = ?",
                (*self._values(data, connection), item_id),
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
    def _values(data: dict, connection: sqlite3.Connection | None = None) -> tuple:
        valid_keys = None
        if connection is not None:
            try:
                valid_keys = {row[0] for row in connection.execute("SELECT key FROM categories")}
            except sqlite3.OperationalError:
                pass
        return (
            text(data.get("title"), label="開支名稱"),
            number(data.get("amount")),
            category(data.get("category", "other"), valid_keys=valid_keys),
            text(data.get("paid_by", "共同"), max_length=30, label="付款人"),
            iso_date(data.get("spent_on") or date.today().isoformat()),
        )
