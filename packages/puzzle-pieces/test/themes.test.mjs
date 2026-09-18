/**
 * The four theme files in registry/theme/ are hand-written CSS and the source
 * of truth. These tests keep them honest without a generator:
 *
 *   - every file declares exactly the token contract (test/lib/roles.mjs) —
 *     nothing missing, nothing extra, the same set in all four;
 *   - scheme selectors are unanchored (`[data-scheme='x']`, never
 *     `:root[data-scheme=…]`) so an Appearance picker can scope a preview card;
 *   - pieces.css keeps the marker line the `puzzle add` CLI keys on;
 *   - each medium block is real: it re-declares the grounds and type that make
 *     "soft dark" and never restates a value that is already the dark half;
 *   - the demo's static token list and the demo's copies of appearance.js and
 *     the pre-paint snippet match the registry byte for byte;
 *   - registry.json's themes array is truthful.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { PROPS, MEDIUM_REQUIRED, ROLE_BY_PROP } from './lib/roles.mjs';
import {
	SCHEMES,
	fileFor,
	readTheme,
	pairBlock,
	mediumBlock,
	declarations,
	modeMaps,
	resolvedModes,
	half,
} from './lib/parse-theme.mjs';
import { TOKEN_PROPS, SCHEMES as DEMO_SCHEMES, MODES as DEMO_MODES } from '../demo/app/lib/tokenNames.js';
import { parseColor } from './lib/color.mjs';

const MARKER_LINE = ' * puzzle-pieces design tokens (Tailwind v4 @theme).';

test('pieces.css keeps the CLI marker on line 2', () => {
	const lines = readTheme('default').split('\n');
	assert.equal(lines[0], '/*');
	assert.equal(lines[1], MARKER_LINE);
});

test('every theme file declares exactly the token contract', () => {
	const expected = [...PROPS].sort();
	for (const scheme of SCHEMES) {
		const block = pairBlock(scheme);
		assert.ok(block, `${fileFor(scheme)} has no palette block`);
		const declared = [...declarations(block.body).keys()].sort();
		assert.deepEqual(declared, expected, `${fileFor(scheme)} declares a different token set`);
	}
});

test('the alternate palettes name no token the default does not', () => {
	const base = new Set(declarations(pairBlock('default').body).keys());
	for (const scheme of SCHEMES.slice(1)) {
		for (const prop of declarations(pairBlock(scheme).body).keys()) {
			assert.ok(base.has(prop), `${fileFor(scheme)} declares ${prop}, which pieces.css does not`);
		}
	}
});

test('no palette or mode block is anchored to :root', () => {
	for (const scheme of SCHEMES) {
		const css = readTheme(scheme);
		assert.equal([...css.matchAll(/^:root\[data-(scheme|theme)=/gm)].length, 0, `${fileFor(scheme)} anchors a block to :root`);
	}
});

test('pieces.css sets color-scheme per mode and follows the OS with no attribute', () => {
	const css = readTheme('default');
	assert.match(css, /:root \{\s*color-scheme: light dark;\s*\}/);
	assert.match(css, /\[data-theme='light'\] \{\s*color-scheme: light;\s*\}/);
	assert.match(css, /\[data-theme='dark'\],\s*\[data-theme='medium'\] \{\s*color-scheme: dark;\s*\}/);
});

test('scheme files do not set color-scheme on their palette block (the mode axis owns it)', () => {
	for (const scheme of SCHEMES.slice(1)) {
		assert.doesNotMatch(pairBlock(scheme).body, /color-scheme/, `${fileFor(scheme)} sets color-scheme in its palette block`);
	}
});

test('pieces.css restates the default palette on [data-scheme="default"] for preview cards', () => {
	const css = readTheme('default');
	const restated = css.match(/\[data-scheme='default'\] \{([^}]*)\}/);
	assert.ok(restated, 'no [data-scheme=\'default\'] block');
	const copy = declarations(restated[1]);
	const source = declarations(pairBlock('default').body);
	assert.deepEqual([...copy.keys()].sort(), [...source.keys()].sort());
	for (const [prop, value] of source) assert.equal(copy.get(prop), value, `${prop} drifted in the restated block`);
});

test('every palette has a real medium block', () => {
	for (const scheme of SCHEMES) {
		const block = mediumBlock(scheme);
		assert.ok(block, `${fileFor(scheme)} has no medium block`);
		assert.match(block.body, /color-scheme:\s*dark/, `${fileFor(scheme)}: medium block must set color-scheme: dark`);
		const selectors = block.selector.split(',').map((s) => s.trim());
		assert.ok(
			selectors.includes(`[data-theme='medium'] [data-scheme='${scheme}']:not([data-theme])`),
			`${fileFor(scheme)}: medium block must also match a preview card scoped under a medium root`
		);

		const decls = declarations(block.body);
		const pairs = declarations(pairBlock(scheme).body);
		for (const prop of MEDIUM_REQUIRED) {
			assert.ok(decls.has(prop), `${fileFor(scheme)}: medium block does not re-declare ${prop}`);
		}
		for (const [prop, value] of decls) {
			assert.ok(pairs.has(prop), `${fileFor(scheme)}: medium block declares ${prop}, which the palette does not`);
			assert.notEqual(value, half(pairs.get(prop), 'dark'), `${fileFor(scheme)}: medium ${prop} restates the dark value — drop the line or change it`);
			assert.doesNotMatch(value, /light-dark\(/, `${fileFor(scheme)}: medium ${prop} must be a flat value, not a pair`);
		}
	}
});

test('every alias resolves to a colour inside its own palette, in every mode', () => {
	for (const scheme of SCHEMES) {
		const maps = modeMaps(scheme);
		const resolved = resolvedModes(scheme);
		for (const mode of Object.keys(resolved)) {
			for (const [prop, value] of resolved[mode]) {
				const role = ROLE_BY_PROP.get(prop);
				assert.ok(value !== null, `${fileFor(scheme)}/${mode}: ${prop} does not resolve (alias cycle or missing target)`);
				if (role.kind === 'shadow') continue;
				assert.ok(parseColor(value), `${fileFor(scheme)}/${mode}: ${prop} = ${JSON.stringify(value)} is not a colour`);
				// A measured foreground must be opaque — a translucent ink has no
				// ratio. Grounds and hairlines may be alphas (Void's borders are).
				if (role.contrast) {
					assert.ok(parseColor(value).a === 1, `${fileFor(scheme)}/${mode}: ${prop} is measured for contrast and must be opaque`);
				}
			}
			// Every value is either a plain colour, an alias, or (in the pair block) a pair.
			for (const [prop, raw] of maps[mode]) {
				assert.doesNotMatch(raw, /light-dark\(/, `${fileFor(scheme)}/${mode}: ${prop} still holds a pair after splitting`);
			}
		}
	}
});

test('the demo token list equals the contract, and its scheme/mode lists match', () => {
	assert.deepEqual([...TOKEN_PROPS].sort(), [...PROPS].sort(), 'demo/app/lib/tokenNames.js has drifted from test/lib/roles.mjs');
	assert.deepEqual(DEMO_SCHEMES, SCHEMES);
	assert.deepEqual(DEMO_MODES, ['light', 'medium', 'dark']);
});

test('the demo copies of appearance.js and the pre-paint snippet match the registry', () => {
	const registryAppearance = readFileSync(new URL('../registry/theme/appearance.js', import.meta.url), 'utf8');
	const demoAppearance = readFileSync(new URL('../demo/app/lib/appearance.js', import.meta.url), 'utf8');
	assert.equal(demoAppearance, registryAppearance, 'demo/app/lib/appearance.js drifted from registry/theme/appearance.js');

	const prePaint = readFileSync(new URL('../registry/theme/pre-paint.js', import.meta.url), 'utf8');
	const html = readFileSync(new URL('../demo/app/public/index.html', import.meta.url), 'utf8');
	const inline = html.match(/<script data-key="puzzle:appearance">\n([\s\S]*?)<\/script>/);
	assert.ok(inline, 'demo index.html has no <script data-key="puzzle:appearance"> block');
	assert.equal(inline[1], prePaint, 'the inline pre-paint script in demo index.html drifted from registry/theme/pre-paint.js');
});

test('registry.json lists the four themes truthfully, with the three modes', () => {
	const registry = JSON.parse(readFileSync(new URL('../registry/registry.json', import.meta.url), 'utf8'));
	assert.equal(registry.theme, 'theme/pieces.css');
	assert.deepEqual(registry.modes, ['light', 'medium', 'dark']);
	assert.deepEqual(registry.themes.map((t) => t.name), SCHEMES);
	for (const theme of registry.themes) {
		assert.equal(theme.file, `theme/${fileFor(theme.name)}`);
		assert.ok(theme.label && theme.description, `${theme.name}: label and description are required`);
	}
});

test('package.json exports the theme files, appearance and pre-paint', () => {
	const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
	assert.equal(pkg.exports['./themes/default.css'], './registry/theme/pieces.css');
	for (const scheme of SCHEMES.slice(1)) assert.equal(pkg.exports[`./themes/${scheme}.css`], `./registry/theme/${scheme}.css`);
	assert.equal(pkg.exports['./appearance'], './registry/theme/appearance.js');
	assert.equal(pkg.exports['./pre-paint'], './registry/theme/pre-paint.js');
	assert.deepEqual(pkg.files, ['registry']);
});
