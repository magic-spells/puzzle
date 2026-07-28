#!/usr/bin/env node
// Local dry-run of the release pipeline (`npm run release:prep`).
//
// This is the ONLY release pipeline — releases are published by hand from this
// machine; there is no publish workflow in CI. Steps, fail-fast:
//
//   0. Clear stale platform pins — an aborted pack can leave the pack-time
//      optionalDependencies in the tracked manifest; restore before anything
//      reads it.
//   1. Version consistency — package.json vs compiler/internal/version/version.go,
//      client-runtime/devtools.js FRAMEWORK_VERSION and each
//      npm/puzzle-*/package.json (all must agree), plus the `@magic-spells/puzzle`
//      dependency ranges no version field carries: the two go:embed-ed scaffold
//      templates and examples/*/package.json.
//   2. Pack allowlist — delegate to scripts/verify-pack.mjs (the tarball must ship
//      only the runtime + declarations + bin shim).
//   3. Cross-compile the four per-platform CLI binaries into npm/<pkg>/bin/puzzle,
//      version-stamped via -ldflags.
//   4. Copy LICENSE.txt (MIT) into each platform package dir.
//   5. Host smoke test — run the binary built for THIS platform with --version and
//      assert it reports the expected version.
//   6. Pack the ROOT tarball for publishing, and assert the manifest INSIDE it
//      carries the four platform pins (D120 — the root package must be published
//      as this .tgz, never as a directory; see the note on step 7).
//   7. Summary — print the exact `npm publish` commands in the REQUIRED order
//      (platform packages first, root LAST so its optionalDependencies resolve).
//
// Node builtins only. Any failure exits non-zero with a clear message.

import { execFileSync } from 'node:child_process';
import { readFileSync, copyFileSync, chmodSync, statSync, readdirSync, existsSync } from 'node:fs';
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

