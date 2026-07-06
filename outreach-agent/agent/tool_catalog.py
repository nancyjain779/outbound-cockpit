"""Tool catalog — eligibility rules and single-tool executors."""
from __future__ import annotations

from typing import Any, Callable

from mcp_server.bridge import call_tool_sync

TOOL_NAMES = (
    "enrich_company",
    "scrape_website",
    "fetch_linkedin_profile",
    "web_research",
)

TOOL_DESCRIPTIONS = {
    "enrich_company": "Apollo org enrichment + hiring titles (~1 credit if uncached)",
    "scrape_website": "Scrape company homepage/about text (no credits)",
    "fetch_linkedin_profile": "Apify LinkedIn profile + recent posts",
    "web_research": "Perplexity live web research (news, funding, hiring)",
}


def _prospect(state: dict) -> dict:
    return state.get("prospect") or {}


def _facts(state: dict) -> dict | None:
    p = _prospect(state)
    if isinstance(p.get("companyFacts"), dict):
        return p["companyFacts"]
    if isinstance(state.get("company_facts"), dict):
        return state["company_facts"]
    return None


def _site_url(state: dict) -> str:
    p = _prospect(state)
    facts = _facts(state)
    domain = p.get("domain") or ""
    return (
        p.get("website")
        or (facts or {}).get("website")
        or (f"https://{domain}" if domain else "")
    )


def _facts_rich(facts: dict | None) -> bool:
    if not facts:
        return False
    return bool(facts.get("description") and facts.get("industry"))


def eligible_enrich_company(state: dict) -> bool:
    if _facts(state):
        return False
    p = _prospect(state)
    return bool(p.get("domain") or p.get("orgId"))


def eligible_scrape_website(state: dict) -> bool:
    return bool(_site_url(state))


def eligible_fetch_linkedin_profile(state: dict) -> bool:
    if not state.get("pull_profile"):
        return False
    profile = (_prospect(state).get("profile") or "").lower()
    return "linkedin.com/in/" in profile


def eligible_web_research(state: dict) -> bool:
    if state.get("deep_research"):
        return True
    return not _facts_rich(_facts(state))


ELIGIBILITY: dict[str, Callable[[dict], bool]] = {
    "enrich_company": eligible_enrich_company,
    "scrape_website": eligible_scrape_website,
    "fetch_linkedin_profile": eligible_fetch_linkedin_profile,
    "web_research": eligible_web_research,
}

# Default execution order when LLM planner unavailable
DEFAULT_ORDER = ("enrich_company", "scrape_website", "fetch_linkedin_profile", "web_research")


def build_eligible_tools(state: dict) -> list[str]:
    return [name for name in DEFAULT_ORDER if ELIGIBILITY[name](state)]


def default_tool_args(state: dict, name: str) -> dict:
    p = _prospect(state)
    if name == "enrich_company":
        return {"domain": p.get("domain") or "", "orgId": p.get("orgId") or ""}
    if name == "scrape_website":
        return {"url": _site_url(state)}
    if name == "fetch_linkedin_profile":
        facts = _facts(state)
        site_text = state.get("site_text") or ""
        skip = bool(facts and site_text)
        return {"profileUrl": p.get("profile") or "", "skipProfile": skip}
    if name == "web_research":
        name_s = p.get("name") or ""
        company = p.get("company") or ""
        q = f'Research "{name_s}" at "{company}" — recent news, funding, product, hiring, LinkedIn activity.'
        return {"query": q, "deep": bool(state.get("deep_research"))}
    return {}


def run_enrich_company(state: dict, args: dict, run_id: str) -> dict:
    r = call_tool_sync(
        "POST",
        "enrich-org",
        json_body={"domain": args.get("domain", ""), "orgId": args.get("orgId", "")},
        run_id=run_id,
    )
    if r.get("facts"):
        state["company_facts"] = r["facts"]
        state["hiring_titles"] = r.get("hiringTitles") or state.get("hiring_titles") or []
        state["all_roles"] = r.get("allRoles") or state.get("all_roles") or []
        credits = (state.get("credits_consumed") or 0) + (r.get("credits_consumed") or 0)
        state["credits_consumed"] = credits
        p = dict(_prospect(state))
        if r.get("orgId"):
            p["orgId"] = r["orgId"]
        state["prospect"] = p
    return r


def run_scrape_website(state: dict, args: dict, run_id: str) -> dict:
    r = call_tool_sync("POST", "scrape-site", json_body={"url": args.get("url", "")}, run_id=run_id)
    if r.get("text"):
        state["site_text"] = r["text"]
    return r


def run_fetch_linkedin_profile(state: dict, args: dict, run_id: str) -> dict:
    r = call_tool_sync(
        "POST",
        "linkedin-profile",
        json_body={"profileUrl": args.get("profileUrl", ""), "skipProfile": bool(args.get("skipProfile"))},
        run_id=run_id,
    )
    if r.get("text"):
        state["linkedin_data"] = {
            "headline": r.get("headline", ""),
            "about": r.get("about", ""),
            "recentPosts": r.get("recentPosts") or [],
            "text": r.get("text", ""),
        }
    return r


def run_web_research(state: dict, args: dict, run_id: str) -> dict:
    r = call_tool_sync(
        "POST",
        "web-research",
        json_body={"query": args.get("query", ""), "deep": bool(args.get("deep"))},
        run_id=run_id,
    )
    if r.get("summary"):
        state["web_research"] = {"summary": r["summary"], "sources": r.get("sources") or []}
    return r


RUNNERS: dict[str, Callable[[dict, dict, str], dict]] = {
    "enrich_company": run_enrich_company,
    "scrape_website": run_scrape_website,
    "fetch_linkedin_profile": run_fetch_linkedin_profile,
    "web_research": run_web_research,
}


def run_tool(state: dict, name: str, args: dict, run_id: str) -> dict[str, Any]:
    runner = RUNNERS.get(name)
    if not runner:
        return {"error": f"unknown tool: {name}"}
    return runner(state, args, run_id)
