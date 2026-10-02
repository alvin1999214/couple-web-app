import sqlite3

from .types import Migration


def apply(connection: sqlite3.Connection) -> None:
    connection.execute("""CREATE TABLE order_import_batches (
        token TEXT PRIMARY KEY, digest TEXT NOT NULL, expense_ids TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )""")
    connection.execute("""CREATE TABLE expense_orders (
        expense_id INTEGER PRIMARY KEY REFERENCES expenses(id) ON DELETE CASCADE,
        platform TEXT NOT NULL, order_id TEXT, original_amount REAL, currency TEXT
    )""")
    connection.execute("CREATE UNIQUE INDEX idx_expense_order_identity ON expense_orders(platform, order_id) WHERE order_id IS NOT NULL")


MIGRATION = Migration(6, "order_imports", apply)
