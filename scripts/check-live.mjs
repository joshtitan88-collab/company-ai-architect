/** Public, read-only launch check. Never follows login redirects or creates intake. */
const base = 'https://www.companyaiarchitect.com';
let failed = false;
async function check(path, method, verify) {
  try {
    const response = await fetch(base + path, { method, redirect: 'manual', signal: AbortSignal.timeout(20000) });
    if (response.status !== 200) throw new Error(response.status >= 300 && response.status < 400
      ? `HTTP ${response.status}: public route redirects; inspect deployment protection before launch`
      : `HTTP ${response.status}`);
    const detail = verify ? await verify(response) : 'reachable';
    console.log(`PASS ${method} ${path}: ${detail}`);
  } catch (error) {
    failed = true;
    console.error(`FAIL ${method} ${path}: ${error.message}`);
  }
}
await check('/', 'GET', async response => {
  const html = await response.text();
  if (!html.includes('data-avatar="sam-realistic"') || !html.includes('Your next great hire')) throw new Error('SAM homepage marker missing');
  return 'SAM homepage visible without authentication';
});
if (!failed) {
  await check('/release.json', 'GET', async response => {
    const release = await response.json();
    if (!release.commit || (process.env.SAM_EXPECTED_COMMIT && release.commit !== process.env.SAM_EXPECTED_COMMIT)) throw new Error('unexpected production commit');
    return release.commit;
  });
  await check('/api/slots', 'GET', async response => {
    const result = await response.json();
    if (!Array.isArray(result.slots) || !['request', 'calendar'].includes(result.bookingMode)) throw new Error('invalid availability response');
    return `${result.slots.length} times; ${result.bookingMode === 'request' ? 'team confirmation required' : 'calendar availability connected'}`;
  });
  await check('/assets/desk-idle.mp4', 'HEAD');
  await check('/api/stt', 'HEAD');
}
if (failed) process.exitCode = 1;
else console.log('Public launch checks passed. Real microphone, avatar motion, submissions, email and telephone still need acceptance tests.');
