import assert from "node:assert/strict";
import { createHandler } from "../api/lemonslice-session.js";

const UUID = "12345678-1234-4234-8234-123456789abc";
const ROOM = "sam-" + UUID;
const env = { DAILY_API_KEY: "secret-daily", LEMONSLICE_API_KEY: "secret-lemon", SAM_VIDEO_ENABLED: "true", VERCEL: "1" };
const origin = "https://www.companyaiarchitect.com";
let checks = 0;
async function check(name, run) { await run(); checks++; console.log("PASS " + name); }
function harness(options = {}) {
  const calls = [];
  let time = 1_800_000_000_000;
  const state = { fail: "", invalid: "", ...options };
  const request = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, init, body });
    assert.equal(init.redirect, "error");
    assert.ok(init.signal instanceof AbortSignal);
    if (state.fail && url.includes(state.fail)) throw new Error("provider secret-daily secret-lemon PRIVATE ERROR");
    let data;
    if (url.endsWith("/rooms") && init.method === "POST") data = { name: ROOM, url: "https://sam.daily.co/" + ROOM };
    else if (url.endsWith("/meeting-tokens")) data = { token: body.properties.user_id === "sam-avatar" ? "publisher-token" : "viewer-token" };
    else if (url.endsWith("/liveai/sessions")) data = { session_id: "session-123456", websocket_address: "wss://stream.lemonslice.com/session-capability" };
    else data = { success: true };
    if (state.invalid === "socket" && url.endsWith("/liveai/sessions")) data.websocket_address = "http://bad.example";
    if (state.invalid === "room" && url.endsWith("/rooms")) data.url = "https://daily.co.attacker.example/room";
    return { ok: true, status: 200, json: async () => data };
  };
  const handler = createHandler({ env: options.env || { ...env }, request, uuid: () => UUID, now: () => time,
    readImage: async () => options.noImage ? Promise.reject(new Error("missing")) : Buffer.from("original sam image"),
  });
  async function invoke(body = { action: "start" }, headers = {}, method = "POST") {
    const res = { headers: {}, statusCode: 0, setHeader(k,v) { this.headers[k]=v; }, status(code) {this.statusCode=code;return this;}, json(data) {this.data=data;return this;} };
    await handler({ method, body, headers: { origin, "x-forwarded-for": "192.0.2.1", ...headers } }, res);
    return res;
  }
  return { invoke, calls, state, advance: (ms) => { time += ms; } };
}

