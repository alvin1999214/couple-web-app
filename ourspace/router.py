from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable, Pattern

from .database import Database
from .errors import ApiError
from .services.admin import AdminService
from .services.categories import CategoryService
from .services.dashboard import DashboardService
from .services.expenses import ExpenseService
from .services.invoice_ocr import InvoiceOCRService
from .services.order_imports import OrderImportService
from .services.settings import SettingsService
from .services.shopping import ShoppingService
from .services.special_days import SpecialDayService
from .services.todos import TodoService


Handler = Callable[[dict, dict, dict], dict]


@dataclass(frozen=True)
class Route:
    method: str
    pattern: Pattern[str]
    handler: Handler
    success_status: int = 200
    requires_setup: bool = True


class Router:
    """Matches HTTP details to small feature services; contains no domain logic."""

    def __init__(self, database: Database):
        dashboard = DashboardService(database)
        expenses = ExpenseService(database)
        invoice_ocr = InvoiceOCRService(database)
        order_imports = OrderImportService(database)
        settings = SettingsService(database)
        shopping = ShoppingService(database)
        todos = TodoService(database)
        special_days = SpecialDayService(database)
        categories = CategoryService(database)
        admin = AdminService(database)
        self.settings = settings
        self.routes = [
            self._route("GET", r"/api/health", lambda p, b, q: {"status": "ok"}, setup=False),
            self._route("GET", r"/api/status", lambda p, b, q: settings.status(), setup=False),
            self._route(
                "GET",
                r"/api/dashboard",
                lambda p, b, q: dashboard.get(
                    self._query(q, "month"),
                    self._query(q, "period"),
                    self._query(q, "category"),
                    self._query(q, "today"),
                ),
                setup=False,
            ),
            self._route("POST", r"/api/onboarding", lambda p, b, q: settings.configure(b), status=201, setup=False),
            self._route("PATCH", r"/api/settings", lambda p, b, q: settings.update(b)),
            self._route("POST", r"/api/expenses", lambda p, b, q: expenses.create(b), status=201),
            self._route("POST", r"/api/expenses/ocr", lambda p, b, q: invoice_ocr.recognize(b)),
            self._route("POST", r"/api/expenses/orders/ocr", lambda p, b, q: order_imports.recognize(b)),
            self._route("POST", r"/api/expenses/orders/import", lambda p, b, q: order_imports.save(b), status=201),
            self._route("GET", r"/api/expenses/(?P<id>\d+)/invoice", lambda p, b, q: expenses.invoice(int(p["id"]))),
            self._route("PATCH", r"/api/expenses/(?P<id>\d+)", lambda p, b, q: expenses.update(int(p["id"]), b)),
            self._route("DELETE", r"/api/expenses/(?P<id>\d+)", lambda p, b, q: expenses.delete(int(p["id"]))),
            self._route("POST", r"/api/shopping", lambda p, b, q: shopping.create(b), status=201),
            self._route("PATCH", r"/api/shopping/(?P<id>\d+)", lambda p, b, q: shopping.update(int(p["id"]), b)),
            self._route("POST", r"/api/shopping/(?P<id>\d+)/complete", lambda p, b, q: shopping.complete(int(p["id"]), b)),
            self._route("DELETE", r"/api/shopping/completed", lambda p, b, q: shopping.clear_completed()),
            self._route("DELETE", r"/api/shopping/(?P<id>\d+)", lambda p, b, q: shopping.delete(int(p["id"]))),
            self._route("POST", r"/api/todos", lambda p, b, q: todos.create(b), status=201),
            self._route("PATCH", r"/api/todos/(?P<id>\d+)", lambda p, b, q: todos.update(int(p["id"]), b)),
            self._route("DELETE", r"/api/todos/(?P<id>\d+)", lambda p, b, q: todos.delete(int(p["id"]))),
            self._route("POST", r"/api/special-days", lambda p, b, q: special_days.create(b), status=201),
            self._route("PATCH", r"/api/special-days/(?P<id>\d+)", lambda p, b, q: special_days.update(int(p["id"]), b)),
            self._route("DELETE", r"/api/special-days/(?P<id>\d+)", lambda p, b, q: special_days.delete(int(p["id"]))),

            # Categories API
            self._route("GET", r"/api/categories", lambda p, b, q: categories.list(), setup=False),
            self._route("POST", r"/api/categories", lambda p, b, q: categories.create(b), status=201),
            self._route("PATCH", r"/api/categories/(?P<key>[a-zA-Z0-9_\-]+)", lambda p, b, q: categories.update(p["key"], b)),
            self._route("DELETE", r"/api/categories/(?P<key>[a-zA-Z0-9_\-]+)", lambda p, b, q: categories.delete(p["key"])),

            # Admin & DB Dashboard API
            self._route("GET", r"/api/admin/overview", lambda p, b, q: admin.overview()),
            self._route(
                "GET",
                r"/api/admin/tables/(?P<table>[a-zA-Z0-9_]+)",
                lambda p, b, q: admin.get_table(
                    p["table"],
                    search=self._query(q, "search") or self._query(q, "q"),
                    filters={k: v[0] for k, v in q.items() if k not in {"search", "q", "limit", "offset"}},
                    limit=int(self._query(q, "limit") or 200),
                    offset=int(self._query(q, "offset") or 0),
                ),
            ),
            self._route(
                "GET",
                r"/api/admin/export",
                lambda p, b, q: admin.export_csv(
                    self._query(q, "table") or "expenses",
                    search=self._query(q, "search") or self._query(q, "q"),
                    filters={k: v[0] for k, v in q.items() if k not in {"table", "search", "q"}},
                ),
            ),
            self._route("POST", r"/api/admin/settings", lambda p, b, q: admin.create_setting(b), status=201),
            self._route("PATCH", r"/api/admin/settings/(?P<key>[a-zA-Z0-9_\-]+)", lambda p, b, q: admin.update_setting(p["key"], b.get("value"))),
            self._route("DELETE", r"/api/admin/settings/(?P<key>[a-zA-Z0-9_\-]+)", lambda p, b, q: admin.delete_setting(p["key"])),
        ]

    def dispatch(self, method: str, path: str, body: dict, query: dict) -> tuple[dict, int]:
        for route in self.routes:
            match = route.pattern.fullmatch(path)
            if route.method != method or not match:
                continue
            if route.requires_setup and not self.settings.status()["configured"]:
                raise ApiError("請先完成初次設定", 409)
            return route.handler(match.groupdict(), body, query), route.success_status
        raise ApiError("找不到此功能", 404)

    @staticmethod
    def _route(method: str, pattern: str, handler: Handler, *, status: int = 200, setup: bool = True) -> Route:
        return Route(method, re.compile(pattern), handler, status, setup)

    @staticmethod
    def _query(query: dict, key: str):
        values = query.get(key)
        return values[0] if values else None
