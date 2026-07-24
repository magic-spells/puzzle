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
import { PLATFORM_PACKAGES, injectPins } from './inject-platform-pins.mjs';

// The public entry points that MUST ship — a missing one is a packaging regression
// just as much as an unexpected extra file.
const REQUIRED = [
	'client-runtime/index.js',
	'types/index.d.ts',
	'puzzle-env.d.ts',
	'bin/puzzle.js',
];

// The per-platform CLI binaries ship as optionalDependencies, each pinned EXACTLY
// to the root version so `npm install` never resolves a skewed binary. The pins
// are injected at pack time (scripts/inject-platform-pins.mjs via prepack) so the
// repo manifest stays lockfile-clean between a version bump and the publish.
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
// Validates the manifest AS PUBLISHED: the repo manifest must carry NO pins (they
// would desync package-lock.json against unpublished versions and break npm ci),
// and the prepack injection must produce all four, pinned exactly to the root
// version.
{
	const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
	const problems = [];
	if (pkg.optionalDependencies) {
		problems.push(
			'repo package.json declares optionalDependencies — platform pins must only ' +
				'be injected at pack time (scripts/inject-platform-pins.mjs)'
		);
	}
	const injected = injectPins(pkg).optionalDependencies;
	for (const dep of PLATFORM_DEPS) {
		if (!(dep in injected)) {
			problems.push(`missing optionalDependency after injection: ${dep}`);
		} else if (injected[dep] !== pkg.version) {
			problems.push(
				`optionalDependency ${dep} is "${injected[dep]}", expected root version "${pkg.version}"`
			);
		}
	}
	const strays = Object.keys(injected).filter((dep) => !PLATFORM_DEPS.includes(dep));
	for (const dep of strays) {
		problems.push(`unexpected injected optionalDependency: ${dep}`);
	}
	if (PLATFORM_PACKAGES.length !== PLATFORM_DEPS.length) {
		problems.push('inject-platform-pins PLATFORM_PACKAGES and verify-pack PLATFORM_DEPS disagree');
	}
	if (problems.length > 0) {
		console.error('verify-pack: FAIL — platform optionalDependencies are wrong:');
		for (const m of problems) console.error(`  - ${m}`);
		console.error(
			'\nEach @magic-spells/puzzle-<platform>-<arch> must be injected at pack time and ' +
				'pinned EXACTLY to the root package version.'
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