await check("capability is disabled until explicitly activated, without provider calls or secrets", async () => {
  const h = harness({ env: { ...env, SAM_VIDEO_ENABLED: "false" } });
  const r = await h.invoke(null, {}, "GET");
  assert.deepEqual(r.data, { ok:true, enabled:false, provider:"lemonslice" });
  assert.equal(h.calls.length,0);
  assert.equal((await h.invoke()).statusCode,501);
});
await check("missing one credential remains disabled", async () => {
  const h=harness({ env: { SAM_VIDEO_ENABLED:"true", DAILY_API_KEY:"only-one" } });
  assert.equal((await h.invoke(null,{},"GET")).data.enabled,false);
});
await check("cross-site and missing-origin starts cannot allocate paid resources", async () => {
  const h=harness();
  assert.equal((await h.invoke(undefined,{origin:"https://attacker.example"})).statusCode,403);
  assert.equal((await h.invoke(undefined,{origin:""})).statusCode,403);
  assert.equal(h.calls.length,0);
});
await check("private scoped room, receive-only visitor, exact audio transport and original embedded image", async () => {
  const h=harness(); const r=await h.invoke();
  assert.equal(r.statusCode,200); assert.equal(r.data.meetingToken,"viewer-token");
  assert.equal(r.data.expiresAt,1_800_000_600_000);
  const room=h.calls[0].body; assert.equal(room.privacy,"private");
  assert.equal(room.properties.eject_at_room_exp,true); assert.equal(room.properties.max_participants,2);
  const tokens=h.calls.filter(c=>c.url.endsWith("/meeting-tokens"));
  for(const c of tokens) { assert.equal(c.body.properties.room_name,ROOM); assert.equal(c.body.properties.is_owner,false); assert.equal(c.body.properties.eject_at_token_exp,true); }
  assert.deepEqual(tokens[0].body.properties.permissions.canSend,["audio","video"]);
  assert.equal(tokens[1].body.properties.permissions.canSend,false);
  const avatar=h.calls.find(c=>c.url.endsWith("/liveai/sessions"));
  assert.equal(avatar.body.transport_type,"websocket-daily"); assert.equal(avatar.body.daily_properties.daily_token,"publisher-token");
  assert.equal(avatar.body.agent_image_base64,Buffer.from("original sam image").toString("base64"));
  assert.equal(avatar.body.idle_timeout,60);
  assert.ok(!JSON.stringify(r.data).includes("secret-")); assert.ok(!JSON.stringify(r.data).includes("publisher-token"));
});
await check("signed cleanup ends only its own avatar and room", async () => {
  const h=harness(); const started=await h.invoke(); h.calls.length=0;
  const ended=await h.invoke({action:"end",cleanupToken:started.data.cleanupToken,room:"other-room",session:"other-session"});
  assert.equal(ended.statusCode,200); assert.equal(h.calls.length,2);
  assert.equal(h.calls[0].url,"https://lemonslice.com/api/liveai/sessions/session-123456/control");
  assert.deepEqual(h.calls[0].body,{event:"terminate"});
  assert.equal(h.calls[1].url,"https://api.daily.co/v1/rooms/"+ROOM);
});
await check("modified and expired cleanup capabilities make no requests", async () => {
  const h=harness(); const started=await h.invoke(); h.calls.length=0;
  assert.equal((await h.invoke({action:"end",cleanupToken:"e30.invalid"})).statusCode,403);
  const [p,s]=started.data.cleanupToken.split(".");
  assert.equal((await h.invoke({action:"end",cleanupToken:p+"A."+s})).statusCode,403);
  h.advance(4_201_000);
  assert.equal((await h.invoke({action:"end",cleanupToken:started.data.cleanupToken})).statusCode,403);
  assert.equal(h.calls.length,0);
});
await check("switching off new starts still permits existing session cleanup", async () => {
  const config={...env}; const h=harness({env:config}); const started=await h.invoke();
  config.SAM_VIDEO_ENABLED="false";
  assert.equal((await h.invoke()).statusCode,501);
  assert.equal((await h.invoke({action:"end",cleanupToken:started.data.cleanupToken})).statusCode,200);
});
await check("token provisioning failure deletes the private room with generic errors", async () => {
  const h=harness({fail:"/meeting-tokens"}); const r=await h.invoke();
  assert.equal(r.statusCode,502); assert.deepEqual(r.data,{error:"avatar_start_failed"});
  assert.ok(h.calls.some(c=>c.init.method==="DELETE"));
  assert.ok(!h.calls.some(c=>c.url.endsWith("/liveai/sessions")));
});
await check("bad websocket response terminates allocated avatar and deletes room", async () => {
  const h=harness({invalid:"socket"}); assert.equal((await h.invoke()).statusCode,502);
  assert.ok(h.calls.some(c=>c.url.endsWith("/session-123456/control")));
  assert.ok(h.calls.some(c=>c.init.method==="DELETE"));
});
await check("invalid room origin cannot receive publisher credentials", async () => {
  const h=harness({invalid:"room"}); assert.equal((await h.invoke()).statusCode,502);
  assert.ok(!h.calls.some(c=>c.url.endsWith("/meeting-tokens")));
});
await check("portrait missing fails before resource allocation", async () => {
  const h=harness({noImage:true}); assert.equal((await h.invoke()).statusCode,502);
  assert.ok(!h.calls.some(c=>c.init.method==="POST"));
});
await check("bounded per-address start limiter resets, and cleanup is not start-limited", async () => {
  const h=harness(); let token;
  for(let i=0;i<3;i++) token=(await h.invoke()).data.cleanupToken;
  const before=h.calls.length; assert.equal((await h.invoke()).statusCode,429); assert.equal(h.calls.length,before);
  assert.equal((await h.invoke({action:"end",cleanupToken:token})).statusCode,200);
  h.advance(600001); assert.equal((await h.invoke()).statusCode,200);
});
await check("malformed, oversized and unsupported actions do not allocate", async () => {
  const h=harness();
  for(const body of ["{",[],{action:"wrong"},"x".repeat(5000)]) assert.equal((await h.invoke(body)).statusCode,400);
  assert.equal((await h.invoke(null,{},"DELETE")).statusCode,405); assert.equal(h.calls.length,0);
});
console.log(`${checks} LemonSlice session checks passed.`);
