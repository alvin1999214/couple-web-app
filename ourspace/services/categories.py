from __future__ import annotations

import re
import sqlite3

from .shared import Service
from ..database import fetch_all
from ..errors import ApiError
from ..validation import text


COLOR_PATTERN = re.compile(r"^#(?:[0-9a-fA-F]{3}){1,2}$")
KEY_PATTERN = re.compile(r"^[a-z0-9_\-]{2,30}$")


class CategoryService(Service):
    def list(self) -> list[dict]:
        with self.database.connect() as connection:
            return self._fetch_all_with_counts(connection)

    def create(self, data: dict) -> dict:
        raw_key = str(data.get("key", "")).strip().lower()
        if not KEY_PATTERN.match(raw_key):
            raise ApiError("分類識別碼需為 2-30 個英文小寫字元、數字、底線或連字號")

        label = text(data.get("label"), max_length=50, label="分類名稱")
        icon = str(data.get("icon", "dots")).strip()[:30] or "dots"
        color = self._validate_color(data.get("color"))

        with self.database.connect() as connection:
            existing = connection.execute("SELECT 1 FROM categories WHERE key = ?", (raw_key,)).fetchone()
            if existing:
                raise ApiError("此分類代碼已存在", 409)

            connection.execute(
                "INSERT INTO categories (key, label, icon, color, is_default) VALUES (?, ?, ?, ?, 0)",
                (raw_key, label, icon, color),
            )
        return {"ok": True, "category": {"key": raw_key, "label": label, "icon": icon, "color": color, "is_default": 0}}

    def update(self, key: str, data: dict) -> dict:
        normalized_key = str(key).strip().lower()
        with self.database.connect() as connection:
            row = connection.execute("SELECT * FROM categories WHERE key = ?", (normalized_key,)).fetchone()
            if not row:
                raise ApiError("找不到指定分類", 404)

            updates = []
            params = []
            if "label" in data:
                updates.append("label = ?")
                params.append(text(data["label"], max_length=50, label="分類名稱"))
            if "icon" in data:
                updates.append("icon = ?")
                params.append(str(data["icon"]).strip()[:30] or "dots")
            if "color" in data:
                updates.append("color = ?")
                params.append(self._validate_color(data["color"]))

            if not updates:
                raise ApiError("沒有可更新的分類資料")

            params.append(normalized_key)
            connection.execute(f"UPDATE categories SET {', '.join(updates)} WHERE key = ?", params)
        return {"ok": True}

    def delete(self, key: str) -> dict:
        normalized_key = str(key).strip().lower()
        with self.database.connect() as connection:
            row = connection.execute("SELECT is_default FROM categories WHERE key = ?", (normalized_key,)).fetchone()
            if not row:
                raise ApiError("找不到指定分類", 404)
            if row["is_default"]:
                raise ApiError("系統預設分類不可刪除", 400)

            # Safely migrate existing expenses and shopping items using this category to 'other'
            connection.execute("UPDATE expenses SET category = 'other' WHERE category = ?", (normalized_key,))
            connection.execute("UPDATE shopping_items SET category = 'other' WHERE category = ?", (normalized_key,))
            connection.execute("DELETE FROM categories WHERE key = ?", (normalized_key,))
        return {"ok": True}

    @staticmethod
    def _fetch_all_with_counts(connection: sqlite3.Connection) -> list[dict]:
        sql = """
            SELECT
                c.key,
                c.label,
                c.icon,
                c.color,
                c.is_default,
                c.created_at,
                (SELECT COUNT(*) FROM expenses e WHERE e.category = c.key) AS expense_count,
                (SELECT COUNT(*) FROM shopping_items s WHERE s.category = c.key) AS shopping_count
            FROM categories c
            ORDER BY c.is_default DESC, c.key ASC
        """
        return fetch_all(connection, sql)

    @staticmethod
    def _validate_color(color_val: str | None) -> str:
        color = str(color_val or "").strip()
        if not color or not COLOR_PATTERN.match(color):
            return "#a8a59e"
        return color
