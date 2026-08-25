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

    def delete(self, item_id: int) -> dict:
        with self.database.connect() as connection:
            cursor = connection.execute("DELETE FROM special_days WHERE id = ?", (item_id,))
            if not cursor.rowcount:
                raise ApiError("找不到特別日子", 404)
        return {"ok": True}
