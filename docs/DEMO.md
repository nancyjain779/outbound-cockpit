# Recruiter demo guide

How to showcase the **LangGraph agent + MCP tools** in a live interview or portfolio review.

## Links to share

| What | URL |
|------|-----|
| **Live app** (open this) | https://outbound-cockpit-xopw.onrender.com/cockpit.html |
| **GitHub** | https://github.com/nancyjain779/outbound-cockpit |
| Agent health (optional) | https://outreach-agent-nuuh.onrender.com/health |

Do **not** share `COCKPIT_SERVICE_TOKEN` or API keys.

## Before the demo (2 min)

1. Open both URLs once to wake free-tier services (cold start ~30–60s).
2. Confirm https://outreach-agent-nuuh.onrender.com/health shows `"bridge_ok": true`.
3. Open the live app in a clean tab.

## 90-second demo script

1. **Pitch:** “Single-shot LLM → **LangGraph agent** with **12 MCP tools**, validation loops, and live SSE trace.”
2. Pick one prospect → click **Analyse**.
3. **Point at Agent trace** as events stream:
   - `plan` — hybrid tool planner picks tools
   - `tool` — enrich, web research, etc. (one per step)
   - `synthesize` — brief + draft
   - `validate` — LLM-as-judge
   - `final` — result
4. Show **draft message** + **analysis brief**.
5. Optional: **Revise draft** chat for multi-turn memory.

## What to emphasize

- LangGraph `StateGraph` with conditional routing and retry loops
- FastMCP tool surface (same tools in agent + Cursor)
- Node ↔ Python sidecar + secured internal tool bridge
- Not the lead-scraping tabs — lead with the **agent loop**

## If live demo stalls

Free tier cold start — open health URL, retry Analyse, or walk through `outreach-agent/agent/graph.py` and `mcp_server/server.py` on GitHub while services wake up.
