# Design Decisions

This document explains the main architectural and product choices in Outbound Cockpit.

---

## 1. LangGraph agents, not Temporal

**Decision:** Use LangGraph `StateGraph` for orchestration; do not add Temporal for v1.

**Why:** Analyse runs are request-scoped (30–120 seconds). The graph needs conditional routing, tool loops, and validation retries — not durable multi-day workflows. LangGraph + MongoDB thread memory covers interactive use and multi-turn chat.

**When Temporal would make sense:** Scheduled batch analyse of thousands of prospects, multi-day follow-up sequences, or strict crash-recovery SLAs across process restarts.

---

## 2. Node.js + Python sidecar

**Decision:** Split UI/lead APIs (Node) from agent orchestration (Python).

**Why:**

- Existing cockpit was Node — lead sourcing (Apollo, Apify, Reddit) and static UI stay in one deployable unit.
- LangGraph, FastMCP, and Python ML ecosystem fit the agent layer better.
- Internal tool bridge (`/api/internal/tools/*`) lets MCP tools reuse Node integrations without duplicating Apollo/Apify clients in Python.

**Trade-off:** Two services to deploy. Mitigated by `docker-compose.yml` and `render.yaml` blueprints.

---

## 3. MCP as the tool boundary

**Decision:** Define tools in FastMCP; execute via HTTP bridge to Node.

**Why:**

- Same tool surface for the LangGraph agent and Cursor IDE (`.cursor/mcp.json`).
- Tools stay testable independently; bridge auth (`COCKPIT_SERVICE_TOKEN`) isolates internal routes from the browser.

---

## 4. Hybrid tool planner (rules + LLM)

**Decision:** Deterministic eligibility rules first, then LLM to order/trim the queue.

**Why:**

- Rules prevent wasted API calls (skip enrich if facts cached, skip LinkedIn if no profile URL).
- LLM adapts plan to prospect context when keys are present.
- Falls back to rules-only if LLM unavailable — analyse still completes.

**Cap:** `MAX_TOOLS_PER_RUN` (default 8) bounds cost and latency.

---

## 5. One tool per graph node visit

**Decision:** `execute_tool` runs a single tool, then loops until the queue is empty.

**Why:**

- SSE streaming can emit per-tool progress events for the UI trace panel.
- Easier debugging and eval attribution per tool step.
- Avoids opaque “run all tools” black box.

---

## 6. LLM-as-judge validation loop

**Decision:** After synthesis, validate draft against anti-spam rules; retry up to 2 times.

**Why:** Outreach messages must not pitch, use CTAs, or sound like AI slop. A separate judge step catches violations the synthesizer misses. Bounded retries prevent infinite loops.

---

## 7. SSE streaming for analyse

**Decision:** Primary UX path is `/api/agent/analyse-stream`; non-streaming JSON retained for compatibility.

**Why:** Operators wait 30–60s for deep research. Live trace (`plan` → `tool` → … → `final`) reduces perceived latency and builds trust in the agent.

---

## 8. Legacy fallback path

**Decision:** Keep `/api/ai/analyse` and `AGENT_FALLBACK=1` on Node.

**Why:** Python agent can fail independently (cold start, OOM on free tier). Node heuristic + monolithic LLM path keeps the cockpit usable during outages or local dev without the sidecar.

---

## 9. Generic voice / company via env

**Decision:** Prompts use `OUTREACH_VOICE_NAME`, `OUTBOUND_COMPANY_NAME`, `OUTBOUND_OFFER_CONTEXT` — not hard-coded personas.

**Why:** Open-source portfolio project should be forkable without rebranding code. Operators configure voice in `.env`.

---

## 10. MongoDB for CRM + thread memory

**Decision:** Optional Mongo for cross-device prospect sync and agent thread history.

**Why:** localStorage works offline-first; Mongo enables team sync and chat memory keyed by `prospect_id`. Graceful degradation when `MONGODB_URI` unset.

---

## 11. Security model

| Control | Implementation |
|---------|----------------|
| Browser gate | Optional HTTP Basic (`COCKPIT_UI_AUTH=1` + `COCKPIT_TOKEN`) |
| Internal bridge | `COCKPIT_SERVICE_TOKEN` header only |
| Agent abuse | 10 req/min/IP on `/api/agent/*` |
| Secrets | Server-side env only — never in `cockpit.html` |

---

## 12. Track-based outreach (A/B/C/D)

**Decision:** Classify prospects into four tracks (funded SaaS, enterprise, funded first-time founder, idea-stage) with track-specific opener templates.

**Why:** Message tone and “likely problems” differ materially. Track + signal key drives template selection and planner context without one-size-fits-all copy.
