from __future__ import annotations

from calendar import monthrange
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from .config import CATEGORY_META
from .errors import ApiError


PERIODS = {"month", "today", "week", "last7", "last30"}


@dataclass(frozen=True)
class ExpenseFilter:
    """Validated date/category criteria shared by every expense dashboard view."""

    month: str
    period: str
    category: str
    date_from: date
    date_to: date

    @classmethod
    def from_query(
        cls,
        month: str | None = None,
        period: str | None = None,
        category: str | None = None,
        today: str | None = None,
    ) -> "ExpenseFilter":
        anchor = cls._date(today, "今日日期格式需為 YYYY-MM-DD") if today else date.today()
        period_key = period or "month"
        category_key = category or "all"
        if period_key not in PERIODS:
            raise ApiError("不支援此開支時間範圍")
        if category_key != "all" and category_key not in CATEGORY_META:
            raise ApiError("不支援此開支類別")

        if period_key == "month":
            month_key = cls._month(month or anchor.strftime("%Y-%m"))
            year, month_number = (int(part) for part in month_key.split("-"))
            date_from = date(year, month_number, 1)
            date_to = date(year, month_number, monthrange(year, month_number)[1])
        else:
            month_key = anchor.strftime("%Y-%m")
            if period_key == "today":
                date_from = date_to = anchor
            elif period_key == "week":
                date_from = anchor - timedelta(days=anchor.weekday())
                date_to = date_from + timedelta(days=6)
            else:
                date_from = anchor - timedelta(days=6 if period_key == "last7" else 29)
                date_to = anchor

        return cls(month_key, period_key, category_key, date_from, date_to)

    def sql(self) -> tuple[str, tuple[str, ...]]:
        clause = "spent_on BETWEEN ? AND ?"
        params = (self.date_from.isoformat(), self.date_to.isoformat())
        if self.category != "all":
            clause += " AND category = ?"
            params += (self.category,)
        return clause, params

    def as_dict(self) -> dict:
        return {
            "period": self.period,
            "category": self.category,
            "date_from": self.date_from.isoformat(),
            "date_to": self.date_to.isoformat(),
            "is_active": self.period != "month" or self.category != "all",
        }

    @staticmethod
    def _month(value: str) -> str:
        try:
            return datetime.strptime(value, "%Y-%m").strftime("%Y-%m")
        except ValueError as exc:
            raise ApiError("月份格式需為 YYYY-MM") from exc

    @staticmethod
    def _date(value: str, message: str) -> date:
        try:
            return date.fromisoformat(value)
        except (TypeError, ValueError) as exc:
            raise ApiError(message) from exc
