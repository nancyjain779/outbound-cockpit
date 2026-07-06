/**
 * Perplexity web research — extracted from api/ai/analyse.js for internal tool bridge.
 */
const PERPLEXITY_URL = "https://api.perplexity.ai/chat/completions";

function extractJson(text) {
  if (!text) return null;
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a === -1 || b === -1 || b < a) return null;
  try { return JSON.parse(text.slice(a, b + 1)); } catch { return null; }
}

/**
 * Run live web research via Perplexity sonar.
 * Returns { summary, sources, raw } — summary is plain text for agent context.
 */
export async function webResearch(query, opts = {}) {
  const key = process.env.PERPLEXITY_API_KEY?.trim();
  if (!key) {
    return { summary: "", sources: [], error: "PERPLEXITY_API_KEY not set" };
  }
  const deep = !!opts.deep;
  const model = deep
    ? (process.env.PERPLEXITY_DEEP_MODEL || "sonar-deep-research")
    : (process.env.PERPLEXITY_MODEL || "sonar-pro");

  const r = await fetch(PERPLEXITY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      max_tokens: deep ? 3000 : 1500,
      web_search_options: { search_context_size: deep ? "high" : "medium" },
      messages: [
        {
          role: "system",
          content: "You are a meticulous B2B research analyst. Search the live web and return a concise factual summary with bullet points. Never fabricate. Cite real product names, numbers, and recent events when found.",
        },
        { role: "user", content: String(query || "").slice(0, 4000) },
      ],
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    return { summary: "", sources: [], error: data?.error?.message || "Perplexity error " + r.status };
  }
  let text = data?.choices?.[0]?.message?.content || "";
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  text = text.replace(/\[(\d+)\]/g, "");
  let citations = Array.isArray(data?.citations) ? data.citations : [];
  if (!citations.length && Array.isArray(data?.search_results)) {
    citations = data.search_results.map((s) => s && s.url).filter(Boolean);
  }
  return { summary: text.trim(), sources: citations.slice(0, 12), raw: data };
}

export { extractJson };
