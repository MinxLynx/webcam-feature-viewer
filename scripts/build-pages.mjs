import { readFile, writeFile, mkdir, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const source = join(root, 'public');
const output = join(root, 'dist');
if (!output.startsWith(root + sep) || output === root) throw new Error('Unsafe output directory');
const worker = await readFile(join(source, 'sw.js'), 'utf8');
const assetList = worker.match(/const ASSETS = \[([\s\S]*?)\];/)?.[1];
if (!assetList) throw new Error('Missing service worker asset list');
const assets = [...assetList.matchAll(/'([^']+)'/g)].map(match => match[1]);
const files = [...new Set(assets.filter(path => path !== './').map(path => path.replace(/^\.\//, '')))];
files.push('sw.js');
if (files.some(path => !/^[a-z0-9./-]+$/i.test(path) || path.split('/').includes('..'))) throw new Error('Unsafe asset path');
const bodies = await Promise.all(files.map(async path => {
  const body = await readFile(join(source, path));
  if (!(await stat(join(source, path))).isFile()) throw new Error(`Not a file: ${path}`);
  return [path, body];
}));
const buildId = (process.env.GITHUB_SHA || createHash('sha256').update(Buffer.concat(bodies.map(([, body]) => body))).digest('hex')).slice(0, 16);
await rm(output, { recursive: true, force: true });
for (const [path, body] of bodies) {
  const target = join(output, path);
  await mkdir(resolve(target, '..'), { recursive: true });
  await writeFile(target, path === 'sw.js' ? body.toString('utf8').replace('__BUILD_ID__', buildId) : body);
}
console.log(`GitHub Pages bundle: ${files.length} files, build ${buildId}`);
