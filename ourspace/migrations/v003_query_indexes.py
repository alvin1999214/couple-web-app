from __future__ import annotations

import sqlite3

from .types import Migration


INDEXES = (
    "CREATE INDEX IF NOT EXISTS idx_expenses_spent_on ON expenses(spent_on)",
    "CREATE INDEX IF NOT EXISTS idx_expenses_category_spent_on ON expenses(category, spent_on)",
    "CREATE INDEX IF NOT EXISTS idx_shopping_items_purchased_id ON shopping_items(purchased, id DESC)",
    "CREATE INDEX IF NOT EXISTS idx_todos_done_due_date ON todos(done, due_date)",
    "CREATE INDEX IF NOT EXISTS idx_special_days_event_date ON special_days(event_date)",
)


def apply(connection: sqlite3.Connection) -> None:
    for statement in INDEXES:
        connection.execute(statement)


MIGRATION = Migration(3, "query_indexes", apply)
