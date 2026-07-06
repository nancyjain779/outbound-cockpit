/**
 * Quick Apollo API health check. Run after changing your Apollo plan:
 *
 *   cd cockpit && node scripts/check-apollo.mjs
 *
 * Reads APOLLO_API_KEY from cockpit/.env and hits the People Search endpoint
 * with a tiny query, printing a clear verdict.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.resolve(__dirname, "..", ".env");

function readKey() {
  if (!fs.existsSync(envFile)) return "";
  const m = fs.readFileSync(envFile, "utf8").match(/^APOLLO_API_KEY=(.*)$/m);
  return m ? m[1].trim() : "";
}

const key = readKey();
if (!key) {
  console.log("No APOLLO_API_KEY found in cockpit/.env. Add it and retry.");
  process.exit(1);
}

const body = { page: 1, per_page: 2, person_titles: ["Founder", "CEO"], person_locations: ["London, United Kingdom"] };

const r = await fetch("https://api.apollo.io/v1/mixed_people/search", {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Api-Key": key },
  body: JSON.stringify(body),
});
const data = await r.json().catch(() => ({}));

console.log(`\nHTTP ${r.status}`);
if (r.ok && Array.isArray(data.people)) {
  console.log(`SUCCESS — People Search is enabled on your plan. Got ${data.people.length} sample result(s):`);
  data.people.forEach((p) => console.log(`  - ${[p.first_name, p.last_name].filter(Boolean).join(" ")} | ${p.title || ""} @ ${p.organization?.name || ""} | ${p.linkedin_url || "no url"}`));
  console.log("\nThe cockpit daily feed will now work. Restart the server and click 'Build today's feed'.");
} else if (data.error_code === "API_INACCESSIBLE" || /not accessible/i.test(data.error || "")) {
  console.log("BLOCKED — your Apollo plan still does NOT include API access to the People Search endpoint.");
  console.log(`Apollo says: ${data.error || JSON.stringify(data)}`);
  console.log("\nAsk Apollo support specifically: 'Does my plan include API access to the mixed_people/search (People Search) endpoint?' — it is gated separately from general API access.");
} else {
  console.log("Unexpected response:", JSON.stringify(data).slice(0, 400));
}
