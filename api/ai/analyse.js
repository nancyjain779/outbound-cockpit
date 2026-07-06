/**
 * AI analyse — deep prospect intelligence.
 *
 * Reads ONE prospect and produces a connection brief: who they are, what their
 * company does + needs, where your team fits, and how to open the
 * conversation (recommended opener key + a drafted human custom line).
 *
 *   POST /api/ai/analyse
 *   body: {
 *     prospect:   { name, company, domain, orgId, track, geo, platform, signal, notes, profile },
 *     openerKeys: ["raised","ai_arch", ...]   // valid opener keys for this track
 *   }
 *
 * Pipeline:
 *   1. If a company domain is present + APOLLO_API_KEY set, pull live company
 *      facts via Apollo Org Enrichment (cached; ~1 credit per uncached company).
 *   2. Reason over person + company facts with an LLM:
 *        OPENAI_API_KEY    -> OpenAI (OPENAI_MODEL, default gpt-4o-mini)
 *        ANTHROPIC_API_KEY -> Anthropic (ANTHROPIC_MODEL, default claude-3-5-haiku-latest)
 *        neither           -> built-in heuristic (always works, lower quality)
 *
 * Always returns 200 with a usable brief; `mode` says who answered and
 * `credits_consumed` reports any Apollo spend.
 */

import { enrichOrg, orgFacts, orgHiringEngineers, fetchSiteText } from "../leads/org-lookup.js";
import { scrapeLinkedInProfile, isLinkedInProfile } from "../leads/apify.js";

// Apollo + website scrape already cover company context — skip the costlier
// LinkedIn profile actor and only pull recent posts (what Apollo can't get).
function apolloCoversCompany(facts, siteText, p) {
  const hasWebsite = !!(p.website || facts?.website || p.domain);
  if (!hasWebsite || !facts) return false;
  const richFacts = !!(facts.description || facts.industry || facts.employees || facts.funding);
  return richFacts && (!!siteText || !!facts.description);
}

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const PERPLEXITY_URL = "https://api.perplexity.ai/chat/completions";

const VOICE_NAME = (process.env.OUTREACH_VOICE_NAME || "the operator").trim();
const COMPANY_NAME = (process.env.OUTBOUND_COMPANY_NAME || "your team").trim();

// The VOICE — the single most important spec. The message must read like a
// sharp, warm human who actually did the homework — never like an AI,
// a template, or a salesperson working an angle.
const VOICE = [
  "VOICE & PERSONALITY — this matters more than anything else below:",
  `- You are ${VOICE_NAME}: a senior engineer-operator at ${COMPANY_NAME}. A real person reaching out to another real person. Warm, direct, genuinely curious, a little understated. Peer-to-peer, never vendor-to-lead.`,
  "- Channel the BEST kind of salesperson — the one who never actually sells. They listen first, diagnose the real problem, and earn trust before anything else. The sale is a by-product of being genuinely useful. Right now there is NO offer at all — only sincere interest in their world and their problem.",
  "- Sound unmistakably human: natural rhythm, plain words, contractions, one clear thought. Slightly casual or imperfect is better than polished-and-corporate. Read it aloud — if it sounds like a person texting someone they respect, it's right.",
  "- Earn the reply by showing you actually looked: reference ONE concrete, real, specific thing (a line from their post, a product decision, a number, a launch) — evidence you paid attention, not flattery.",
  "- Be humble and curious, not the expert diagnosing from outside. You're exploring with them, genuinely wondering how they see it.",
  "- Connect like a good human: empathy for the hard parts of their work, no agenda energy, respect for their time. Make them feel seen, not targeted.",
].join("\n");

// Hard anti-patterns. These instantly out a message as sales spam or AI slop.
const MESSAGE_DONTS = [
  "NEVER do any of these in the message:",
  "- No pitching, no 'we build / we help / we specialise', no services list, no case studies, no 'companies like yours'.",
  "- No CTA: no 'book a call', 'grab 15 minutes', 'hop on a quick chat', 'let me know if you're interested', no calendar links.",
  "- No flattery or fake praise ('your post was brilliant', 'huge fan', 'love what you're doing', 'impressive work').",
  "- No corporate/AI filler: 'hope this finds you well', 'I wanted to reach out', 'in today's fast-paced landscape', 'leverage', 'synergies', 'solutions', 'cutting-edge', 'circle back', 'touch base', 'reach out'.",
  "- No formulaic sign-off crutch — do NOT reflexively end with 'no agenda', 'no strings', 'just my two cents'. If something like that is truly natural, fine, but vary it; never make it a tic.",
  "- No placeholders or brackets, no emojis unless genuinely natural, no exclamation spam, no hashtags.",
  "- Don't open every message with the same formula ('Hey {first} — curious how you're thinking about…'). Vary the first line so it fits THIS specific person and what you found.",
].join("\n");

