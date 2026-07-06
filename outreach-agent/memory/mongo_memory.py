from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

_client = None


def _coll():
    global _client
    uri = os.getenv("MONGODB_URI", "")
    db_name = os.getenv("MONGODB_DB", "outbound_cockpit")
    col_name = os.getenv("MONGODB_THREADS_COLLECTION", "agent_threads")
    if not uri:
        return None
    if _client is None:
        from pymongo import MongoClient
        _client = MongoClient(uri, maxPoolSize=5)
    return _client[db_name][col_name]


def load_thread(thread_id: str) -> dict[str, Any] | None:
    c = _coll()
    if c is None or not thread_id:
        return None
    doc = c.find_one({"thread_id": thread_id}, {"_id": 0})
    return doc


def append_thread_message(
    thread_id: str,
    role: str,
    content: str,
    *,
    brief: dict | None = None,
) -> None:
    c = _coll()
    if c is None or not thread_id:
        return
    msg = {"role": role, "content": content, "ts": datetime.now(timezone.utc).isoformat()}
    update: dict[str, Any] = {
        "$push": {"messages": msg},
        "$set": {"updated_at": datetime.now(timezone.utc).isoformat()},
        "$setOnInsert": {"thread_id": thread_id, "prospect_id": thread_id},
    }
    if brief:
        update["$set"]["last_brief"] = brief
    c.update_one({"thread_id": thread_id}, update, upsert=True)


def mongo_ok() -> bool:
    c = _coll()
    if c is None:
        return False
    try:
        c.database.client.admin.command("ping")
        return True
    except Exception:
        return False
