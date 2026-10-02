import sqlite3
import tempfile
import unittest
from pathlib import Path

from ourspace.database import Database
from ourspace.migrations import LATEST_SCHEMA_VERSION, MIGRATIONS, Migration
from ourspace.migrations.helpers import ensure_column


class MigrationTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.path = Path(self.temp_dir.name) / "migration-test.db"

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_fresh_database_records_versions_and_indexes(self):
        database = Database(self.path)

        first = database.initialize()
        second = database.initialize()

        self.assertEqual(first.previous_version, 0)
        self.assertEqual(first.current_version, LATEST_SCHEMA_VERSION)
        self.assertEqual(first.applied_versions, (1, 2, 3, 4, 5, 6))
        self.assertIsNone(first.backup_path)
        self.assertEqual(second.applied_versions, ())
        self.assertIsNone(second.backup_path)
        with database.connect() as connection:
            versions = [row["version"] for row in connection.execute(
                "SELECT version FROM schema_migrations ORDER BY version"
            )]
            indexes = {row["name"] for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'index'"
            )}
            user_version = connection.execute("PRAGMA user_version").fetchone()[0]
        self.assertEqual(versions, [1, 2, 3, 4, 5, 6])
        self.assertEqual(user_version, LATEST_SCHEMA_VERSION)
        self.assertIn("idx_expenses_spent_on", indexes)
        self.assertIn("idx_expenses_category_spent_on", indexes)

    def test_existing_database_is_backed_up_and_data_is_preserved(self):
        with sqlite3.connect(self.path) as connection:
            connection.execute(
                "CREATE TABLE expenses ("
                "id INTEGER PRIMARY KEY, title TEXT, amount REAL, category TEXT, "
                "paid_by TEXT, spent_on TEXT, shopping_item_id INTEGER, created_at TEXT)"
            )
            connection.execute(
                "INSERT INTO expenses VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (7, "舊有開支", 128.5, "other", "共同", "2025-12-01", None, "2025-12-01"),
            )

        database = Database(self.path)
        report = database.initialize()

        self.assertIsNotNone(report.backup_path)
        self.assertTrue(report.backup_path.is_file())
        with database.connect() as connection:
            expense = connection.execute("SELECT * FROM expenses WHERE id = 7").fetchone()
            integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        self.assertEqual(expense["title"], "舊有開支")
        self.assertEqual(expense["amount"], 128.5)
        self.assertEqual(integrity, "ok")
        with sqlite3.connect(report.backup_path) as backup:
            self.assertEqual(backup.execute("SELECT title FROM expenses WHERE id = 7").fetchone()[0], "舊有開支")
            self.assertEqual(backup.execute("PRAGMA integrity_check").fetchone()[0], "ok")

    def test_new_field_and_table_migration_preserves_existing_rows(self):
        database = Database(self.path)
        database.initialize()
        with database.connect() as connection:
            connection.execute(
                "INSERT INTO expenses(title, amount, category, paid_by, spent_on) VALUES (?, ?, ?, ?, ?)",
                ("保留我", 99, "other", "共同", "2026-01-02"),
            )

        def extend_schema(connection):
            ensure_column(connection, "expenses", "note", "TEXT")
            connection.execute(
                "CREATE TABLE household_assets ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)"
            )

        extended = Database(self.path, migrations=(*MIGRATIONS, Migration(7, "expense_note_and_assets", extend_schema)))
        report = extended.initialize()
        repeated = extended.initialize()

        self.assertEqual(report.applied_versions, (7,))
        self.assertIsNotNone(report.backup_path)
        self.assertEqual(repeated.applied_versions, ())
        self.assertIsNone(repeated.backup_path)
        with extended.connect() as connection:
            columns = {row["name"] for row in connection.execute("PRAGMA table_info(expenses)")}
            tables = {row["name"] for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )}
            original = connection.execute("SELECT title, amount FROM expenses").fetchone()
        self.assertIn("note", columns)
        self.assertIn("household_assets", tables)
        self.assertEqual(tuple(original), ("保留我", 99.0))

    def test_invoice_migration_preserves_v4_expenses(self):
        old = Database(self.path, migrations=MIGRATIONS[:4])
        old.initialize()
        with old.connect() as connection:
            connection.execute("INSERT INTO expenses(title, amount, category, paid_by, spent_on) VALUES ('Old', 20, 'other', 'A', '2026-01-01')")
        upgraded = Database(self.path)
        report = upgraded.initialize()
        self.assertEqual(report.applied_versions, (5, 6))
        self.assertTrue(report.backup_path.is_file())
        with upgraded.connect() as connection:
            self.assertEqual(connection.execute("SELECT title, amount FROM expenses").fetchone()[:], ('Old', 20))
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM expense_invoices").fetchone()[0], 0)

    def test_failed_migration_rolls_back_schema_change(self):
        Database(self.path).initialize()

        def broken_migration(connection):
            ensure_column(connection, "expenses", "temporary_field", "TEXT")
            connection.execute("INSERT INTO table_that_does_not_exist VALUES (1)")

        database = Database(self.path, migrations=(*MIGRATIONS, Migration(7, "broken", broken_migration)))
        with self.assertRaises(sqlite3.OperationalError):
            database.initialize()

        with database.connect() as connection:
            columns = {row["name"] for row in connection.execute("PRAGMA table_info(expenses)")}
            applied = connection.execute(
                "SELECT COUNT(*) FROM schema_migrations WHERE version = 7"
            ).fetchone()[0]
        self.assertNotIn("temporary_field", columns)
        self.assertEqual(applied, 0)
        self.assertEqual(len(list((self.path.parent / "backups").glob("*.db"))), 1)


if __name__ == "__main__":
    unittest.main()
