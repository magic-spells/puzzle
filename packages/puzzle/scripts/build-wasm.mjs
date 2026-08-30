#!/usr/bin/env node

import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const compilerDir = join(packageRoot, 'compiler');
const artifactDir = join(packageRoot, 'artifacts', 'wasm');
const wasmPath = join(artifactDir, 'pzl.wasm');
const wasmExecPath = join(artifactDir, 'wasm_exec.js');
const wasmEnv = {
  ...process.env,
  GOOS: 'js',
  GOARCH: 'wasm',
  GOCACHE: join(packageRoot, '.gocache')
};
const rawLimit = 6 * 1024 * 1024;

function runGo(args, { capture = false } = {}) {
  const result = spawnSync('go', args, {
    cwd: compilerDir,
    env: wasmEnv,
    encoding: capture ? 'utf8' : undefined,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (capture && result.stderr) process.stderr.write(result.stderr);
    throw new Error(`go ${args.join(' ')} exited with status ${result.status}`);
  }
  return capture ? result.stdout.trim() : '';
}

function formatSize(bytes) {
  return `${bytes.toLocaleString('en-US')} bytes (${(bytes / 1024 / 1024).toFixed(2)} MiB)`;
}

const deps = runGo(['list', '-deps', './cmd/pzl-wasm'], { capture: true })
  .split(/\r?\n/)
  .filter(Boolean);
const esbuildDeps = deps.filter(
  (dependency) => dependency === 'github.com/evanw/esbuild' || dependency.startsWith('github.com/evanw/esbuild/')
);
if (esbuildDeps.length > 0) {
  throw new Error(`WASM dependency graph includes forbidden esbuild packages:\n${esbuildDeps.join('\n')}`);
}
console.log(`Dependency graph: esbuild absent (${deps.length} packages checked)`);

mkdirSync(artifactDir, { recursive: true });
runGo(['build', '-trimpath', '-ldflags=-s -w', '-o', wasmPath, './cmd/pzl-wasm']);

const goRoot = runGo(['env', 'GOROOT'], { capture: true });
const wasmExecCandidates = [
  join(goRoot, 'lib', 'wasm', 'wasm_exec.js'),
  join(goRoot, 'misc', 'wasm', 'wasm_exec.js')
];
const sourceWasmExec = wasmExecCandidates.find(existsSync);
if (!sourceWasmExec) {
  throw new Error(`wasm_exec.js was not found under ${goRoot}/lib/wasm or ${goRoot}/misc/wasm`);
}
if (existsSync(wasmExecPath)) chmodSync(wasmExecPath, 0o644);
copyFileSync(sourceWasmExec, wasmExecPath);
chmodSync(wasmExecPath, 0o644);

const rawSize = statSync(wasmPath).size;
const gzipSize = gzipSync(readFileSync(wasmPath), { level: 9 }).length;
console.log(`WASM raw:  ${formatSize(rawSize)}`);
console.log(`WASM gzip: ${formatSize(gzipSize)}`);
console.log(`Runtime:   ${sourceWasmExec}`);

if (rawSize > rawLimit) {
  throw new Error(`WASM raw size ${formatSize(rawSize)} exceeds the ${formatSize(rawLimit)} limit`);
}
