#!/usr/bin/env node
// Post-publish check: assert the REGISTRY METADATA for the just-published version
// is installable (`npm run verify:published`).
//
// This is deliberately not a tarball check — scripts/verify-pack.mjs already proves
// the .tgz is correct, and in the 0.3.0 failure the tarball WAS correct. npm does
// not resolve dependencies from the tarball; it resolves them from the packument
// (the registry's per-version manifest). Those two disagreed: `npm publish` on a
// directory re-reads package.json from disk after postpack has stripped the
// injected pins, so 0.3.0 published a pin-perfect tarball behind a packument with
// no optionalDependencies at all. Every install got the shim and no binary.
//
// So this asks the registry the only question that matters: if someone runs
// `npm install @magic-spells/puzzle@<version>` right now, do they get a CLI?
//
//   1. The root version exists on the registry.
//   2. Its packument declares every platform optionalDependency, each pinned
//      EXACTLY to the root version.
//   3. Each of those platform versions actually exists on the registry (a pin
//      to a missing version installs nothing — optional deps fail silently).
//   4. The root packument still declares the `puzzle` bin.
//   5. A REAL install into a temp dir produces a `puzzle` that runs and reports
//      the expected version.
//   6. @magic-spells/puzzle-pieces exists on the registry at the SAME exact
//      version (the D32 major.minor lock).
//   7. The installed CLI scaffolds an app and resolves `add piece` to that exact
//      pieces version, with PUZZLE_PIECES_REGISTRY deleted from the child env.
//
// Steps 6-7 exist because the version lock has a silent failure mode of its own.
// When no pieces release matches the CLI's major.minor, `add piece` does not
// fail — it prints a note and falls back to the newest older line, which is right
// for a user on a fresh install and wrong for us: it means the release shipped
// half-published. Nothing else in the pipeline looks at the pieces registry at
// all, so a framework release with no matching pieces release passed every check
// and degraded every user's first `add piece`. The env var matters as much as the
// assertion: PUZZLE_PIECES_REGISTRY is exported in the maintainer's shell and
// points at the in-repo registry, which would make this check pass by reading
// local files it is supposed to be proving are on npm.
//
// Steps 1-4 are metadata checks: fast, and they name the exact defect when one
// fires. Step 5 is the one that actually answers the question — the others infer
// installability from field shapes, and inference is what let 0.3.0 through. It
// is deliberately not optional: no other check in this repo proves a working
// binary comes out of a registry install. `scripts/e2e-pack.mjs` proves the
// RUNTIME resolves from a packed tarball, and it does so while the platform deps
// are unresolvable by design (they are unpublished at that point) — so it can
// never catch a missing binary.
//
// Node builtins only. Any failure exits non-zero with a clear message.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PLATFORM_PACKAGES } from './inject-platform-pins.mjs';
import { piecesFallbackNotice } from './release-checks.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = 'https://registry.npmjs.org';

function fail(msg, hint) {
	console.error(`\nverify-published: FAIL — ${msg}`);
	if (hint) console.error(`\n${hint}`);
	process.exit(1);
}

async function packument(name) {
	const res = await fetch(`${REGISTRY}/${name.replace('/', '%2F')}`, {
		headers: { accept: 'application/json' },
	});
	if (res.status === 404) return null;
	if (!res.ok) fail(`registry returned ${res.status} for ${name}`);
	return res.json();
}

// Defaults to the version in package.json — the one just published. An explicit
// argument lets you audit any release (`npm run verify:published -- 0.3.0`),
// which is also how this checker's own negative case is exercised.
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const name = pkg.name;
const version = process.argv[2] || pkg.version;
if (!name || !version) fail('package.json is missing "name" or "version"');

console.log(`verify-published: checking ${name}@${version} on ${REGISTRY}\n`);

// --- 1. The root version exists --------------------------------------------
const root = await packument(name);
if (!root) fail(`${name} is not on the registry at all`);
const manifest = root.versions?.[version];
if (!manifest) {
	fail(
		`${name}@${version} is not on the registry`,
		`Published versions: ${Object.keys(root.versions ?? {}).join(', ') || '(none)'}`
	);
}
console.log(`  OK  ${name}@${version} is published`);

