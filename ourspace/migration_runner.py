from __future__ import annotations

import sqlite3
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from .migrations import Migration
from .migrations.helpers import table_exists


OpenConnection = Callable[[], sqlite3.Connection]


@dataclass(frozen=True)
class MigrationReport:
    previous_version: int
    current_version: int
    applied_versions: tuple[int, ...]
    backup_path: Path | None = None


class MigrationRunner:
    """Applies immutable migrations in order and records every completed version."""

    def __init__(self, path: Path, open_connection: OpenConnection, migrations: Sequence[Migration]):
        self.path = path
        self.open_connection = open_connection
        self.migrations = tuple(migrations)
        self._validate_registry()

    def run(self) -> MigrationReport:
        database_existed = self.path.exists() and self.path.stat().st_size > 0
        connection = self.open_connection()
        try:
            applied = self._applied(connection)
            self._validate_applied(applied)
            pending = [migration for migration in self.migrations if migration.version not in applied]
            previous_version = max(applied, default=0)
            backup_path = self._backup(connection, pending[0].version) if pending and database_existed else None
            self._ensure_migration_table(connection)
            completed = []
            for migration in pending:
                if self._apply_one(connection, migration):
                    completed.append(migration.version)
            self._verify_database(connection)
            current_version = max(self._applied(connection), default=0)
            return MigrationReport(previous_version, current_version, tuple(completed), backup_path)
        finally:
            connection.close()

    def _apply_one(self, connection: sqlite3.Connection, migration: Migration) -> bool:
        try:
            connection.execute("BEGIN IMMEDIATE")
            if connection.execute(
                "SELECT 1 FROM schema_migrations WHERE version = ?",
                (migration.version,),
            ).fetchone():
                connection.commit()
                return False
            migration.apply(connection)
            connection.execute(
                "INSERT INTO schema_migrations(version, name) VALUES (?, ?)",
                (migration.version, migration.name),
            )
            connection.execute(f"PRAGMA user_version = {migration.version}")
            connection.commit()
            return True
        except Exception:
            connection.rollback()
            raise

    @staticmethod
    def _ensure_migration_table(connection: sqlite3.Connection) -> None:
        connection.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations ("
            "version INTEGER PRIMARY KEY, "
            "name TEXT NOT NULL UNIQUE, "
            "applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
        )
        connection.commit()

    @staticmethod
    def _applied(connection: sqlite3.Connection) -> dict[int, str]:
        if not table_exists(connection, "schema_migrations"):
            return {}
        return {
            int(row["version"]): row["name"]
            for row in connection.execute("SELECT version, name FROM schema_migrations")
        }

    def _validate_registry(self) -> None:
        versions = [migration.version for migration in self.migrations]
        names = [migration.name for migration in self.migrations]
        if not versions or versions != sorted(versions) or versions[0] < 1:
            raise RuntimeError("Database migrations must use positive ascending versions")
        if versions != list(range(1, versions[-1] + 1)):
            raise RuntimeError("Database migration versions must be contiguous")
        if len(set(versions)) != len(versions) or len(set(names)) != len(names):
            raise RuntimeError("Database migration versions and names must be unique")

    def _validate_applied(self, applied: dict[int, str]) -> None:
        registry = {migration.version: migration.name for migration in self.migrations}
        unknown = sorted(set(applied) - set(registry))
        if unknown:
            raise RuntimeError(f"Database schema is newer than this app: versions {unknown}")
        changed = [version for version, name in applied.items() if registry[version] != name]
        if changed:
            raise RuntimeError(f"Applied database migration names have changed: versions {changed}")

    @staticmethod
    def _verify_database(connection: sqlite3.Connection) -> None:
        if connection.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise RuntimeError("Database integrity check failed after migrations")
        violation = connection.execute("PRAGMA foreign_key_check").fetchone()
        if violation:
            raise RuntimeError(f"Database foreign key check failed for table {violation[0]}")

    def _backup(self, source: sqlite3.Connection, next_version: int) -> Path:
        backup_dir = self.path.parent / "backups"
        backup_dir.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        destination_path = backup_dir / f"{self.path.stem}-before-v{next_version}-{timestamp}.db"
        destination = sqlite3.connect(destination_path)
        try:
            source.backup(destination)
            if destination.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise RuntimeError("Migration backup integrity check failed")
        finally:
            destination.close()
        return destination_path
