#!/usr/bin/env node
// Asserts the npm tarball for @magic-spells/puzzle ships ONLY the runtime, its
// public TypeScript declarations, and the CLI bin shim (package.json "files":
// client-runtime, types, puzzle-env.d.ts, bin/puzzle.js). Also asserts the
// per-platform optionalDependencies are declared and version-pinned to the root.
//
// This check inspects a REAL tarball, not a report about one. It runs `npm pack`
// into a temp dir (which fires the real prepack/postpack hooks), then reads
// `package/package.json` and the entry list back OUT of the .tgz. That matters:
// the pins only exist because prepack injects them, so validating anything other
// than the bytes npm actually produced would pass in exactly the case worth
// catching — a publish that skipped the hooks (`npm publish --ignore-scripts`, a
// republished tarball, a prepack that failed) and therefore ships a manifest with
// no platform binary at all.
//
// Allowed packed paths:
//   - package.json          (npm always includes it)
//   - README.md             (npm always includes the README)
//   - LICENSE / LICENSE.*   (npm always includes license files; correct to ship)
//   - CHANGELOG.md          (declared in "files" — npm does NOT force-include it;
//                            it ships so an installed copy carries the upgrade
//                            table for the breaking 0.x minors, offline)
//   - client-runtime/**     (the actual runtime — the point of the package)
//   - types/**              (the public .d.ts surface, D54)
//   - puzzle-env.d.ts       (the *.pzl ambient-module shim, D54)
//   - bin/puzzle.js         (the CLI shim that spawns the platform binary)
//
// Anything else (compiler/, constellation/, tests/, fixtures, config) is a packaging
// leak: fail loudly with the offending paths so it never reaches npm. The check is
// two-sided — REQUIRED (below) also asserts the public entry points are present, so
// a future "files" edit that DROPS the declarations fails just as loudly.
//
// The manifest is checked at three points in time, because they fail differently:
//   - the WORKING-TREE package.json before packing (pins here desync
//     package-lock.json against unpublished versions and break `npm ci`),
//   - the TARBALL package.json (pins must be there, exact, and nothing else),
//   - the WORKING-TREE package.json again after packing, plus the COMMITTED
//     manifest at HEAD (a postpack that did not run leaves the pins behind).

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLATFORM_PACKAGES } from './inject-platform-pins.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(repoRoot, 'package.json');

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
	'@magic-spells/puzzle-win32-x64',
];

function isAllowed(p) {
	if (p === 'package.json') return true;
	if (p === 'README.md') return true;
	// npm force-includes license files regardless of the "files" field.
	if (/^licen[sc]e(\.[^/]+)?$/i.test(p)) return true;
	// Declared in "files" — see the header note. Not force-included by npm.
	if (p === 'CHANGELOG.md') return true;
	// Go sources live beside the runtime (formatter builtins are embedded into
	// the compiler via go:embed) but must never ship to npm.
	if (p.endsWith('.go')) return false;
	if (p.startsWith('client-runtime/')) return true;
	if (p.startsWith('types/')) return true;
	if (p === 'puzzle-env.d.ts') return true;
	if (p === 'bin/puzzle.js') return true;
	return false;
}

function fail(headline, problems, hint) {
	console.error(`verify-pack: FAIL — ${headline}`);
	for (const m of problems) console.error(`  - ${m}`);
	if (hint) console.error(`\n${hint}`);
	process.exit(1);
}

function readManifest(path, label) {
	try {
		return JSON.parse(readFileSync(path, 'utf8'));
	} catch (err) {
		fail(`could not read the ${label} package.json`, [`${path}: ${err.message}`]);
	}
}

// The temp dir holds the produced tarball. Clean it up on EVERY exit path —
// `process.exit()` skips finally blocks, but 'exit' listeners still run.
let packDir = null;
process.on('exit', () => {
	if (!packDir) return;
	try {
		rmSync(packDir, { recursive: true, force: true });
	} catch {
		/* best effort — a stray temp dir must never mask the real result */
	}
});

