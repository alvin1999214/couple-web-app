from __future__ import annotations

from .shared import Service
from ..config import DEFAULT_LAYOUT, DEFAULT_SPLIT, WIDGET_IDS, WIDGET_SIZES
from ..database import get_setting, set_settings
from ..errors import ApiError
from ..split import normalize_split
from ..validation import iso_date, number, text


def is_configured(connection) -> bool:
    return get_setting(connection, "onboarding_complete", False) is True


class SettingsService(Service):
    def status(self) -> dict:
        with self.database.connect() as connection:
            return {"configured": is_configured(connection)}

    def configure(self, data: dict) -> dict:
        names = self._names(data.get("couple_names"))
        values = {
            "couple_names": names,
            "monthly_budget": number(data.get("monthly_budget")),
            "started_on": iso_date(data.get("started_on"), label="開始交往日期", allow_future=False),
            "layout": DEFAULT_LAYOUT,
            "split": DEFAULT_SPLIT,
            "onboarding_complete": True,
        }
        with self.database.connect() as connection:
            if is_configured(connection):
                raise ApiError("初次設定已經完成", 409)
            set_settings(connection, values)
        return {"ok": True}

    def update(self, data: dict) -> dict:
        values = {}
        if "monthly_budget" in data:
            values["monthly_budget"] = number(data["monthly_budget"])
        if "couple_names" in data:
            values["couple_names"] = self._names(data["couple_names"])
        if "started_on" in data:
            values["started_on"] = iso_date(data["started_on"], label="開始交往日期", allow_future=False)
        if "layout" in data:
            values["layout"] = self._layout(data["layout"])
        if "split" in data:
            values["split"] = normalize_split(data["split"])
        if not values:
            raise ApiError("沒有可更新的設定")
        with self.database.connect() as connection:
            if not is_configured(connection):
                raise ApiError("請先完成初次設定", 409)
            set_settings(connection, values)
        return {"ok": True}

    @staticmethod
    def _names(value) -> list[str]:
        if not isinstance(value, list) or len(value) != 2:
            raise ApiError("請填寫兩位使用者的名字")
        return [text(name, max_length=30, label="名字") for name in value]

    @staticmethod
    def _layout(value) -> list[dict]:
        if not isinstance(value, list) or len(value) > len(WIDGET_IDS):
            raise ApiError("版面資料不正確")
        normalized = []
        seen_ids = set()
        for item in value:
            if not isinstance(item, dict):
                raise ApiError("版面元件不正確")
            widget_id = item.get("id")
            size = item.get("size")
            if widget_id not in WIDGET_IDS or size not in WIDGET_SIZES or widget_id in seen_ids:
                raise ApiError("版面元件不正確或重複")
            seen_ids.add(widget_id)
            normalized.append({
                "id": widget_id,
                "size": size,
                "order": len(normalized),
                "hidden": bool(item.get("hidden", False)),
            })
        return normalized