// FOR THE MODEL'S CONTEXT ONLY — so it can ask sharper questions and judge fit
// internally. These must NEVER be pitched, described or listed in the message.
const OUTBOUND_CAPS =
  process.env.OUTBOUND_OFFER_CONTEXT ||
  ("Your team's capabilities (context only — do NOT pitch these): " +
  "(1) build AI products with proper eval, retrieval (RAG) and audit/observability layers so they survive real users and enterprise procurement; " +
  "(2) act as a fractional technical team for founders (idea -> launched MVP, no equity ask); " +
  "(3) Audit + Compliance (SOC 2 / ISO 27001) and continuous assurance for enterprise/regulated AI; " +
  "(4) a paid Build Plan (architecture + scope + honest cost) for non-technical / idea-stage founders.");

// The prospect's WORLD and the problems they're likely wrestling with — so the
// message can lead with understanding, not an offer.
const TRACK_CONTEXT = {
  A: "Funded SaaS/AI founder or CTO scaling under real users and enterprise scrutiny. Likely wrestling with: keeping AI features reliable as usage grows, retrieval/eval quality, the audit/observability trail buyers demand, and stretched engineering capacity.",
  B: "Enterprise innovation / digital / engineering leader trying to ship AI inside regulated, procurement-heavy workflows. Likely wrestling with: compliance (SOC 2 / ISO), accountability across multiple vendors, and shipping without a costly rebuild later.",
  C: "First-time founder with capital trying to get from idea to a launched MVP. Likely wrestling with: who to trust to build it, architecture that won't need rebuilding, and avoiding wasted months on the wrong freelancer or co-founder hunt.",
  D: "Idea-stage / non-technical founder. Likely wrestling with: what to build first vs. skip, realistic scope and cost, and not getting burned by the wrong developer.",
};

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  return await new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => { try { resolve(JSON.parse(raw || "{}")); } catch { resolve({}); } });
  });
}

function factsBlock(facts, hiringTitles, allRoles, siteText) {
  const lines = [];
  if (facts) {
    lines.push("Company facts (from Apollo):");
    if (facts.name) lines.push("- Name: " + facts.name);
    if (facts.industry) lines.push("- Industry: " + facts.industry);
    if (facts.description) lines.push("- Description: " + facts.description);
    if (facts.foundedYear) lines.push("- Founded: " + facts.foundedYear);
    if (facts.employees) lines.push("- Employees: " + facts.employees);
    if (facts.funding) lines.push("- Funding: " + [facts.funding.stage, facts.funding.amount, facts.funding.date].filter(Boolean).join(" · "));
    if (facts.technologies && facts.technologies.length) lines.push("- Tech stack: " + facts.technologies.join(", "));
    if (facts.keywords && facts.keywords.length) lines.push("- Keywords: " + facts.keywords.join(", "));
  } else {
    lines.push("Company facts: (none retrieved — reason from the signal/headline/website only).");
  }
  if (hiringTitles && hiringTitles.length) lines.push("- Open engineering roles: " + hiringTitles.join(", "));
  if (allRoles && allRoles.length) lines.push("- All open roles (what they're scaling): " + allRoles.join(", "));
  if (siteText) lines.push("\nCompany website excerpt:\n\"\"\"\n" + siteText + "\n\"\"\"");
  return lines.join("\n");
}

