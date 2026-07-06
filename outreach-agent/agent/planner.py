"""Hybrid tool planner — deterministic eligibility + LLM trim/order."""
from __future__ import annotations

import os
from typing import Any

from pydantic import BaseModel, Field

from agent.tool_catalog import (
    DEFAULT_ORDER,
    TOOL_DESCRIPTIONS,
    build_eligible_tools,
    default_tool_args,
)
from agent.llm import llm_json

MAX_TOOLS_PER_RUN = int(os.getenv("MAX_TOOLS_PER_RUN", "8"))


class ToolPlanItem(BaseModel):
    name: str
    args: dict = Field(default_factory=dict)
    reason: str = ""


class ToolPlan(BaseModel):
    tools: list[ToolPlanItem] = Field(default_factory=list)
    reasoning: str = ""


def _rules_only_plan(state: dict) -> ToolPlan:
    eligible = build_eligible_tools(state)
    tools = [
        ToolPlanItem(
            name=name,
            args=default_tool_args(state, name),
            reason="eligible by rules",
        )
        for name in eligible
    ][:MAX_TOOLS_PER_RUN]
    return ToolPlan(tools=tools, reasoning="Rules-only plan (LLM unavailable)")


def _prospect_summary(state: dict) -> str:
    p = state.get("prospect") or {}
    lines = [
        f"Name: {p.get('name', '?')}",
        f"Company: {p.get('company', '?')}",
        f"Domain: {p.get('domain', '?')}",
        f"Track: {p.get('track', '?')}",
        f"Signal: {p.get('signal', '')}",
        f"Has companyFacts cached: {bool(p.get('companyFacts'))}",
        f"deep_research: {state.get('deep_research')}",
        f"pull_profile: {state.get('pull_profile')}",
    ]
    return "\n".join(lines)


def plan_tools_hybrid(state: dict) -> ToolPlan:
    eligible = build_eligible_tools(state)
    if not eligible:
        return ToolPlan(tools=[], reasoning="No tools eligible for this prospect")

    desc_lines = "\n".join(
        f"- {name}: {TOOL_DESCRIPTIONS[name]}" for name in eligible
    )
    prompt = f"""You are a tool planner for a B2B outreach research agent.
Given the prospect and ONLY the eligible tools below, return an ORDERED subset to run.
You may DROP optional tools (e.g. skip web_research if Apollo facts suffice) but must NOT add tools outside this list.

Eligible tools:
{desc_lines}

Prospect:
{_prospect_summary(state)}

Return STRICT JSON:
{{"reasoning": "<one sentence>", "tools": [{{"name": "<tool name>", "reason": "<why run it>"}}]}}

Include only tools from the eligible list. Max {MAX_TOOLS_PER_RUN} tools."""

    out = llm_json("Return only valid JSON.", prompt)
    if not out or not isinstance(out.get("tools"), list):
        return _rules_only_plan(state)

    eligible_set = set(eligible)
    tools: list[ToolPlanItem] = []
    for item in out["tools"]:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "")
        if name not in eligible_set:
            continue
        tools.append(
            ToolPlanItem(
                name=name,
                args=default_tool_args(state, name),
                reason=str(item.get("reason") or ""),
            )
        )
        if len(tools) >= MAX_TOOLS_PER_RUN:
            break

    if not tools:
        return _rules_only_plan(state)

    return ToolPlan(
        tools=tools,
        reasoning=str(out.get("reasoning") or "LLM-planned tool order"),
    )


def plan_to_queue(plan: ToolPlan) -> list[dict[str, Any]]:
    return [t.model_dump() for t in plan.tools]
