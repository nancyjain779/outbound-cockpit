"""HTTP client to Node.js internal tool bridge."""
from __future__ import annotations

import json
import os
import time
from typing import Any

import httpx


def normalize_bridge_url(raw: str | None) -> str:
    """Render Blueprint hostport is hostname:port without a scheme."""
    u = (raw or "http://localhost:3000").strip().rstrip("/")
    if not u.startswith(("http://", "https://")):
        u = f"https://{u}"
    return u


BRIDGE_URL = normalize_bridge_url(os.getenv("NODE_TOOL_BRIDGE_URL"))
SERVICE_TOKEN = os.getenv("COCKPIT_SERVICE_TOKEN", "")
TIMEOUT = float(os.getenv("TOOL_BRIDGE_TIMEOUT", "120"))


def _headers(run_id: str = "") -> dict[str, str]:
    h = {"Content-Type": "application/json", "x-service-token": SERVICE_TOKEN}
    if run_id:
        h["x-run-id"] = run_id
    return h


async def call_tool(method: str, path: str, *, json_body: dict | None = None, params: dict | None = None, run_id: str = "") -> dict[str, Any]:
    url = f"{BRIDGE_URL}/api/internal/tools/{path.lstrip('/')}"
    t0 = time.monotonic()
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        if method.upper() == "GET":
            r = await client.get(url, headers=_headers(run_id), params=params or {})
        else:
            r = await client.post(url, headers=_headers(run_id), json=json_body or {})
    ms = int((time.monotonic() - t0) * 1000)
    try:
        data = r.json()
    except Exception:
        data = {"error": r.text[:500], "status": r.status_code}
    if r.status_code >= 400:
        return {"error": data.get("error", f"HTTP {r.status_code}"), "status": r.status_code, "duration_ms": ms}
    data["_duration_ms"] = ms
    return data


def call_tool_sync(method: str, path: str, *, json_body: dict | None = None, params: dict | None = None, run_id: str = "") -> dict[str, Any]:
    url = f"{BRIDGE_URL}/api/internal/tools/{path.lstrip('/')}"
    t0 = time.monotonic()
    with httpx.Client(timeout=TIMEOUT) as client:
        if method.upper() == "GET":
            r = client.get(url, headers=_headers(run_id), params=params or {})
        else:
            r = client.post(url, headers=_headers(run_id), json=json_body or {})
    ms = int((time.monotonic() - t0) * 1000)
    try:
        data = r.json()
    except Exception:
        data = {"error": r.text[:500], "status": r.status_code}
    if r.status_code >= 400:
        return {"error": data.get("error", f"HTTP {r.status_code}"), "status": r.status_code, "duration_ms": ms}
    data["_duration_ms"] = ms
    return data
