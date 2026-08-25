from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from pathlib import Path

from .config import DB_PATH
from .migration_runner import MigrationReport, MigrationRunner
from .migrations import MIGRATIONS, Migration
from .migrations.helpers import ensure_column


class Database:
    """Owns SQLite lifecycle; domain services receive this as a dependency."""

    def __init__(self, path: str | Path = DB_PATH, migrations: Sequence[Migration] | None = None):
        self.path = Path(path)
        self.migrations = tuple(MIGRATIONS if migrations is None else migrations)

    def _open(self) -> sqlite3.Connection:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA journal_mode = WAL")
        connection.execute("PRAGMA busy_timeout = 5000")
        return connection

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        connection = self._open()
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def initialize(self) -> MigrationReport:
        return MigrationRunner(self.path, self._open, self.migrations).run()


def fetch_all(connection: sqlite3.Connection, sql: str, params: tuple = ()) -> list[dict]:
    return [dict(row) for row in connection.execute(sql, params).fetchall()]


def get_setting(connection: sqlite3.Connection, key: str, fallback=None):
    row = connection.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    if not row:
        return fallback
    try:
        return json.loads(row[0])
    except json.JSONDecodeError:
        return row[0]


def set_setting(connection: sqlite3.Connection, key: str, value) -> None:
    serialized = json.dumps(value, ensure_ascii=False)
    connection.execute(
        "INSERT INTO settings(key, value) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, serialized),
    )


def set_settings(connection: sqlite3.Connection, values: dict) -> None:
    for key, value in values.items():
        set_setting(connection, key, value)
