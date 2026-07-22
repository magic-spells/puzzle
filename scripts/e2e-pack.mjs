#!/usr/bin/env node
/**
 * Packed-tarball end-to-end smoke (`npm run test:e2e-pack`).
 *
 * Proves the shipped npm package works from a REAL install — not the in-repo
 * esbuild alias the examples lean on. The flow:
 *
 *   1. `npm pack` the repo into a temp dir OUTSIDE the repo tree.
 *   2. `puzzle init e2e-app --template todos --dir <tmp>` (the REPO compiler via
 *      `go run`, since the published binary doesn't exist pre-publish).
 *   3. Point the app's `@magic-spells/puzzle` dependency at the packed tarball
 *      (`file:…`) and `npm install`. Now the RUNTIME resolves from real
 *      node_modules. The four per-platform binary optionalDependencies are
 *      unpublished, so they fail to resolve — npm tolerates missing OPTIONAL
 *      deps, which is exactly what we assert by the install succeeding.
 *   4. Build the app with the REPO compiler. Because the app lives outside the
 *      repo, the compiler's findRuntime() ancestor walk finds no in-repo
 *      package, so findInstalledRuntime() wins and imports of
 *      '@magic-spells/puzzle' resolve to the installed tarball — the whole point.
 *   5. Assert dist/{app.js,index.html,styles.css} exist and app.js carries no
 *      'puzzle-env' ambient-shim strays.
 *
 * The temp dir is always removed (success or failure).
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP_NAME = 'e2e-app';

// A step runner that streams child output and keeps cwd explicit.
function run(cmd, args, cwd) {
	console.log(`\n$ (${cwd}) ${cmd} ${args.join(' ')}`);
	execFileSync(cmd, args, { cwd, stdio: 'inherit' });
}

function fail(msg) {
	console.error(`\n[e2e-pack] FAIL: ${msg}`);
	process.exitCode = 1;
}

// Temp workspace OUTSIDE the repo so the compiler's in-repo runtime alias never
// engages (findRuntime walks up from the app root; there is no puzzle package.json
// above /tmp, so the installed tarball wins via findInstalledRuntime).
const work = mkdtempSync(join(tmpdir(), 'puzzle-e2e-'));
console.log(`[e2e-pack] workspace: ${work}`);

try {
	// 1. Pack the repo. --json gives the produced filename deterministically.
	const packOut = execFileSync(
		'npm',
		['pack', '--pack-destination', work, '--json'],
		{ cwd: repoRoot, encoding: 'utf8' }
	);
	const tarball = join(work, JSON.parse(packOut)[0].filename);
	if (!existsSync(tarball)) throw new Error(`npm pack produced no tarball at ${tarball}`);
	console.log(`[e2e-pack] packed: ${tarball}`);

	// 2. Scaffold a todos app with the REPO compiler.
	run('go', ['run', './compiler/cmd/puzzle', 'init', APP_NAME, '--template', 'todos', '--dir', work], repoRoot);
	const appDir = join(work, APP_NAME);
	if (!existsSync(join(appDir, 'package.json'))) throw new Error(`init produced no app at ${appDir}`);

	// 3. Repoint the runtime dependency at the packed tarball, then install. This
	//    keeps npm off the (unpublished) registry for @magic-spells/puzzle while
	//    still pulling the tailwind devDeps the build needs from the registry.
	const pkgPath = join(appDir, 'package.json');
	const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
	pkg.dependencies = pkg.dependencies || {};
	pkg.dependencies['@magic-spells/puzzle'] = `file:${tarball}`;
	writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
	run('npm', ['install', '--no-audit', '--no-fund'], appDir);

	// Confirm the tarball actually landed as the resolved runtime.
	const installed = join(appDir, 'node_modules', '@magic-spells', 'puzzle', 'client-runtime', 'index.js');
	if (!existsSync(installed)) throw new Error(`tarball did not install to ${installed}`);
	console.log('[e2e-pack] runtime installed from tarball into node_modules');

	// 4. Build the app with the REPO compiler (published binary doesn't exist
	//    pre-publish). Runtime + subpaths resolve via the app's node_modules.
	run('go', ['run', './compiler/cmd/puzzle', 'build', appDir, '--mode', 'development'], repoRoot);

	// 5. Assertions.
	const dist = join(appDir, 'dist');
	const required = ['app.js', 'index.html', 'styles.css'];
	for (const f of required) {
		if (!existsSync(join(dist, f))) throw new Error(`missing build artifact dist/${f}`);
	}
	const appJs = readFileSync(join(dist, 'app.js'), 'utf8');
	if (appJs.includes('puzzle-env')) {
		throw new Error("dist/app.js contains a 'puzzle-env' stray (ambient shim leaked into the bundle)");
	}

	console.log('\n[e2e-pack] PASS — packed tarball installs and builds a real app:');
	console.log(`  dist/${required.join(', dist/')} present; no 'puzzle-env' strays in app.js`);
} catch (err) {
	fail(err.message);
} finally {
	try {
		rmSync(work, { recursive: true, force: true });
		console.log(`[e2e-pack] cleaned workspace ${work}`);
	} catch (e) {
		console.error(`[e2e-pack] cleanup warning: ${e.message}`);
	}
}
