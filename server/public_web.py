"""Public view-only gateway. Run on loopback port 8010, then tunnel only that port.

Serves the built UI and an explicit set of cached GET endpoints from the private
API. No arbitrary proxy targets, credentials, write methods, or source files.
"""
import asyncio
from collections import OrderedDict
from pathlib import Path
import re
import time
from urllib.parse import urlencode

import httpx
from dotenv import dotenv_values
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "client" / "dist"
ORIGIN = "http://127.0.0.1:8000"
CREW = "(?i:robin|nami|jinbe|law|luffy|zoro|sanji)"
READ_PATHS = re.compile(
    rf"/api/(?:traders(?:/{CREW}(?:/logs)?)?|market|research|runs(?:/trace_[a-zA-Z0-9_-]+)?"
    rf"|health/activity|lessons|memory/{CREW}(?:/node/[^\x00-\x1f]+)?"
    r"|market-year|lab/catalog|lab/trials/[0-9]+|experiments(?:/exp_[a-zA-Z0-9_-]+)?)"
)
PAGES = {"", "trades", "researcher", "decisions", "lessons", "memory", "market-year", "experiments", "failures", "health"}
# Trace text is public, but configured credentials must never appear in it.
SECRETS = [v.encode() for k, v in dotenv_values(ROOT / ".env").items()
           if v and len(v) >= 8 and re.search(r"KEY|TOKEN|SECRET|PASSWORD", k, re.I)]
cache: OrderedDict[str, tuple[float, bytes]] = OrderedDict()
pending: dict[str, asyncio.Task] = {}
slots = asyncio.Semaphore(4)
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


def query_for(request: Request) -> str:
    allowed = {
        "/api/research": {"trader", "limit"}, "/api/runs": {"trader", "limit"},
        "/api/lessons": {"trader"}, "/api/health/activity": {"minutes"},
        "/api/market-year": {"range"},
    }.get(request.url.path, {"last_n"} if request.url.path.endswith("/logs") else set())
    result = {}
    for key, value in request.query_params.multi_items():
        if key not in allowed or key in result:
            raise ValueError("Unsupported query")
        if key in {"limit", "last_n", "minutes"}:
            value = str(max(1, min(int(value), {"limit": 200, "last_n": 100, "minutes": 1440}[key])))
        elif key == "trader":
            value = value.lower()
            if not re.fullmatch(CREW, value):
                raise ValueError("Unknown trader")
        elif key == "range" and value not in {"ytd", "2y", "10y"}:
            raise ValueError("Unknown range")
        result[key] = value
    return urlencode(sorted(result.items()))


async def fetch_read(key: str, ttl: int) -> tuple[int, bytes]:
    try:
        async with slots, httpx.AsyncClient(timeout=60, trust_env=False) as client:
            # No visitor headers/cookies forwarded; no redirects followed.
            response = await client.get(ORIGIN + key)
        if response.status_code != 200:
            return (404 if response.status_code == 404 else 503), b'{"detail":"Data unavailable"}'
        if "application/json" not in response.headers.get("content-type", ""):
            return 503, b'{"detail":"Data unavailable"}'
        body = response.content
        for secret in SECRETS:
            body = body.replace(secret, b"[redacted]")
        cache[key] = (time.monotonic() + ttl, body)
        cache.move_to_end(key)
        while len(cache) > 128:
            cache.popitem(last=False)
        return 200, body
    except httpx.HTTPError:
        return 503, b'{"detail":"Desktop API unavailable"}'
    finally:
        pending.pop(key, None)


@app.middleware("http")
async def view_only(request: Request, call_next):
    if request.method not in {"GET", "HEAD"}:
        return JSONResponse({"detail": "Public dashboard is view-only"}, status_code=405,
                            headers={"Allow": "GET, HEAD"})
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Robots-Tag"] = "noindex, nofollow"
    response.headers["Cache-Control"] = "no-store"
    return response


@app.api_route("/{path:path}", methods=["GET", "HEAD"])
async def public(request: Request, path: str):
    if path.startswith("api/"):
        if not READ_PATHS.fullmatch("/" + path) or len(path) > 1024:
            return JSONResponse({"detail": "Not found"}, status_code=404)
        try:
            query = query_for(request)
        except ValueError:
            return JSONResponse({"detail": "Invalid query"}, status_code=400)
        key = "/" + path + ("?" + query if query else "")
        cached = cache.get(key)
        if cached and cached[0] > time.monotonic():
            status, body = 200, cached[1]
        else:
            if key not in pending:
                if len(pending) >= 32:
                    return JSONResponse({"detail": "Please retry shortly"}, status_code=429)
                ttl = 300 if path == "api/market-year" else 15
                pending[key] = asyncio.create_task(fetch_read(key, ttl))
            status, body = await asyncio.shield(pending[key])
        return Response(body if request.method == "GET" else b"", status_code=status, media_type="application/json")
    if path in PAGES:
        html = (DIST / "index.html").read_text().replace("<head>", '<head><meta name="view-only" content="true">', 1)
        return HTMLResponse(html if request.method == "GET" else "")
    # Only compiled assets and the UI's image files; never arbitrary repo files.
    candidate = (DIST / path).resolve()
    if (path.startswith("assets/") or path in {"favicon.png", "chopper.png"}) and candidate.is_relative_to(DIST.resolve()) and candidate.is_file():
        return FileResponse(candidate)
    return JSONResponse({"detail": "Not found"}, status_code=404)
