from __future__ import annotations

import sqlite3

from .helpers import ensure_column
from .types import Migration


def apply(connection: sqlite3.Connection) -> None:
    ensure_column(connection, "shopping_items", "completed_at", "TEXT")
    connection.execute(
        "UPDATE shopping_items SET completed_at = created_at "
        "WHERE purchased = 1 AND completed_at IS NULL"
    )


MIGRATION = Migration(2, "shopping_completed_at", apply)
