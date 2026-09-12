import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';

const endpoints = (await readdir('api')).filter(f => /\.(?:js|mjs)$/.test(f) && !f.startsWith('_'));
assert.equal(endpoints.length, 9, 'Internal helpers must not become API endpoints');
for (const file of endpoints) {
  const api = await import('../api/' + file);
  assert.equal(typeof api.default, 'function', file + ' must export a request handler');
}
for (const file of ['index.html', 'receptionist.html', 'sam-3d.bundle.js', 'assets/3d/sam.glb', 'release.json']) {
  assert.ok((await stat('dist/' + file)).size > 0, file + ' is missing or empty');
}
const publicFiles = await readdir('dist');
assert.ok(!publicFiles.includes('sam-system-prompt.txt'), 'Private prompt must not be published');
assert.ok(!publicFiles.includes('api'), 'API source must not be copied to static output');
const entry = await readFile('dist/index.html', 'utf8');
assert.ok(entry.includes('sam-3d.bundle.js'), 'Homepage must load the real 3D renderer');
console.log('PASS production assets, private-source exclusion and 9 valid API endpoints');
