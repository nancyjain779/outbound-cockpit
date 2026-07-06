/**
 * Service-to-service auth for /api/internal/* routes.
 * Python agent and MCP server use x-service-token (COCKPIT_SERVICE_TOKEN).
 */
function serviceToken() {
  return (process.env.COCKPIT_SERVICE_TOKEN || "").trim();
}

export function requireServiceToken(req, res) {
  const expected = serviceToken();
  if (!expected) {
    res.status(503).json({ error: "COCKPIT_SERVICE_TOKEN not configured on server." });
    return false;
  }
  const token = (req.headers["x-service-token"] || req.headers["x-cockpit-service-token"] || "").trim();
  if (token !== expected) {
    res.status(403).json({ error: "Forbidden — invalid or missing x-service-token." });
    return false;
  }
  return true;
}

export function logInternalCall(req, tool, extra = {}) {
  const runId = req.headers["x-run-id"] || "";
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    type: "internal_tool",
    tool,
    run_id: runId,
    ...extra,
  }));
}
