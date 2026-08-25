from __future__ import annotations

import sqlite3

from .config import SHOPPING_RETENTION_DAYS


def prune_completed_shopping(connection: sqlite3.Connection) -> int:
    """Remove stale checklist rows while deliberately leaving expenses untouched."""
    cursor = connection.execute(
        "DELETE FROM shopping_items "
        "WHERE purchased = 1 AND completed_at IS NOT NULL "
        "AND datetime(completed_at) < datetime('now', ?)",
        (f"-{SHOPPING_RETENTION_DAYS} days",),
    )
    return cursor.rowcount
