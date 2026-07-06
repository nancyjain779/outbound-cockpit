/** Valid opener keys per track — synced with public/cockpit.html TEMPLATES. */
export const OPENERS_BY_TRACK = {
  A: ["raised", "ai_arch", "soc2", "hiring_eng", "scaling", "default"],
  B: ["intro", "innovation_role", "transformation", "default"],
  C: ["cofounder", "just_incorporated", "accelerator", "find_dev", "milestone", "stealth", "default"],
  D: ["cofounder", "new_founder", "idea_help", "mvp_cost", "validation", "default"],
};

export function listOpeners(track) {
  const t = (track || "").toUpperCase();
  if (t && OPENERS_BY_TRACK[t]) return { track: t, openers: OPENERS_BY_TRACK[t] };
  return { tracks: OPENERS_BY_TRACK };
}
