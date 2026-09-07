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
            row = connection.execute("SELECT * FROM todos WHERE id = ?", (item_id,)).fetchone()
            if not row:
                raise ApiError("找不到待辦事項", 404)
            updates = []
            params = []
            if "done" in data:
                updates.append("done = ?")
                params.append(1 if boolean(data["done"]) else 0)
            if "title" in data:
                updates.append("title = ?")
                params.append(text(data["title"], label="待辦事項"))
            if "assignee" in data:
                updates.append("assignee = ?")
                params.append(text(data["assignee"], max_length=30, label="負責人"))
            if "due_date" in data:
                updates.append("due_date = ?")
                params.append(iso_date(data["due_date"]) if data.get("due_date") else None)
            if not updates:
                raise ApiError("沒有可更新的資料")
            params.append(item_id)
            connection.execute(f"UPDATE todos SET {', '.join(updates)} WHERE id = ?", params)
        return {"ok": True}


    def delete(self, item_id: int) -> dict:
        with self.database.connect() as connection:
            cursor = connection.execute("DELETE FROM todos WHERE id = ?", (item_id,))
            if not cursor.rowcount:
                raise ApiError("找不到待辦事項", 404)
        return {"ok": True}

