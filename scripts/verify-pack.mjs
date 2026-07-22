#!/usr/bin/env node
// Asserts the npm tarball for @magic-spells/puzzle ships ONLY the runtime, its
// public TypeScript declarations, and the CLI bin shim (package.json "files":
// client-runtime, types, puzzle-env.d.ts, bin/puzzle.js). Also asserts the four
// per-platform optionalDependencies are declared and version-pinned to the root.
//
// Allowed packed paths:
//   - package.json          (npm always includes it)
//   - README.md             (npm always includes the README)
//   - LICENSE / LICENSE.*   (npm always includes license files; correct to ship)
//   - client-runtime/**     (the actual runtime — the point of the package)
//   - types/**              (the public .d.ts surface, D54)
//   - puzzle-env.d.ts       (the *.pzl ambient-module shim, D54)
//   - bin/puzzle.js         (the CLI shim that spawns the platform binary)
//
// Anything else (compiler/, constellation/, tests/, fixtures, config) is a packaging
// leak: fail loudly with the offending paths so it never reaches npm. The check is
// two-sided — REQUIRED (below) also asserts the public entry points are present, so
// a future "files" edit that DROPS the declarations fails just as loudly.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// The public entry points that MUST ship — a missing one is a packaging regression
// just as much as an unexpected extra file.
const REQUIRED = [
	'client-runtime/index.js',
	'types/index.d.ts',
	'puzzle-env.d.ts',
	'bin/puzzle.js',
];

// The per-platform CLI binaries ship as optionalDependencies, each pinned EXACTLY
// to the root version so `npm install` never resolves a skewed binary.
const PLATFORM_DEPS = [
	'@magic-spells/puzzle-darwin-arm64',
	'@magic-spells/puzzle-darwin-x64',
	'@magic-spells/puzzle-linux-x64',
	'@magic-spells/puzzle-linux-arm64',
];

function isAllowed(p) {
	if (p === 'package.json') return true;
	if (p === 'README.md') return true;
	// npm force-includes license files regardless of the "files" field.
	if (/^licen[sc]e(\.[^/]+)?$/i.test(p)) return true;
	// Go sources live beside the runtime (formatter builtins are embedded into
	// the compiler via go:embed) but must never ship to npm.
	if (p.endsWith('.go')) return false;
	if (p.startsWith('client-runtime/')) return true;
	if (p.startsWith('types/')) return true;
	if (p === 'puzzle-env.d.ts') return true;
	if (p === 'bin/puzzle.js') return true;
	return false;
}

// --- optionalDependencies pinning check (independent of the packed file list) ---
{
	const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
	const optional = pkg.optionalDependencies ?? {};
	const problems = [];
	for (const dep of PLATFORM_DEPS) {
		if (!(dep in optional)) {
			problems.push(`missing optionalDependency: ${dep}`);
		} else if (optional[dep] !== pkg.version) {
			problems.push(
				`optionalDependency ${dep} is "${optional[dep]}", expected root version "${pkg.version}"`
			);
		}
	}
	if (problems.length > 0) {
		console.error('verify-pack: FAIL — platform optionalDependencies are wrong:');
		for (const m of problems) console.error(`  - ${m}`);
		console.error(
			'\nEach @magic-spells/puzzle-<platform>-<arch> must be declared and pinned ' +
				'EXACTLY to the root package version.'
		);
		process.exit(1);
	}
}

const raw = execFileSync('npm', ['pack', '--dry-run', '--json'], {
	encoding: 'utf8',
});

let report;
try {
	report = JSON.parse(raw);
} catch (err) {
	console.error('verify-pack: could not parse `npm pack --json` output.');
	console.error(err.message);
	process.exit(1);
}

const entry = Array.isArray(report) ? report[0] : report;
const files = (entry?.files ?? []).map((f) => f.path);

if (files.length === 0) {
	console.error('verify-pack: no files reported by `npm pack` — aborting.');
	process.exit(1);
}

const offenders = files.filter((p) => !isAllowed(p));

if (offenders.length > 0) {
	console.error('verify-pack: FAIL — tarball contains unexpected files:');
	for (const p of offenders) console.error(`  - ${p}`);
	console.error(
		'\nOnly package.json, README.md, LICENSE*, client-runtime/**, types/**, and ' +
			'puzzle-env.d.ts may ship.'
	);
	process.exit(1);
}

const missing = REQUIRED.filter((p) => !files.includes(p));

if (missing.length > 0) {
	console.error('verify-pack: FAIL — tarball is missing required public entry points:');
	for (const p of missing) console.error(`  - ${p}`);
	console.error(
		'\nThe published package must include the runtime entry and the public .d.ts ' +
			'surface — check the "files" field in package.json.'
	);
	process.exit(1);
}

console.log(`verify-pack: OK — ${files.length} files, all within the runtime allowlist:`);
for (const p of files.sort()) console.log(`  ${p}`);
