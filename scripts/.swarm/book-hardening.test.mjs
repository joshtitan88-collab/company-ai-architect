// Module test for book.js rate limiter + notify.js — fetch fully mocked, no network.
import assert from "node:assert";

process.env.GITHUB_TOKEN = "fake-token-for-test";
process.env.INTAKE_REPO = "example/private-intake";
delete process.env.RESEND_API_KEY;

const calls = []; // record of mocked fetch calls
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), init });
  const u = String(url);
  if (u.endsWith("/repos/example/private-intake")) {
    return { ok: true, status: 200, json: async () => ({ private: true }) };
  }
  if (u.includes("api.github.com") && u.includes("/issues?")) {
    return { ok: true, status: 200, json: async () => [] };
  }
  if (u.includes("api.github.com") && u.endsWith("/issues")) {
    return { ok: true, status: 201, json: async () => ({ number: 42 }) };
  }
  if (u.includes("api.resend.com")) {
    return { ok: true, status: 200, json: async () => ({ id: "email_123" }) };
  }
  return { ok: false, status: 500, json: async () => ({}) };
};

const { default: handler } = await import("../../api/book.js");
const notify = await import("../../api/notify.js");

function makeRes() {
  const res = {
    statusCode: 0,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
  return res;
}

function makeReq(ip, i = 0) {
  return {
    method: "POST",
    headers: { "x-forwarded-for": ip },
    body: {
      name: "Test User",
      email: `t${i}@example.com`,
      company: "Acme",
      slotIso: "2026-09-01T15:00:00Z",
      timezone: "America/New_York",
    },
  };
}

const results = [];

// (1) 6 rapid posts from same IP -> 6th is 429
{
  const codes = [];
  for (let i = 0; i < 6; i++) {
    const res = makeRes();
    await handler(makeReq("1.2.3.4, 10.0.0.1", i), res);
    codes.push(res.statusCode);
  }
  assert.deepStrictEqual(codes.slice(0, 5), [200, 200, 200, 200, 200], "first 5 should pass");
  assert.strictEqual(codes[5], 429, "6th should be 429");
  const res6body = codes[5];
  results.push("PASS (1) same-IP: codes=" + codes.join(","));
}

// verify 429 body shape
{
  const res = makeRes();
  await handler(makeReq("1.2.3.4", 99), res);
  assert.strictEqual(res.statusCode, 429);
  assert.deepStrictEqual(res.body, { error: "rate_limited" });
  results.push("PASS (1b) 429 body {error:'rate_limited'}");
}

// (2) different IP unaffected
{
  const res = makeRes();
  await handler(makeReq("5.6.7.8", 7), res);
  assert.strictEqual(res.statusCode, 200, "different IP should not be limited, got " + res.statusCode);
  assert.strictEqual(res.body.ok, true);
  results.push("PASS (2) different IP -> 200");
}

// (4) notify skipped cleanly when RESEND_API_KEY unset (no network)
{
  const before = calls.length;
  const out = await notify.sendBookingConfirmation({
    name: "Test User", email: "t@example.com", company: "Acme",
    slotUtc: "2026-09-01T15:00:00.000Z", timezone: "America/New_York",
  });
  assert.deepStrictEqual(out, { ok: false, skipped: true });
  assert.strictEqual(calls.length, before, "no fetch calls when key unset");
  results.push("PASS (4) unset key -> {ok:false,skipped:true}, zero fetch calls");
}

// (3) with fake key, email POST body contains the slot
{
  process.env.RESEND_API_KEY = "re_fake_test_key";
  const before = calls.length;
  const out = await notify.sendBookingConfirmation({
    name: "Test User", email: "t@example.com", company: "Acme",
    slotUtc: "2026-09-01T15:00:00.000Z", timezone: "America/New_York",
  });
  assert.strictEqual(out.ok, true, "send should succeed: " + JSON.stringify(out));
  const resendCalls = calls.slice(before).filter((c) => c.url.includes("api.resend.com"));
  assert.strictEqual(resendCalls.length, 1, "exactly one resend call");
  const body = resendCalls[0].init.body;
  assert.ok(body.includes("2026-09-01T15:00:00.000Z"), "email body must contain slot UTC");
  assert.ok(resendCalls[0].init.headers.Authorization.startsWith("Bearer "), "bearer auth header");
  results.push("PASS (3) fake key -> Resend POST body contains slot");
}

// bonus: retry once on failure, never throws
{
  let n = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { n++; throw new Error("boom"); };
  const out = await notify.sendBookingConfirmation({
    name: "X", email: "x@example.com", company: "C",
    slotUtc: "2026-09-01T15:00:00.000Z", timezone: "UTC",
  });
  assert.strictEqual(n, 2, "exactly one retry (2 attempts)");
  assert.strictEqual(out.ok, false);
  globalThis.fetch = realFetch;
  results.push("PASS (5) failure path: 2 attempts, no throw, ok:false");
}

// let fire-and-forget promises settle before exit
await new Promise((r) => setTimeout(r, 50));
console.log(results.join("\n"));
console.log("ALL TESTS PASSED");
