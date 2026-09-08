import assert from "node:assert/strict";
import deposit from "../api/deposit.js";
import tavusSession from "../api/tavus-session.js";
import { createGoogleBooking, getGoogleBusy } from "../api/google-calendar.js";

function res() {
  return {
    code: 200,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.code = c; return this; },
    json(v) { this.body = v; return this; },
    end() { return this; },
  };
}

const originalFetch = global.fetch;

delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_DEPOSIT_CENTS;
let out = res();
await deposit({ method: "GET", headers: {} }, out);
assert.equal(out.body.enabled, false);

process.env.STRIPE_SECRET_KEY = "sk_test_fake";
process.env.STRIPE_DEPOSIT_CENTS = "50000";
let stripeBody = "";
global.fetch = async (_url, init) => {
  stripeBody = init.body;
  return { ok: true, json: async () => ({ url: "https://checkout.stripe.com/test" }) };
};
out = res();
await deposit({
  method: "POST",
  headers: {},
  body: { name: "Ada", email: "ada@example.com", company: "Example", bookingId: "42" },
}, out);
assert.equal(out.code, 200);
assert.equal(out.body.url, "https://checkout.stripe.com/test");
const stripeForm = new URLSearchParams(stripeBody);
assert.equal(stripeForm.get("line_items[0][price_data][unit_amount]"), "50000");
assert.equal(stripeForm.get("customer_email"), "ada@example.com");
assert.doesNotMatch(stripeBody, /card|cvc|number/);
console.log("PASS Stripe Checkout session contains deposit metadata, never card data");

process.env.GOOGLE_CLIENT_ID = "client";
process.env.GOOGLE_CLIENT_SECRET = "secret";
process.env.GOOGLE_REFRESH_TOKEN = "refresh";
process.env.GOOGLE_CALENDAR_ID = "primary";
const googleCalls = [];
global.fetch = async (url, init) => {
  googleCalls.push({ url: String(url), init });
  if (String(url).includes("oauth2.googleapis.com")) {
    return { ok: true, json: async () => ({ access_token: "access", expires_in: 3600 }) };
  }
  if (String(url).includes("freeBusy")) {
    return { ok: true, json: async () => ({ calendars: { primary: { busy: [{ start: "2026-09-01T15:00:00Z", end: "2026-09-01T15:30:00Z" }] } } }) };
  }
  return { ok: true, json: async () => ({ id: "event-1", htmlLink: "https://calendar.google.com/event", hangoutLink: "https://meet.google.com/test" }) };
};
const busy = await getGoogleBusy("2026-09-01T00:00:00Z", "2026-09-02T00:00:00Z");
assert.equal(busy.length, 1);
const calendar = await createGoogleBooking({
  name: "Ada", email: "ada@example.com", company: "Example", pain: "manual intake",
  slotUtc: "2026-09-01T15:00:00Z", timezone: "America/New_York",
});
assert.equal(calendar.ok, true);
const eventCall = googleCalls.find((c) => c.url.includes("/events?"));
const event = JSON.parse(eventCall.init.body);
assert.equal(event.attendees[0].email, "ada@example.com");
assert.equal(event.conferenceData.createRequest.conferenceSolutionKey.type, "hangoutsMeet");
console.log("PASS Google free/busy and invited Meet event integration");

delete process.env.TAVUS_API_KEY;
delete process.env.TAVUS_PAL_ID;
out = res();
await tavusSession({ method: "GET", headers: {} }, out);
assert.equal(out.body.enabled, false);

process.env.TAVUS_API_KEY = "tavus-fake";
process.env.TAVUS_PAL_ID = "pal-echo";
process.env.TAVUS_FACE_ID = "face-sam";
let tavusPayload = null;
global.fetch = async (_url, init) => {
  tavusPayload = JSON.parse(init.body);
  return { ok: true, json: async () => ({ conversation_id: "conversation-1", conversation_url: "https://tavus.daily.co/conversation-1", meeting_token: "token" }) };
};
out = res();
await tavusSession({ method: "POST", headers: { "x-forwarded-for": "203.0.113.10" }, body: {} }, out);
assert.equal(out.code, 200);
assert.equal(tavusPayload.pal_id, "pal-echo");
assert.equal(tavusPayload.face_id, "face-sam");
assert.equal(tavusPayload.require_auth, true);
console.log("PASS private Tavus CVI conversation creation");

global.fetch = originalFetch;
console.log("ALL WOW-UPGRADE TESTS PASSED");
