import assert from "node:assert/strict";
import { provisionIntake, diagnosticCode } from "./provision-intake.mjs";
import { DEFAULT_INTAKE_REPO, PRODUCTION_PROJECT_ID, intakeRepo } from "../api/_private-intake.js";

const env = { VERCEL_ENV: "production", VERCEL_PROJECT_ID: PRODUCTION_PROJECT_ID, GITHUB_TOKEN: "sentinel-token" };
const metadata = (repo = DEFAULT_INTAKE_REPO) => ({ full_name: repo, private: true, has_issues: true });
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
let count = 0;
async function check(name, fn) { await fn(); count++; console.log("PASS " + name); }
async function rejectsCode(fn, expected) {
  await assert.rejects(fn, error => diagnosticCode(error) === expected);
}

await check("preview, local and other projects never provision or inherit production storage", async () => {
  for (const candidate of [{}, { ...env, VERCEL_ENV: "preview" }, { ...env, VERCEL_PROJECT_ID: "another-project" }]) {
    assert.equal(intakeRepo(candidate), "");
    assert.equal((await provisionIntake({ env: candidate, request: async () => { throw Error("must not request"); } })).skipped, true);
  }
});
await check("explicit intake setting overrides the production default", async () => {
  const candidate = { ...env, INTAKE_REPO: "owner/explicit" }; const paths = [];
  const result = await provisionIntake({ env: candidate, request: async (url, init) => {
    paths.push(url); assert.equal(init.method, "GET");
    return response(url.includes("/issues?") ? [] : metadata("owner/explicit"));
  } });
  assert.equal(result.created, false);
  assert(paths.every(path => path.includes("/repos/owner/explicit")));
  assert.equal(intakeRepo({ ...candidate, INTAKE_REPO: "invalid value" }), "");
});
await check("existing private intake is reused without writes", async () => {
  const result = await provisionIntake({ env, request: async (url, init) => {
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "error");
    return response(url.includes("/issues?") ? [] : metadata());
  } });
  assert.deepEqual(result, { skipped: false, created: false, private: true, recordsReadable: true, writesVerified: false });
});
await check("initial creation is private and the synthetic write check is closed", async () => {
  let exists = false; const methods = [];
  const result = await provisionIntake({ env, request: async (url, init) => {
    methods.push(init.method);
    if (url.endsWith("/user")) return response({ login: "joshtitan88-collab" });
    if (url.endsWith("/user/repos")) {
      const body = JSON.parse(init.body);
      assert.equal(body.private, true); assert.equal(body.has_issues, true);
      assert.equal(body.name, "company-ai-architect-intake");
      exists = true; return response(metadata(), 201);
    }
    if (url.endsWith("/issues") && init.method === "POST") {
      const body = JSON.parse(init.body); assert(!body.labels); assert(!body.body.includes("slot_utc"));
      return response({ number: 1 }, 201);
    }
    if (url.endsWith("/issues/1")) { assert.deepEqual(JSON.parse(init.body), { state: "closed" }); return response({ state: "closed" }); }
    if (url.includes("/issues?")) return response([]);
    return exists ? response(metadata()) : response({}, 404);
  } });
  assert.equal(result.created, true); assert.equal(result.writesVerified, true);
  assert.equal(methods.filter(x => x === "POST").length, 2);
  assert.equal(methods.filter(x => x === "PATCH").length, 1);
});
await check("concurrent repository creation refetches and verifies instead of duplicating", async () => {
  let exists = false;
  const result = await provisionIntake({ env, request: async (url, init) => {
    if (url.endsWith("/user")) return response({ login: "joshtitan88-collab" });
    if (url.endsWith("/user/repos")) { exists = true; return response({}, 422); }
    assert.equal(init.method, "GET");
    return url.includes("/issues?") ? response([]) : exists ? response(metadata()) : response({}, 404);
  } });
  assert.equal(result.created, false); assert.equal(result.writesVerified, false);
});
await check("wrong GitHub identity cannot create a repository", async () => {
  await rejectsCode(() => provisionIntake({ env, request: async (url, init) => {
    assert.equal(init.method, "GET");
    return url.endsWith("/user") ? response({ login: "another-owner" }) : response({}, 404);
  } }), "github_owner_mismatch");
});
await check("public intake and disabled issues both block setup", async () => {
  for (const [data, expected] of [[{ ...metadata(), private: false }, "intake_must_be_private"], [{ ...metadata(), has_issues: false }, "intake_issues_disabled"]]) {
    await rejectsCode(() => provisionIntake({ env, request: async () => response(data) }), expected);
  }
});
await check("missing credentials and invalid explicit targets block setup", async () => {
  await rejectsCode(() => provisionIntake({ env: { ...env, GITHUB_TOKEN: "" } }), "github_token_missing");
  await rejectsCode(() => provisionIntake({ env: { ...env, INTAKE_REPO: "not a repo" } }), "intake_repo_invalid");
});
await check("provider secrets and raw errors never enter diagnostic codes", async () => {
  const secret = Error("Bearer secret-message");
  secret.stack = "secret-stack"; secret.cause = "secret-cause"; secret.code = "secret-code";
  await rejectsCode(() => provisionIntake({ env, request: async () => { throw secret; } }), "intake_setup_failed");
  assert.equal(diagnosticCode(secret), "intake_setup_failed");
  await rejectsCode(() => provisionIntake({ env, request: async () => response({ message: "secret-response" }, 403) }), "intake_repo_http_403");
});
await check("missing explicit repository is never auto-created", async () => {
  await rejectsCode(() => provisionIntake({ env: { ...env, INTAKE_REPO: "owner/custom" }, request: async (_url, init) => {
    assert.equal(init.method, "GET"); return response({}, 404);
  } }), "intake_repo_http_404");
});
await check("malformed records and repository identity mismatch fail closed", async () => {
  await rejectsCode(() => provisionIntake({ env, request: async () => response(metadata("owner/unexpected")) }), "intake_identity_mismatch");
  await rejectsCode(() => provisionIntake({ env, request: async url => response(url.includes("/issues?") ? {} : metadata()) }), "intake_records_unavailable");
});
console.log(count + " private intake setup checks passed.");
