from __future__ import annotations

import sqlite3

from .types import Migration


DEFAULT_CATEGORIES = (
    ("groceries", "日常購物", "basket", "#ff8e7a", 1),
    ("dining", "外出用餐", "utensils", "#f6bd61", 1),
    ("home", "居家生活", "home", "#8ec5a7", 1),
    ("utilities", "水電煤", "bolt", "#9ba5e8", 1),
    ("transport", "交通", "train", "#62b3c4", 1),
    ("leisure", "約會娛樂", "sparkles", "#d99cc8", 1),
    ("other", "其他", "dots", "#a8a59e", 1),
)


def apply(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS categories (
            key TEXT PRIMARY KEY,
            label TEXT NOT NULL,
            icon TEXT NOT NULL DEFAULT 'dots',
            color TEXT NOT NULL DEFAULT '#a8a59e',
            is_default INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    for key, label, icon, color, is_default in DEFAULT_CATEGORIES:
        connection.execute(
            """
            INSERT OR IGNORE INTO categories (key, label, icon, color, is_default)
            VALUES (?, ?, ?, ?, ?)
            """,
            (key, label, icon, color, is_default),
        )


MIGRATION = Migration(4, "categories_table", apply)
