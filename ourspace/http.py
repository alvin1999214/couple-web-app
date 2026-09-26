from __future__ import annotations

import json
import mimetypes
import sqlite3
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from .errors import ApiError
from .config import APP_NAME
from .router import Router
from .services.invoice_ocr import MAX_OCR_BODY_BYTES


MAX_BODY_BYTES = 1_000_000


def create_handler(router: Router, static_dir: Path):
    class RequestHandler(BaseHTTPRequestHandler):
        server_version = f"{APP_NAME}/2.0"

        def log_message(self, fmt: str, *args) -> None:
            print(f"[{self.log_date_time_string()}] {fmt % args}")

        def do_GET(self) -> None:
            parsed = urlparse(self.path)
            if parsed.path.startswith("/api/"):
                self.handle_api("GET", parsed)
            else:
                self.serve_static(parsed.path)

        def do_POST(self) -> None:
            self.handle_api("POST", urlparse(self.path))

        def do_PATCH(self) -> None:
            self.handle_api("PATCH", urlparse(self.path))

        def do_DELETE(self) -> None:
            self.handle_api("DELETE", urlparse(self.path))

        def handle_api(self, method: str, parsed) -> None:
            try:
                limit = MAX_OCR_BODY_BYTES if method == "POST" and parsed.path == "/api/expenses/ocr" else MAX_BODY_BYTES
                body = self.read_json(limit) if method in {"POST", "PATCH"} else {}
                payload, status = router.dispatch(method, parsed.path, body, parse_qs(parsed.query))
                if isinstance(payload, dict) and payload.get("__download__"):
                    self.send_download(payload, status)
                else:
                    self.send_json(payload, status)
            except ApiError as exc:
                self.send_json({"error": str(exc)}, exc.status)
            except sqlite3.IntegrityError:
                self.send_json({"error": "資料不符合限制條件"}, HTTPStatus.BAD_REQUEST)
            except Exception as exc:
                print(f"Unhandled error: {exc!r}")
                self.send_json({"error": "伺服器暫時忙碌，請稍後再試"}, HTTPStatus.INTERNAL_SERVER_ERROR)

        def send_download(self, payload: dict, status: int = 200) -> None:
            content = payload.get("content", "").encode("utf-8")
            filename = payload.get("filename", "export.csv")
            content_type = payload.get("content_type", "text/csv; charset=utf-8")
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(content)


        def read_json(self, limit: int = MAX_BODY_BYTES) -> dict:
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError as exc:
                raise ApiError("Content-Length 格式不正確") from exc
            if length < 0:
                raise ApiError("Content-Length 格式不正確")
            if length > limit:
                raise ApiError("資料內容過大", HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
            try:
                body = json.loads(self.rfile.read(length) or b"{}")
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise ApiError("無效的 JSON 資料") from exc
            if not isinstance(body, dict):
                raise ApiError("JSON 資料需為物件")
            return body

        def send_json(self, payload, status: int = 200) -> None:
            content = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(content)

        def serve_static(self, request_path: str) -> None:
            relative = "index.html" if request_path in {"", "/"} else request_path.lstrip("/")
            target = (static_dir / relative).resolve()
            root = static_dir.resolve()
            if target != root and root not in target.parents:
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            if not target.is_file():
                target = static_dir / "index.html"
            content = target.read_bytes()
            content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
            if content_type.startswith("text/") or content_type in {"application/javascript", "image/svg+xml"}:
                content_type += "; charset=utf-8"
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(content)

    return RequestHandler
