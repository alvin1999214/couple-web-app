from __future__ import annotations

from .shared import Service
from ..errors import ApiError
from ..validation import boolean, iso_date, text


class SpecialDayService(Service):
    def create(self, data: dict) -> dict:
        values = (
            text(data.get("title"), label="日子名稱"),
            iso_date(data.get("event_date")),
            text(data.get("emoji", "♥"), max_length=8, label="小記號"),
            1 if boolean(data.get("repeats_yearly"), default=True) else 0,
        )
        with self.database.connect() as connection:
            cursor = connection.execute(
                "INSERT INTO special_days(title, event_date, emoji, repeats_yearly) VALUES (?, ?, ?, ?)",
                values,
            )
            item_id = cursor.lastrowid
        return {"ok": True, "id": item_id}

    def update(self, item_id: int, data: dict) -> dict:
        with self.database.connect() as connection:
            row = connection.execute("SELECT * FROM special_days WHERE id = ?", (item_id,)).fetchone()
            if not row:
                raise ApiError("找不到特別日子", 404)
            updates = []
            params = []
            if "title" in data:
                updates.append("title = ?")
                params.append(text(data["title"], label="日子名稱"))
            if "event_date" in data:
                updates.append("event_date = ?")
                params.append(iso_date(data["event_date"]))
            if "emoji" in data:
                updates.append("emoji = ?")
                params.append(text(data["emoji"], max_length=8, label="小記號"))
            if "repeats_yearly" in data:
                updates.append("repeats_yearly = ?")
                params.append(1 if boolean(data["repeats_yearly"]) else 0)
            if not updates:
                raise ApiError("沒有可更新的資料")
            params.append(item_id)
            connection.execute(f"UPDATE special_days SET {', '.join(updates)} WHERE id = ?", params)
        return {"ok": True}

    def delete(self, item_id: int) -> dict:
        with self.database.connect() as connection:
            cursor = connection.execute("DELETE FROM special_days WHERE id = ?", (item_id,))
            if not cursor.rowcount:
                raise ApiError("找不到特別日子", 404)
        return {"ok": True}

