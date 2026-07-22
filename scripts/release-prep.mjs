#!/usr/bin/env node
// Local dry-run of the release pipeline (`npm run release:prep`).
//
// This is the ONLY release pipeline — releases are published by hand from this
// machine; there is no publish workflow in CI. Steps, fail-fast:
//
//   1. Version consistency — package.json vs compiler/internal/version/version.go
//      and each npm/puzzle-*/package.json (all must agree).
//   2. Pack allowlist — delegate to scripts/verify-pack.mjs (the tarball must ship
//      only the runtime + declarations + bin shim).
//   3. Cross-compile the four per-platform CLI binaries into npm/<pkg>/bin/puzzle,
//      version-stamped via -ldflags.
//   4. Copy LICENSE.txt (MIT) into each platform package dir.
//   5. Host smoke test — run the binary built for THIS platform with --version and
//      assert it reports the expected version.
//   6. Summary — print the exact `npm publish` commands in the REQUIRED order
//      (platform packages first, root LAST so its optionalDependencies resolve).
//
// Node builtins only. Any failure exits non-zero with a clear message.

import { execFileSync } from 'node:child_process';
import { readFileSync, copyFileSync, chmodSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// GOOS, GOARCH, platform package dir name — the release build matrix.
const MATRIX = [
	{ goos: 'darwin', goarch: 'arm64', pkg: 'puzzle-darwin-arm64' },
	{ goos: 'darwin', goarch: 'amd64', pkg: 'puzzle-darwin-x64' },
	{ goos: 'linux', goarch: 'amd64', pkg: 'puzzle-linux-x64' },
	{ goos: 'linux', goarch: 'arm64', pkg: 'puzzle-linux-arm64' },
];

// process.platform-process.arch → platform package dir (same table as bin/puzzle.js).
const HOST_PACKAGES = {
	'darwin-arm64': 'puzzle-darwin-arm64',
	'darwin-x64': 'puzzle-darwin-x64',
	'linux-x64': 'puzzle-linux-x64',
	'linux-arm64': 'puzzle-linux-arm64',
};

function fail(msg) {
	console.error(`\nrelease-prep: FAIL — ${msg}`);
	process.exit(1);
}

function readJSON(relPath) {
	return JSON.parse(readFileSync(join(repoRoot, relPath), 'utf8'));
}

// --- 1. Version consistency check ------------------------------------------
const version = readJSON('package.json').version;
if (!version) fail('package.json has no "version" field');
console.log(`release-prep: root package version is ${version}`);

// version.go — parse `var Version = "..."`.
const versionGo = readFileSync(join(repoRoot, 'compiler/internal/version/version.go'), 'utf8');
const goMatch = versionGo.match(/^var Version = "(.*)"$/m);
if (!goMatch) fail('could not find `var Version = "..."` in compiler/internal/version/version.go');
if (goMatch[1] !== version) {
	fail(`version.go Version is "${goMatch[1]}", expected "${version}"`);
}
console.log(`  OK  version.go Version = ${goMatch[1]}`);

// Each platform manifest must pin the same version.
for (const { pkg } of MATRIX) {
	const manifest = readJSON(`npm/${pkg}/package.json`);
	if (manifest.version !== version) {
		fail(`npm/${pkg}/package.json version is "${manifest.version}", expected "${version}"`);
	}
	console.log(`  OK  npm/${pkg}/package.json version = ${manifest.version}`);
}

// --- 2. Pack allowlist check -----------------------------------------------
console.log('\nrelease-prep: verifying pack contents (scripts/verify-pack.mjs)...');
try {
	execFileSync('node', ['scripts/verify-pack.mjs'], { cwd: repoRoot, stdio: 'inherit' });
} catch {
	fail('verify-pack.mjs reported packaging problems (see output above)');
}

// --- 3. Cross-compile the four CLI binaries --------------------------------
console.log('\nrelease-prep: cross-compiling CLI binaries...');
const ldflags = `-s -w -X github.com/magic-spells/puzzle/compiler/internal/version.Version=${version}`;
for (const { goos, goarch, pkg } of MATRIX) {
	const outPath = join('npm', pkg, 'bin', 'puzzle');
	try {
		execFileSync(
			'go',
			[
				'build',
				'-trimpath',
				'-ldflags',
				ldflags,
				'-o',
				outPath,
				'./compiler/cmd/puzzle',
			],
			{
				cwd: repoRoot,
				stdio: ['ignore', 'ignore', 'inherit'],
				env: { ...process.env, CGO_ENABLED: '0', GOOS: goos, GOARCH: goarch },
			}
		);
	} catch {
		fail(`go build failed for ${goos}/${goarch} (${pkg})`);
	}
	chmodSync(join(repoRoot, outPath), 0o755);
	const sizeMB = statSync(join(repoRoot, outPath)).size / (1024 * 1024);
	console.log(`  OK  ${outPath} (${goos}/${goarch}) — ${sizeMB.toFixed(2)} MB`);
}

// --- 4. Copy LICENSE.txt into each platform package ------------------------
console.log('\nrelease-prep: copying LICENSE.txt into platform packages...');
for (const { pkg } of MATRIX) {
	const dest = join('npm', pkg, 'LICENSE.txt');
	try {
		copyFileSync(join(repoRoot, 'LICENSE.txt'), join(repoRoot, dest));
	} catch (err) {
		fail(`could not copy LICENSE.txt into npm/${pkg}: ${err.message}`);
	}
	console.log(`  OK  ${dest}`);
}

// --- 5. Host smoke test ----------------------------------------------------
console.log('\nrelease-prep: smoke-testing the host binary...');
const hostKey = `${process.platform}-${process.arch}`;
const hostPkg = HOST_PACKAGES[hostKey];
if (!hostPkg) {
	console.log(`  SKIP  host platform ${hostKey} is not one of the four targets — cannot smoke-test`);
} else {
	const hostBin = join(repoRoot, 'npm', hostPkg, 'bin', 'puzzle');
	let out;
	try {
		out = execFileSync(hostBin, ['--version'], { encoding: 'utf8' });
	} catch (err) {
		fail(`${hostBin} --version failed: ${err.message}`);
	}
	if (!out.includes(version)) {
		fail(`${hostPkg} binary --version output does not contain "${version}":\n${out}`);
	}
	console.log(`  OK  ${hostPkg} --version → ${out.trim()}`);
}

// --- 6. Summary ------------------------------------------------------------
console.log('\n' + '='.repeat(70));
console.log(`release-prep: OK — all four CLI binaries built and staged for ${version}`);
console.log('='.repeat(70));
console.log('\nPublish IN THIS ORDER (root LAST — its optionalDependencies must');
console.log('already exist on the registry before the root package resolves):\n');
for (const { pkg } of MATRIX) {
	console.log(`  npm publish ./npm/${pkg} --access public`);
}
console.log('  npm publish --access public   # root package — MUST go last\n');
console.log('Reminder: run the full suites first if you have not already:');
console.log('  npm test');
console.log('  cd compiler && go test ./...\n');
