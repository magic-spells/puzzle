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

// The protocol carries CSS as well as JS (D164): a playground with no build
// pipeline has nowhere else to get a component's styles from.
const plainStyled = globalThis.__pzlCompile(
  `<puzzle-view>\n  <p>styled</p>\n</puzzle-view>\n\n<style>\n  p { color: red; }\n</style>`,
  { filename: 'app/components/Plain.pzl' }
);
assert.deepEqual(plainStyled.errors, [], `styled component failed: ${JSON.stringify(plainStyled.errors)}`);
assert.match(plainStyled.css, /p \{ color: red; \}/, 'unscoped css was not returned');
assert.doesNotMatch(plainStyled.css, /@scope/, 'unscoped css was wrapped in @scope');

const scopedStyled = globalThis.__pzlCompile(
  `<puzzle-view>\n  <p>styled</p>\n</puzzle-view>\n\n<style scoped>\n  p { color: blue; }\n</style>`,
  { filename: 'app/components/Scoped.pzl' }
);
assert.deepEqual(scopedStyled.errors, [], `scoped component failed: ${JSON.stringify(scopedStyled.errors)}`);
const scopeMatch = /@scope \(\[data-(pzl-[0-9a-f]{8})\]\)/.exec(scopedStyled.css);
assert.ok(scopeMatch, `scoped css is not an @scope rule: ${JSON.stringify(scopedStyled.css)}`);
assert.match(scopedStyled.css, /p \{ color: blue; \}/, 'scoped css lost its body');
assert.ok(
  scopedStyled.js.includes(`data-${scopeMatch[1]}`),
  'the @scope id does not match the data-<scopeId> stamp codegen emitted'
);

assert.equal(compiled.css, '', 'a file with no <style> returned css');

// Input guards (D164). Both must answer with a diagnostic and leave the
// instance alive: a Go fatal error here would be permanent, because a dead
// instance throws "Go program has already exited" on every later call.
const stillAlive = (what) => {
  const after = globalThis.__pzlCompile(homeSource, options);
  assert.deepEqual(after.errors, [], `the instance did not survive ${what}`);
};

const deepSource = `<puzzle-view>\n${'<div>'.repeat(20_000)}x${'</div>'.repeat(20_000)}\n</puzzle-view>`;
const deep = globalThis.__pzlCompile(deepSource, { filename: 'app/views/Deep.pzl' });
assert.equal(deep.errors.length, 1, `over-deep source returned ${JSON.stringify(deep.errors)}`);
assert.match(deep.errors[0].message, /nesting exceeds playground limit/);
assert.ok(deep.errors[0].line > 0, 'the nesting diagnostic is not positioned');
stillAlive('an over-deep source');

const longSource = `<puzzle-view>\n  <p>${'x'.repeat(600 * 1024)}</p>\n</puzzle-view>`;
const long = globalThis.__pzlCompile(longSource, { filename: 'app/views/Long.pzl' });
assert.equal(long.errors.length, 1, `over-long source returned ${JSON.stringify(long.errors)}`);
assert.match(long.errors[0].message, /source exceeds playground limit/);
stillAlive('an over-long source');

// A hostile options object: the getter throws while Go is reading it. recover()
// turns that into a diagnostic rather than an exited program.
const hostileOptions = {
  get filename() {
    throw new Error('hostile getter');
  }
};
const hostile = globalThis.__pzlCompile(homeSource, hostileOptions);
assert.equal(hostile.errors.length, 1, `a throwing options getter returned ${JSON.stringify(hostile.errors)}`);
stillAlive('a throwing options getter');

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
