# Future Improvements

Roadmap items for Outbound Cockpit — ordered by impact for portfolio and production readiness.

---

## Near term (portfolio-ready)

- [ ] **Golden-set eval with metrics** — run `eval/run_eval.py`, commit pass rate / validation scores to README
- [ ] **Live screenshots** — replace SVG previews in `docs/screenshots/` with PNGs from deployed instance
- [ ] **GitHub Actions CI** — Node tests (`npm test`) + Python tests (`pytest`) on push
- [ ] **Public demo deploy** — Render free tier with read-only demo mode (no API keys exposed)

---

## Agent quality

- [ ] **Tool result caching** — Redis or Mongo TTL cache for Apollo/Apify to cut credits on re-analyse
- [ ] **Structured eval harness** — per-tool latency, cost, and brief quality scoring
- [ ] **Human-in-the-loop approval** — operator edits draft before “mark sent” with feedback loop to eval set
- [ ] **A/B opener testing** — track reply rates by `signalKey` and template variant

---

## Product features

- [ ] **Slack bot** — `/analyse @prospect` using same agent API + thread memory
- [ ] **Email export** — one-click copy to Gmail/Outlook with tracking pixel opt-out
- [ ] **Sequence builder** — follow-up drafts at day 3 / 7 (still consultative, no spam)
- [ ] **Team workspaces** — shared prospect pool with role-based access

---

## Infrastructure

- [ ] **Temporal (optional)** — only if adding scheduled batch analyse or multi-day durable sequences
- [ ] **Observability** — OpenTelemetry traces across Node → Python → tool bridge
- [ ] **Rate-limit tiers** — per-user quotas when moving off single-operator use
- [ ] **Kubernetes Helm chart** — alternative to Render for teams already on K8s

---

## Developer experience

- [ ] **OpenAPI client generation** — typed TS/Python clients from FastAPI schema
- [ ] **Seed script** — demo prospects + mock tool responses for offline dev
- [ ] **MCP tool unit tests** — mock bridge responses without live Apollo/Apify keys

---

## Contributing

If you implement any of these, open a PR with:

1. Design note (why this approach)
2. Test or eval evidence where applicable
3. README/docs update if behavior changes
