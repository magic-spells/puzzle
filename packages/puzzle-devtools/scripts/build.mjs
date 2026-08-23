#!/usr/bin/env node
/**
 * build.mjs — build the panel app, then assemble the unpacked extension.
 *
 *   node scripts/build.mjs            production panel, dist-extension/
 *   node scripts/build.mjs --dev      development panel (unminified, sourcemap)
 *   node scripts/build.mjs --zip      also emit puzzle-devtools-<version>.zip
 *
 * The panel is compiled by the monorepo's compiler binary — ../../puzzle, built
 * at the repo root with `npm run build:compiler`. The framework dependency is a
 * file: link to ../.., so the npm shim would resolve a platform binary package
 * that a working-tree link never installs; it is deliberately not a fallback.
 * PUZZLE_BIN overrides the compiler binary.
 *
 * Layout produced:
 *
 *   dist-extension/
 *     manifest.json  background.js  content-script.js  page-hook.js
 *     devtools.html  devtools.js    panel.html         panel-glue.js
 *     icons/*.png
 *     panel/app.js  panel/styles.css      ← compiled panel, paths match panel.html
 */
import { spawnSync } from 'node:child_process';
import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PANEL_DIR = join(ROOT, 'panel');
const PANEL_DIST = join(PANEL_DIR, 'dist');
const EXTENSION_DIR = join(ROOT, 'extension');
const OUT_DIR = join(ROOT, 'dist-extension');

const MONOREPO_PUZZLE_BIN = join(ROOT, '..', '..', 'puzzle');
const PUZZLE_BIN = process.env.PUZZLE_BIN || MONOREPO_PUZZLE_BIN;

const args = process.argv.slice(2);
const wantZip = args.includes('--zip');
const devMode = args.includes('--dev');

main();

function main() {
	buildPanel();
	assemble();
	const files = verify();
	report(files);
	if (wantZip) zip();
}

/* -------------------------------------------------------------------------- */

function buildPanel() {
	if (!existsSync(PUZZLE_BIN)) {
		fail(
			`puzzle compiler not found at ${PUZZLE_BIN}\n` +
				`Build it at the monorepo root with \`npm run build:compiler\` (emits ./puzzle), ` +
				`or set PUZZLE_BIN to a puzzle binary.`
		);
	}

	const argv = ['build'];
	if (devMode) argv.push('--mode', 'development');

	console.log(`> ${PUZZLE_BIN} ${argv.join(' ')}   (cwd: panel/)`);
	const result = spawnSync(PUZZLE_BIN, argv, { cwd: PANEL_DIR, stdio: 'inherit' });
	if (result.error) fail(`could not run the puzzle compiler: ${result.error.message}`);
	if (result.status !== 0) fail(`panel build failed (exit ${result.status})`);
}

function assemble() {
	rmSync(OUT_DIR, { recursive: true, force: true });
	mkdirSync(OUT_DIR, { recursive: true });

	// 1. Everything in extension/ ships as-is at the package root.
	cpSync(EXTENSION_DIR, OUT_DIR, { recursive: true });

	// 2. The compiled panel goes under panel/, matching panel.html's src paths.
	//    app/public/index.html is deliberately NOT copied: it is the standalone
	//    `puzzle dev` shell, superseded by extension/panel.html.
	const panelOut = join(OUT_DIR, 'panel');
	mkdirSync(panelOut, { recursive: true });
	for (const name of ['app.js', 'styles.css', 'app.js.map', 'styles.css.map']) {
		const src = join(PANEL_DIST, name);
		if (existsSync(src)) cpSync(src, join(panelOut, name));
	}
}

/**
 * Fail loudly if the assembled directory would not load: every path the manifest
 * or panel.html names must exist. Chrome reports these as vague load errors, so
 * catching them here is worth the twenty lines.
 */
function verify() {
	const manifestPath = join(OUT_DIR, 'manifest.json');
	if (!existsSync(manifestPath)) fail('dist-extension/manifest.json is missing');

	let manifest;
	try {
		manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
	} catch (err) {
		fail(`dist-extension/manifest.json is not valid JSON: ${err.message}`);
	}

	const required = new Set();
	if (manifest.devtools_page) required.add(manifest.devtools_page);
	if (manifest.background?.service_worker) required.add(manifest.background.service_worker);
	for (const icon of Object.values(manifest.icons ?? {})) required.add(icon);
	for (const entry of manifest.content_scripts ?? []) {
		for (const file of entry.js ?? []) required.add(file);
		for (const file of entry.css ?? []) required.add(file);
	}

	// panel.html is reached through devtools.js, not the manifest — scrape its
	// local script/link references too.
	const panelHtml = join(OUT_DIR, 'panel.html');
	if (!existsSync(panelHtml)) fail('dist-extension/panel.html is missing');
	required.add('panel.html');
	const html = readFileSync(panelHtml, 'utf8');
	for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
		const ref = match[1];
		if (/^[a-z]+:|^\/\//i.test(ref)) continue; // absolute/protocol URL
		required.add(ref.replace(/^\.?\//, ''));
	}

	const missing = [...required].filter((file) => !existsSync(join(OUT_DIR, file)));
	if (missing.length) {
		fail(`referenced files missing from dist-extension/:\n  ${missing.join('\n  ')}`);
	}

	return listFiles(OUT_DIR);
}

function report(files) {
	console.log('');
	console.log(`  dist-extension/  (${files.length} files)`);
	let total = 0;
	for (const file of files) {
		const size = statSync(file).size;
		total += size;
		console.log(`    ${relative(OUT_DIR, file).padEnd(24)} ${kb(size).padStart(9)}`);
	}
	console.log(`    ${'total'.padEnd(24)} ${kb(total).padStart(9)}`);
	console.log('');
	console.log('  Load it: chrome://extensions → Developer mode → Load unpacked → dist-extension/');
	console.log('');
}

function zip() {
	const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
	const out = join(ROOT, `puzzle-devtools-${version}.zip`);
	rmSync(out, { force: true });
	const result = spawnSync('zip', ['-r', '-q', '-X', out, '.'], {
		cwd: OUT_DIR,
		stdio: 'inherit',
	});
	if (result.error || result.status !== 0) {
		fail(`zip failed — is the \`zip\` command available? ${result.error?.message ?? ''}`);
	}
	console.log(`  wrote ${relative(ROOT, out)} (${kb(statSync(out).size)})`);
	console.log('');
}

function listFiles(dir) {
	const out = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...listFiles(full));
		else out.push(full);
	}
	return out.sort();
}

function kb(bytes) {
	return `${(bytes / 1024).toFixed(1)} KB`;
}

function fail(message) {
	console.error(`\nbuild failed: ${message}\n`);
	process.exit(1);
}
