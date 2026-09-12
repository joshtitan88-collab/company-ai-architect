/** Run on an authenticated workstation. Never logs token values or provider error bodies.
 * node --env-file=.env.setup.local scripts/configure-production.mjs [--apply] [--create-intake] [--redeploy]
 * Default is read-only preflight. --apply uploads only allowlisted, supplied values.
 */
const TEAM = 'team_q6bj9t3HZmuNWgadw3g6p1dq';
const PROJECT = 'prj_C22GLMaAGoNt1XPEdvbKbjqV4Lm8';
const SOURCE = 'joshtitan88-collab/company-ai-architect';
const apply = process.argv.includes('--apply');
const repo = process.env.INTAKE_REPO || '';
const ghToken = process.env.GITHUB_TOKEN;
const vercelToken = process.env.VERCEL_TOKEN;
const optional = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN', 'GOOGLE_CALENDAR_ID', 'RESEND_API_KEY', 'SAM_PHONE_WEBHOOK_SECRET'];
async function api(host, path, token, method = 'GET', body) {
  const r = await fetch(host + path, {
    method, signal: AbortSignal.timeout(20000),
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json', 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!r.ok) { const error = new Error(`${host} ${method}: HTTP ${r.status}`); error.status = r.status; throw error; }
  return r.json();
}
const gh = (path, method, body) => api('https://api.github.com', path, ghToken, method, body);
const vc = (path, method, body) => api('https://api.vercel.com', path + (path.includes('?') ? '&' : '?') + 'teamId=' + TEAM, vercelToken, method, body);
try {
  if (!ghToken || !vercelToken || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('Supply GITHUB_TOKEN, VERCEL_TOKEN and INTAKE_REPO in .env.setup.local. Do not put credentials in chat or command arguments.');
  if (repo.toLowerCase() === SOURCE.toLowerCase()) throw new Error('The public website repository cannot receive customer intake. Choose a dedicated private repository.');
  const calendarKeys = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'];
  if (calendarKeys.some(k => process.env[k]) && !calendarKeys.every(k => process.env[k])) throw new Error('Supply the full Google Calendar OAuth credential set, or omit it entirely.');
  if (process.env.SAM_PHONE_WEBHOOK_SECRET && process.env.SAM_PHONE_WEBHOOK_SECRET.length < 32) throw new Error('The telephone webhook secret must have at least 32 characters.');
  const project = await vc('/v9/projects/' + PROJECT);
  if (project.id !== PROJECT || project.accountId !== TEAM || project.name !== 'company-ai-architect') throw new Error('Project identity mismatch; stopped.');
  console.log('Verified target Vercel project and team.');
  let metadata;
  try { metadata = await gh('/repos/' + repo); }
  catch (error) {
    if (error.status !== 404 || !apply || !process.argv.includes('--create-intake')) throw error;
    const user = await gh('/user');
    const [owner, name] = repo.split('/');
    if (owner !== user.login) throw new Error('Automatic repository creation is limited to the authenticated GitHub user. Create organization repositories separately.');
    metadata = await gh('/user/repos', 'POST', { name, private: true, auto_init: true, has_issues: true, description: 'Private customer intake for Company AI Architect' });
    console.log('Created private intake repository.');
  }
  if (metadata.private !== true || metadata.archived || metadata.has_issues !== true) throw new Error('Intake must be a non-archived private repository with Issues enabled.');
  await gh('/repos/' + repo + '/issues?state=open&per_page=1');
  console.log('Verified private intake and issue read access. A real submission is still needed to verify writes.');
  const values = { INTAKE_REPO: repo, GITHUB_TOKEN: ghToken };
  for (const key of optional) if (process.env[key]) values[key] = process.env[key];
  console.log((apply ? 'Applying' : 'Preflight only; would apply') + ' production keys: ' + Object.keys(values).join(', '));
  if (!apply) process.exit(0);
  for (const [key, value] of Object.entries(values)) {
    await vc('/v10/projects/' + PROJECT + '/env?upsert=true', 'POST', { key, value, type: 'encrypted', target: ['production'] });
    console.log('Configured ' + key + '.');
  }
  if (!process.argv.includes('--redeploy')) { console.log('Configuration saved. Redeploy to activate it.'); process.exit(0); }
  const production = project.targets?.production;
  if (!production?.id) throw new Error('Could not identify the current production deployment. Redeploy from the Vercel dashboard.');
  const deployment = await vc('/v13/deployments', 'POST', { name: project.name, project: PROJECT, deploymentId: production.id, target: 'production', withLatestCommit: false });
  console.log('Production rebuild requested: ' + deployment.id);
  const deadline = Date.now() + 10 * 60000;
  let ready = false;
  while (Date.now() < deadline) {
    const state = await vc('/v13/deployments/' + deployment.id);
    if (state.readyState === 'READY') { ready = true; break; }
    if (['ERROR', 'CANCELED'].includes(state.readyState)) throw new Error('Production rebuild did not finish successfully: ' + state.readyState);
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  if (!ready) throw new Error('Deployment is still pending. Check Vercel before reporting success.');
  const r = await fetch('https://www.companyaiarchitect.com/api/slots', { signal: AbortSignal.timeout(30000) });
  const data = await r.json();
  if (!r.ok || !Array.isArray(data.slots)) throw new Error('Live availability still fails. Inspect runtime logs; do not bypass reservation checks.');
  console.log('Live availability verified: ' + data.slots.length + ' openings. Booking writes, calendar invitations and telephone calls still require acceptance tests.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
