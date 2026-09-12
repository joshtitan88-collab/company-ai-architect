import { pathToFileURL } from "node:url";
import { DEFAULT_INTAKE_REPO, intakeRepo, isProductionProject } from "../api/_private-intake.js";

class IntakeSetupError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = (code) => { throw new IntakeSetupError(code); };
export function diagnosticCode(error) {
  return error instanceof IntakeSetupError ? error.code : "intake_setup_failed";
}

/** Bootstrap only the owner's exact production project; never log credentials. */
export async function provisionIntake({ env = process.env, request = fetch } = {}) {
  if (!isProductionProject(env)) return { skipped: true, reason: "outside_production_project" };
  const repo = intakeRepo(env);
  if (!repo) fail("intake_repo_invalid");
  const token = env.GITHUB_TOKEN;
  if (!token) fail("github_token_missing");
  const api = async (path, method = "GET", body) => {
    const r = await request("https://api.github.com" + path, {
      method, redirect: "error", signal: AbortSignal.timeout(10000),
      headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await r.json().catch(() => null);
    return { ok: r.ok, status: Number.isInteger(r.status) ? r.status : 0, data };
  };
  let metadata = await api("/repos/" + repo);
  let created = false;
  if (metadata.status === 404 && repo === DEFAULT_INTAKE_REPO) {
    const owner = repo.split("/")[0];
    const identity = await api("/user");
    if (!identity.ok) fail("github_identity_unavailable");
    if (String(identity.data?.login || "").toLowerCase() !== owner.toLowerCase()) fail("github_owner_mismatch");
    const result = await api("/user/repos", "POST", {
      name: repo.split("/")[1],
      description: "Private appointment requests and messages for Company AI Architect SAM.",
      private: true, has_issues: true, has_projects: false, has_wiki: false,
    });
    if (!result.ok && result.status !== 422) fail("intake_create_http_" + result.status);
    created = result.ok;
    // A concurrent deployment may have created the same repo. Verify it again.
    metadata = await api("/repos/" + repo);
  }
  if (!metadata.ok) fail("intake_repo_http_" + metadata.status);
  if (String(metadata.data?.full_name || "").toLowerCase() !== repo.toLowerCase()) fail("intake_identity_mismatch");
  if (metadata.data?.private !== true) fail("intake_must_be_private");
  if (metadata.data?.has_issues !== true) fail("intake_issues_disabled");
  const records = await api("/repos/" + repo + "/issues?labels=desk-booking&state=open&per_page=1");
  if (!records.ok || !Array.isArray(records.data)) fail("intake_records_unavailable");

  // On initial setup only, verify the deployment credential can write and close
  // a synthetic record. It contains no customer data and reserves no time slot.
  if (created) {
    const probe = await api("/repos/" + repo + "/issues", "POST", {
      title: "SAM private intake connectivity check",
      body: "Automated initial deployment check. No customer information or appointment is attached. This issue is closed immediately after verifying private storage access.",
    });
    if (!probe.ok || !Number.isSafeInteger(probe.data?.number) || probe.data.number < 1) fail("intake_write_check_failed");
    const closed = await api("/repos/" + repo + "/issues/" + probe.data.number, "PATCH", { state: "closed" });
    if (!closed.ok || closed.data?.state !== "closed") fail("intake_write_check_cleanup_failed");
  }
  return { skipped: false, created, private: true, recordsReadable: true, writesVerified: created };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await provisionIntake();
    console.log("[sam.intake.setup]", JSON.stringify(result));
  } catch (error) {
    console.error("[sam.intake.setup]", diagnosticCode(error));
    process.exitCode = 1;
  }
}
