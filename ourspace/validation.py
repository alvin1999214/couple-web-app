from __future__ import annotations

from datetime import date, datetime, timedelta

from .config import CATEGORY_META
from .errors import ApiError


def text(value, *, max_length: int = 100, label: str = "資料") -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise ApiError(f"請填寫{label}")
    return normalized[:max_length]


def number(value, *, allow_zero: bool = False, label: str = "金額") -> float:
    try:
        normalized = float(value)
    except (TypeError, ValueError) as exc:
        raise ApiError(f"{label}格式不正確") from exc
    minimum = 0 if allow_zero else 0.0000001
    if normalized < minimum or normalized > 100_000_000:
        operator = "不能小於 0" if allow_zero else "需大於 0"
        raise ApiError(f"{label}{operator}")
    return round(normalized, 2)


def positive_integer(value, *, label: str = "數量", maximum: int = 10_000) -> int:
    try:
        normalized = int(value)
    except (TypeError, ValueError) as exc:
        raise ApiError(f"{label}格式不正確") from exc
    if normalized < 1 or normalized > maximum:
        raise ApiError(f"{label}需介於 1 到 {maximum:,}")
    return normalized


def iso_date(value, *, label: str = "日期", allow_future: bool = True) -> str:
    try:
        normalized = datetime.strptime(str(value), "%Y-%m-%d").date()
    except (TypeError, ValueError) as exc:
        raise ApiError(f"{label}格式不正確") from exc
    # Browser-local "today" may be one day ahead of the UTC Docker container.
    if not allow_future and normalized > date.today() + timedelta(days=1):
        raise ApiError(f"{label}不能晚於今天")
    return normalized.isoformat()


def category(value, *, valid_keys: set | None = None) -> str:
    if valid_keys is not None:
        return value if value in valid_keys else "other"
    return value if value in CATEGORY_META else "other"


def boolean(value, *, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str) and value.lower() in {"true", "false"}:
        return value.lower() == "true"
    if value in {0, 1}:
        return bool(value)
    raise ApiError("布林值格式不正確")