// --- 0. Clear any stale pack-time platform pins ----------------------------
// `prepack` injects the four platform optionalDependencies into package.json and
// `postpack` removes them again — but npm does NOT run postpack when the pack step
// itself fails (a rejected prepublishOnly, Ctrl-C, a full disk). That leaves the
// worktree manifest pinned to versions that do not exist on the registry yet.
// Restoring FIRST means an aborted pack can never feed a stale pinned manifest into
// the next release. Idempotent: byte-for-byte a no-op on an already-clean manifest.
// Safe in every entry point — `npm publish` runs prepublishOnly BEFORE prepack, so
// this never races the injection it is undoing.
const hadStalePins = Boolean(readJSON('package.json').optionalDependencies);
try {
	execFileSync('node', ['scripts/inject-platform-pins.mjs', 'restore'], {
		cwd: repoRoot,
		stdio: ['ignore', 'ignore', hadStalePins ? 'inherit' : 'ignore'],
	});
} catch {
	fail('could not restore package.json (node scripts/inject-platform-pins.mjs restore)');
}
if (hadStalePins) {
	console.log(
		'release-prep: cleared stale platform pins left in package.json by an aborted pack\n'
	);
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

// The DevTools bridge reports a hardcoded framework version to the extension
// (D100) — the ESM bundle cannot import package.json, so it is a literal that
// ships in client-runtime/. A comment told the releaser to bump it and that was
// not enough: it sat at 0.3.0 through the 0.3.1 bump. Assert it instead.
const devtoolsJS = readFileSync(join(repoRoot, 'client-runtime/devtools.js'), 'utf8');
const dtMatch = devtoolsJS.match(/^const FRAMEWORK_VERSION = '(.*)';$/m);
if (!dtMatch) {
	fail("could not find `const FRAMEWORK_VERSION = '...'` in client-runtime/devtools.js");
}
if (dtMatch[1] !== version) {
	fail(
		`client-runtime/devtools.js FRAMEWORK_VERSION is "${dtMatch[1]}", expected "${version}" ` +
			'(it ships in the runtime and is reported to the DevTools extension)'
	);
}
console.log(`  OK  client-runtime/devtools.js FRAMEWORK_VERSION = ${dtMatch[1]}`);

// Each platform manifest must pin the same version.
for (const { pkg } of MATRIX) {
	const manifest = readJSON(`npm/${pkg}/package.json`);
	if (manifest.version !== version) {
		fail(`npm/${pkg}/package.json version is "${manifest.version}", expected "${version}"`);
	}
	console.log(`  OK  npm/${pkg}/package.json version = ${manifest.version}`);
}

// The `@magic-spells/puzzle` dependency RANGES no version field carries. The two
// scaffold manifests are go:embed-ed into the CLI binary, so a stale range ships
// a broken `puzzle init`: caret ranges do not cross a 0.x minor, so "^0.3.1"
// installs 0.3.x into an app scaffolded by a 0.4.0 binary. It cannot be fixed by
// republishing the JS — the four platform binaries have to be rebuilt. Same
// class of drift as FRAMEWORK_VERSION above, so it gets the same assert.
const SCAFFOLD_TEMPLATES = [
	'compiler/internal/scaffold/templates/default/package.json',
	'compiler/internal/scaffold/templates/todos/package.json',
];

// A range "resolves to" the release when its base version IS the release:
// "0.4.0", "^0.4.0", "~0.4.0" and "=0.4.0" all install what is being published;
// "^0.3.1" does not. Anything else (a tag, a URL, a compound range) is not the
// release convention and is reported so a human looks at it.
function puzzleRangeBase(range) {
	return typeof range === 'string' ? range.trim().replace(/^[\^~=v]+/, '') : '';
}

function puzzleDepRange(relPath) {
	const manifest = readJSON(relPath);
	return (manifest.dependencies ?? {})['@magic-spells/puzzle'];
}

for (const rel of SCAFFOLD_TEMPLATES) {
	const range = puzzleDepRange(rel);
	if (!range) {
		fail(`${rel} has no "@magic-spells/puzzle" entry in "dependencies" — a scaffolded app would not install the framework`);
	}
	if (puzzleRangeBase(range) !== version) {
		fail(
			`${rel} depends on @magic-spells/puzzle@"${range}", expected "^${version}"\n` +
				'  This manifest is go:embed-ed into the CLI binary: a stale range ships a broken\n' +
				'  `puzzle init` that no JS-only republish can fix (the binaries must be rebuilt).'
		);
	}
	console.log(`  OK  ${rel} → @magic-spells/puzzle@${range}`);
}

// The examples install against what is actually published, so sweep them too.
// They ship in no tarball, but a stale range is the same bump that was missed.
{
	const exampleManifests = readdirSync(join(repoRoot, 'examples'), { withFileTypes: true })
		.filter(
			(e) => e.isDirectory() && existsSync(join(repoRoot, 'examples', e.name, 'package.json'))
		)
		.map((e) => `examples/${e.name}/package.json`)
		.sort();
	const stale = exampleManifests
		.map((rel) => [rel, puzzleDepRange(rel)])
		.filter(([, range]) => range !== undefined && puzzleRangeBase(range) !== version)
		.map(([rel, range]) => `    ${rel} → "${range}"`);
	if (stale.length > 0) {
		fail(
			`${stale.length} example manifest(s) do not depend on @magic-spells/puzzle@^${version}:\n` +
				stale.join('\n')
		);
	}
	console.log(`  OK  ${exampleManifests.length} examples/*/package.json → @magic-spells/puzzle@^${version}`);
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

// --- 6. Pack the root tarball that will actually be published ----------------
// D120: `npm publish` on a DIRECTORY does not send the tarball's manifest to the
// registry. It re-reads package.json from disk AFTER packing
// (lib/commands/publish.js: pack() at ~L111, then getManifest() again at ~L124) —
// and by then postpack has already stripped the injected pins. The tarball ships
// correct while the registry metadata carries NO optionalDependencies, so every
// install resolves zero platform binaries. That is exactly how 0.3.0 shipped
// broken: a correct .tgz behind a pin-less packument.
//
// Publishing the FILE instead makes npm read the manifest out of the tarball, so
// the injected pins reach the registry. This step produces that file and proves
// its manifest is right, so the artifact named in the summary is the verified one.
console.log('\nrelease-prep: packing the root tarball for publishing...');
let rootTarball;
try {
	const packJSON = execFileSync('npm', ['pack', '--json', '--pack-destination', repoRoot], {
		cwd: repoRoot,
		encoding: 'utf8',
	});
	const packed = JSON.parse(packJSON);
	rootTarball = (Array.isArray(packed) ? packed[0] : packed)?.filename;
} catch (err) {
	fail(`could not pack the root package: ${err.message}`);
}
if (!rootTarball) fail('`npm pack` reported no tarball filename for the root package');

// Read the pins back out of the bytes that will be uploaded — not out of the
// worktree manifest, which postpack has already restored to its pin-free state.
{
	let packedManifest;
	try {
		packedManifest = JSON.parse(
			execFileSync('tar', ['-xOzf', rootTarball, 'package/package.json'], {
				cwd: repoRoot,
				encoding: 'utf8',
				maxBuffer: 64 * 1024 * 1024,
			})
		);
	} catch (err) {
		fail(`could not read package/package.json out of ${rootTarball}: ${err.message}`);
	}
	const pins = packedManifest.optionalDependencies ?? {};
	const missing = MATRIX.map(({ pkg }) => `@magic-spells/${pkg}`).filter(
		(dep) => pins[dep] !== version
	);
	if (missing.length > 0) {
		fail(
			`${rootTarball} does not pin the platform packages at ${version}: ${missing.join(', ')}\n` +
				'  prepack (scripts/inject-platform-pins.mjs inject) did not run or did not match.'
		);
	}
	console.log(`  OK  ${rootTarball} pins ${MATRIX.length} platform packages at ${version}`);
}

// --- 7. Summary ------------------------------------------------------------
console.log('\n' + '='.repeat(70));
console.log(`release-prep: OK — all four CLI binaries built and staged for ${version}`);
console.log('='.repeat(70));
console.log('\nPublish IN THIS ORDER (root LAST — its optionalDependencies must');
console.log('already exist on the registry before the root package resolves):\n');
for (const { pkg } of MATRIX) {
	console.log(`  npm publish ./npm/${pkg} --access public`);
}
console.log(`  npm publish ./${rootTarball} --access public   # root — MUST go last\n`);
console.log('Publish the root as THAT TARBALL, not as `npm publish` in this directory:');
console.log('a directory publish sends a manifest with NO platform pins (D120), which');
console.log('is how 0.3.0 shipped with no working CLI.\n');
console.log('Then confirm the registry actually got the pins:');
console.log('  npm run verify:published\n');
console.log('Reminder: run the full suites first if you have not already:');
console.log('  npm test');
console.log('  cd compiler && go test ./...\n');
