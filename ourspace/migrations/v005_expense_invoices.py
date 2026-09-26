import sqlite3

from .types import Migration


def apply(connection: sqlite3.Connection) -> None:
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


MIGRATION = Migration(5, "expense_invoices", apply)
