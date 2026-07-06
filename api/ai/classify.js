/**
 * AI classify — turn a raw social post / profile blurb into a structured lead.
 *
 * This is the Track C/D fix: behavioral triggers (co-founder hunts, MVP-cost
 * questions, idea validation) live in post TEXT, not in a company database.
 * Paste the text, get back a track + opener key + signal + drafted line.
 *
 *   POST /api/ai/classify
 *   body: {
 *     text:      "<the post / bio the user pasted>",
 *     url:       "<optional source url>",
 *     hintTrack: "C",                              // optional starting guess
 *     openerMap: { A:[...], B:[...], C:[...], D:[...] }  // valid opener keys per track
 *   }
 *
 * Uses OPENAI_API_KEY / ANTHROPIC_API_KEY if present, else a keyword heuristic.
 * No scraping — operates only on text the user supplies. No Apollo credits.
 */

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  return await new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => { try { resolve(JSON.parse(raw || "{}")); } catch { resolve({}); } });
  });
}

function buildPrompt(text, url, hintTrack, openerMap) {
  const map = Object.keys(openerMap || {}).map((t) => "  " + t + ": " + (openerMap[t] || []).join(", ")).join("\n");
  return [
    "You triage one social post / profile for founder-led outbound.",
    "Tracks: A = funded SaaS/AI founder or CTO; B = enterprise innovation/engineering leader; C = first-time founder WITH capital; D = idea-stage / non-technical founder.",
    "",
    "Valid opener keys per track (pick one key that belongs to the track you choose):",
    map || "  (default only)",
    "",
    hintTrack ? "Starting guess for track: " + hintTrack + " (override if the text says otherwise)." : "",
    "Source URL: " + (url || "(none)"),
    "Pasted text:",
    '"""',
    String(text || "").slice(0, 4000),
    '"""',
    "",
    "Return STRICT JSON only:",
    "{",
    '  "track": "<A|B|C|D>",',
    '  "signalKey": "<one valid opener key for that track>",',
    '  "signal": "<short phrase naming the real trigger, e.g. \'Looking for a technical co-founder\'>",',
    '  "nameGuess": "<their name or @handle if present, else empty>",',
    '  "customLine": "<one specific human line referencing the post; NO brackets/placeholders>",',
    '  "summary": "<one-line why this is a fit>"',
    "}",
  ].filter(Boolean).join("\n");
}

function extractJson(text) {
  if (!text) return null;
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a === -1 || b === -1 || b < a) return null;
  try { return JSON.parse(text.slice(a, b + 1)); } catch { return null; }
}

async function callOpenAI(prompt) {
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const r = await fetch(OPENAI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + process.env.OPENAI_API_KEY.trim() },
    body: JSON.stringify({
      model, temperature: 0.4, response_format: { type: "json_object" },
      messages: [{ role: "system", content: "You return only valid JSON." }, { role: "user", content: prompt }],
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error?.message || "OpenAI error " + r.status);
  return extractJson(data?.choices?.[0]?.message?.content || "");
}

async function callAnthropic(prompt) {
  const model = process.env.ANTHROPIC_MODEL || "claude-3-5-haiku-latest";
  const r = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY.trim(), "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: 500, temperature: 0.4, system: "You return only valid JSON.", messages: [{ role: "user", content: prompt }] }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error?.message || "Anthropic error " + r.status);
  const text = Array.isArray(data?.content) ? data.content.map((c) => c.text || "").join("") : "";
  return extractJson(text);
}

function heuristic(text, hintTrack, openerMap) {
  const t = (text || "").toLowerCase();
  let track = (hintTrack || "C").toUpperCase();
  let signalKey = "default";
  let signal = "Social post";
  if (/\bco-?founder\b|technical co/.test(t)) { track = /idea|non-tech|validate/.test(t) ? "D" : "C"; signalKey = "cofounder"; signal = "Looking for a technical co-founder"; }
  else if (/\bmvp\b|how much.*(cost|build)|cost to build/.test(t)) { track = "D"; signalKey = "mvp_cost"; signal = "Asking about MVP cost"; }
  else if (/\bvalidat|feedback|would you (use|pay)\b/.test(t)) { track = "D"; signalKey = "validation"; signal = "Validating an idea"; }
  else if (/\b(find|hire|need).*(developer|dev|engineer)\b/.test(t)) { track = "C"; signalKey = "find_dev"; signal = "Trying to find a developer"; }
  else if (/\b(launch|shipped|just (built|made))\b/.test(t)) { track = "C"; signalKey = "milestone"; signal = "Shipped something"; }
  else { signalKey = track === "D" ? "idea_help" : "default"; signal = "Idea-stage post"; }

  const keys = (openerMap && openerMap[track]) || [];
  if (keys.length && !keys.includes(signalKey)) signalKey = keys.includes("default") ? "default" : keys[0];
  return { mode: "heuristic", track, signalKey, signal, nameGuess: "", customLine: "Saw your post — " + signal.toLowerCase() + ". Quick thought:", summary: signal + " — likely Track " + track + "." };
}

function normalise(out, openerMap) {
  const track = ["A", "B", "C", "D"].includes((out?.track || "").toUpperCase()) ? out.track.toUpperCase() : "C";
  const keys = (openerMap && openerMap[track]) || [];
  let key = out?.signalKey;
  if (keys.length && !keys.includes(key)) key = keys.includes("default") ? "default" : keys[0];
  return {
    track,
    signalKey: key || "default",
    signal: out?.signal || "",
    nameGuess: out?.nameGuess || "",
    customLine: (out?.customLine || "").replace(/\[\[.*?\]\]|\[.*?\]/g, "").trim(),
    summary: out?.summary || "",
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed — POST { text }" }); return; }
  const body = await readBody(req);
  const text = (body.text || "").trim();
  if (!text) { res.status(400).json({ error: "Paste the post / profile text to classify." }); return; }
  const openerMap = body.openerMap && typeof body.openerMap === "object" ? body.openerMap : {};
  const prompt = buildPrompt(text, body.url, body.hintTrack, openerMap);
  try {
    if (process.env.OPENAI_API_KEY?.trim()) {
      const out = await callOpenAI(prompt);
      if (out) { res.status(200).json(Object.assign({ mode: "openai" }, normalise(out, openerMap))); return; }
    } else if (process.env.ANTHROPIC_API_KEY?.trim()) {
      const out = await callAnthropic(prompt);
      if (out) { res.status(200).json(Object.assign({ mode: "anthropic" }, normalise(out, openerMap))); return; }
    }
  } catch (e) {
    res.status(200).json(Object.assign({}, heuristic(text, body.hintTrack, openerMap), { warning: e.message || "AI error — used heuristic." }));
    return;
  }
  res.status(200).json(heuristic(text, body.hintTrack, openerMap));
}