function researchBlock(p) {
  const targets = [];
  if (p.profile) targets.push("- Their profile: " + p.profile);
  if (p.name && p.company) targets.push('- Web search: "' + p.name + '" "' + p.company + '" (LinkedIn, Twitter/X, news, interviews, YouTube talks)');
  if (p.company) targets.push('- The company "' + p.company + '": official website, what they ship, customers, recent news/launches');
  if (p.website) targets.push("- Company website: " + p.website + " (read About, Product, Customers, Careers/Jobs, Blog)");
  else if (p.domain) targets.push("- Company site: https://" + p.domain + " (read About, Product, Careers/Jobs, Blog)");
  if (p.company) targets.push('- Funding & stage: Crunchbase/news for "' + p.company + '" (round, amount, date, investors)');
  if (p.company) targets.push('- Hiring signals: open roles on their careers page / job boards (what they\'re scaling)');
  if (p.name) targets.push("- Anything the person has written publicly: posts, talks, podcasts, GitHub");
  return [
    "RESEARCH FIRST — use live web search before writing. Find REAL, CURRENT facts. Do not invent anything; if a fact can't be verified, say so rather than guessing.",
    "Look up:",
    targets.join("\n"),
    "Prefer primary sources (their own site/profile/posts) and recent items. Use specifics you actually found (real product names, real numbers, a real post) — these make the message land.",
  ].join("\n");
}

function buildPrompt(p, openerKeys, facts, hiringTitles, allRoles, siteText, linkedInBlock, userPaste, webResearch) {
  const ctx = TRACK_CONTEXT[(p.track || "A").toUpperCase()] || TRACK_CONTEXT.A;
  const contextParts = [];
  if (linkedInBlock) contextParts.push("Verified LinkedIn scrape (profile + recent posts — HIGHEST trust, ground the message and playbook in this):\n\"\"\"\n" + linkedInBlock.slice(0, 3500) + "\n\"\"\"");
  if (userPaste) contextParts.push("Additional context the user pasted:\n\"\"\"\n" + userPaste.slice(0, 2000) + "\n\"\"\"");
  return [
    `You are reaching out as a peer and technical consultant from ${COMPANY_NAME} — NOT a salesperson. Produce TWO things: (1) a deep ANALYSIS BRIEF the operator can keep and use when a conversation happens days or weeks later, and (2) a short opening MESSAGE that starts a genuine consultation. Philosophy: understand the problem FIRST; a solution only comes later and only if it genuinely fits — never force an existing offering onto them.`,
    "",
    VOICE,
    "",
    webResearch ? researchBlock(p) + "\n" : "",
    OUTBOUND_CAPS,
    "",
    "Their world (likely problems): " + ctx,
    "",
    "Prospect:",
    "- Name: " + (p.name || "?"),
    "- Company: " + (p.company || "?"),
    "- Title/role context: " + (p.notes || p.signal || "?"),
    "- Track: " + (p.track || "?") + " | Platform: " + (p.platform || "?") + " | Geo: " + (p.geo || "?"),
    "- Captured signal: " + (p.signal || "(none)"),
    "- Profile URL: " + (p.profile || "(none)"),
    "",
    factsBlock(facts, hiringTitles, allRoles, siteText),
    "",
    contextParts.length ? contextParts.join("\n\n") : "No LinkedIn scrape or pasted context — rely on company facts + web research.",
    "",
    "Valid opener keys for this track (choose exactly one): " + (openerKeys && openerKeys.length ? openerKeys.join(", ") : "default"),
    "",
    "Analysis brief: think like a consultant preparing for a call. Who is this person really? What does the company do and where is it in its journey? What do their RECENT POSTS reveal they care about? What problems/tensions are they likely facing? What verified facts should the operator remember? If they reply, how should the conversation continue consultatively (listen, explore, do NOT pitch yet)?",
    "",
    "Opening message (`draftMessage`): 40-85 words, in the VOICE above. Structure (but make it flow naturally, not as bullet beats): (1) open with ONE specific, real observation from their posts/profile/company that proves you looked — make it personal to them, not a generic hook. (2) Show you understand the tension or hard part of that, briefly and with empathy — like someone who's lived it, not diagnosing from outside. (3) Ask ONE sincere, open question about how THEY see it or are approaching it. Close simply and human — no pitch, no CTA. It should feel like the start of a real conversation between peers, where you genuinely want to learn how they think — not the opening of a sales sequence.",
    MESSAGE_DONTS,
    "",
    "Return STRICT JSON only (no prose), exactly this shape:",
    "{",
    '  "person": "<2-3 sentences: who they are, background, what they seem to care about>",',
    '  "company": "<2-3 sentences: what the company does, stage, size, funding if known>",',
    '  "needs": ["<real problem/tension they likely face now>", "<another>"],',
    '  "recentSignals": ["<what their recent posts/activity reveal — be specific>", "<another if any>"],',
    '  "keyFacts": ["<verified fact to remember>", "<another>"],',
    '  "conversationPlaybook": {',
    '    "whatTheyCareAbout": "<what matters to them based on evidence>",',
    '    "listenFor": ["<if they reply, listen for this>", "<another>"],',
    '    "goodFollowUpQuestions": ["<consultative question if conversation opens>", "<another>"],',
    '    "ifTheyReply": "<2-3 sentences: how to continue consultatively — explore their problem, trade notes, still no pitch>",',
    '    "watchOut": "<what NOT to do / assumptions to avoid>"',
    "  },",
    '  "fit": { "score": <0-100>, "label": "<Strong|Moderate|Weak> fit", "whereWeFit": "<INTERNAL ONLY — never in message>", "whyNow": "<timing trigger>" },',
    '  "angle": "<honest curious angle — a problem to explore>",',
    '  "signalKey": "<one valid opener key>",',
    '  "customLine": "<one warm, specific, human line in the operator\'s voice; no flattery, no pitch, no brackets>",',
    '  "draftMessage": "<the opening message — sounds like a real human peer who did the homework, per VOICE and the DON\'Ts; never AI/sales copy>",',
    '  "summary": "<one-line tl;dr for the operator>"',
    "}",
  ].join("\n");
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
      model,
      temperature: 0.5,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `You are ${VOICE_NAME} — a warm, genuine senior engineer-operator at ${COMPANY_NAME}, never a salesperson. The messages you draft must sound like a real human peer who did real homework, never AI or sales copy. You return only valid JSON.` },
        { role: "user", content: prompt },
      ],
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
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY.trim(),
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1200,
      temperature: 0.5,
      system: `You are ${VOICE_NAME} — a warm, genuine senior engineer-operator at ${COMPANY_NAME}, never a salesperson. The messages you draft must sound like a real human peer who did real homework, never AI or sales copy. You return only valid JSON.`,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error?.message || "Anthropic error " + r.status);
  const text = Array.isArray(data?.content) ? data.content.map((c) => c.text || "").join("") : "";
  return extractJson(text);
}

