import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ESLint } from 'eslint';
import plugin from '../src/index.js';
import { splitSections } from '../src/split.js';

// The Puzzle example corpus lives in the sibling framework repo. Resolve it
// relative to this package so the test is portable, and skip gracefully when it
// is not present (e.g. published/standalone checkouts).
const CORPUS_DIR = join(process.cwd(), '..', 'puzzle', 'examples');

function findPzl(dir) {
	const out = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		const st = statSync(full);
		if (st.isDirectory()) {
			out.push(...findPzl(full));
		} else if (entry.endsWith('.pzl')) {
			out.push(full);
		}
	}
	return out;
}

const hasCorpus = existsSync(CORPUS_DIR);
// Skip zero-byte placeholder .pzl files: an empty file legitimately has no
// <puzzle-view> and the real Go compiler rejects it the same way — that is
// correct behavior, not a splitter fault.
const files = hasCorpus ? findPzl(CORPUS_DIR).filter((f) => statSync(f).size > 0) : [];

describe.skipIf(!hasCorpus)('corpus sweep over examples/**/*.pzl', () => {
	it('found a non-trivial number of .pzl files', () => {
		expect(files.length).toBeGreaterThan(50);
	});

	it('every corpus file splits with zero structural errors', () => {
		const failures = [];
		for (const f of files) {
			const src = readFileSync(f, 'utf8');
			const { errors } = splitSections(src, f);
			if (errors.length > 0) failures.push(`${f}: ${errors[0].message} (${errors[0].line}:${errors[0].column})`);
		}
		expect(failures).toEqual([]);
	});

	it('every corpus file lints through the ESLint API without crashing', async () => {
		const eslint = new ESLint({
			cwd: process.cwd(),
			overrideConfigFile: true,
			overrideConfig: [
				...plugin.configs.recommended,
				// A no-`files` entry so these rules reach the extracted virtual
				// blocks. Kept light — findings are fine, crashes are not.
				{ rules: { 'no-unused-vars': 'warn', 'no-undef': 'off' } },
			],
		});

		let scanned = 0;
		for (const f of files) {
			const src = readFileSync(f, 'utf8');
			// A crash here (splitter throw, processor throw) rejects the promise
			// and fails the test; rule findings and even fatal TS parse errors on
			// lang="ts" blocks (no TS parser configured) are acceptable.
			const results = await eslint.lintText(src, { filePath: f });
			expect(Array.isArray(results)).toBe(true);
			scanned++;
		}
		expect(scanned).toBe(files.length);
	});
});
