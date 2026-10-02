from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from typing import Callable

from .helpers import ensure_column


MigrationAction = Callable[[sqlite3.Connection], None]


@dataclass(frozen=True)
class Migration:
    """One immutable, ordered database schema change."""

    version: int
    name: str
    apply: MigrationAction


STATEMENTS = (
    """
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        amount REAL NOT NULL CHECK(amount >= 0),
        category TEXT NOT NULL DEFAULT 'other',
        paid_by TEXT NOT NULL DEFAULT '共同',
        spent_on TEXT NOT NULL,
        shopping_item_id INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS shopping_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity > 0),
        category TEXT NOT NULL DEFAULT 'groceries',
        purchased INTEGER NOT NULL DEFAULT 0,
        expense_id INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(expense_id) REFERENCES expenses(id) ON DELETE SET NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS todos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        assignee TEXT NOT NULL DEFAULT '一起',
        due_date TEXT,
        done INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS special_days (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        event_date TEXT NOT NULL,
        emoji TEXT NOT NULL DEFAULT '♥',
        repeats_yearly INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
    """,
)


def apply_v001_initial_schema(connection: sqlite3.Connection) -> None:
    for statement in STATEMENTS:
        connection.execute(statement)


def apply_v002_shopping_completed_at(connection: sqlite3.Connection) -> None:
    ensure_column(connection, "shopping_items", "completed_at", "TEXT")
    connection.execute(
        "UPDATE shopping_items SET completed_at = created_at "
        "WHERE purchased = 1 AND completed_at IS NULL"
    )


INDEXES = (
    "CREATE INDEX IF NOT EXISTS idx_expenses_spent_on ON expenses(spent_on)",
    "CREATE INDEX IF NOT EXISTS idx_expenses_category_spent_on ON expenses(category, spent_on)",
    "CREATE INDEX IF NOT EXISTS idx_shopping_items_purchased_id ON shopping_items(purchased, id DESC)",
    "CREATE INDEX IF NOT EXISTS idx_todos_done_due_date ON todos(done, due_date)",
    "CREATE INDEX IF NOT EXISTS idx_special_days_event_date ON special_days(event_date)",
)


def apply_v003_query_indexes(connection: sqlite3.Connection) -> None:
    for statement in INDEXES:
        connection.execute(statement)


DEFAULT_CATEGORIES = (
    ("groceries", "日常購物", "basket", "#ff8e7a", 1),
    ("dining", "外出用餐", "utensils", "#f6bd61", 1),
    ("home", "居家生活", "home", "#8ec5a7", 1),
    ("utilities", "水電煤", "bolt", "#9ba5e8", 1),
    ("transport", "交通", "train", "#62b3c4", 1),
    ("leisure", "約會娛樂", "sparkles", "#d99cc8", 1),
    ("other", "其他", "dots", "#a8a59e", 1),
)


def apply_v004_categories_table(connection: sqlite3.Connection) -> None:
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


def apply_v005_expense_invoices(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE expense_invoices (
            expense_id INTEGER PRIMARY KEY REFERENCES expenses(id) ON DELETE CASCADE,
            content_type TEXT NOT NULL CHECK(content_type IN ('image/jpeg', 'image/png', 'image/webp')),
            image BLOB NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )


def apply_v006_order_imports(connection: sqlite3.Connection) -> None:
    connection.execute("""CREATE TABLE order_import_batches (
        token TEXT PRIMARY KEY, digest TEXT NOT NULL, expense_ids TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )""")
    connection.execute("""CREATE TABLE expense_orders (
        expense_id INTEGER PRIMARY KEY REFERENCES expenses(id) ON DELETE CASCADE,
        platform TEXT NOT NULL, order_id TEXT, original_amount REAL, currency TEXT
    )""")
    connection.execute("CREATE UNIQUE INDEX idx_expense_order_identity ON expense_orders(platform, order_id) WHERE order_id IS NOT NULL")


# Append new versions here; preserve published version numbers, names and behavior.
MIGRATIONS = (
    Migration(1, "initial_schema", apply_v001_initial_schema),
    Migration(2, "shopping_completed_at", apply_v002_shopping_completed_at),
    Migration(3, "query_indexes", apply_v003_query_indexes),
    Migration(4, "categories_table", apply_v004_categories_table),
    Migration(5, "expense_invoices", apply_v005_expense_invoices),
    Migration(6, "order_imports", apply_v006_order_imports),
)

LATEST_SCHEMA_VERSION = MIGRATIONS[-1].version

__all__ = ["LATEST_SCHEMA_VERSION", "MIGRATIONS", "Migration"]
