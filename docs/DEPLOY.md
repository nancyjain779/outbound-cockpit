# Deploy Guide — GitHub + Render

Step-by-step instructions to publish Outbound Cockpit as a GitHub project and deploy it live.

---

## Part 1 — Push to GitHub

### 1. Create the repository on GitHub

1. Go to [github.com/new](https://github.com/new)
2. Repository name: **`outbound-cockpit`**
3. Description: *Agentic founder-led outreach — LangGraph + FastMCP*
4. Visibility: **Public** (for portfolio)
5. Do **not** initialize with README (you already have one)
6. Click **Create repository**

### 2. Initialize git locally (if not already)

From your machine:

```bash
cd /path/to/outbound-cockpit

# First-time only
git init
git branch -M main
```

### 3. Verify secrets are not committed

```bash
# .env must NOT appear — it's in .gitignore
cat .gitignore | grep .env
ls -la .env 2>/dev/null && echo "WARNING: remove .env before push" || echo "OK"
```

Never commit `.env`, API keys, or Mongo connection strings.

### 4. Stage and commit

```bash
git add .
git status   # review — no .env, no node_modules
git commit -m "Initial commit: Outbound Cockpit — LangGraph + MCP outreach agent"
```

### 5. Add remote and push

Replace `nancyjain779` with your GitHub username if different:

```bash
git remote add origin https://github.com/nancyjain779/outbound-cockpit.git
git push -u origin main
```

If the repo already has a remote:

```bash
git remote -v
git push origin main
```

### 6. Add to portfolio README

Link from your portfolio site:

```markdown
**Outbound Cockpit** — LangGraph + MCP sales research agent  
[Live demo](https://your-render-url.onrender.com/cockpit.html) · [GitHub](https://github.com/nancyjain779/outbound-cockpit)
```

---

## Part 2 — Deploy on Render (recommended)

Render runs two services from [`render.yaml`](../render.yaml): Node cockpit + Python agent.

### 1. Create Render account

Sign up at [render.com](https://render.com) (GitHub login works).

### 2. New Blueprint

1. Dashboard → **New** → **Blueprint**
2. Connect GitHub → select **`outbound-cockpit`** repo
3. Render detects `render.yaml` → **Apply**

This creates:

| Service | Name | Runtime |
|---------|------|---------|
| Web | `outbound-cockpit` | Node |
| Web | `outreach-agent` | Python |

### 3. Set environment variables

In Render dashboard, set these on **both** services (shared secret must match):

| Variable | Service(s) | Required | Notes |
|----------|------------|----------|-------|
| `COCKPIT_SERVICE_TOKEN` | Both | **Yes** | Server-only secret — generate with `openssl rand -hex 32`. **Never commit or publish.** Same value on Node + Python. |
| `OPENAI_API_KEY` | Both | Recommended | Or `PERPLEXITY_API_KEY` on Node for legacy fallback |
| `PERPLEXITY_API_KEY` | Node | Optional | Live web research in legacy path |
| `APOLLO_API_KEY` | Node | Optional | Lead search + enrich |
| `APIFY_TOKEN` | Node | Optional | LinkedIn profile scrape |
| `MONGODB_URI` | Both | Optional | Cross-device sync + thread memory |
| `MONGODB_DB` | Both | Optional | Default `outbound_cockpit` |
| `COCKPIT_TOKEN` | Node only | Optional | Mongo sync API only — does **not** show login unless `COCKPIT_UI_AUTH=1` |
| `COCKPIT_UI_AUTH` | Node only | Optional | Set to `1` with `COCKPIT_TOKEN` to password-protect the UI |

Render auto-wires:

- `AGENT_SERVICE_URL` → Python service host
- `NODE_TOOL_BRIDGE_URL` → Node service host

### 4. Wait for deploy

Production URLs (this deployment):

| Service | URL |
|---------|-----|
| Node (public) | https://outbound-cockpit-xopw.onrender.com |
| Python (agent) | https://outreach-agent-nuuh.onrender.com |
| **Open app** | https://outbound-cockpit-xopw.onrender.com/cockpit.html |

- Node health: https://outbound-cockpit-xopw.onrender.com/healthz
- Python health: https://outreach-agent-nuuh.onrender.com/health

**Manual env wiring** (if Blueprint did not link services):

| Service | Variable | Value |
|---------|----------|--------|
| `outbound-cockpit` | `AGENT_SERVICE_URL` | `https://outreach-agent-nuuh.onrender.com` |
| `outreach-agent` | `NODE_TOOL_BRIDGE_URL` | `https://outbound-cockpit-xopw.onrender.com` |

Open UI: **https://outbound-cockpit-xopw.onrender.com/cockpit.html**

**Public demo — no visitor password.** Anyone can open the URL. `COCKPIT_SERVICE_TOKEN` stays in Render env only (never README/GitHub).

> Free tier cold starts: first request may take 30–60s. Agent analyse can timeout on very cold starts — retry once.

### 5. Enable auto-deploy

Default from `render.yaml`: `autoDeploy: true` — pushes to `main` redeploy both services.

---

## Part 3 — Deploy with Docker (VPS / local prod)

```bash
cp .env.example .env
# Edit .env — set COCKPIT_SERVICE_TOKEN + LLM keys

docker compose up -d --build
docker compose ps
```

Put Caddy/nginx in front for HTTPS:

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_read_timeout 120s;
}
```

---

## Part 4 — Post-deploy checklist

- [ ] UI loads at `/cockpit.html`
- [ ] `GET /healthz` returns `ok`
- [ ] Python `GET /health` shows `bridge_ok: true`
- [ ] Run analyse on a test prospect — agent trace panel shows tool steps
- [ ] Capture screenshots → save as `docs/screenshots/*.png` → update README
- [ ] Add live URL to portfolio + resume project bullet

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `bridge_ok: false` | `COCKPIT_SERVICE_TOKEN` mismatch between Node and Python |
| Agent 502 | Python service down or cold start — check Render logs for `outreach-agent` |
| Analyse falls back to heuristic | Set `OPENAI_API_KEY` on Python; check Node `AGENT_SERVICE_URL` |
| 401 on all routes | `COCKPIT_UI_AUTH=1` and `COCKPIT_TOKEN` set — use Basic auth or unset `COCKPIT_UI_AUTH` |
| Apollo credits not consumed | `APOLLO_API_KEY` missing on Node service only |

---

## Alternative hosts

| Host | Notes |
|------|-------|
| **Railway** | Two services from same repo; set root dir `outreach-agent` for Python |
| **Fly.io** | Use `fly.toml` per service; internal networking for bridge |
| **AWS ECS** | `docker-compose.yml` maps cleanly to two task definitions |
| **Vercel** | Not recommended — long-running agent + SSE needs a persistent Node server |

For portfolio purposes, **Render Blueprint** is the fastest path with the included `render.yaml`.
