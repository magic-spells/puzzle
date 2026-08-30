#!/usr/bin/env node

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const artifactDir = join(packageRoot, 'artifacts', 'wasm');
const wasmPath = join(artifactDir, 'pzl.wasm');
const wasmExecPath = join(artifactDir, 'wasm_exec.js');

for (const artifact of [wasmPath, wasmExecPath]) {
  if (!existsSync(artifact)) {
    throw new Error(`missing ${artifact}; run node scripts/build-wasm.mjs first`);
  }
}

await import(pathToFileURL(wasmExecPath).href);
assert.equal(typeof globalThis.Go, 'function', 'wasm_exec.js did not register Go');

const go = new globalThis.Go();
const bytes = readFileSync(wasmPath);
const { instance } = await WebAssembly.instantiate(bytes, go.importObject);
const run = go.run(instance);
run.catch((error) => {
  console.error('Go WASM runtime exited unexpectedly:', error);
  process.exitCode = 1;
});

assert.equal(typeof globalThis.__pzlCompile, 'function', '__pzlCompile was not registered');
assert.equal(typeof globalThis.__pzlVersion, 'function', '__pzlVersion was not registered');
assert.match(globalThis.__pzlVersion(), /^\d+\.\d+\.\d+/, 'compiler version is not semver-like');

const homePath = join(packageRoot, 'examples', 'todos', 'app', 'views', 'Home.pzl');
const homeSource = readFileSync(homePath, 'utf8');
const options = { filename: 'examples/todos/app/views/Home.pzl', ts: false };
const compiled = globalThis.__pzlCompile(homeSource, options);
assert.deepEqual(compiled.errors, [], `todos Home.pzl failed: ${JSON.stringify(compiled.errors)}`);
assert.match(compiled.js, /\.prototype\.render = function\s*\(/, 'compiled module has no render function');

const brokenSource = `<puzzle-view>\n  {#if ready}\n    <div>broken</span>\n  {/if}\n</puzzle-view>`;
const broken = globalThis.__pzlCompile(brokenSource, { filename: 'app/views/Broken.pzl' });
assert.ok(broken.errors.length > 0, 'broken source unexpectedly compiled');
assert.equal(typeof broken.errors[0].message, 'string');
assert.ok(broken.errors[0].line > 0, `error line is not positioned: ${JSON.stringify(broken.errors[0])}`);
assert.ok(broken.errors[0].col > 0, `error column is not positioned: ${JSON.stringify(broken.errors[0])}`);

const assetSource = `<puzzle-view>\n  {#svg 'icons/heart.svg'}\n</puzzle-view>`;
const asset = globalThis.__pzlCompile(assetSource, { filename: 'app/views/Asset.pzl' });
assert.equal(asset.errors.length, 1, `asset source returned unexpected diagnostics: ${JSON.stringify(asset.errors)}`);
assert.match(asset.errors[0].message, /not available in the playground/);
assert.equal(asset.errors[0].line, 2, `asset error is not positioned at its source line: ${JSON.stringify(asset.errors[0])}`);

const timings = [];
for (let i = 0; i < 50; i += 1) {
  const started = performance.now();
  const result = globalThis.__pzlCompile(homeSource, options);
  timings.push(performance.now() - started);
  assert.equal(result.errors.length, 0, `timed compile ${i + 1} failed`);
}
const sorted = [...timings].sort((a, b) => a - b);
const total = timings.reduce((sum, value) => sum + value, 0);
const mean = total / timings.length;
const percentile = (value) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)];

console.log(`Smoke passed: todos Home.pzl compiled; broken source reported ${broken.errors[0].line}:${broken.errors[0].col}`);
console.log(
  `50 compiles: ${total.toFixed(2)} ms total, ${mean.toFixed(2)} ms mean, ` +
    `${percentile(0.5).toFixed(2)} ms p50, ${percentile(0.95).toFixed(2)} ms p95`
);
