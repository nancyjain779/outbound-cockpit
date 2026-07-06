# API Reference

Outbound Cockpit exposes three API surfaces: **public Node routes** (browser + integrations), **Python agent routes** (LangGraph orchestration), and **internal tool bridge** (MCP → Node, service-token only).

---

## Authentication

| Route pattern | Auth |
|---------------|------|
| `/healthz`, static files | None by default |
| `/api/*` (public) | HTTP Basic only if `COCKPIT_UI_AUTH=1` **and** `COCKPIT_TOKEN` set |
| `/api/internal/tools/*` | Header `x-service-token: <COCKPIT_SERVICE_TOKEN>` |
| Python `/v1/*` | Not exposed publicly in production — reached via Node proxy |

---

## Public Node API

Base URL: `http://localhost:3000` (or your Render URL)

### Health

```
GET /healthz
→ 200 "ok"
```

### Agent proxy (recommended)

These forward to the Python LangGraph agent. Rate limit: **10 req/min/IP**.

#### Analyse (streaming)

```
POST /api/agent/analyse-stream
Content-Type: application/json
```

**Body:**

```json
{
  "prospect": {
    "id": "p1",
    "name": "Jane Doe",
    "company": "Acme AI",
    "domain": "acme.ai",
    "track": "A",
    "signal": "Raised Series A",
    "profile": "https://linkedin.com/in/janedoe"
  },
  "openerKeys": ["raised", "ai_arch", "hiring_eng"],
  "extraContext": "",
  "deep": false,
  "pullProfile": true
}
```

**Response:** `text/event-stream` — SSE events:

| Event `type` | Payload |
|--------------|---------|
| `plan` | `{ planned_tools, plan_reasoning }` |
| `tool` | `{ tool, status, summary }` |
| `synthesize` | `{ status }` |
| `validate` | `{ pass, score, issues }` |
| `retry` | `{ retry_count }` |
| `persist` | `{ status }` |
| `final` | Full analyse result (same shape as non-streaming) |
| `error` | `{ message }` |

#### Analyse (JSON)

```
POST /api/agent/analyse
```

Same body as streaming. Returns full brief JSON (no SSE).

#### Classify pasted text

```
POST /api/agent/classify
```

```json
{
  "text": "Looking for a technical co-founder to build our MVP...",
  "url": "https://reddit.com/r/...",
  "hintTrack": "C",
  "openerMap": { "A": ["raised"], "B": ["soc2"], "C": ["cofounder"], "D": ["scope"] }
}
```

**Response:**

```json
{
  "track": "C",
  "signalKey": "cofounder",
  "signal": "Looking for technical co-founder",
  "nameGuess": "",
  "customLine": "...",
  "summary": "..."
}
```

#### Chat (revise draft)

```
POST /api/agent/chat
```

```json
{
  "prospect_id": "p1",
  "message": "Make it shorter and less formal",
  "prospect": { "...": "..." },
  "openerKeys": ["raised"]
}
```

**Response:**

```json
{
  "reply": "Here's a tighter version...",
  "updated_brief": { "...": "..." },
  "draftMessage": "...",
  "tool_trace": []
}
```

### Legacy AI (fallback when `AGENT_FALLBACK=1`)

```
POST /api/ai/analyse    # monolithic prompt → JSON
POST /api/ai/classify   # text triage without LangGraph
```

Same request shapes as agent routes where applicable.

### Lead sourcing

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/leads/apollo` | Apollo people search |
| GET | `/api/leads/apollo-org` | Org lookup by domain |
| POST | `/api/leads/apollo-enrich` | Bulk people enrich |
| GET | `/api/leads/apify-search` | LinkedIn post intent search |
| GET | `/api/leads/reddit` | Reddit post finder |
| GET | `/api/leads/org-lookup` | Combined org enrich + site scrape |

Query params vary per handler — see source in `api/leads/`.

### CRM sync (Mongo)

```
GET  /api/cockpit          # load all prospects (requires x-cockpit-token if COCKPIT_TOKEN set)
POST /api/cockpit          # upsert prospects
GET  /api/cockpit-seen     # feed seen-state sync
POST /api/cockpit-seen
```

---

## Python agent (FastAPI)

Base URL: `http://localhost:8000`  
OpenAPI UI: **http://localhost:8000/docs**

### Health

```
GET /health
```

```json
{
  "ok": true,
  "mongo_ok": true,
  "bridge_ok": true
}
```

### Analyse

```
POST /v1/analyse
POST /v1/analyse/stream   # SSE
```

Request body matches Node proxy (`prospect`, `openerKeys`, `extraContext`, `deep`, `pullProfile`).

**Response fields (key):**

| Field | Description |
|-------|-------------|
| `mode` | `agent` |
| `person`, `company`, `needs`, `keyFacts` | Research brief |
| `conversationPlaybook` | Consultative follow-up guide |
| `fit` | `{ score, label, whereWeFit, whyNow }` |
| `draftMessage`, `customLine` | Opening message |
| `tool_trace` | Tools executed this run |
| `planned_tools`, `plan_reasoning` | Planner output |
| `validation` | LLM-as-judge result |
| `credits_consumed` | Apollo credits if any |

### Classify

```
POST /v1/classify
```

### Chat

```
POST /v1/chat
```

---

## Internal tool bridge

Base: `/api/internal/tools/`  
**Required header:** `x-service-token: <COCKPIT_SERVICE_TOKEN>`

Used by the Python MCP server — not for browser clients.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `list-openers` | Opener keys per track |
| POST | `enrich-org` | Apollo org + hiring |
| POST | `scrape-site` | Homepage text |
| POST | `linkedin-profile` | Apify profile scrape |
| POST | `apollo-search` | People search |
| POST | `apollo-org` | Org by domain |
| POST | `apollo-enrich` | Bulk enrich |
| POST | `apify-search` | LinkedIn post search |
| POST | `web-research` | Perplexity sonar |
| GET | `get-prospect` | CRM read |
| POST | `upsert-prospect` | CRM write |

---

## MCP tools (Cursor / IDE)

When running `python -m mcp_server.server`, these tools are exposed to MCP clients:

`classify_lead_text`, `enrich_company`, `scrape_website`, `fetch_linkedin_profile`, `search_apollo_leads`, `search_linkedin_posts`, `bulk_enrich_people`, `web_research`, `get_prospect`, `save_prospect_brief`, `list_openers`, `validate_message`

Config: [`.cursor/mcp.json`](../.cursor/mcp.json)

---

## Error codes

| Code | Meaning |
|------|---------|
| 401 | Missing/invalid `COCKPIT_TOKEN` (Basic auth) or service token |
| 429 | Agent rate limit exceeded |
| 502 | Python agent unreachable or graph error |
| 504 | Agent timeout (default 120s) |
