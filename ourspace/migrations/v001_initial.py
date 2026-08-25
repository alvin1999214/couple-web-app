from __future__ import annotations

import sqlite3

from .types import Migration


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


def apply(connection: sqlite3.Connection) -> None:
    for statement in STATEMENTS:
        connection.execute(statement)


MIGRATION = Migration(1, "initial_schema", apply)