// Perplexity sonar models search the live web (site, LinkedIn, news, hiring) before answering.
// deep=true uses the Deep Research model: many more sources (Google/news/YouTube/etc.),
// multi-step reasoning — slower (~30-60s) but a true "deep researcher" report.
async function callPerplexity(prompt, deep) {
  const model = deep
    ? (process.env.PERPLEXITY_DEEP_MODEL || "sonar-deep-research")
    : (process.env.PERPLEXITY_MODEL || "sonar-pro");
  const r = await fetch(PERPLEXITY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + process.env.PERPLEXITY_API_KEY.trim() },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      max_tokens: deep ? 4000 : 2200,
      web_search_options: { search_context_size: deep ? "high" : "medium" },
      messages: [
        { role: "system", content: `You are a meticulous B2B research analyst AND a warm, genuine human writer. First, search the live web broadly — the prospect's company website, LinkedIn, Twitter/X, recent news, funding databases (Crunchbase/news), GitHub, YouTube talks/interviews and job boards — and read the TOP results, not just one. Cross-check facts across sources. Gather REAL, CURRENT facts before answering. Never fabricate; if something can't be verified, say so. Then, when you write the message and customLine, drop the analyst voice entirely and write as ${VOICE_NAME}: a real human peer reaching out — warm, specific, curious, never salesy or AI-sounding. Output ONLY the requested JSON object — no prose, no markdown, no citation brackets.` },
        { role: "user", content: prompt },
      ],
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error?.message || "Perplexity error " + r.status);
  let text = data?.choices?.[0]?.message?.content || "";
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, ""); // deep-research model emits reasoning traces
  text = text.replace(/\[(\d+)\]/g, ""); // strip [1][2] citation markers before JSON parse
  const out = extractJson(text);
  let citations = Array.isArray(data?.citations) ? data.citations : [];
  if (!citations.length && Array.isArray(data?.search_results)) citations = data.search_results.map((s) => s && s.url).filter(Boolean);
  return { out, citations };
}

