# Folder Structure

```
outbound-cockpit/
│
├── public/
│   └── cockpit.html              # Single-page outreach UI (leads, analyse, settings)
│
├── api/
│   ├── agent/                    # Python agent proxies (preferred path)
│   │   ├── analyse.js            # POST → /v1/analyse
│   │   ├── analyse-stream.js     # POST → /v1/analyse/stream (SSE)
│   │   ├── classify.js           # POST → /v1/classify
│   │   └── chat.js               # POST → /v1/chat
│   │
│   ├── ai/                       # Legacy monolithic LLM (AGENT_FALLBACK)
│   │   ├── analyse.js
│   │   └── classify.js
│   │
│   ├── leads/                    # Public lead-sourcing APIs
│   │   ├── apollo.js             # People search
│   │   ├── apollo-org.js
│   │   ├── apollo-enrich.js
│   │   ├── apify.js              # LinkedIn profile actor
│   │   ├── apify-search.js       # LinkedIn post search
│   │   ├── org-lookup.js         # Enrich + site scrape combo
│   │   └── reddit.js             # Reddit intent finder
│   │
│   ├── internal/tools/           # MCP bridge (service token required)
│   │   ├── enrich-org.js
│   │   ├── scrape-site.js
│   │   ├── linkedin-profile.js
│   │   ├── apollo-search.js
│   │   ├── apollo-org.js
│   │   ├── apollo-enrich.js
│   │   ├── apify-search.js
│   │   ├── web-research.js
│   │   ├── get-prospect.js
│   │   ├── upsert-prospect.js
│   │   └── list-openers.js
│   │
│   ├── cockpit.js                # Mongo prospect sync
│   └── cockpit-seen.js           # Feed seen-state sync
│
├── lib/
│   ├── read-body.js              # JSON body parser
│   ├── internal-auth.js          # Service token validation
│   ├── mongo.js                  # Mongo client singleton
│   ├── openers.js                # Track → opener key definitions
│   ├── web-research.js           # Perplexity helper
│   └── org-lookup.js             # Shared org enrich logic
│
├── outreach-agent/               # Python LangGraph + MCP sidecar
│   ├── agent/
│   │   ├── api/main.py           # FastAPI app (/v1/*, /health)
│   │   ├── graph.py              # StateGraph assembly
│   │   ├── nodes.py              # Node implementations
│   │   ├── routers.py            # Conditional edges
│   │   ├── state.py              # TypedDict state schema
│   │   ├── tools.py              # Tool invocation via bridge
│   │   ├── tool_catalog.py       # Tool metadata + eligibility rules
│   │   ├── planner.py            # Hybrid planner
│   │   ├── prompts.py            # LLM prompts (voice, tracks)
│   │   ├── llm.py                # Shared JSON LLM helper
│   │   └── streaming.py          # SSE event generator
│   │
│   ├── mcp_server/
│   │   ├── server.py             # FastMCP tool definitions
│   │   └── bridge.py             # HTTP client to Node internal tools
│   │
│   ├── memory/
│   │   └── mongo_memory.py       # Thread load/save
│   │
│   ├── eval/
│   │   ├── golden_set.json
│   │   └── run_eval.py
│   │
│   ├── tests/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── pyproject.toml
│
├── docs/
│   ├── ARCHITECTURE.md
│   ├── API.md
│   ├── DESIGN.md
│   ├── DEPLOY.md
│   ├── FUTURE.md
│   ├── FOLDER_STRUCTURE.md
│   └── screenshots/
│
├── tests/                        # Node integration tests
├── scripts/                      # Dev utilities (check-apollo.mjs)
├── server.js                     # HTTP server entrypoint
├── docker-compose.yml
├── Dockerfile.node
├── render.yaml
├── package.json
└── .env.example
```

## Data flow (analyse)

1. Browser → `POST /api/agent/analyse-stream`
2. Node proxy → `POST /v1/analyse/stream` (Python)
3. LangGraph: `plan_gather` → `execute_tool` (loop) → `synthesize` → `validate` → `persist`
4. Each tool → MCP → `POST /api/internal/tools/<name>` (Node) → Apollo/Apify/Perplexity/Mongo
5. SSE events stream back to browser trace panel
