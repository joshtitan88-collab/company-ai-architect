// Test for api/slots.js booked-slot filtering. Run from repo root.
import assert from "node:assert";
import handler, { openSlots, bookedStarts } from "../api/slots.js";
import { readFileSync } from "node:fs";

const data = JSON.parse(readFileSync("availability.json", "utf8"));
const all = openSlots(data);
assert(all.length >= 2, "need at least 2 open slots to test");
const bookIso = all[0].iso;
const bookIso2 = all[1].iso;

const mkRes = () => ({
  setHeader() {},
  status(c) { this.code = c; return this; },
  json(o) { this.out = o; return this; },
  end() {},
});

process.env.GITHUB_TOKEN = "test-token-not-real";
const realFetch = global.fetch;

// --- Case 1: two fake open issues book two slots -> both removed ---
global.fetch = async (url, init) => {
  assert(String(url).includes("/repos/joshtitan88-collab/company-ai-architect/issues"), "wrong URL: " + url);
  assert(String(url).includes("labels=desk-booking") && String(url).includes("state=open"), "missing filters");
  assert(init.headers.Authorization.startsWith("Bearer "), "missing auth header");
  return {
    ok: true,
    status: 200,
    json: async () => [
      { number: 1, body: `Automated desk booking\n\n- name: A\n- email: a@x.com\n- slot_iso: ${bookIso}\n- slot_utc: ${bookIso}\n` },
      { number: 2, body: `Automated desk booking\n\n- name: B\n- email: b@x.com\n- slot_utc: ${bookIso2}\n` },
    ],
  };
};
let res = mkRes();
await handler({ method: "GET" }, res);
assert.equal(res.code, 200);
assert(!res.out.slots.some((s) => s.iso === bookIso), "booked slot 1 still served");
assert(!res.out.slots.some((s) => s.iso === bookIso2), "booked slot 2 still served");
assert.equal(res.out.count, all.length - 2, "count mismatch");
assert.equal(res.out.count, res.out.slots.length, "count != slots.length");
assert.deepEqual(Object.keys(res.out).sort(), ["count", "slotMinutes", "slots", "timezone"], "response shape changed");
console.log("PASS case1: booked slots removed (" + all.length + " -> " + res.out.count + ")");

// --- Case 2: fetch rejects -> all slots served ---
global.fetch = async () => { throw new Error("network down"); };
res = mkRes();
await handler({ method: "GET" }, res);
assert.equal(res.code, 200);
assert.equal(res.out.count, all.length, "failure path should serve ALL slots");
console.log("PASS case2: fetch failure serves all " + res.out.count + " slots");

// --- Case 3: non-ok HTTP response -> all slots served ---
global.fetch = async () => ({ ok: false, status: 403, json: async () => ({}) });
res = mkRes();
await handler({ method: "GET" }, res);
assert.equal(res.code, 200);
assert.equal(res.out.count, all.length, "http-error path should serve ALL slots");
console.log("PASS case3: http 403 serves all slots");

// --- Case 4: token missing -> all slots served, no fetch call ---
delete process.env.GITHUB_TOKEN;
global.fetch = async () => { throw new Error("should not be called"); };
res = mkRes();
await handler({ method: "GET" }, res);
assert.equal(res.code, 200);
assert.equal(res.out.count, all.length, "no-token path should serve ALL slots");
console.log("PASS case4: missing token serves all slots without fetching");

global.fetch = realFetch;
console.log("ALL TESTS PASSED");
