"""LangGraph node wrappers."""
from __future__ import annotations

from agent.state import OutreachAgentState
from agent.tools import (
    classify_text,
    execute_single_tool,
    persist_brief,
    plan_gather,
    synthesize_brief,
    validate_message,
)
from memory.mongo_memory import append_thread_message, load_thread


def route_input(state: OutreachAgentState) -> OutreachAgentState:
    return state


def plan_gather_node(state: OutreachAgentState) -> OutreachAgentState:
    return plan_gather(dict(state))


def execute_tool_node(state: OutreachAgentState) -> OutreachAgentState:
    return execute_single_tool(dict(state))


def synthesize_node(state: OutreachAgentState) -> OutreachAgentState:
    return synthesize_brief(dict(state))


def validate_node(state: OutreachAgentState) -> OutreachAgentState:
    return validate_message(dict(state))


def persist_node(state: OutreachAgentState) -> OutreachAgentState:
    return persist_brief(dict(state))


def classify_node(state: OutreachAgentState) -> OutreachAgentState:
    return classify_text(dict(state))


def increment_retry(state: OutreachAgentState) -> OutreachAgentState:
    s = dict(state)
    s["retry_count"] = (s.get("retry_count") or 0) + 1
    return s


def load_memory_node(state: OutreachAgentState) -> OutreachAgentState:
    s = dict(state)
    tid = s.get("thread_id") or (s.get("prospect") or {}).get("id") or ""
    if tid:
        thread = load_thread(tid)
        if thread:
            s["extra_context"] = (s.get("extra_context") or "") + "\nPrior context: " + str(thread.get("last_brief", ""))[:1000]
    return s


def chat_reply_node(state: OutreachAgentState) -> OutreachAgentState:
    s = dict(state)
    draft = s.get("draft_message") or (s.get("brief") or {}).get("draftMessage") or ""
    s["chat_reply"] = draft or "I've updated the analysis based on your request."
    tid = s.get("thread_id") or (s.get("prospect") or {}).get("id")
    if tid:
        append_thread_message(tid, "user", s.get("chat_message") or "")
        append_thread_message(tid, "assistant", s["chat_reply"], brief=s.get("brief"))
    return s
