from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from typing import Callable


MigrationAction = Callable[[sqlite3.Connection], None]


@dataclass(frozen=True)
class Migration:
    """One immutable, ordered database schema change."""

    version: int
    name: str
    apply: MigrationAction