// --- 2. The packument declares the platform pins, version-matched -----------
// The failure this exists for: correct tarball, pin-less packument.
const pins = manifest.optionalDependencies;
if (!pins || Object.keys(pins).length === 0) {
	fail(
		`${name}@${version} declares NO optionalDependencies in its registry metadata`,
		'The tarball may still be correct — that is exactly the 0.3.0 bug. `npm publish`\n' +
			'on a DIRECTORY re-reads package.json after postpack removed the injected pins,\n' +
			'so the registry got the pin-free manifest. Publish the packed .tgz instead:\n' +
			'  npm pack && npm publish ./<name>-<version>.tgz --access public\n' +
			`This version cannot be repaired in place — bump past ${version}, republish, and\n` +
			`deprecate ${version}.`
	);
}
const problems = [];
for (const dep of PLATFORM_PACKAGES) {
	if (!(dep in pins)) problems.push(`missing pin: ${dep}`);
	else if (pins[dep] !== version) problems.push(`${dep} is pinned "${pins[dep]}", expected "${version}"`);
}
for (const dep of Object.keys(pins).filter((d) => !PLATFORM_PACKAGES.includes(d))) {
	problems.push(`unexpected optionalDependency: ${dep}`);
}
if (problems.length > 0) {
	fail(`${name}@${version} registry metadata has wrong platform pins:\n  - ${problems.join('\n  - ')}`);
}
console.log(`  OK  registry metadata pins ${PLATFORM_PACKAGES.length} platform packages at ${version}`);

// --- 3. Every pinned platform version actually exists -----------------------
// An optionalDependency that 404s is skipped SILENTLY, so a pin to a version that
// was never published looks identical to no pin at all from the installer's side.
for (const dep of PLATFORM_PACKAGES) {
	const doc = await packument(dep);
	if (!doc) fail(`${dep} is not on the registry, but ${name}@${version} pins it`);
	if (!doc.versions?.[version]) {
		fail(
			`${dep}@${version} is not on the registry, but ${name}@${version} pins it`,
			'Publish the platform packages BEFORE the root package — a pin to a\n' +
				'missing version fails silently and installs no binary.'
		);
	}
	console.log(`  OK  ${dep}@${version} exists`);
}

// --- 4. The bin shim is still declared --------------------------------------
if (!manifest.bin?.puzzle) {
	fail(`${name}@${version} declares no "puzzle" bin — nothing would be linked onto PATH`);
}
console.log(`  OK  bin.puzzle = ${manifest.bin.puzzle}`);

// --- 5. A real install must produce a runnable CLI --------------------------
// Everything above reasons about metadata. This step stops reasoning and runs
// the binary, because the 0.3.0 failure looked healthy from every angle except
// this one. Installed OUTSIDE the repo so no ancestor node_modules, workspace
// root, or in-repo alias can satisfy the import for us.
console.log('\nverify-published: installing into a temp dir to prove the CLI runs...');
let sandbox = null;
process.on('exit', () => {
	if (!sandbox) return;
	try {
		rmSync(sandbox, { recursive: true, force: true });
	} catch {
		/* best effort — a stray temp dir must never mask the real result */
	}
});
sandbox = mkdtempSync(join(tmpdir(), 'puzzle-published-'));
writeFileSync(
	join(sandbox, 'package.json'),
	JSON.stringify({ name: 'puzzle-publish-check', version: '0.0.0', private: true }, null, 2) + '\n'
);

try {
	execFileSync('npm', ['install', `${name}@${version}`, '--no-audit', '--no-fund', '--silent'], {
		cwd: sandbox,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
	});
} catch (err) {
	fail(
		`\`npm install ${name}@${version}\` failed in a clean directory:\n${err.stderr || err.message}`
	);
}

const cliPath = join(sandbox, 'node_modules', '.bin', 'puzzle');
if (!existsSync(cliPath)) {
	fail(
		`the install produced no ${cliPath}`,
		'The package declares a "puzzle" bin, so npm should have linked it.'
	);
}