// No-key fallback: assemble a reasonable brief from the facts/signal we have.
function heuristic(p, openerKeys, facts, hiringTitles) {
  const sig = (p.signal || "").toLowerCase();
  const has = (k) => openerKeys && openerKeys.includes(k);
  let signalKey = has("default") ? "default" : (openerKeys && openerKeys[0]) || "default";
  if (hiringTitles && hiringTitles.length && has("hiring_eng")) signalKey = "hiring_eng";
  else if ((facts?.funding || /rais|series|funding|seed/.test(sig)) && has("raised")) signalKey = "raised";
  else if (/ai|ml|llm/.test(sig + " " + (facts?.industry || "")) && has("ai_arch")) signalKey = "ai_arch";
  else if (/(soc ?2|compliance|fintech|health|regulated|bank)/.test(sig + " " + (facts?.industry || "")) && has("soc2")) signalKey = "soc2";
  else if (/(new company|founded|incorporat)/.test(sig) && has("just_incorporated")) signalKey = "just_incorporated";
  else if (has("innovation_role")) signalKey = "innovation_role";

  const needsByTrack = {
    A: ["Reliable eval / retrieval / audit layers for their AI product", "Engineering capacity without growing headcount"],
    B: ["Shipping AI under regulated workflows", "SOC 2 / ISO 27001 readiness"],
    C: ["A technical team to get from idea to launched MVP", "Architecture that won't need rebuilding"],
    D: ["A clear, honest build plan and cost before spending", "Avoiding the wrong developer"],
  };
  const T = (p.track || "A").toUpperCase();
  const company = facts
    ? [facts.name || p.company, facts.industry ? "(" + facts.industry + ")" : "", facts.employees ? facts.employees + " staff" : "", facts.funding ? "· " + [facts.funding.stage, facts.funding.amount].filter(Boolean).join(" ") : ""].filter(Boolean).join(" ")
    : (p.company || "Unknown company") + " — " + (p.signal || "no company facts retrieved");
  const score = facts?.funding || (hiringTitles && hiringTitles.length) ? 72 : (p.signal && p.signal.indexOf("@") === -1 ? 62 : 45);
  const first = (p.name || "there").replace(/^u\//, "").split(" ")[0];
  const customLine = p.signal && p.signal.indexOf("@") === -1
    ? "Saw the " + p.signal.replace(/\.$/, "") + "."
    : "Been following what " + (p.company || "your team") + " is building.";
  // A genuine, problem-aware QUESTION per track — never a pitch.
  const questionByTrack = {
    A: "Curious how you're thinking about keeping the AI side reliable and auditable as usage scales — that's usually where it gets hard.",
    B: "Curious how you're approaching shipping AI inside the compliance/procurement side of things — what's been the trickiest part?",
    C: "Curious where you're at on actually getting it built and shipped — figured out who's taking it from idea to a working MVP?",
    D: "Curious how you're thinking about what to build first, and what to leave out, before spending real money on it?",
  };
  // Vary the close so the heuristic doesn't read as one fixed script.
  const closeByTrack = {
    A: "Would honestly love to hear your take.",
    B: "Would genuinely value your perspective on it.",
    C: "Happy to be a sounding board if it's useful — either way, rooting for you.",
    D: "Glad to talk it through if that helps at all.",
  };
  const draftMessage = "Hi " + first + " — " + customLine + " " + (questionByTrack[T] || questionByTrack.A) + "\n\n" + (closeByTrack[T] || closeByTrack.A);
  const playbook = {
    whatTheyCareAbout: p.signal || "What they're building and scaling right now.",
    listenFor: ["What problem is actually blocking them", "Whether they've tried to solve it already"],
    goodFollowUpQuestions: [questionByTrack[T] || questionByTrack.A, "What's been the hardest part so far?"],
    ifTheyReply: "Thank them for replying. Ask one more clarifying question about their situation. Share a relevant observation or trade notes — still no pitch. Only explore whether there's a real problem worth solving together.",
    watchOut: "Do not pitch services in the first reply. Do not assume they need an agency — they may need advice, a hire, or a different path.",
  };
  return {
    mode: "heuristic",
    person: (p.name || "This prospect") + " — " + (p.notes || p.signal || "role unknown") + ".",
    company,
    needs: needsByTrack[T] || needsByTrack.A,
    recentSignals: p.signal && p.signal.indexOf("@") === -1 ? [p.signal] : [],
    keyFacts: [p.company ? "Company: " + p.company : "", p.geo ? "Geo: " + p.geo : ""].filter(Boolean),
    conversationPlaybook: playbook,
    fit: {
      score,
      label: score >= 70 ? "Strong fit" : score >= 50 ? "Moderate fit" : "Weak fit",
      whereWeFit: TRACK_CONTEXT[T] || TRACK_CONTEXT.A,
      whyNow: facts?.funding ? "Recently funded — scaling pressure now." : (hiringTitles && hiringTitles.length ? "Actively hiring engineers." : (p.signal || "Captured signal suggests timing.")),
    },
    angle: "Lead with their signal and a genuine question — understand their problem before offering anything.",
    signalKey,
    customLine,
    draftMessage,
    summary: (p.name || "Prospect") + " at " + (p.company || "their company") + " — " + (TRACK_CONTEXT[T] || ""),
    note: "Heuristic brief — add PERPLEXITY_API_KEY for deep live web research (or OPENAI_API_KEY).",
  };
}

function clampNeeds(arr) {
  if (Array.isArray(arr)) return arr.map((x) => String(x)).filter(Boolean).slice(0, 4);
  if (typeof arr === "string" && arr.trim()) return [arr.trim()];
  return [];
}

function clampArr(arr, max) {
  if (Array.isArray(arr)) return arr.map((x) => String(x)).filter(Boolean).slice(0, max || 6);
  if (typeof arr === "string" && arr.trim()) return [arr.trim()];
  return [];
}

function normalisePlaybook(pb) {
  if (!pb || typeof pb !== "object") return null;
  return {
    whatTheyCareAbout: pb.whatTheyCareAbout || "",
    listenFor: clampArr(pb.listenFor, 4),
    goodFollowUpQuestions: clampArr(pb.goodFollowUpQuestions, 4),
    ifTheyReply: pb.ifTheyReply || "",
    watchOut: pb.watchOut || "",
  };
}

function normalise(out, p, openerKeys) {
  const valid = openerKeys && openerKeys.length ? openerKeys : ["default"];
  let key = out && out.signalKey;
  if (!valid.includes(key)) key = valid.includes("default") ? "default" : valid[0];
  const score = Math.max(0, Math.min(100, parseInt(out?.fit?.score, 10) || 0));
  return {
    person: out?.person || "",
    company: out?.company || "",
    needs: clampNeeds(out?.needs),
    recentSignals: clampArr(out?.recentSignals, 5),
    keyFacts: clampArr(out?.keyFacts, 6),
    conversationPlaybook: normalisePlaybook(out?.conversationPlaybook),
    fit: {
      score,
      label: out?.fit?.label || (score >= 70 ? "Strong fit" : score >= 50 ? "Moderate fit" : "Weak fit"),
      whereWeFit: out?.fit?.whereWeFit || "",
      whyNow: out?.fit?.whyNow || "",
    },
    angle: out?.angle || "",
    signalKey: key,
    customLine: (out?.customLine || "").replace(/\[\[.*?\]\]|\[.*?\]/g, "").trim(),
    draftMessage: (out?.draftMessage || "").replace(/\[\[.*?\]\]/g, "").trim(),
    summary: out?.summary || "",
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed — POST { prospect, openerKeys }" });
    return;
  }
  const body = await readBody(req);
  const p = body.prospect || {};
  const openerKeys = Array.isArray(body.openerKeys) ? body.openerKeys : [];
  let userPaste = (body.extraContext || "").trim();
  const deep = !!body.deep;
  const pullProfile = !!body.pullProfile;
  if (!p.name && !p.company && !p.signal) {
    res.status(400).json({ error: "Provide a prospect to analyse." });
    return;
  }

  // Normalise an explicit company website into a usable domain (so Apollo
  // enrichment + site scrape work even for hand-added leads).
  if (p.website) {
    p.website = /^https?:\/\//i.test(p.website) ? p.website : "https://" + p.website;
    if (!p.domain) {
      try { p.domain = new URL(p.website).hostname.replace(/^www\./, ""); } catch { /* ignore */ }
    }
  }

  // 1) Company facts + hiring. PREFER facts already stored on the prospect at
  //    import time — that spends ZERO Apollo credits here and survives deploys
  //    and re-analysis. Only hit Apollo when nothing was stored.
  let facts = (p.companyFacts && typeof p.companyFacts === "object") ? p.companyFacts : null;
  let hiringTitles = Array.isArray(p.hiringTitles) ? p.hiringTitles : [];
  let allRoles = Array.isArray(p.allRoles) ? p.allRoles : [];
  let credits = 0;
  const factsFromStore = !!facts;
  const apolloKey = process.env.APOLLO_API_KEY?.trim();
  if (!factsFromStore && apolloKey && (p.domain || p.orgId)) {
    const headers = { "Content-Type": "application/json", "Cache-Control": "no-cache", "X-Api-Key": apolloKey };
    try {
      if (p.domain) {
        const { org, credits: c } = await enrichOrg(p.domain, headers);
        credits += c;
        facts = orgFacts(org);
        if (org?.id && !p.orgId) p.orgId = org.id;
      }
      if (p.orgId) {
        const { titles, allTitles } = await orgHiringEngineers(p.orgId, headers);
        hiringTitles = titles || [];
        allRoles = allTitles || [];
      }
    } catch { /* fall through — analysis still runs without facts */ }
  }

  // 2) Website text (no auth, no credits) — homepage of the company site/domain.
  //    Prefer the website the user typed, then Apollo's, then the domain.
  let siteText = "";
  const site = p.website || facts?.website || (p.domain ? "https://" + p.domain : "");
  if (site) {
    try { siteText = await fetchSiteText(site); } catch { /* ignore */ }
  }

  // 2b) Gated LinkedIn via Apify. When Apollo + website already cover company
  //     context, only scrape recent posts (cheaper). Perplexity always runs.
  let linkedInBlock = "";
  let linkedInData = null;
  let usedProfile = false;
  let usedPosts = false;
  let apifySkippedProfile = false;
  if (pullProfile && isLinkedInProfile(p.profile)) {
    try {
      apifySkippedProfile = apolloCoversCompany(facts, siteText, p);
      const prof = await scrapeLinkedInProfile(p.profile, { skipProfile: apifySkippedProfile });
      if (prof && prof.text) {
        linkedInBlock = prof.text;
        linkedInData = {
          headline: prof.headline || "",
          about: prof.about || "",
          recentPosts: prof.recentPosts || [],
          postCount: prof.postCount || 0,
        };
        usedProfile = !apifySkippedProfile && !!(prof.headline || prof.about || prof.experiences?.length);
        usedPosts = !!(prof.recentPosts && prof.recentPosts.length);
      }
    } catch { /* ignore */ }
  }

  // 3) Reason with an LLM (or heuristic). Perplexity researches open web AND
  //    synthesizes the Apify LinkedIn block + Apollo facts into brief + message.
  const profileSources = linkedInBlock ? [p.profile] : [];
  const meta = {
    credits_consumed: credits || null,
    companyFacts: facts,
    hiringTitles,
    allRoles,
    factsFromStore,
    usedWebsite: !!siteText,
    usedPaste: !!userPaste,
    usedProfile,
    usedPosts,
    apifySkippedProfile,
    linkedInData,
  };
  try {
    if (process.env.PERPLEXITY_API_KEY?.trim()) {
      const prompt = buildPrompt(p, openerKeys, facts, hiringTitles, allRoles, siteText, linkedInBlock, userPaste, true);
      const { out, citations } = await callPerplexity(prompt, deep);
      const sources = [...profileSources, ...(citations || []).filter((u) => u !== p.profile)].slice(0, 12);
      if (out) { res.status(200).json(Object.assign({ mode: deep ? "perplexity-deep" : "perplexity" }, normalise(out, p, openerKeys), meta, { sources, webResearch: true, deep })); return; }
    } else if (process.env.OPENAI_API_KEY?.trim()) {
      const out = await callOpenAI(buildPrompt(p, openerKeys, facts, hiringTitles, allRoles, siteText, linkedInBlock, userPaste, false));
      if (out) { res.status(200).json(Object.assign({ mode: "openai" }, normalise(out, p, openerKeys), meta, { sources: profileSources })); return; }
    } else if (process.env.ANTHROPIC_API_KEY?.trim()) {
      const out = await callAnthropic(buildPrompt(p, openerKeys, facts, hiringTitles, allRoles, siteText, linkedInBlock, userPaste, false));
      if (out) { res.status(200).json(Object.assign({ mode: "anthropic" }, normalise(out, p, openerKeys), meta, { sources: profileSources })); return; }
    }
  } catch (e) {
    res.status(200).json(Object.assign({}, heuristic(p, openerKeys, facts, hiringTitles), meta, { warning: e.message || "AI provider error — used heuristic." }));
    return;
  }
  res.status(200).json(Object.assign({}, heuristic(p, openerKeys, facts, hiringTitles), meta));
}
