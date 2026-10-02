import base64
import io
import json
import os
import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError, URLError

from ourspace.database import Database
from ourspace.errors import ApiError
from ourspace.router import Router
from ourspace.services.order_imports import OrderImportService
from ourspace.services.settings import SettingsService


class OrderImportTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.db = Database(Path(temp.name) / 'orders.db')
        self.db.initialize()
        SettingsService(self.db).configure({'couple_names': ['A', 'B'], 'monthly_budget': 1000, 'started_on': '2026-01-01'})
        self.service = OrderImportService(self.db)
        self.image = 'data:image/png;base64,' + base64.b64encode(
            (Path(__file__).parent.parent / 'static/assets/favicon-32.png').read_bytes()).decode()
        self.order = {'platform': '淘寶', 'order_id': '12345678901234567890', 'title': '收納盒',
                      'original_amount': 20, 'currency': 'CNY', 'spent_on': None, 'category': 'home',
                      'source_pages': [1], 'warnings': []}
        env = patch.dict(os.environ, {'INVOICE_OCR_API_KEY': 'test', 'INVOICE_OCR_BASE_URL': 'https://example.test/v1'})
        env.start()
        self.addCleanup(env.stop)

    def response(self, orders=None, **changes):
        result = {'orders': orders if orders is not None else [self.order], 'warnings': [], **changes}
        return io.BytesIO(json.dumps({'choices': [{'message': {'content': json.dumps(result)}}]}).encode())

    def payload(self):
        return {'token': 'test-import-token-12345', 'confirmed': True, 'images': [self.image],
                'orders': [{**self.order, 'spent_on': '2025-12-31', 'amount': 22.5, 'paid_by': 'A', 'source_page': 1},
                           {**self.order, 'order_id': 'second', 'spent_on': '2026-01-02', 'amount': 30, 'paid_by': 'B', 'source_page': 1}]}

    def count(self, table='expenses'):
        with self.db.connect() as c:
            return c.execute('SELECT COUNT(*) FROM ' + table).fetchone()[0]

    @patch('ourspace.services.order_imports.urlopen')
    def test_multi_page_drafts_leave_missing_dates_and_foreign_hkd_empty(self, send):
        send.return_value = self.response([self.order, {**self.order, 'platform': '拼多多', 'order_id': 'other', 'source_pages': [2]}])
        result, status = Router(self.db).dispatch('POST', '/api/expenses/orders/ocr', {'images': [self.image] * 2}, {})
        self.assertEqual(status, 200)
        self.assertEqual(len(result['orders']), 2)
        self.assertEqual(result['orders'][0]['spent_on'], '')
        self.assertIsNone(result['orders'][0]['amount'])
        self.assertEqual(result['orders'][0]['original_amount'], 20)
        self.assertEqual(self.count(), 0)
        self.assertEqual(self.count('expense_invoices'), 0)
        body = json.loads(send.call_args.args[0].data)
        images = [item for item in body['messages'][1]['content'] if item['type'] == 'image_url']
        self.assertEqual(len(images), 2)
        self.assertIn('Never invent missing dates', body['messages'][0]['content'])

    @patch('ourspace.services.order_imports.urlopen')
    def test_overlap_ids_merge_but_distinct_ids_do_not(self, send):
        send.return_value = self.response([self.order, {**self.order, 'source_pages': [2]}, {**self.order, 'order_id': 'other'}])
        result = self.service.recognize({'images': [self.image] * 2})
        self.assertEqual(len(result['orders']), 2)
        self.assertEqual(result['orders'][0]['source_pages'], [1, 2])

    @patch('ourspace.services.order_imports.urlopen')
    def test_conflicting_overlap_clears_amount(self, send):
        send.return_value = self.response([self.order, {**self.order, 'original_amount': 99}])
        result = self.service.recognize({'images': [self.image]})
        self.assertIsNone(result['orders'][0]['original_amount'])
        self.assertIsNone(result['orders'][0]['amount'])

    @patch('ourspace.services.order_imports.urlopen')
    def test_malformed_output_and_bad_source_pages_rejected(self, send):
        for orders in ([None], [{**self.order, 'source_pages': [0]}], [{**self.order, 'source_pages': [2]}], [{**self.order, 'platform': 'unknown'}]):
            with self.subTest(orders=orders):
                send.return_value = self.response(orders)
                with self.assertRaises(ApiError) as error:
                    self.service.recognize({'images': [self.image]})
                self.assertEqual(error.exception.status, 502)
        self.assertEqual(self.count(), 0)

    @patch('ourspace.services.order_imports.urlopen')
    def test_empty_order_list_reports_exclusions(self, send):
        send.return_value = self.response([], warnings=['已排除未付款訂單'])
        result = self.service.recognize({'images': [self.image]})
        self.assertEqual(result['orders'], [])
        self.assertEqual(result['warnings'], ['已排除未付款訂單'])

    @patch('ourspace.services.order_imports.urlopen')
    def test_limits_and_invalid_images_never_call_model(self, send):
        for images in ([], [self.image] * 11, ['bad'], None):
            with self.assertRaises(ApiError):
                self.service.recognize({'images': images})
        send.assert_not_called()

    @patch('ourspace.services.order_imports.urlopen')
    def test_model_failures_are_actionable(self, send):
        for failure, status in [(TimeoutError(), 504), (URLError('offline'), 504),
                                (HTTPError('url', 401, 'unauthorized', {}, None), 502),
                                (HTTPError('url', 429, 'busy', {}, None), 503)]:
            send.side_effect = failure
            with self.assertRaises(ApiError) as error:
                self.service.recognize({'images': [self.image]})
            self.assertEqual(error.exception.status, status)

    def test_atomic_save_retains_dates_currency_and_screenshot_and_retries(self):
        payload = self.payload()
        result, status = Router(self.db).dispatch('POST', '/api/expenses/orders/import', payload, {})
        self.assertEqual(status, 201)
        self.assertEqual(len(result['ids']), 2)
        self.assertEqual(self.count(), 2)
        self.assertEqual(self.count('expense_invoices'), 2)
        with self.db.connect() as c:
            self.assertEqual([r[0] for r in c.execute('SELECT spent_on FROM expenses ORDER BY id')], ['2025-12-31', '2026-01-02'])
            self.assertEqual(tuple(c.execute('SELECT original_amount, currency FROM expense_orders LIMIT 1').fetchone()), (20, 'CNY'))
        self.assertEqual(self.service.save(payload)['ids'], result['ids'])
        self.assertEqual(self.count(), 2)
        payload['orders'][0]['amount'] = 99
        with self.assertRaises(ApiError) as error:
            self.service.save(payload)
        self.assertEqual(error.exception.status, 409)

    def test_concurrent_retry_inserts_once(self):
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(self.service.save, [self.payload(), self.payload()]))
        self.assertEqual(results[0]['ids'], results[1]['ids'])
        self.assertEqual(self.count(), 2)

    def test_missing_date_bad_money_and_unconfirmed_save_leave_nothing(self):
        for changes in ({'spent_on': ''}, {'spent_on': '2026-02-30'}, {'amount': None}, {'amount': 0.001}, {'amount': True}, {'amount': float('nan')}, {'amount': float('inf')}, {'source_page': 3}):
            data = self.payload()
            data['orders'][1].update(changes)
            with self.subTest(changes=changes), self.assertRaises(ApiError):
                self.service.save(data)
            self.assertEqual(self.count(), 0)
            self.assertEqual(self.count('order_import_batches'), 0)
        data = self.payload()
        data['confirmed'] = False
        with self.assertRaises(ApiError):
            self.service.save(data)

    def test_storage_failure_rolls_back_entire_batch(self):
        with self.db.connect() as c:
            c.execute("CREATE TRIGGER fail_order BEFORE INSERT ON expense_orders WHEN NEW.order_id = 'second' BEGIN SELECT RAISE(ABORT, 'test'); END")
        with self.assertRaises(sqlite3.IntegrityError):
            self.service.save(self.payload())
        for table in ('expenses', 'expense_invoices', 'expense_orders', 'order_import_batches'):
            self.assertEqual(self.count(table), 0)

    def test_duplicate_order_ids_rejected_even_if_reviewed(self):
        payload = self.payload()
        payload['orders'][1]['order_id'] = payload['orders'][0]['order_id']
        with self.assertRaises(ApiError):
            self.service.save(payload)
        self.assertEqual(self.count(), 0)
        payload = self.payload()
        saved = self.service.save(payload)
        payload['token'] = 'another-token-12345'
        payload['reviewed_invoice_ids'] = saved['ids']
        with self.assertRaises(ApiError):
            self.service.save(payload)
        self.assertEqual(self.count(), 2)

    def test_existing_screenshot_candidates_require_explicit_review(self):
        payload = self.payload()
        saved = self.service.save(payload)
        payload['token'] = 'another-token-12345'
        for i, row in enumerate(payload['orders']):
            row['order_id'] = 'new-' + str(i)
        with self.assertRaises(ApiError) as error:
            self.service.save(payload)
        self.assertEqual(error.exception.details['code'], 'duplicate_invoice')
        self.assertEqual(self.count(), 2)
        payload['reviewed_invoice_ids'] = saved['ids']
        self.service.save(payload)
        self.assertEqual(self.count(), 4)

    def test_deleting_order_removes_metadata_and_screenshot(self):
        saved = self.service.save(self.payload())
        Router(self.db).dispatch('DELETE', f'/api/expenses/{saved["ids"][0]}', {}, {})
        self.assertEqual(self.count('expense_orders'), 1)
        self.assertEqual(self.count('expense_invoices'), 1)


if __name__ == '__main__':
    unittest.main()
