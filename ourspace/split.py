from __future__ import annotations

from .errors import ApiError
from .validation import number


SPLIT_METHODS = {"equal", "custom", "income"}


def normalize_split(value) -> dict:
    """Validate a split request and return the canonical persisted structure."""
    if not isinstance(value, dict) or value.get("method") not in SPLIT_METHODS:
        raise ApiError("分帳方式不正確")

    method = value["method"]
    if method == "equal":
        return {"method": "equal", "percentages": [50.0, 50.0], "incomes": [0.0, 0.0]}

    if method == "custom":
        try:
            first = round(float(value.get("percentage")), 1)
        except (TypeError, ValueError) as exc:
            raise ApiError("請輸入有效的分帳百分比") from exc
        if first < 0 or first > 100:
            raise ApiError("分帳百分比需介乎 0 至 100")
        return {
            "method": "custom",
            "percentages": [first, round(100 - first, 1)],
            "incomes": [0.0, 0.0],
        }

    incomes = value.get("incomes")
    if not isinstance(incomes, list) or len(incomes) != 2:
        raise ApiError("請輸入雙方每月收入")
    normalized_incomes = [number(item, allow_zero=True, label="收入") for item in incomes]
    total = sum(normalized_incomes)
    if total <= 0:
        raise ApiError("雙方總收入需大於 0")
    first = round(normalized_incomes[0] / total * 100, 1)
    return {
        "method": "income",
        "percentages": [first, round(100 - first, 1)],
        "incomes": normalized_incomes,
    }