// --- 1. The working-tree manifest must be pin-free BEFORE packing ------------
// Checked first because it gives a far better error than the tarball check would:
// pins committed here desync package-lock.json against versions that do not exist
// on the registry yet, which breaks `npm ci` for everyone.
const repoPkgBefore = readManifest(manifestPath, 'repo');
if (repoPkgBefore.optionalDependencies) {
	fail(
		'the repo package.json declares optionalDependencies:',
		Object.keys(repoPkgBefore.optionalDependencies).map(
			(dep) => `${dep}: ${repoPkgBefore.optionalDependencies[dep]}`
		),
		'Platform pins must exist ONLY inside the tarball — they are injected by\n' +
			'prepack (scripts/inject-platform-pins.mjs). Run\n' +
			'`node scripts/inject-platform-pins.mjs restore` to clear them; an aborted\n' +
			'pack (failed prepublishOnly, Ctrl-C) leaves them behind because npm skips\n' +
			'postpack when the pack step fails.'
	);
}
const version = repoPkgBefore.version;
if (!version) fail('the repo package.json has no "version" field', []);

// --- 2. Pack for real -------------------------------------------------------
packDir = mkdtempSync(join(tmpdir(), 'puzzle-pack-'));

let raw;
try {
	// prepack/postpack log to stderr specifically so this stdout stays parseable.
	raw = execFileSync('npm', ['pack', '--json', '--pack-destination', packDir], {
		cwd: repoRoot,
		encoding: 'utf8',
	});
} catch (err) {
	fail('`npm pack` failed — the package cannot be built at all', [err.message]);
}

let report;
try {
	report = JSON.parse(raw);
} catch (err) {
	fail('could not parse `npm pack --json` output', [
		err.message,
		'anything written to STDOUT by a prepack/postpack hook corrupts this payload',
	]);
}

const entry = Array.isArray(report) ? report[0] : report;
const tarball = entry?.filename ? join(packDir, entry.filename) : null;
if (!tarball || !existsSync(tarball)) {
	fail('`npm pack` reported no tarball on disk', [
		`expected a .tgz in ${packDir}, got ${entry?.filename ?? '(no filename)'}`,
	]);
}
console.log(`verify-pack: packed ${entry.filename} (${(entry.size / 1024).toFixed(1)} KB)`);

function fromTarball(args, what) {
	try {
		return execFileSync('tar', args, {
			cwd: packDir,
			encoding: 'utf8',
			maxBuffer: 64 * 1024 * 1024,
		});
	} catch (err) {
		fail(`could not read ${what} from the packed tarball`, [`${tarball}: ${err.message}`]);
	}
}

// --- 3. The TARBALL manifest must carry exactly the platform pins -----------
const tarPkg = (() => {
	const text = fromTarball(['-xOzf', tarball, 'package/package.json'], 'package/package.json');
	try {
		return JSON.parse(text);
	} catch (err) {
		fail('the packed package.json is not valid JSON', [err.message]);
	}
})();

{
	const problems = [];
	if (tarPkg.version !== version) {
		problems.push(
			`packed version is "${tarPkg.version}", repo version is "${version}" — the tarball is stale`
		);
	}
	const pins = tarPkg.optionalDependencies;
	if (!pins || Object.keys(pins).length === 0) {
		problems.push(
			'the packed package.json declares NO optionalDependencies — prepack did not run ' +
				'(--ignore-scripts? a republished tarball?), so an install would get no platform binary'
		);
	} else {
		for (const dep of PLATFORM_DEPS) {
			if (!(dep in pins)) {
				problems.push(`missing optionalDependency in the tarball: ${dep}`);
			} else if (pins[dep] !== tarPkg.version) {
				problems.push(
					`optionalDependency ${dep} is "${pins[dep]}", expected packed version "${tarPkg.version}"`
				);
			}
		}
		for (const dep of Object.keys(pins).filter((d) => !PLATFORM_DEPS.includes(d))) {
			problems.push(`unexpected optionalDependency in the tarball: ${dep}`);
		}
	}
	// Compare CONTENTS, not counts: the two lists are maintained by hand in
	// different files and in different orders, so a rename on one side that keeps
	// the count is exactly the drift this guard exists to catch.
	const injected = [...PLATFORM_PACKAGES].sort();
	const expected = [...PLATFORM_DEPS].sort();
	const onlyInjected = injected.filter((name) => !expected.includes(name));
	const onlyExpected = expected.filter((name) => !injected.includes(name));
	if (onlyInjected.length > 0 || onlyExpected.length > 0) {
		problems.push(
			'inject-platform-pins PLATFORM_PACKAGES and verify-pack PLATFORM_DEPS disagree' +
				(onlyInjected.length ? `; only in inject-platform-pins: ${onlyInjected.join(', ')}` : '') +
				(onlyExpected.length ? `; only in verify-pack: ${onlyExpected.join(', ')}` : '')
		);
	}
	if (problems.length > 0) {
		fail(
			'the PACKED platform optionalDependencies are wrong:',
			problems,
			'Each @magic-spells/puzzle-<platform>-<arch> must be injected at pack time and\n' +
				'pinned EXACTLY to the packed package version.'
		);
	}
	console.log(
		`verify-pack: OK — packed manifest pins ${PLATFORM_DEPS.length} platform packages at ${tarPkg.version}`
	);
}

