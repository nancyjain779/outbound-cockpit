"""Tests for hybrid tool planner and eligibility rules."""
from __future__ import annotations

import os

from agent.planner import plan_tools_hybrid, _rules_only_plan
from agent.tool_catalog import (
    build_eligible_tools,
    eligible_enrich_company,
    eligible_fetch_linkedin_profile,
    eligible_web_research,
)
from agent.routers import route_after_execute, route_by_intent


def test_skip_enrich_when_company_facts_cached():
    state = {
        "prospect": {
            "domain": "acme.io",
            "companyFacts": {"name": "Acme", "industry": "SaaS", "description": "B2B platform"},
        },
    }
    assert not eligible_enrich_company(state)
    assert "enrich_company" not in build_eligible_tools(state)


def test_linkedin_excluded_when_pull_profile_false():
    state = {
        "prospect": {"profile": "https://linkedin.com/in/jane"},
        "pull_profile": False,
    }
    assert not eligible_fetch_linkedin_profile(state)


def test_web_research_eligible_on_deep_research():
    state = {
        "prospect": {
            "companyFacts": {"description": "x", "industry": "y"},
        },
        "deep_research": True,
    }
    assert eligible_web_research(state)


def test_rules_only_plan_respects_max_tools():
    prev = os.environ.get("MAX_TOOLS_PER_RUN")
    os.environ["MAX_TOOLS_PER_RUN"] = "2"
    try:
        state = {
            "prospect": {"domain": "acme.io", "profile": "https://linkedin.com/in/jane"},
            "pull_profile": True,
            "deep_research": True,
        }
        plan = _rules_only_plan(state)
        assert len(plan.tools) <= 2
    finally:
        if prev is None:
            os.environ.pop("MAX_TOOLS_PER_RUN", None)
        else:
            os.environ["MAX_TOOLS_PER_RUN"] = prev


def test_route_after_execute_loops():
    assert route_after_execute({"tools_queue": [{"name": "scrape_website"}]}) == "execute_tool"
    assert route_after_execute({"tools_queue": []}) == "synthesize"


def test_route_by_intent_plan():
    assert route_by_intent({"intent": "analyse"}) == "plan"


def test_plan_hybrid_empty_when_nothing_eligible():
    state = {"prospect": {}, "pull_profile": False, "deep_research": False}
    plan = plan_tools_hybrid(state)
    assert plan.tools == []
