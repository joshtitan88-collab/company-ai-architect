import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';

const endpoints = (await readdir('api')).filter(f => /\.(?:js|mjs)$/.test(f) && !f.startsWith('_'));
assert.deepEqual(endpoints.sort(), ['lemonslice-session.js', 'book.js', 'deposit.js', 'message-nlu.js', 'message.js', 'phone-tools.js', 'public-availability.js', 'sam-chat.js', 'slots.js', 'stt.js', 'tavus-session.js', 'tts.js'].sort(), 'Only intended request handlers may become API endpoints');
for (const file of endpoints) {
  const api = await import('../api/' + file);
  assert.equal(typeof api.default, 'function', file + ' must export a request handler');
}
for (const file of ['index.html', 'receptionist.html', 'sam-video.bundle.js', 'sam-3d.bundle.js', 'assets/3d/sam.glb', 'release.json']) {
  assert.ok((await stat('dist/' + file)).size > 0, file + ' is missing or empty');
}
const publicFiles = await readdir('dist');
assert.ok(!publicFiles.includes('sam-system-prompt.txt'), 'Private prompt must not be published');
assert.ok(!publicFiles.includes('api'), 'API source must not be copied to static output');
for (const name of ['index.html', 'receptionist.html']) {
  const entry = await readFile('dist/' + name, 'utf8');
  assert.ok(entry.includes('data-avatar="sam-realistic"'), 'Keep the original Sam identity on both entry pages');
  assert.ok(entry.includes('sam-video.bundle.js'), 'Live video adapter must be available on both entry pages');
  assert.ok(entry.includes('id="samLiveVideo"'), 'One live media owner must exist');
  assert.ok(!entry.includes('sam-3d.bundle.js'), 'Do not replace Sam with the unrelated 3D character');
  for (const asset of ['desk.jpg', 'desk-idle.mp4', 'sam-listen.mp4', 'sam-process.mp4', 'sam-imagine-speak.mp4']) {
    assert.ok(entry.includes(asset), 'Original Sam state asset missing: ' + asset);
    assert.ok((await stat('dist/assets/' + asset)).size > 0, 'Missing original Sam media');
  }
}
console.log('PASS production assets, private-source exclusion and 12 valid API endpoints');
