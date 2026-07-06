"""LangGraph SSE streaming for analyse flow."""
from __future__ import annotations

import json
from typing import Any, AsyncIterator


def _event(payload: dict[str, Any]) -> dict[str, Any]:
    return payload


def _node_event(node_name: str, update: dict[str, Any]) -> dict[str, Any] | None:
    if node_name == "plan_gather":
        return _event({
            "type": "plan",
            "tools": update.get("planned_tools") or [],
            "reasoning": update.get("plan_reasoning") or "",
        })
    if node_name == "execute_tool":
        tool = update.get("current_tool") or ""
        last = update.get("last_tool_result") or {}
        trace = update.get("tool_trace") or []
        last_trace = trace[-1] if trace else {}
        return _event({
            "type": "tool",
            "name": tool,
            "duration_ms": last_trace.get("duration_ms") or last.get("_duration_ms", 0),
            "error": last_trace.get("error") or last.get("error"),
            "reason": last_trace.get("reason", ""),
        })
    if node_name == "synthesize":
        return _event({"type": "synthesize", "status": "done"})
    if node_name == "validate":
        v = update.get("validation") or {}
        return _event({
            "type": "validate",
            "pass": v.get("pass"),
            "score": v.get("score"),
            "issues": v.get("issues") or [],
        })
    if node_name == "increment_retry":
        return _event({"type": "retry", "attempt": update.get("retry_count") or 0})
    if node_name == "persist":
        return _event({"type": "persist", "ok": True})
    return None


async def graph_stream_analyse(state: dict, format_fn) -> AsyncIterator[dict[str, Any]]:
    from agent.graph import get_chain

    chain = get_chain()
    final_state: dict[str, Any] = dict(state)

    async for chunk in chain.astream(state, stream_mode="updates"):
        if not isinstance(chunk, dict):
            continue
        for node_name, node_update in chunk.items():
            if isinstance(node_update, dict):
                final_state.update(node_update)
            evt = _node_event(node_name, node_update if isinstance(node_update, dict) else {})
            if evt:
                yield evt

    yield _event({"type": "final", **format_fn(final_state)})


def sse_line(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload, default=str)}\n\n"
