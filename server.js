/**
 * Outbound Cockpit — standalone service.
 *
 * Serves the cockpit UI (public/) and the API routes in /api as a single
 * long-lived Node server. Designed for Render (or any Node host) — no
 * serverless platform required.
 *
 *   npm start            -> production (PORT from env, defaults 3000)
 *   npm run dev          -> hot-reloads API handlers on each request
 *
 * Env vars (all optional; features degrade gracefully when unset):
 *   REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET / REDDIT_USER_AGENT
 *   APOLLO_API_KEY
 *   MONGODB_URI / MONGODB_DB / COCKPIT_TOKEN   (optional Mongo sync — not browser auth unless COCKPIT_UI_AUTH=1)
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, "public");
const API = path.join(__dirname, "api");
const PORT = process.env.PORT || 3000;
const DEV = process.env.COCKPIT_DEV === "1";

// --- minimal .env loader (no dependency) ---
function loadEnv() {
  const f = path.join(__dirname, ".env");
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}
loadEnv();

// --- password gate ---------------------------------------------------------
// Browser Basic auth is OFF by default (public portfolio demos).
// Enable only with COCKPIT_UI_AUTH=1 AND COCKPIT_TOKEN set.
// COCKPIT_SERVICE_TOKEN is separate — Node ↔ Python bridge only (never a browser popup).
const UI_AUTH_ENABLED = ["1", "true", "yes"].includes(String(process.env.COCKPIT_UI_AUTH || "").toLowerCase());
const SYNC_TOKEN = (process.env.COCKPIT_TOKEN || "").trim();
const AUTH_TOKEN = UI_AUTH_ENABLED && SYNC_TOKEN ? SYNC_TOKEN : "";
const SERVICE_TOKEN = (process.env.COCKPIT_SERVICE_TOKEN || "").trim();

function isInternalApi(pathname) {
  return pathname.startsWith("/api/internal/");
}

function hasValidServiceToken(req) {
  if (!SERVICE_TOKEN) return false;
  const token = (req.headers["x-service-token"] || req.headers["x-cockpit-service-token"] || "").trim();
  return token === SERVICE_TOKEN;
}

function requireAuth(req, res, pathname) {
  // Internal tool bridge uses service token, not browser Basic auth.
  if (isInternalApi(pathname) && hasValidServiceToken(req)) return true;
  if (!AUTH_TOKEN) return true;
  const hdr = req.headers["authorization"] || "";
  const m = hdr.match(/^Basic\s+(.+)$/i);
  if (m) {
    const decoded = Buffer.from(m[1], "base64").toString("utf8");
    const pass = decoded.slice(decoded.indexOf(":") + 1);
    if (pass === AUTH_TOKEN) {
      req.headers["x-cockpit-token"] = SYNC_TOKEN; // let /api/cockpit trust it
      return true;
    }
  }
  res.statusCode = 401;
  res.setHeader("WWW-Authenticate", 'Basic realm="Outbound Cockpit", charset="UTF-8"');
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end("Authentication required");
  return false;
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
};

function adaptRes(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => {
    if (!res.headersSent) res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(obj));
    return res;
  };
  res.send = (data) => { res.end(typeof data === "string" ? data : JSON.stringify(data)); return res; };
  return res;
}

// Resolve /api/<...> to a handler file, supporting [param] dynamic segments.
function resolveApiFile(segments) {
  const direct = path.join(API, ...segments) + ".js";
  if (fs.existsSync(direct)) return { file: direct, params: {} };
  const idx = path.join(API, ...segments, "index.js");
  if (fs.existsSync(idx)) return { file: idx, params: {} };
  if (segments.length) {
    const dir = path.join(API, ...segments.slice(0, -1));
    if (fs.existsSync(dir)) {
      const dyn = fs.readdirSync(dir).find((f) => /^\[.+\]\.js$/.test(f));
      if (dyn) {
        const key = dyn.replace(/^\[|\]\.js$/g, "");
        return { file: path.join(dir, dyn), params: { [key]: segments[segments.length - 1] } };
      }
    }
  }
  return null;
}

const handlerCache = new Map();

// Simple rate limit for agent proxy (10 req/min per IP)
const agentRate = new Map();
function agentRateLimit(req, res) {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "local";
  const now = Date.now();
  const win = agentRate.get(ip) || { t: now, n: 0 };
  if (now - win.t > 60000) { win.t = now; win.n = 0; }
  win.n += 1;
  agentRate.set(ip, win);
  if (win.n > 10) {
    adaptRes(res).status(429).json({ error: "Rate limit — max 10 agent requests per minute." });
    return false;
  }
  return true;
}

async function getHandler(file) {
  if (!DEV && handlerCache.has(file)) return handlerCache.get(file);
  const href = pathToFileURL(file).href + (DEV ? `?t=${Date.now()}` : "");
  const mod = await import(href);
  if (!DEV) handlerCache.set(file, mod.default);
  return mod.default;
}

async function handleApi(req, res, pathname) {
  if (pathname.startsWith("/api/agent/") && !agentRateLimit(req, res)) return;
  const segments = pathname.replace(/^\/api\//, "").replace(/\/+$/, "").split("/").filter(Boolean);
  const resolved = resolveApiFile(segments);
  if (!resolved) { adaptRes(res).status(404).json({ error: `No API route for /api/${segments.join("/")}` }); return; }
  const url = new URL(req.url, "http://localhost");
  req.query = { ...resolved.params };
  for (const [k, v] of url.searchParams) req.query[k] = v;
  adaptRes(res);
  try {
    const handler = await getHandler(resolved.file);
    await handler(req, res);
    if (!res.writableEnded) res.end();
  } catch (e) {
    console.error(`[api] ${pathname} failed:`, e);
    if (!res.headersSent) res.status(500).json({ error: e.message || "Handler error" });
  }
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === "/") rel = "/cockpit.html";
  const filePath = path.join(PUBLIC, rel);
  if (!filePath.startsWith(PUBLIC)) { res.statusCode = 403; res.end("Forbidden"); return; }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(`<h1>404</h1><p>${rel} not found. Try <a href="/cockpit.html">/cockpit.html</a></p>`);
      return;
    }
    res.setHeader("Content-Type", MIME[path.extname(filePath)] || "application/octet-stream");
    res.setHeader("Cache-Control", path.extname(filePath) === ".html" ? "no-store" : "public, max-age=3600");
    fs.createReadStream(filePath).pipe(res);
  });
}

http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname === "/healthz") { res.statusCode = 200; res.end("ok"); return; }
  if (!requireAuth(req, res, pathname)) return;
  if (pathname.startsWith("/api/")) return void handleApi(req, res, pathname);
  serveStatic(req, res, pathname);
}).listen(PORT, () => {
  console.log(`\n  Outbound Cockpit running on http://localhost:${PORT}/cockpit.html`);
  console.log(`  Apollo:  ${process.env.APOLLO_API_KEY ? "key loaded" : "no key (set APOLLO_API_KEY)"}`);
  const ai = process.env.PERPLEXITY_API_KEY ? "Perplexity (live web research)" : process.env.OPENAI_API_KEY ? "OpenAI" : process.env.ANTHROPIC_API_KEY ? "Anthropic" : "heuristic only (set PERPLEXITY_API_KEY)";
  console.log(`  AI:      ${ai}`);
  console.log(`  Apify:   ${process.env.APIFY_TOKEN ? "profile scrape enabled" : "off (set APIFY_TOKEN)"}`);
  console.log(`  Sync:    ${process.env.MONGODB_URI ? "Mongo configured" : "local storage only"}`);
  console.log(`  Agent:   ${process.env.AGENT_SERVICE_URL || "http://localhost:8000"} (proxy /api/agent/*)`);
  console.log(`  Bridge:  /api/internal/tools/* ${SERVICE_TOKEN ? "(service token set)" : "(set COCKPIT_SERVICE_TOKEN)"}`);
  console.log(`  UI auth: ${AUTH_TOKEN ? "Basic auth ON (COCKPIT_UI_AUTH=1)" : "public (set COCKPIT_UI_AUTH=1 + COCKPIT_TOKEN to password-protect)"}\n`);
});
