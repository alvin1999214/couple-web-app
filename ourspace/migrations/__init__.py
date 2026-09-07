from .types import Migration
from .v001_initial import MIGRATION as INITIAL_SCHEMA
from .v002_shopping_completed_at import MIGRATION as SHOPPING_COMPLETED_AT
from .v003_query_indexes import MIGRATION as QUERY_INDEXES
from .v004_categories import MIGRATION as CATEGORIES_TABLE


MIGRATIONS = (
    INITIAL_SCHEMA,
    SHOPPING_COMPLETED_AT,
    QUERY_INDEXES,
    CATEGORIES_TABLE,
)

LATEST_SCHEMA_VERSION = MIGRATIONS[-1].version

__all__ = ["LATEST_SCHEMA_VERSION", "MIGRATIONS", "Migration"]

