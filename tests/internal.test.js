import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("openers", async () => {
  it("lists track A openers", async () => {
    const { listOpeners } = await import("../lib/openers.js");
    const r = listOpeners("A");
    assert.equal(r.track, "A");
    assert.ok(r.openers.includes("raised"));
  });
});

describe("internal auth", async () => {
  it("rejects missing token when configured", async () => {
    const prev = process.env.COCKPIT_SERVICE_TOKEN;
    process.env.COCKPIT_SERVICE_TOKEN = "test-secret";
    const { requireServiceToken } = await import("../lib/internal-auth.js");
    let status = 0;
    const res = { status: (c) => { status = c; return res; }, json: () => res };
    const ok = requireServiceToken({ headers: {} }, res);
    assert.equal(ok, false);
    assert.equal(status, 403);
    process.env.COCKPIT_SERVICE_TOKEN = prev;
  });
});
