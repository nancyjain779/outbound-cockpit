#!/usr/bin/env python3
"""Outreach Cockpit MCP Server — 12 tools wrapping Node internal bridge + LLM helpers."""
from __future__ import annotations

import json
import os
import sys

from dotenv import load_dotenv

load_dotenv()

try:
    from mcp.server.fastmcp import FastMCP
except ImportError:
    sys.exit("ERROR: pip install mcp")

from mcp_server.bridge import call_tool_sync

mcp = FastMCP("outreach-cockpit")

LITELLM_MODEL = os.getenv("LITELLM_MODEL", os.getenv("OPENAI_MODEL", "gpt-4o-mini"))


def _json(data: dict) -> str:
    return json.dumps(data, indent=2, default=str)


def _ask_llm(system: str, user: str) -> str:
    try:
        import litellm
        resp = litellm.completion(
            model=LITELLM_MODEL,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=0.4,
        )
        return resp.choices[0].message.content or ""
    except Exception as e:
        return json.dumps({"error": str(e)})


@mcp.tool()
def classify_lead_text(text: str, url: str = "", hint_track: str = "", opener_map_json: str = "") -> str:
    """Classify pasted social post text into track A/B/C/D, signalKey, and draft line."""
    opener_map = json.loads(opener_map_json) if opener_map_json else {}
    map_lines = "\n".join(f"  {t}: {', '.join(v)}" for t, v in opener_map.items()) if opener_map else "(default)"
    prompt = f"""You triage one social post for founder-led outbound.
Tracks: A=funded SaaS/AI founder/CTO; B=enterprise innovation leader; C=first-time founder WITH capital; D=idea-stage/non-technical.
Valid opener keys:
{map_lines}
Hint track: {hint_track or 'none'}
URL: {url or 'none'}
Text:
\"\"\"
{text[:4000]}
\"\"\"
Return STRICT JSON: {{"track":"A|B|C|D","signalKey":"...","signal":"...","nameGuess":"...","customLine":"...","summary":"..."}}"""
    out = _ask_llm("Return only valid JSON.", prompt)
    return out


@mcp.tool()
def enrich_company(domain: str, org_id: str = "") -> str:
    """Enrich company via Apollo org lookup + hiring signals."""
    data = call_tool_sync("POST", "enrich-org", json_body={"domain": domain, "orgId": org_id})
    return _json(data)


@mcp.tool()
def scrape_website(url: str) -> str:
    """Scrape company website text (homepage/about)."""
    data = call_tool_sync("POST", "scrape-site", json_body={"url": url})
    return _json(data)


@mcp.tool()
def fetch_linkedin_profile(profile_url: str, skip_profile: bool = False) -> str:
    """Fetch LinkedIn profile and recent posts via Apify."""
    data = call_tool_sync("POST", "linkedin-profile", json_body={"profileUrl": profile_url, "skipProfile": skip_profile})
    return _json(data)


@mcp.tool()
def search_apollo_leads(track: str = "A", geo: str = "IN-tier1", limit: int = 25, page: int = 1) -> str:
    """Search Apollo for people matching track/geo filters."""
    data = call_tool_sync("GET", "apollo-search", params={"track": track, "geo": geo, "limit": str(limit), "page": str(page)})
    return _json(data)


@mcp.tool()
def search_linkedin_posts(queries: str, track: str = "C", geo: str = "", max_posts: int = 15) -> str:
    """Search LinkedIn posts by keyword; return post authors as leads."""
    qlist = [q.strip() for q in queries.replace("\n", ",").split(",") if q.strip()]
    data = call_tool_sync("POST", "apify-search", json_body={"queries": qlist, "track": track, "geo": geo, "maxPosts": max_posts})
    return _json(data)


@mcp.tool()
def bulk_enrich_people(details_json: str) -> str:
    """Bulk enrich Apollo people by id (max 10). Pass JSON array of {id, track}."""
    details = json.loads(details_json) if details_json else []
    data = call_tool_sync("POST", "apollo-enrich", json_body={"details": details})
    return _json(data)


@mcp.tool()
def web_research(query: str, deep: bool = False) -> str:
    """Live web research via Perplexity sonar."""
    data = call_tool_sync("POST", "web-research", json_body={"query": query, "deep": deep})
    return _json(data)


@mcp.tool()
def get_prospect(prospect_id: str) -> str:
    """Read a prospect from MongoDB CRM by id."""
    data = call_tool_sync("GET", "get-prospect", params={"id": prospect_id})
    return _json(data)


@mcp.tool()
def save_prospect_brief(prospect_json: str, brief_json: str = "", draft_message: str = "") -> str:
    """Save aiBrief and draft message back to CRM."""
    prospect = json.loads(prospect_json)
    body: dict = {"prospect": prospect}
    if brief_json:
        body["brief"] = json.loads(brief_json)
    if draft_message:
        body["draftMessage"] = draft_message
    data = call_tool_sync("POST", "upsert-prospect", json_body=body)
    return _json(data)


@mcp.tool()
def list_openers(track: str = "") -> str:
    """Return valid opener keys per track for prompt grounding."""
    params = {"track": track} if track else {}
    data = call_tool_sync("GET", "list-openers", params=params)
    return _json(data)


@mcp.tool()
def validate_message(draft_message: str, track: str = "A") -> str:
    """LLM-as-judge: check draft against anti-spam rules. Returns pass/fail + issues."""
    prompt = f"""Judge this outreach draft for a track {track} prospect.
Rules — FAIL if any: pitching your services, CTA/book-a-call, flattery, corporate filler, placeholders, exclamation spam.
Draft:
\"\"\"
{draft_message[:2000]}
\"\"\"
Return STRICT JSON: {{"pass": true/false, "score": 0-100, "issues": ["..."], "suggestion": "..."}}"""
    return _ask_llm("Return only valid JSON.", prompt)


if __name__ == "__main__":
    mcp.run()
