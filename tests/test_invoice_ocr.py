import base64
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError, URLError

from ourspace.database import Database
from ourspace.errors import ApiError
from ourspace.router import Router
from ourspace.services.invoice_ocr import InvoiceOCRService
from ourspace.services.settings import SettingsService


class InvoiceOCRTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.db = Database(Path(self.temp.name) / "test.db")
        self.db.initialize()
        SettingsService(self.db).configure({
            "couple_names": ["A", "B"], "monthly_budget": 10000, "started_on": "2026-01-01",
        })
        self.service = InvoiceOCRService(self.db)
        self.image = "data:image/png;base64," + base64.b64encode(
            (Path(__file__).resolve().parent.parent / "static/assets/favicon-32.png").read_bytes()
        ).decode()
        self.env = patch.dict(os.environ, {"INVOICE_OCR_API_KEY": "test-key", "INVOICE_OCR_BASE_URL": "https://example.test/v1", "INVOICE_OCR_MODEL": "gemini-3.8-flash-high"})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.result = {"is_invoice": True, "title": "超市", "amount": 123.45, "category": "groceries", "spent_on": "2026-09-26", "currency": "HKD", "warnings": []}

    def response(self, result=None, fenced=False):
        content = json.dumps(result if result is not None else self.result)
        if fenced:
            content = "```json\n" + content + "\n```"
        return io.BytesIO(json.dumps({"choices": [{"message": {"content": content}}]}).encode())

    @patch("ourspace.services.invoice_ocr.urlopen")
    def test_draft_route_does_not_save_and_uses_configured_model(self, send):
        send.return_value = self.response(fenced=True)
        draft, status = Router(self.db).dispatch("POST", "/api/expenses/ocr", {"image": self.image}, {})
        self.assertEqual(status, 200)
        self.assertEqual(draft["draft"]["amount"], 123.45)
        self.assertNotIn("paid_by", draft["draft"])
        with self.db.connect() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM expenses").fetchone()[0], 0)
        request = send.call_args.args[0]
        self.assertEqual(request.full_url, "https://example.test/v1/chat/completions")
        self.assertEqual(request.get_header("Authorization"), "Bearer test-key")
        self.assertEqual(request.get_header("User-agent"), "Teletubbyland/2.0")
        body = json.loads(request.data)
        self.assertEqual(body["model"], "gemini-3.8-flash-high")
        self.assertEqual(body["messages"][1]["content"][0]["image_url"]["url"], self.image)
        draft["draft"].update(paid_by="B", amount=120)
        _, status = Router(self.db).dispatch("POST", "/api/expenses", draft["draft"], {})
        self.assertEqual(status, 201)
        with self.db.connect() as conn:
            row = conn.execute("SELECT * FROM expenses").fetchone()
            self.assertEqual((row["paid_by"], row["amount"]), ("B", 120))

    @patch("ourspace.services.invoice_ocr.urlopen")
    def test_foreign_or_unknown_currency_cannot_silently_become_hkd(self, send):
        for currency in ("USD", None, ""):
            with self.subTest(currency=currency):
                send.return_value = self.response({**self.result, "currency": currency})
                result = self.service.recognize({"image": self.image})
                self.assertIsNone(result["draft"]["amount"])
                self.assertTrue(result["warnings"])

    @patch("ourspace.services.invoice_ocr.urlopen")
    def test_untrusted_fields_are_normalized(self, send):
        for amount in (float("nan"), float("inf"), -1, True, "123", {}, None):
            with self.subTest(amount=amount):
                send.return_value = self.response({**self.result, "amount": amount, "spent_on": "2026-02-31", "category": [], "title": {}, "warnings": {}})
                result = self.service.recognize({"image": self.image})
                self.assertEqual(result["draft"], {"title": "", "amount": None, "spent_on": "", "category": "other"})

    @patch("ourspace.services.invoice_ocr.urlopen")
    def test_invalid_images_never_reach_provider(self, send):
        for image in (None, "https://example.test/a.jpg", "data:image/png;base64,abcd", "data:image/png;base64,=", "a" * 5_400_001):
            with self.subTest(image_type=type(image)):
                with self.assertRaises(ApiError):
                    self.service.recognize({"image": image})
        send.assert_not_called()

    @patch("ourspace.services.invoice_ocr.urlopen")
    def test_missing_or_placeholder_key(self, send):
        for key in ("", "sk-xxxxxx"):
            with patch.dict(os.environ, {"INVOICE_OCR_API_KEY": key}):
                with self.assertRaises(ApiError) as caught:
                    self.service.recognize({"image": self.image})
                self.assertEqual(caught.exception.status, 503)
        send.assert_not_called()

    @patch("ourspace.services.invoice_ocr.urlopen")
    def test_provider_errors_are_sanitized(self, send):
        for error, status in ((HTTPError("url", 401, "secret", {}, None), 502), (HTTPError("url", 429, "secret", {}, None), 503), (HTTPError("url", 500, "secret", {}, None), 502), (TimeoutError("secret"), 504), (URLError("secret"), 504)):
            send.side_effect = error
            with self.assertRaises(ApiError) as caught:
                self.service.recognize({"image": self.image})
            self.assertEqual(caught.exception.status, status)
            self.assertNotIn("secret", str(caught.exception))

    @patch("ourspace.services.invoice_ocr.urlopen")
    def test_malformed_and_non_invoice_responses(self, send):
        for raw, status in ((b"not json", 502), (b'{"choices": []}', 502), (self.response({"is_invoice": False}).getvalue(), 422), (self.response([]).getvalue(), 502)):
            send.return_value = io.BytesIO(raw)
            with self.assertRaises(ApiError) as caught:
                self.service.recognize({"image": self.image})
            self.assertEqual(caught.exception.status, status)


if __name__ == "__main__":
    unittest.main()
