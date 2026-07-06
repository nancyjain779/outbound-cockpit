/**
 * Shared Apollo organization lookup with an in-process TTL cache.
 * Used by lead APIs, AI analyse, and internal tool bridge.
 */
export {
  fundingFromOrg,
  enrichOrg,
  orgHiringEngineers,
  fetchSiteText,
  orgFacts,
} from "../api/leads/org-lookup.js";