// --- 4. The packed FILE LIST must match the allowlist -----------------------
const listing = fromTarball(['-tzf', tarball], 'the entry list');
const files = [];
for (const line of listing.split('\n')) {
	const name = line.trim();
	if (!name) continue;
	if (name.endsWith('/')) continue; // directory entries carry no content
	// Everything npm packs lives under package/. A stray prefix is itself a
	// packaging problem, so keep it verbatim and let isAllowed() reject it.
	files.push(name.startsWith('package/') ? name.slice('package/'.length) : name);
}

if (files.length === 0) {
	fail('the tarball contains no files', [tarball]);
}

const offenders = files.filter((p) => !isAllowed(p));
if (offenders.length > 0) {
	fail(
		'the tarball contains unexpected files:',
		offenders,
		'Only package.json, README.md, LICENSE*, CHANGELOG.md, client-runtime/**, ' +
			'types/**,\npuzzle-env.d.ts, and bin/puzzle.js may ship.'
	);
}

const missing = REQUIRED.filter((p) => !files.includes(p));
if (missing.length > 0) {
	fail(
		'the tarball is missing required public entry points:',
		missing,
		'The published package must include the runtime entry and the public .d.ts\n' +
			'surface — check the "files" field in package.json.'
	);
}

// --- 5. postpack must have put the working tree back ------------------------
// The regression test for an abort window: if postpack did not run, the pins are
// still sitting in the tracked manifest right now.
const repoPkgAfter = readManifest(manifestPath, 'repo');
if (repoPkgAfter.optionalDependencies) {
	fail(
		'the repo package.json still carries platform pins AFTER packing:',
		Object.keys(repoPkgAfter.optionalDependencies),
		'postpack (scripts/inject-platform-pins.mjs restore) did not restore the\n' +
			'manifest. Run it by hand, then find out why the hook was skipped.'
	);
}

// --- 6. …and the COMMITTED manifest must be clean too -----------------------
// Fail-soft: no git (a tarball-only checkout, a CI image without git) downgrades
// this to a warning rather than blocking a release.
// The `./` prefix is load-bearing: a bare `HEAD:package.json` is resolved from
// the REPO ROOT regardless of cwd, which since the monorepo move reads the
// private root shell manifest — a file that never carries pins, so the check
// would pass vacuously. `HEAD:./package.json` is cwd-relative, and cwd is this
// package.
{
	let committed = null;
	try {
		committed = JSON.parse(
			execFileSync('git', ['show', 'HEAD:./package.json'], {
				cwd: repoRoot,
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'pipe'],
			})
		);
	} catch (err) {
		console.error(
			`verify-pack: WARN — could not read HEAD:./package.json via git (${err.message.trim().split('\n')[0]}); ` +
				'skipping the committed-manifest check.'
		);
	}
	if (committed?.optionalDependencies) {
		fail(
			'the COMMITTED package.json (HEAD) declares optionalDependencies:',
			Object.keys(committed.optionalDependencies),
			'A pinned manifest was committed — that desyncs package-lock.json against\n' +
				'unpublished versions and breaks `npm ci`. Restore it and amend the commit.'
		);
	} else if (committed) {
		console.log('verify-pack: OK — committed manifest (HEAD) declares no optionalDependencies');
	}
}

console.log(
	`verify-pack: OK — ${files.length} files in the real tarball, all within the runtime allowlist:`
);
for (const p of files.sort()) console.log(`  ${p}`);
