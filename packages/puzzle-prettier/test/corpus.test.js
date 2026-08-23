import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { format, sectionMap, splitSections } from './helpers.js';

const EXAMPLES_DIR = '/Users/coryschulz/Code/@magic-spells/puzzle/examples';

function listPzl(dir) {
	try {
		const out = execFileSync('find', [dir, '-name', '*.pzl'], { encoding: 'utf8' });
		return out.split('\n').filter(Boolean);
	} catch {
		return [];
	}
}

const haveExamples = existsSync(EXAMPLES_DIR) && statSync(EXAMPLES_DIR).isDirectory();
// Skip empty / whitespace-only placeholder files: they have no <puzzle-view> (so
// the compiler rejects them too), and Prettier short-circuits empty input
// without ever invoking the parser, so there is nothing to format or verify.
const files = (haveExamples ? listPzl(EXAMPLES_DIR) : []).filter(
	(f) => readFileSync(f, 'utf8').trim() !== '',
);

describe.skipIf(!haveExamples || files.length === 0)('corpus sweep', () => {
	it(`found .pzl corpus files under ${EXAMPLES_DIR}`, () => {
		expect(files.length).toBeGreaterThan(0);
	});

	it('formats every corpus file without throwing, idempotently, preserving templates and section set', async () => {
		let checked = 0;
		const failures = [];
		for (const file of files) {
			const input = readFileSync(file, 'utf8');
			let out;
			try {
				out = await format(input);
			} catch (err) {
				failures.push(`${file}: threw ${err.message}`);
				continue;
			}
			try {
				// (b) idempotent
				const out2 = await format(out);
				if (out2 !== out) failures.push(`${file}: not idempotent`);

				const a = sectionMap(input);
				const b = sectionMap(out);

				// (d) same section set
				const aKeys = Object.keys(a).sort().join(',');
				const bKeys = Object.keys(b).sort().join(',');
				if (aKeys !== bKeys) failures.push(`${file}: section set changed ${aKeys} -> ${bKeys}`);

				// (c) template bodies + all section tags byte-identical
				for (const name of ['puzzle-view', 'puzzle-skeleton']) {
					if (a[name] && a[name].inner !== b[name]?.inner) {
						failures.push(`${file}: ${name} body changed`);
					}
				}
				for (const name of Object.keys(a)) {
					if (a[name].openTag !== b[name]?.openTag) failures.push(`${file}: ${name} open tag changed`);
					if (a[name].closeTag !== b[name]?.closeTag) failures.push(`${file}: ${name} close tag changed`);
				}
			} catch (err) {
				failures.push(`${file}: verification error ${err.message}`);
			}
			checked++;
		}
		if (failures.length) {
			throw new Error(`corpus failures (${failures.length}/${checked}):\n` + failures.join('\n'));
		}
		expect(checked).toBe(files.length);
		// eslint-disable-next-line no-console
		console.log(`corpus sweep: ${checked} files formatted, idempotent, templates byte-identical`);
	});

	it('re-splitting the formatted output yields the same section set (via splitter directly)', async () => {
		for (const file of files) {
			const input = readFileSync(file, 'utf8');
			const out = await format(input);
			const before = splitSections(input).map((s) => s.name);
			const after = splitSections(out).map((s) => s.name);
			expect(after, file).toEqual(before);
		}
	});
});
