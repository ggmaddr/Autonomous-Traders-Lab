"""Public boundary tests; never connects to the desktop API or writes its data."""
import asyncio
import unittest
from unittest.mock import patch

import httpx
from . import public_web as web

RealClient = httpx.AsyncClient


class PublicWebTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        web.cache.clear()
        web.pending.clear()
        web.slots = asyncio.Semaphore(4)
        self.client = RealClient(transport=httpx.ASGITransport(app=web.app), base_url="http://public")

    async def asyncTearDown(self):
        await self.client.aclose()

    async def test_all_writes_blocked(self):
        for method in ("POST", "PUT", "PATCH", "DELETE", "OPTIONS"):
            for path in ("/api/experiments", "/api/experiments/exp_test/cancel", "/"):
                response = await self.client.request(method, path, json={})
                self.assertEqual(response.status_code, 405)
        self.assertFalse(web.pending)

    async def test_private_paths_not_exposed(self):
        for path in ("/.env", "/accounts.db", "/server/api.py", "/docs", "/openapi.json",
                     "/api/generate", "/api/experiments/exp_test/cancel", "/api/traders/unknown",
                     "/assets/%2e%2e/%2e%2e/.env"):
            self.assertEqual((await self.client.get(path)).status_code, 404, path)

    async def test_ui_is_marked_view_only_and_deep_links_work(self):
        for path in ("/", "/trades", "/experiments", "/architecture", "/architecture?mechanism=memory"):
            response = await self.client.get(path)
            self.assertEqual(response.status_code, 200)
            self.assertIn('<meta name="view-only" content="true">', response.text)

    async def test_query_validation(self):
        for path in ("/api/traders?target=http://evil", "/api/runs?limit=no",
                     "/api/market-year?range=all", "/api/runs?trader=unknown"):
            self.assertEqual((await self.client.get(path)).status_code, 400)

    async def test_roster_display_names_are_allowed(self):
        def upstream_client(**kwargs):
            return RealClient(transport=httpx.MockTransport(lambda _: httpx.Response(200, json={"balance": 10000})))
        with patch.object(web.httpx, "AsyncClient", upstream_client):
            for name in ("Zoro", "Sanji", "Luffy", "Robin", "Law", "Nami", "Jinbe"):
                self.assertEqual((await self.client.get(f"/api/traders/{name}")).status_code, 200)

    async def test_shared_cache_coalesces_visitors_and_redacts(self):
        calls = []

        async def upstream(request):
            calls.append(request)
            await asyncio.sleep(0.01)
            return httpx.Response(200, json={"note": "test-secret-123"})

        def upstream_client(**kwargs):
            return RealClient(transport=httpx.MockTransport(upstream))

        with patch.object(web.httpx, "AsyncClient", upstream_client), patch.object(web, "SECRETS", [b"test-secret-123"]):
            responses = await asyncio.gather(*[self.client.get("/api/traders", headers={"Authorization": "private"}) for _ in range(8)])
            responses.append(await self.client.get("/api/traders"))
        self.assertEqual(len(calls), 1)
        self.assertNotIn("authorization", calls[0].headers)
        self.assertEqual(str(calls[0].url), "http://127.0.0.1:8000/api/traders")
        for response in responses:
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), {"note": "[redacted]"})

    async def test_upstream_failure_does_not_leak_details(self):
        def upstream_client(**kwargs):
            return RealClient(transport=httpx.MockTransport(lambda _: httpx.Response(500, text="private traceback")))
        with patch.object(web.httpx, "AsyncClient", upstream_client):
            response = await self.client.get("/api/traders")
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("traceback", response.text)


if __name__ == "__main__":
    unittest.main()