let cliOut;
try {
	cliOut = execFileSync(cliPath, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} catch (err) {
	fail(
		`the installed \`puzzle\` binary does not run:\n${(err.stderr || err.stdout || err.message).trim()}`,
		'If this says "no prebuilt CLI binary available for this platform", the platform\n' +
			'optionalDependency did not install: the pin is missing from the registry metadata,\n' +
			'names a version that does not exist, or the publish skipped it. This version\n' +
			`cannot be repaired in place — republish as ${version} + 1 and deprecate this one.`
	);
}
if (!cliOut.includes(version)) {
	fail(
		`the installed \`puzzle --version\` reported "${cliOut.trim()}", expected it to contain "${version}"`,
		'A version-skewed binary means the platform pin resolved to the wrong release.'
	);
}
console.log(`  OK  installed puzzle --version → ${cliOut.trim()}`);

// --- 6. The version-locked pieces release must exist ------------------------
// `puzzle add piece` resolves @magic-spells/puzzle-pieces to the CLI's own
// major.minor (D32 amendment). A framework release published without its pieces
// release leaves zero-config `add piece` silently reaching for an older line.
const PIECES_PACKAGE = '@magic-spells/puzzle-pieces';
const piecesDoc = await packument(PIECES_PACKAGE);
if (!piecesDoc) fail(`${PIECES_PACKAGE} is not on the registry at all`);
if (!piecesDoc.versions?.[version]) {
	fail(
		`${PIECES_PACKAGE}@${version} is not on the registry`,
		'The pieces registry is version-locked to the framework: `puzzle add piece`\n' +
			`resolves ${PIECES_PACKAGE} to the CLI's major.minor. Without ${version} on the\n` +
			'registry, every zero-config `add piece` falls back to an older line (or hard-fails\n' +
			'when none exists). Publish it from ../puzzle-pieces, then re-run this check.\n' +
			`Published: ${Object.keys(piecesDoc.versions ?? {}).join(', ') || '(none)'}`
	);
}
console.log(`  OK  ${PIECES_PACKAGE}@${version} exists`);

// --- 7. `add piece` must actually RESOLVE that exact version -----------------
// Step 6 proves the release exists; this proves the CLI reaches it. The two are
// not the same claim — a resolution bug, a wrong default registry baked into the
// binary, or a packument the CLI cannot parse all leave step 6 green.
//
// PUZZLE_PIECES_REGISTRY is DELETED from the child env, not merely overridden:
// it is exported in the maintainer's shell profile and points at the in-repo
// registry directory, which would satisfy this check from local files and prove
// nothing about npm.
console.log('\nverify-published: resolving `add piece` against the npm transport...');
const childEnv = { ...process.env };
delete childEnv.PUZZLE_PIECES_REGISTRY;

const appName = 'pieces-check';
const appDir = join(sandbox, appName);
try {
	execFileSync(cliPath, ['init', appName, '--dir', sandbox], {
		cwd: sandbox,
		env: childEnv,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
	});
} catch (err) {
	fail(`\`puzzle init\` failed with the published CLI:\n${(err.stderr || err.stdout || err.message).trim()}`);
}

// A small, dependency-free piece: the assertion is about RESOLUTION, so the
// cheapest unit that exercises the whole fetch/unpack/copy path is the right one.
// spawnSync, not execFileSync: the fallback notice goes to STDERR (so it cannot
// land mid-summary), and execFileSync hands back only stdout on success.
const PIECE = 'badge';
const add = spawnSync(cliPath, ['add', 'piece', PIECE, '--dir', appDir], {
	cwd: appDir,
	env: childEnv,
	encoding: 'utf8',
	stdio: ['ignore', 'pipe', 'pipe'],
});
const addOut = `${add.stdout ?? ''}\n${add.stderr ?? ''}`;
if (add.error || add.status !== 0) {
	fail(
		`\`puzzle add piece ${PIECE}\` failed against the npm transport:\n${addOut.trim()}`,
		'With no PUZZLE_PIECES_REGISTRY set the CLI must resolve\n' +
			`${PIECES_PACKAGE} from npm at ${version}.`
	);
}

const notice = piecesFallbackNotice(addOut);
if (notice) {
	fail(
		`\`add piece\` fell back to an older pieces line:\n  ${notice}`,
		`Publish ${PIECES_PACKAGE}@${version} — the fallback is correct behaviour for a\n` +
			'user whose CLI is ahead of the registry, and a half-published release for us.'
	);
}

const lockPath = join(appDir, 'pieces.lock');
if (!existsSync(lockPath)) {
	fail(`\`add piece ${PIECE}\` wrote no pieces.lock in ${appDir}`);
}
let lock;
try {
	lock = JSON.parse(readFileSync(lockPath, 'utf8'));
} catch (err) {
	fail(`could not parse ${lockPath}: ${err.message}`);
}
// The lock records the FULLY RESOLVED source, so it is the authoritative answer
// to "which pieces release did this actually install" — a notice on stderr can be
// missed, a resolved spec cannot.
const expectedSource = `npm:${PIECES_PACKAGE}@${version}`;
if (lock.registry !== expectedSource) {
	fail(
		`pieces.lock records registry "${lock.registry}", expected "${expectedSource}"`,
		'`add piece` resolved a different release than the one this framework version\n' +
			'is locked to. If it names an older version the pieces release is missing; if it\n' +
			'names a path or URL, PUZZLE_PIECES_REGISTRY leaked into the child environment.'
	);
}
console.log(`  OK  add piece ${PIECE} resolved ${lock.registry}`);

console.log(
	`\nverify-published: OK — \`npm install ${name}@${version}\` installs a CLI that runs,\n` +
		`and \`puzzle add piece\` resolves ${PIECES_PACKAGE}@${version} from npm.`
);
