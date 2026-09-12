import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const { MeshoptEncoder, MeshoptDecoder } = require('meshoptimizer');

// Upstream explicitly dedicates this MPFB avatar to CC0. Pin source and verify
// its digest so a later upstream asset change cannot silently alter Sam.
export const AVATAR_SOURCE = 'https://raw.githubusercontent.com/met4citizen/TalkingHead/eed58d198076a7e1e825f804802921c4d3804d46/avatars/mpfb.glb';
const SOURCE_SHA256 = '63c645a2a863b9972e9a9c2ed576a1de4c390b8475508e1473e69c87a3ee299c';
const componentBytes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const componentCount = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

function parseGlb(bytes) {
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2) throw new Error('Expected GLB v2');
  const jsonLength = bytes.readUInt32LE(12);
  const document = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  const binStart = 20 + jsonLength;
  if (bytes.readUInt32LE(binStart + 4) !== 0x004e4942) throw new Error('Missing GLB binary chunk');
  return { document, binary: bytes.subarray(binStart + 8, binStart + 8 + bytes.readUInt32LE(binStart)) };
}

function packGlb(document, binary) {
  const json = Buffer.from(JSON.stringify(document));
  const jsonPadded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20);
  json.copy(jsonPadded);
  const binPadded = Buffer.alloc(Math.ceil(binary.length / 4) * 4);
  binary.copy(binPadded);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + jsonPadded.length + binPadded.length, 8);
  header.writeUInt32LE(jsonPadded.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binPadded.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonPadded, binHeader, binPadded]);
}

/** Preserve every accessor, bone, mesh, morph name and geometry byte exactly.
 * Only textures are resized; meshopt compression is lossless and verified by
 * decoding EVERY compressed view before writing the distributable GLB.
 */
export async function prepareAvatar(output = 'dist/assets/sam.glb') {
  let source;
  if (process.env.SAM_AVATAR_SOURCE) {
    source = await readFile(process.env.SAM_AVATAR_SOURCE);
  } else {
    const cache = resolve('.cache/sam-original.glb');
    try { source = await readFile(cache); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const response = await fetch(AVATAR_SOURCE);
      if (!response.ok) throw new Error(`Avatar download failed: ${response.status}`);
      source = Buffer.from(await response.arrayBuffer());
      if (createHash('sha256').update(source).digest('hex') !== SOURCE_SHA256) throw new Error('Avatar source SHA-256 mismatch');
      await mkdir(dirname(cache), { recursive: true });
      await writeFile(cache, source);
    }
  }
  if (createHash('sha256').update(source).digest('hex') !== SOURCE_SHA256) throw new Error('Avatar source SHA-256 mismatch');
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
  const { document, binary } = parseGlb(source);
  const originalViews = structuredClone(document.bufferViews);
  const imageViews = new Map(document.images.map(image => [image.bufferView, image]));
  const viewLayouts = new Map();
  for (const accessor of document.accessors) {
    const stride = componentBytes[accessor.componentType] * componentCount[accessor.type];
    if (accessor.bufferView !== undefined) {
      viewLayouts.set(accessor.bufferView, { stride, mode: accessor.type === 'SCALAR' && accessor.componentType !== 5126 ? 'INDICES' : 'ATTRIBUTES' });
    }
    if (accessor.sparse) {
      viewLayouts.set(accessor.sparse.indices.bufferView, { stride: componentBytes[accessor.sparse.indices.componentType], mode: 'INDICES' });
      viewLayouts.set(accessor.sparse.values.bufferView, { stride, mode: 'ATTRIBUTES' });
    }
  }
  const chunks = [];
  let length = 0;
  let fallbackLength = 0;
  let compressedViews = 0;
  const append = bytes => {
    const offset = length;
    chunks.push(Buffer.from(bytes));
    length += bytes.length;
    const padding = (4 - length % 4) % 4;
    if (padding) { chunks.push(Buffer.alloc(padding)); length += padding; }
    return offset;
  };
  for (let index = 0; index < originalViews.length; index++) {
    const original = originalViews[index];
    const view = document.bufferViews[index];
    const bytes = binary.subarray(original.byteOffset || 0, (original.byteOffset || 0) + original.byteLength);
    const image = imageViews.get(index);
    if (image) {
      // PNG preserves alpha and needs no additional browser texture extension.
      const optimized = await sharp(bytes).resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer();
      view.buffer = 0;
      view.byteOffset = append(optimized);
      view.byteLength = optimized.length;
      continue;
    }
    const layout = viewLayouts.get(index);
    const stride = original.byteStride || layout?.stride;
    if (!layout || bytes.length % stride || (layout.mode === 'ATTRIBUTES' && stride % 4) || (layout.mode === 'INDICES' && ![2, 4].includes(stride))) {
      view.buffer = 0;
      view.byteOffset = append(bytes);
      continue;
    }
    const count = bytes.length / stride;
    const encoded = MeshoptEncoder.encodeGltfBuffer(bytes, count, stride, layout.mode);
    const decoded = new Uint8Array(bytes.length);
    MeshoptDecoder.decodeGltfBuffer(decoded, count, stride, encoded, layout.mode);
    if (!Buffer.from(decoded).equals(bytes)) throw new Error(`Lossless avatar verification failed for view ${index}`);
    if (encoded.length >= bytes.length) {
      view.buffer = 0;
      view.byteOffset = append(bytes);
      continue;
    }
    view.buffer = 1;
    view.byteOffset = fallbackLength;
    fallbackLength += Math.ceil(bytes.length / 4) * 4;
    view.extensions = {
      ...view.extensions,
      EXT_meshopt_compression: { buffer: 0, byteOffset: append(encoded), byteLength: encoded.length, byteStride: stride, count, mode: layout.mode },
    };
    compressedViews++;
  }
  document.extensionsUsed = [...new Set([...(document.extensionsUsed || []), 'EXT_meshopt_compression'])];
  document.extensionsRequired = [...new Set([...(document.extensionsRequired || []), 'EXT_meshopt_compression'])];
  document.buffers = [
    { byteLength: length },
    { byteLength: fallbackLength, extensions: { EXT_meshopt_compression: { fallback: true } } },
  ];
  document.asset.generator = 'Company AI Architect lossless avatar preparation';
  document.asset.copyright = 'MPFB avatar by met4citizen, CC0; source https://github.com/met4citizen/TalkingHead';
  const result = packGlb(document, Buffer.concat(chunks));
  await mkdir(dirname(resolve(output)), { recursive: true });
  await writeFile(output, result);
  console.log(`Sam avatar: ${(source.length / 1048576).toFixed(2)} → ${(result.length / 1048576).toFixed(2)} MiB; ${compressedViews} buffer views verified lossless.`);
  return { path: resolve(output), bytes: result.length, compressedViews };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareAvatar(process.argv[2]);
}
