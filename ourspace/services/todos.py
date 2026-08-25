from __future__ import annotations

from .shared import Service
from ..errors import ApiError
from ..validation import boolean, iso_date, text


class TodoService(Service):
    def create(self, data: dict) -> dict:
        due_date = iso_date(data["due_date"]) if data.get("due_date") else None
        values = (
            text(data.get("title"), label="待辦事項"),
            text(data.get("assignee", "一起"), max_length=30, label="負責人"),
            due_date,
        )
        with self.database.connect() as connection:
            cursor = connection.execute(
                "INSERT INTO todos(title, assignee, due_date) VALUES (?, ?, ?)",
                values,
            )
            item_id = cursor.lastrowid
        return {"ok": True, "id": item_id}

    def update(self, item_id: int, data: dict) -> dict:
        with self.database.connect() as connection:
            cursor = connection.execute(
                "UPDATE todos SET done = ? WHERE id = ?",
                (1 if boolean(data.get("done")) else 0, item_id),
            )
            if not cursor.rowcount:
                raise ApiError("找不到待辦事項", 404)
        return {"ok": True}

    def delete(self, item_id: int) -> dict:
        with self.database.connect() as connection:
            cursor = connection.execute("DELETE FROM todos WHERE id = ?", (item_id,))
            if not cursor.rowcount:
                raise ApiError("找不到待辦事項", 404)
        return {"ok": True}

