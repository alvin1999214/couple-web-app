from __future__ import annotations

import os
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"
DATA_DIR = Path(os.getenv("DATA_DIR", BASE_DIR / "data"))
DB_PATH = DATA_DIR / "ourspace.db"
PORT = int(os.getenv("PORT", "8000"))
APP_NAME = "Teletubbyland"
DEFAULT_CURRENCY = "HKD"
DEFAULT_LOCALE = "zh-HK"
SHOPPING_RETENTION_DAYS = 30

DEFAULT_SPLIT = {
    "method": "equal",
    "percentages": [50.0, 50.0],
    "incomes": [0.0, 0.0],
}

DEFAULT_LAYOUT = [
    {"id": "budget", "size": "large", "order": 0, "hidden": False},
    {"id": "balance", "size": "small", "order": 1, "hidden": False},
    {"id": "shopping", "size": "medium", "order": 2, "hidden": False},
    {"id": "todo", "size": "medium", "order": 3, "hidden": False},
    {"id": "moments", "size": "medium", "order": 4, "hidden": False},
    {"id": "insight", "size": "medium", "order": 5, "hidden": False},
]

CATEGORY_META = {
    "groceries": {"label": "日常購物", "icon": "basket", "color": "#ff8e7a"},
    "dining": {"label": "外出用餐", "icon": "utensils", "color": "#f6bd61"},
    "home": {"label": "居家生活", "icon": "home", "color": "#8ec5a7"},
    "utilities": {"label": "水電煤", "icon": "bolt", "color": "#9ba5e8"},
    "transport": {"label": "交通", "icon": "train", "color": "#62b3c4"},
    "leisure": {"label": "約會娛樂", "icon": "sparkles", "color": "#d99cc8"},
    "other": {"label": "其他", "icon": "dots", "color": "#a8a59e"},
}

WIDGET_IDS = {item["id"] for item in DEFAULT_LAYOUT}
WIDGET_SIZES = {"small", "medium", "large", "wide"}
