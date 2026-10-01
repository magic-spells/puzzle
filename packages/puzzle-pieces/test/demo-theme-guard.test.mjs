// The demo's shell and design-system panels must be styled through tokens only —
// no colour literals and no arbitrary-value escape hatches carrying one. Pyramid's
// check-theme.mjs idea, scoped to the files the themes build added or rewrote so
// the guard is exact (the older component docs are outside its remit).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEMO = join(ROOT, 'demo', 'app');

const FIXED = [
	'layouts/Default.pzl',
	'components/docs/AppearanceSwitcher.pzl',
	'views/Theming.pzl',
];
const DIRS = ['components/themes', 'views/themes'];

function guarded() {
	const files = FIXED.map((f) => join(DEMO, f));
	for (const dir of DIRS) {
		const abs = join(DEMO, dir);
		if (!existsSync(abs)) continue;
		for (const name of readdirSync(abs)) if (name.endsWith('.pzl')) files.push(join(abs, name));
	}
	return files;
}

// A hex literal, not an anchor id that happens to start with hex letters (`#badges`).
const HEX = /#[0-9a-fA-F]{3,8}(?![\w-])/g;
const FUNCS = /\b(rgba?|hsla?|oklch|oklab|lab|lch|color)\(/g;
// Arbitrary-value escapes carrying a COLOUR (`bg-[#…]`, `text-[rgb(…)]`).
const ESCAPES = /-\[(?:#|rgba?\(|hsla?\(|oklch\(|oklab\(|lab\(|lch\(|color\()/g;
// Raw type sizes too: the docs scale is tokens (`text-code`, `text-micro`, …).
const TYPE_ESCAPES = /\b(?:text|tracking|leading)-\[/g;

test('themes demo files exist', () => {
	for (const f of FIXED) assert.ok(existsSync(join(DEMO, f)), `${f} missing`);
	for (const d of DIRS) assert.ok(existsSync(join(DEMO, d)), `${d}/ missing`);
	assert.ok(guarded().length >= FIXED.length + 4, 'expected the themes views and components');
});

test('no colour literals or colour escape hatches in the shell and themes files', () => {
	const offences = [];
	for (const file of guarded()) {
		const src = readFileSync(file, 'utf8');
		const rel = file.slice(DEMO.length + 1);
		src.split('\n').forEach((line, i) => {
			// `var(--color-x)` references and `#/route` hrefs are fine; literals are not.
			const stripped = line.replace(/var\(--[a-z0-9-]+\)/g, '').replace(/#\//g, '');
			for (const re of [HEX, FUNCS, ESCAPES, TYPE_ESCAPES]) {
				re.lastIndex = 0;
				const m = re.exec(stripped);
				if (m) offences.push(`${rel}:${i + 1}: ${m[0]} — ${line.trim().slice(0, 100)}`);
			}
		});
	}
	assert.deepEqual(offences, [], `colour literals found:\n${offences.join('\n')}`);
});
