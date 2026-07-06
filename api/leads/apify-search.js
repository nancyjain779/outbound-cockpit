/**
 * Intent sourcing — find people POSTING about your services and turn the post
 * authors into leads. Complements Apollo (firmographics) with live demand
 * signal: who is actively asking for dev help right now.
 *
 * POST /api/leads/apify-search   { queries, track?, geo?, postedLimit?, maxPosts? }
 * GET  /api/leads/apify-search?q=looking%20for%20developers&track=C
 *
 * Uses harvestapi~linkedin-post-search via Apify (pay-per-result). The matched
 * post is carried as the prospect's "why now" signal for AI analyse + outreach.
 */

import { searchLinkedInPosts } from "./apify.js";

function clip(s, n) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) + "\u2026" : t;
}

// Pick the best-fit opener key from the post text, constrained to the keys that
// actually exist for the chosen track (mirrors public/cockpit.html TEMPLATES).
// This makes the imported draft intent-matched instead of a generic opener.
function inferSignalKey(text, track) {
  const t = String(text || "").toLowerCase();
  const cofounder = /co[\s-]?founder/.test(t);
  const mvp = /\bmvp\b|cost to build|build (?:an?|my|the) (?:app|product|mvp)/.test(t);
  const findDev = /(?:looking for|need|hire|find|searching for|seeking)\s+(?:an?\s+)?(?:developer|dev|engineer|development|tech(?:nical)? team)|development (?:partner|agency|team)|outsourc/.test(t);
  const validation = /validat/.test(t);
  const stealth = /stealth/.test(t);
  const milestone = /\b(?:shipped|launched|went live|just shipped|just launched)\b/.test(t);
  const started = /just (?:incorporated|started|founded|launched)|new (?:startup|founder|venture)|started (?:my|a|an) (?:company|startup)/.test(t);
  // Idea-stage framing: "turn my idea into a product", "build my idea", "have an idea".
  const idea = /\b(?:my|an?|the)\s+idea\b|idea into (?:a |an )?(?:product|app|reality|business)|build my idea/.test(t);
  if (track === "D") {
    if (cofounder) return "cofounder";
    if (mvp) return "mvp_cost";
    if (validation) return "validation";
    if (findDev || idea) return "idea_help";
    if (started) return "new_founder";
  } else if (track === "C") {
    if (cofounder) return "cofounder";
    if (findDev || mvp || idea) return "find_dev";
    if (milestone) return "milestone";
    if (stealth) return "stealth";
    if (started) return "just_incorporated";
  }
  return "default";
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => { try { resolve(JSON.parse(raw || "{}")); } catch { resolve({}); } });
    req.on("error", () => resolve({}));
  });
}

export default async function handler(req, res) {
  if (!process.env.APIFY_TOKEN?.trim()) {
    res.status(501).json({
      error: "APIFY_TOKEN not set. Add it in your env (and on Render) to enable LinkedIn post search.",
      prospects: [],
    });
    return;
  }

  let body = {};
  if (req.method === "POST") {
    body = await readBody(req);
  } else {
    let sp;
    try {
      const tail = req.url?.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
      sp = new URL(tail || "", "http://localhost").searchParams;
    } catch {
      sp = new URLSearchParams();
    }
    body = {
      queries: sp.get("q") || sp.get("queries") || "",
      track: sp.get("track") || "",
      geo: sp.get("geo") || "",
      postedLimit: sp.get("postedLimit") || "",
      maxPosts: sp.get("maxPosts") || "",
    };
  }

  const track = (body.track || "C").toString().toUpperCase();
  const geo = (body.geo || "").toString();
  const postedLimit = (body.postedLimit || "month").toString();
  const maxPosts = parseInt(body.maxPosts || 15, 10) || 15;

  try {
    const leads = await searchLinkedInPosts(body.queries, { postedLimit, maxPosts });
    const prospects = leads.map((l) => ({
      name: l.name,
      company: l.company || "",
      track,
      geo,
      platform: "LinkedIn",
      signalKey: inferSignalKey(l.postText, track),
      profile: l.profile,
      // The triggering post is the highest-value context for outreach.
      signal: l.postText ? "Posted" + (l.postedAt ? " (" + l.postedAt + ")" : "") + ': \u201c' + clip(l.postText, 160) + "\u201d" : (l.headline || ""),
      notes: l.postText || "",
      headline: l.headline || "",
      postUrl: l.postUrl || "",
      postText: l.postText || "",
      postedAt: l.postedAt || "",
      source: "apify-post",
    }));
    res.status(200).json({ count: prospects.length, prospects });
  } catch (e) {
    res.status(502).json({ error: e?.message || "Apify post search failed", prospects: [] });
  }
}
