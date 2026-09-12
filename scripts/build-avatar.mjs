import { build } from 'esbuild';
import { cp, mkdir, readdir, rm, writeFile, readFile } from 'node:fs/promises';
import { prepareAvatar } from './prepare-avatar.mjs';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/assets/3d', { recursive: true });
for (const f of await readdir('.')) {
  if (/\.(html|css|js|xml)$/.test(f) || ['robots.txt', 'availability.json', 'sam-intents.json', 'THIRD-PARTY-NOTICES.txt'].includes(f)) {
    await cp(f, 'dist/' + f);
  }
}
await cp('assets', 'dist/assets', { recursive: true, filter: path => !path.endsWith('.md') });
await cp('fonts', 'dist/fonts', { recursive: true });
await prepareAvatar('dist/assets/3d/sam.glb');
await build({ entryPoints: ['src/sam-3d.js'], bundle: true, minify: true, format: 'esm', target: 'es2022', outfile: 'dist/sam-3d.bundle.js', legalComments: 'linked',
  plugins: [{ name: 'talkinghead-meshopt', setup(builder) {
    builder.onLoad({ filter: /talkinghead\.mjs$/ }, async args => {
      const source = await readFile(args.path, 'utf8');
      const needle = 'const loader = new GLTFLoader();';
      if (!source.includes(needle)) throw new Error('Pinned TalkingHead loader changed');
      return { contents: "import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';\n" + source.replace(needle, needle + ' loader.setMeshoptDecoder(MeshoptDecoder);'), loader: 'js' };
    });
  } }]
});
await cp('dist/sam-3d.bundle.js', 'sam-3d.bundle.js');
await build({ entryPoints: ['src/sam-video.js'], bundle: true, minify: true, format: 'iife', target: 'es2022', outfile: 'dist/sam-video.bundle.js', legalComments: 'linked' });
await cp('dist/sam-video.bundle.js', 'sam-video.bundle.js');
await mkdir('assets/3d', { recursive: true });
await cp('dist/assets/3d/sam.glb', 'assets/3d/sam.glb');
await writeFile('dist/release.json', JSON.stringify({ version: 'sam-realistic-video-2026-09-12', commit: process.env.VERCEL_GIT_COMMIT_SHA || 'local' }));
console.log('Built SAM video integration and public website.');
