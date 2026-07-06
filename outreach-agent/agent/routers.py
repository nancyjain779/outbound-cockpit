from __future__ import annotations

from agent.state import OutreachAgentState


def route_by_intent(state: OutreachAgentState) -> str:
    intent = state.get("intent") or "analyse"
    if intent == "classify":
        return "classify"
    if intent == "chat":
        return "chat"
    return "plan"


def route_after_execute(state: OutreachAgentState) -> str:
    queue = state.get("tools_queue") or []
    if queue:
        return "execute_tool"
    return "synthesize"


def route_after_validate(state: OutreachAgentState) -> str:
    v = state.get("validation") or {}
    retries = state.get("retry_count") or 0
    max_r = state.get("max_retries") or 2
    if v.get("pass"):
        return "persist"
    if retries < max_r:
        return "retry"
    return "persist"


def route_after_synthesize(state: OutreachAgentState) -> str:
    if state.get("intent") == "chat":
        return "chat_reply"
    return "validate"


def route_chat(state: OutreachAgentState) -> str:
    msg = (state.get("chat_message") or "").lower()
    if any(w in msg for w in ("research", "linkedin", "company", "funding", "news")):
        return "plan"
    return "synthesize"
