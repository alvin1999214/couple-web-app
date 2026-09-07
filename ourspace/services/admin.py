from __future__ import annotations

import csv
import io
import json
import sqlite3
from datetime import date
from pathlib import Path

from .shared import Service
from ..config import DB_PATH
from ..database import fetch_all, set_setting
from ..errors import ApiError
from ..migrations import LATEST_SCHEMA_VERSION


MANAGED_TABLES = {
    "categories": {
        "label": "記帳分類",
        "search_fields": ["key", "label"],
        "order_by": "is_default DESC, key ASC",
        "headers": {
            "key": "分類代碼",
            "label": "分類名稱",
            "icon": "圖示標籤",
            "color": "色彩代碼",
            "is_default": "類型",
            "created_at": "建立時間",
            "expense_count": "開支筆數",
            "shopping_count": "購物項目數",
        },
    },
    "settings": {
        "label": "系統設定",
        "search_fields": ["key", "value"],
        "order_by": "key ASC",
        "headers": {
            "key": "參數鍵名",
            "value": "參數數值",
        },
    },
    "expenses": {
        "label": "共同開支",
        "search_fields": ["title", "paid_by"],
        "order_by": "spent_on DESC, id DESC",
        "headers": {
            "id": "開支編號",
            "title": "開支名稱",
            "amount": "金額 (HK$)",
            "category": "分類",
            "paid_by": "付款人",
            "spent_on": "消費日期",
            "shopping_item_id": "關聯購物編號",
            "created_at": "建立時間",
        },
    },
    "shopping_items": {
        "label": "購物清單",
        "search_fields": ["name"],
        "order_by": "purchased ASC, id DESC",
        "headers": {
            "id": "項目編號",
            "name": "購買物品",
            "quantity": "數量",
            "category": "分類",
            "purchased": "狀態",
            "expense_id": "關聯開支編號",
            "completed_at": "完成時間",
            "created_at": "建立時間",
        },
    },
    "todos": {
        "label": "日常待辦",
        "search_fields": ["title", "assignee"],
        "order_by": "done ASC, due_date IS NULL, due_date ASC, id DESC",
        "headers": {
            "id": "待辦編號",
            "title": "待辦事項",
            "assignee": "負責人",
            "due_date": "到期日",
            "done": "狀態",
            "created_at": "建立時間",
        },
    },
    "special_days": {
        "label": "特別日子",
        "search_fields": ["title"],
        "order_by": "event_date ASC, id ASC",
        "headers": {
            "id": "日子編號",
            "title": "事件名稱",
            "event_date": "日期",
            "emoji": "小記號",
            "repeats_yearly": "每年重複",
            "created_at": "建立時間",
        },
    },
}

PROTECTED_SETTINGS = {"onboarding_complete", "couple_names", "monthly_budget", "started_on"}


