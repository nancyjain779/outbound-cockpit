"""Direct tool execution for LangGraph nodes (same bridge as MCP)."""
from __future__ import annotations

import uuid
from typing import Any

from agent.llm import llm_json
from agent.planner import plan_tools_hybrid, plan_to_queue


def ensure_run_id(state: dict) -> str:
    run_id = state.get("run_id") or str(uuid.uuid4())[:8]
    state["run_id"] = run_id
    return run_id


def init_gather_state(state: dict) -> dict:
    """Seed company_facts/hiring from prospect cache before planning."""
    ensure_run_id(state)
    p = state.get("prospect") or {}
    if isinstance(p.get("companyFacts"), dict) and not state.get("company_facts"):
        state["company_facts"] = p["companyFacts"]
    if p.get("hiringTitles") and not state.get("hiring_titles"):
        state["hiring_titles"] = list(p["hiringTitles"])
    if p.get("allRoles") and not state.get("all_roles"):
        state["all_roles"] = list(p["allRoles"])
    state.setdefault("credits_consumed", 0)
    state.setdefault("tools_completed", 0)
    state.setdefault("tool_trace", [])
    return state


def plan_gather(state: dict) -> dict:
    state = init_gather_state(dict(state))
    plan = plan_tools_hybrid(state)
    state["tools_queue"] = plan_to_queue(plan)
    state["plan_reasoning"] = plan.reasoning
    state["planned_tools"] = [
        {"name": t.name, "reason": t.reason} for t in plan.tools
    ]
    return state


def execute_single_tool(state: dict) -> dict:
    state = dict(state)
    queue = list(state.get("tools_queue") or [])
    if not queue:
        state["current_tool"] = None
        return state

    item = queue.pop(0)
    state["tools_queue"] = queue
    name = item.get("name") or ""
    args = item.get("args") or default_tool_args(state, name)
    reason = item.get("reason") or ""
    state["current_tool"] = name

    run_id = ensure_run_id(state)
    result = run_tool(state, name, args, run_id)
    state["last_tool_result"] = result
    _trace(state, name, result, reason=reason)
    state["tools_completed"] = (state.get("tools_completed") or 0) + 1
    return state


def synthesize_brief(state: dict) -> dict:
    from agent.prompts import build_analyse_prompt

    p = state.get("prospect") or {}
    linkedin_block = (state.get("linkedin_data") or {}).get("text", "")
    web_summary = (state.get("web_research") or {}).get("summary", "")
    feedback = ""
    if state.get("validation") and not state["validation"].get("pass"):
        feedback = f"\nPrevious draft failed validation: {state['validation'].get('issues', [])}. Fix: {state['validation'].get('suggestion', '')}"

    prompt = build_analyse_prompt(
        p,
        state.get("opener_keys") or [],
        state.get("company_facts"),
        state.get("hiring_titles") or [],
        state.get("all_roles") or [],
        state.get("site_text") or "",
        linkedin_block,
        (state.get("extra_context") or "") + feedback,
        web_summary,
    )
    out = llm_json("Return only valid JSON.", prompt)
    if out:
        state["brief"] = out
        state["draft_message"] = out.get("draftMessage") or out.get("customLine") or ""
        state["mode"] = "agent"
    else:
        state["mode"] = "heuristic"
        state["error"] = "LLM synthesis failed"
    return state


def validate_message(state: dict) -> dict:
    draft = state.get("draft_message") or (state.get("brief") or {}).get("draftMessage") or ""
    if not draft:
        state["validation"] = {"pass": False, "score": 0, "issues": ["empty draft"], "suggestion": "generate a message"}
        return state

    from agent.prompts import build_validate_prompt
    track = (state.get("prospect") or {}).get("track") or "A"
    out = llm_json("Return only valid JSON.", build_validate_prompt(draft, track))
    if out:
        state["validation"] = out
        _trace(state, "validate_message", {"_duration_ms": 0, "pass": out.get("pass")})
    else:
        state["validation"] = {"pass": True, "score": 70, "issues": [], "suggestion": ""}
    return state


def classify_text(state: dict) -> dict:
    from agent.prompts import build_classify_prompt
    text = state.get("classify_text") or ""
    opener_map = state.get("opener_map") or {}
    prompt = build_classify_prompt(text, state.get("classify_url") or "", state.get("hint_track") or "", opener_map)
    out = llm_json("Return only valid JSON.", prompt)
    state["classify_result"] = out or {}
    state["mode"] = "agent" if out else "heuristic"
    return state


def persist_brief(state: dict) -> dict:
    p = dict(state.get("prospect") or {})
    if not p.get("id"):
        return state
    brief = state.get("brief") or {}
    draft = state.get("draft_message") or brief.get("draftMessage") or ""
    r = call_tool_sync(
        "POST",
        "upsert-prospect",
        json_body={"prospect": p, "brief": brief, "draftMessage": draft},
        run_id=state.get("run_id") or "",
    )
    _trace(state, "save_prospect_brief", r)
    return state
