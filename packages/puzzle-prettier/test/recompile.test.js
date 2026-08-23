import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, mkdirSync, cpSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format } from './helpers.js';

// The framework package is a sibling under packages/ (D162 monorepo layout), so
// resolve its compiler and examples relative to THIS file.
const here = dirname(fileURLToPath(import.meta.url));
const PUZZLE_PKG = join(here, '..', '..', 'puzzle');
const COMPILER_DIR = join(PUZZLE_PKG, 'compiler');
const EXAMPLES_DIR = join(PUZZLE_PKG, 'examples');
const FIXTURES_DIR = join(here, 'fixtures');

function haveGo() {
	try {
		execFileSync('go', ['version'], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
}

function listPzl(dir) {
	try {
		return execFileSync('find', [dir, '-name', '*.pzl'], { encoding: 'utf8' }).split('\n').filter(Boolean);
	} catch {
		return [];
	}
}

// Emission mode mirrors the compiler's D20 rule: components under /components/
// render inline (--mode component); views and layouts emit a <puzzle-view> root
// (--mode view/layout, both codegen.ModeView).
function modeFor(file) {
	if (file.includes('/components/')) return 'component';
	if (file.includes('/layouts/')) return 'layout';
	return 'view';
}

// Compile a single .pzl with pzlc. Returns { ok, stderr }.
function compile(pzlc, mode, inFile, outFile, assetsDir) {
	const args = ['--mode', mode];
	if (assetsDir) args.push('--assets', assetsDir);
	args.push(inFile, outFile);
	try {
		execFileSync(pzlc, args, { encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] });
		return { ok: true, stderr: '' };
	} catch (err) {
		return { ok: false, stderr: (err.stderr || err.message || '').toString() };
	}
}

// Find the nearest ancestor app/assets dir (mirrors pzlc's defaultAssetsDir) so
// {#svg} inlining resolves the same way for both the original and the formatted
// input, which lives in a temp dir.
function assetsDirFor(file) {
	let dir = dirname(file);
	for (;;) {
		if (dir.endsWith('/app')) return join(dir, 'assets');
		const parent = dirname(dir);
		if (parent === dir) return '';
		dir = parent;
	}
}

const canRun = haveGo() && existsSync(EXAMPLES_DIR);

describe.skipIf(!canRun)('formatted corpus still compiles with pzlc', () => {
	let pzlc;
	let files;

	beforeAll(() => {
		const scratch = mkdtempSync(join(tmpdir(), 'pzlc-'));
		pzlc = join(scratch, 'pzlc');
		execFileSync('go', ['build', '-o', pzlc, './cmd/pzlc'], { cwd: COMPILER_DIR, stdio: 'inherit' });
		files = listPzl(EXAMPLES_DIR);
	}, 120_000);

	it('compiles the formatted output for every file the original compiles', async () => {
		const scratch = mkdtempSync(join(tmpdir(), 'pzlc-fmt-'));
		let originalCompiles = 0;
		let formattedCompiles = 0;
		const regressions = [];

		for (const file of files) {
			const mode = modeFor(file);
			const assets = assetsDirFor(file);
			const outOrig = join(scratch, 'orig.js');

			const orig = compile(pzlc, mode, file, outOrig, assets);
			if (!orig.ok) continue; // only files the compiler already accepts are in scope
			originalCompiles++;

			const formatted = await format(readFileSync(file, 'utf8'));
			// Write the formatted file back into the SAME location tree (temp copy)
			// so relative assets paths still resolve via --assets.
			const fmtIn = join(scratch, 'formatted.pzl');
			writeFileSync(fmtIn, formatted, 'utf8');
			const outFmt = join(scratch, 'formatted.js');
			const res = compile(pzlc, mode, fmtIn, outFmt, assets);
			if (res.ok) formattedCompiles++;
			else regressions.push(`${file} (mode=${mode}): ${res.stderr.trim().split('\n')[0]}`);
		}

		// eslint-disable-next-line no-console
		console.log(
			`pzlc recompile: ${originalCompiles} originals compiled, ${formattedCompiles} formatted compiled, ${regressions.length} regressions`,
		);
		if (regressions.length) {
			throw new Error(`formatted output failed to compile:\n${regressions.join('\n')}`);
		}
		expect(formattedCompiles).toBe(originalCompiles);
		expect(originalCompiles).toBeGreaterThan(0);
	}, 300_000);

	// The examples corpus has no {#raw} usage, so the plugin's own fixtures carry
	// the D150 acceptance case: raw spans must survive formatting well enough that
	// the compiler still emits the SAME literal text nodes.
	it('compiles the formatted output for every fixture the compiler accepts', async () => {
		const scratch = mkdtempSync(join(tmpdir(), 'pzlc-fix-'));
		let checked = 0;
		const regressions = [];

		for (const file of listPzl(FIXTURES_DIR)) {
			const outOrig = join(scratch, 'orig.js');
			if (!compile(pzlc, 'view', file, outOrig, '').ok) continue; // out of scope
			checked++;
			const fmtIn = join(scratch, 'formatted.pzl');
			writeFileSync(fmtIn, await format(readFileSync(file, 'utf8')), 'utf8');
			const outFmt = join(scratch, 'formatted.js');
			const res = compile(pzlc, 'view', fmtIn, outFmt, '');
			if (!res.ok) {
				regressions.push(`${file}: ${res.stderr.trim().split('\n')[0]}`);
				continue;
			}
			if (file.endsWith('raw-block.pzl')) {
				// The raw bodies reach codegen byte-identically: same literal text
				// nodes before and after formatting, braces and all.
				for (const literal of [
					'{ "loop": true, "slides": [1, 2], "url": "/api/x" }',
					'{#if ok}{ value | upper }{:else}{#comment}x{/comment}{/if}',
					'outer {#raw} inner',
				]) {
					expect(readFileSync(outOrig, 'utf8'), literal).toContain(literal);
					expect(readFileSync(outFmt, 'utf8'), literal).toContain(literal);
				}
			}
		}

		if (regressions.length) {
			throw new Error(`formatted fixtures failed to compile:\n${regressions.join('\n')}`);
		}
		expect(checked).toBeGreaterThan(0);
	}, 120_000);
});