class AdminService(Service):
    def overview(self) -> dict:
        with self.database.connect() as connection:
            counts = {}
            for table in MANAGED_TABLES:
                count = connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                counts[table] = count

            expense_stats = connection.execute(
                "SELECT COALESCE(SUM(amount), 0), COUNT(*) FROM expenses"
            ).fetchone()
            total_expense_amount = round(float(expense_stats[0]), 2)
            total_expense_count = int(expense_stats[1])

            custom_categories_count = connection.execute(
                "SELECT COUNT(*) FROM categories WHERE is_default = 0"
            ).fetchone()[0]

            db_size = DB_PATH.stat().st_size if DB_PATH.exists() else 0
            sqlite_ver = sqlite3.sqlite_version

            return {
                "counts": counts,
                "custom_categories_count": custom_categories_count,
                "total_expense_amount": total_expense_amount,
                "total_expense_count": total_expense_count,
                "sqlite_version": sqlite_ver,
                "schema_version": LATEST_SCHEMA_VERSION,
                "db_size_bytes": db_size,
                "db_size_formatted": self._format_size(db_size),
                "tables": [
                    {"name": name, "label": meta["label"], "count": counts[name]}
                    for name, meta in MANAGED_TABLES.items()
                ],
            }

    def get_table(
        self,
        table_name: str,
        search: str | None = None,
        filters: dict | None = None,
        limit: int = 200,
        offset: int = 0,
    ) -> dict:
        if table_name not in MANAGED_TABLES:
            raise ApiError(f"未知的資料表：{table_name}", 404)

        filters = filters or {}
        limit = max(1, min(limit, 500))
        offset = max(0, offset)

        with self.database.connect() as connection:
            where_clauses, params = self._build_where(table_name, search, filters)
            where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

            count_sql = f"SELECT COUNT(*) FROM {table_name} {where_sql}"
            total = connection.execute(count_sql, params).fetchone()[0]

            order_by = MANAGED_TABLES[table_name]["order_by"]

            # Special query for categories to include usage counts
            if table_name == "categories":
                sql = f"""
                    SELECT
                        c.key,
                        c.label,
                        c.icon,
                        c.color,
                        c.is_default,
                        c.created_at,
                        (SELECT COUNT(*) FROM expenses e WHERE e.category = c.key) AS expense_count,
                        (SELECT COUNT(*) FROM shopping_items s WHERE s.category = c.key) AS shopping_count
                    FROM categories c
                    {where_sql.replace(table_name, 'c')}
                    ORDER BY {order_by}
                    LIMIT ? OFFSET ?
                """
            else:
                sql = f"SELECT * FROM {table_name} {where_sql} ORDER BY {order_by} LIMIT ? OFFSET ?"

            rows = fetch_all(connection, sql, (*params, limit, offset))

            # Decorate settings rows with parsed JSON when applicable
            if table_name == "settings":
                for row in rows:
                    try:
                        row["parsed_value"] = json.loads(row["value"])
                    except (ValueError, TypeError):
                        row["parsed_value"] = row["value"]

            columns = list(rows[0].keys()) if rows else list(MANAGED_TABLES[table_name]["headers"].keys())

            return {
                "table": table_name,
                "label": MANAGED_TABLES[table_name]["label"],
                "total": total,
                "limit": limit,
                "offset": offset,
                "columns": columns,
                "headers": MANAGED_TABLES[table_name]["headers"],
                "rows": rows,
            }

    def update_setting(self, key: str, value) -> dict:
        normalized_key = str(key).strip()
        if not normalized_key:
            raise ApiError("參數鍵名不可為空")

        with self.database.connect() as connection:
            set_setting(connection, normalized_key, value)
        return {"ok": True}

    def create_setting(self, data: dict) -> dict:
        key = str(data.get("key", "")).strip()
        if not key:
            raise ApiError("請輸入參數鍵名")
        value = data.get("value")

        with self.database.connect() as connection:
            existing = connection.execute("SELECT 1 FROM settings WHERE key = ?", (key,)).fetchone()
            if existing:
                raise ApiError("此參數已存在，請使用編輯功能更新", 409)
            set_setting(connection, key, value)
        return {"ok": True}

    def delete_setting(self, key: str) -> dict:
        normalized_key = str(key).strip()
        if normalized_key in PROTECTED_SETTINGS:
            raise ApiError("此為核心系統參數，不可刪除", 400)

        with self.database.connect() as connection:
            cursor = connection.execute("DELETE FROM settings WHERE key = ?", (normalized_key,))
            if not cursor.rowcount:
                raise ApiError("找不到指定參數", 404)
        return {"ok": True}

    def export_csv(self, table_name: str, search: str | None = None, filters: dict | None = None) -> dict:
        if table_name not in MANAGED_TABLES:
            raise ApiError(f"未知的資料表：{table_name}", 404)

        result = self.get_table(table_name, search=search, filters=filters, limit=5000, offset=0)
        headers_map = MANAGED_TABLES[table_name]["headers"]

        output = io.StringIO()
        # Add UTF-8 BOM so Excel opens it automatically without encoding issues
        output.write("\ufeff")

        writer = csv.writer(output, quoting=csv.QUOTE_MINIMAL)

        column_keys = [k for k in headers_map.keys() if k in result["columns"]]
        header_labels = [headers_map[k] for k in column_keys]
        writer.writerow(header_labels)

        for row in result["rows"]:
            row_data = []
            for col in column_keys:
                val = row.get(col)
                formatted = self._format_cell_for_export(table_name, col, val)
                row_data.append(formatted)
            writer.writerow(row_data)

        today_str = date.today().isoformat()
        filename = f"teletubbyland-{table_name}-{today_str}.csv"
        return {
            "__download__": True,
            "filename": filename,
            "content": output.getvalue(),
            "content_type": "text/csv; charset=utf-8",
        }

    @staticmethod
    def _build_where(table_name: str, search: str | None, filters: dict) -> tuple[list[str], list]:
        clauses = []
        params = []

        if search and search.strip():
            keyword = f"%{search.strip()}%"
            search_fields = MANAGED_TABLES[table_name]["search_fields"]
            search_clause = " OR ".join(f"{field} LIKE ?" for field in search_fields)
            clauses.append(f"({search_clause})")
            params.extend([keyword] * len(search_fields))

        if table_name == "categories":
            cat_type = filters.get("type")
            if cat_type == "default":
                clauses.append("is_default = 1")
            elif cat_type == "custom":
                clauses.append("is_default = 0")

        elif table_name == "expenses":
            if filters.get("category") and filters["category"] != "all":
                clauses.append("category = ?")
                params.append(filters["category"])
            if filters.get("paid_by") and filters["paid_by"] != "all":
                clauses.append("paid_by = ?")
                params.append(filters["paid_by"])
            if filters.get("spent_on_from"):
                clauses.append("spent_on >= ?")
                params.append(filters["spent_on_from"])
            if filters.get("spent_on_to"):
                clauses.append("spent_on <= ?")
                params.append(filters["spent_on_to"])

        elif table_name == "shopping_items":
            if filters.get("category") and filters["category"] != "all":
                clauses.append("category = ?")
                params.append(filters["category"])
            if filters.get("purchased") in {"0", "1", 0, 1}:
                clauses.append("purchased = ?")
                params.append(int(filters["purchased"]))

        elif table_name == "todos":
            if filters.get("done") in {"0", "1", 0, 1}:
                clauses.append("done = ?")
                params.append(int(filters["done"]))
            if filters.get("assignee") and filters["assignee"] != "all":
                clauses.append("assignee = ?")
                params.append(filters["assignee"])

        elif table_name == "special_days":
            if filters.get("repeats_yearly") in {"0", "1", 0, 1}:
                clauses.append("repeats_yearly = ?")
                params.append(int(filters["repeats_yearly"]))

        return clauses, params

    @staticmethod
    def _format_cell_for_export(table: str, col: str, val) -> str:
        if val is None:
            return ""
        if col in {"purchased", "done"}:
            return "已完成" if val else "未完成"
        if col == "is_default":
            return "系統預設" if val else "使用者自訂"
        if col == "repeats_yearly":
            return "每年重複" if val else "單次提醒"
        if isinstance(val, (dict, list)):
            return json.dumps(val, ensure_ascii=False)
        return str(val)

    @staticmethod
    def _format_size(size_bytes: int) -> str:
        if size_bytes < 1024:
            return f"{size_bytes} B"
        if size_bytes < 1024 * 1024:
            return f"{size_bytes / 1024:.1f} KB"
        return f"{size_bytes / (1024 * 1024):.2f} MB"
