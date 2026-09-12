const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export const DEFAULT_INTAKE_REPO = "joshtitan88-collab/company-ai-architect-intake";
export const PRODUCTION_PROJECT_ID = "prj_C22GLMaAGoNt1XPEdvbKbjqV4Lm8";

export function isProductionProject(env = process.env) {
  return env.VERCEL_ENV === "production" && env.VERCEL_PROJECT_ID === PRODUCTION_PROJECT_ID;
}

export function intakeRepo(env = process.env) {
  const configured = String(env.INTAKE_REPO || "").trim();
  // Only this production project gets the dedicated default. Preview and local
  // deployments require their own explicit setting and cannot inherit live data.
  const repo = configured || (isProductionProject(env) ? DEFAULT_INTAKE_REPO : "");
  return REPO_PATTERN.test(repo) ? repo : "";
}

export async function verifyPrivateIntake(token) {
  const repo = intakeRepo();
  if (!token || !repo) return { ok: false, error: "intake_not_configured" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}`, {
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!response.ok) return { ok: false, error: "intake_unavailable" };
    const metadata = await response.json();
    if (metadata.private !== true) return { ok: false, error: "intake_must_be_private" };
    return { ok: true, repo };
  } catch {
    return { ok: false, error: "intake_unavailable" };
  } finally {
    clearTimeout(timeout);
  }
}
