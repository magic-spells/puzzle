import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ESLint } from 'eslint';
import js from '@eslint/js';
import css from '@eslint/css';
import tseslint from 'typescript-eslint';
import plugin, { processor } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, 'fixtures', name), 'utf8');

// A flat config that wires the processor and applies a few JS rules to the
// extracted virtual files (via a no-`files` entry, which matches the virtual
// `*.pzl/0_scripts.js` block).
function makeConfig(rules) {
	return [
		...plugin.configs.recommended,
		{ rules },
	];
}

async function lint(code, rules, { fix = false, filePath = 'test.pzl' } = {}) {
	const eslint = new ESLint({
		cwd: here,
		overrideConfigFile: true,
		overrideConfig: makeConfig(rules),
		fix,
	});
	const results = await eslint.lintText(code, { filePath });
	return results[0];
}

describe('plugin meta', () => {
	it('reports the name and version from package.json', () => {
		const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));
		expect(plugin.meta).toEqual({ name: pkg.name, version: pkg.version });
	});
});

describe('processor.preprocess', () => {
	it('extracts a .js block and a .css block, positions preserved', () => {
		const src = fixture('basic-js.pzl');
		const blocks = processor.preprocess(src, 'basic-js.pzl');
		expect(blocks.map((b) => b.filename)).toEqual(['0_scripts.js', '1_styles.css']);
		const virtual = blocks[0].text;
		// Cut at the end of the body; offsets before it identical.
		expect(virtual.length).toBe(src.lastIndexOf('</script>'));
		// Every newline preserved at the same index.
		for (let i = 0; i < virtual.length; i++) {
			if (src[i] === '\n' || src[i] === '\r') expect(virtual[i]).toBe(src[i]);
		}
		// The <script> body is byte-identical; outside it is blanked to spaces.
		expect(virtual).toContain('export default class Counter');
		expect(virtual).not.toContain('puzzle-view');
		expect(virtual).not.toContain('color: red');
		// The <style scoped> body the same way: cut at its end, blanked before it.
		expect(blocks[1].text.length).toBe(src.lastIndexOf('</style>'));
		expect(blocks[1].text.trim()).toBe('div { color: red; }');
	});

	it('names the block .ts for lang="ts"', () => {
		const blocks = processor.preprocess(fixture('basic-ts.pzl'), 'basic-ts.pzl');
		expect(blocks).toHaveLength(1);
		expect(blocks[0].filename).toBe('0_scripts.ts');
	});

	it('returns only the .css block for a file with no <script>', () => {
		const blocks = processor.preprocess(fixture('no-scripts.pzl'), 'no-scripts.pzl');
		expect(blocks.map((b) => b.filename)).toEqual(['1_styles.css']);
	});

	it('returns no .css block for a file with no <style>, and no blocks for neither', () => {
		expect(processor.preprocess(fixture('basic-ts.pzl'), 'basic-ts.pzl').map((b) => b.filename)).toEqual(['0_scripts.ts']);
		expect(processor.preprocess('<puzzle-view><p/></puzzle-view>\n', 'view-only.pzl')).toEqual([]);
	});
});

describe('processor.postprocess', () => {
	it('injects section errors even when there are no script blocks', () => {
		// No <puzzle-view> → a structural error with no <script> block.
		const src = '<script>const a = 1;</script>\n';
		processor.preprocess(src, 'bad.pzl');
		const out = processor.postprocess([], 'bad.pzl');
		expect(out).toHaveLength(1);
		expect(out[0].ruleId).toBe('puzzle/no-invalid-sections');
		expect(out[0].severity).toBe(2);
		expect(out[0].message).toBe('missing <puzzle-view> section');
		expect(out[0]).toMatchObject({ line: 1, column: 1 });
	});

	it('flattens block messages and appends injected ones', () => {
		const src = fixture('basic-js.pzl');
		processor.preprocess(src, 'basic-js.pzl');
		const blockMessages = [[{ ruleId: 'x', message: 'hi', line: 1, column: 1 }]];
		const out = processor.postprocess(blockMessages, 'basic-js.pzl');
		expect(out).toHaveLength(1);
		expect(out[0].ruleId).toBe('x');
	});
});

describe('ESLint end to end (JS)', () => {
	it('lints the <script> body without crashing', async () => {
		const res = await lint(fixture('basic-js.pzl'), { 'no-unused-vars': 'warn' });
		expect(res.messages.every((m) => !m.fatal)).toBe(true);
	});

	it('reports rule positions on the real .pzl coordinates', async () => {
		const src = [
			'<puzzle-view>', //          line 1
			'  <div>{ x }</div>', //     line 2
			'</puzzle-view>', //         line 3
			'', //                       line 4
			'<script>', //               line 5
			'const unusedVar = 1;', //   line 6  (unusedVar at col 7)
			'export default 1;', //      line 7
			'</script>', //              line 8
		].join('\n');
		const res = await lint(src, { 'no-unused-vars': 'warn' });
		const msg = res.messages.find((m) => m.ruleId === 'no-unused-vars');
		expect(msg).toBeTruthy();
		expect(msg.line).toBe(6);
		expect(msg.column).toBe(7);
	});

	it('surfaces injected section errors through ESLint', async () => {
		const src = [
			'<puzzle-view><div/></puzzle-view>',
			'<script>const a = 1;</script>',
			'<script>const b = 2;</script>',
		].join('\n');
		const res = await lint(src, {});
		const msg = res.messages.find((m) => m.ruleId === 'puzzle/no-invalid-sections');
		expect(msg).toBeTruthy();
		expect(msg.message).toBe('multiple <script> sections (only one allowed)');
		expect(msg.line).toBe(3);
	});

	it('autofix touches only the <script> body and leaves the rest byte-identical', async () => {
		const src = [
			'<puzzle-view>',
			'  <div class="a">{ x }</div>',
			'</puzzle-view>',
			'',
			'<script>',
			'const s = "double";',
			'export default s;',
			'</script>',
			'',
			'<style>',
			'  .a { content: "x"; }',
			'</style>',
			'',
		].join('\n');
		const res = await lint(src, { quotes: ['error', 'single'] }, { fix: true });
		expect(res.output).toBeTruthy();
		const out = res.output;
		// Only the string quotes inside <script> changed.
		expect(out).toContain("const s = 'double';");
		// Everything outside the script body is unchanged, char for char.
		const idx = src.indexOf('<script>');
		expect(out.slice(0, idx)).toBe(src.slice(0, idx));
		const tail = '</script>';
		const srcTail = src.slice(src.indexOf(tail));
		const outTail = out.slice(out.indexOf(tail));
		expect(outTail).toBe(srcTail);
		// The fixed file still splits cleanly and re-lints with no more quote errors.
		const res2 = await lint(out, { quotes: ['error', 'single'] });
		expect(res2.messages.filter((m) => m.ruleId === 'quotes')).toHaveLength(0);
	});

	// The blanked template and styles read as blank lines and trailing spaces,
	// so whitespace rules (core, @stylistic, neostandard, prettier) "fix" them
	// away unless the processor drops fixes that reach outside the body.
	it('autofix never edits the template or styles, even for whitespace rules', async () => {
		const src = [
			'<puzzle-view>',
			'  <p>',
			'',
			'',
			'    { x }',
			'  </p>',
			'</puzzle-view>',
			'',
			'<script>',
			'const a = 1;',
			'',
			'',
			'',
			'export default a;   ',
			'</script>',
			'',
			'<style>',
			'  p { color: red; }',
			'</style>',
			'',
		].join('\n');
		const rules = { 'no-multiple-empty-lines': 'error', 'no-trailing-spaces': 'error' };
		const { output, messages } = await lint(src, rules, { fix: true });
		const open = src.indexOf('<script>') + '<script>'.length;
		expect(output.slice(0, open)).toBe(src.slice(0, open));
		expect(output.slice(output.indexOf('</script>'))).toBe(src.slice(src.indexOf('</script>')));
		expect(output.slice(open, output.indexOf('</script>'))).toBe('\nconst a = 1;\n\n\nexport default a;\n');
		expect(messages).toEqual([]);
	});

	// D141: paired composition markers — <Slot name="x">…</Slot>,
	// <Children>…</Children>, <Outlet>…</Outlet> with fallback bodies. The splitter
	// only finds section boundaries; it never parses template tags, so these are
	// inert template bytes. Pinned so a future template-grammar change cannot
	// silently start producing structural errors here.
	it('lints paired <Outlet>/<Children> markers with no structural errors or fatals', async () => {
		const src = fixture('paired-markers.pzl');
		const blocks = processor.preprocess(src, 'paired-markers.pzl');
		expect(blocks.map((b) => b.filename)).toEqual(['0_scripts.js', '1_styles.css']);
		// Positions preserved: the virtual file is the source up to </script>.
		expect(blocks[0].text.length).toBe(src.lastIndexOf('</script>'));
		// The template (markers included) is blanked out of the JS block.
		expect(blocks[0].text).not.toContain('<Children>');
		expect(blocks[0].text).not.toContain('<Slot');

		const res = await lint(src, { 'no-unused-vars': 'warn' }, { filePath: 'paired-markers.pzl' });
		expect(res.messages.filter((m) => m.fatal)).toEqual([]);
		expect(res.messages.filter((m) => m.ruleId === 'puzzle/no-invalid-sections')).toEqual([]);
		expect(res.messages).toEqual([]);
	});

	// D150: {#raw} blocks. The raw bodies here are brace-heavy JSON and literal
	// template grammar — inert bytes to the splitter, which must still hand the
	// <script> body over intact and report no structural errors.
	it('lints a file with {#raw} blocks with no structural errors or fatals', async () => {
		const src = fixture('raw-block.pzl');
		const blocks = processor.preprocess(src, 'raw-block.pzl');
		expect(blocks.map((b) => b.filename)).toEqual(['0_scripts.js', '1_styles.css']);
		// Positions preserved: the virtual file is the source up to </script>.
		expect(blocks[0].text.length).toBe(src.lastIndexOf('</script>'));
		// The template — raw bodies included — is blanked out of the JS block.
		expect(blocks[0].text).not.toContain('{#raw}');
		expect(blocks[0].text).not.toContain('"slides"');
		expect(blocks[0].text).toContain('const half = i++ / 2;');

		const res = await lint(src, { 'no-unused-vars': 'warn' }, { filePath: 'raw-block.pzl' });
		expect(res.messages.filter((m) => m.fatal)).toEqual([]);
		expect(res.messages.filter((m) => m.ruleId === 'puzzle/no-invalid-sections')).toEqual([]);
		expect(res.messages).toEqual([]);
	});

	// 0.8.0 template expressions (function calls in attributes and props,
	// methods, arrow-function arguments, object and template literals,
	// <pre>/<textarea> bodies). Template bytes stay out of the JS block, so no
	// JavaScript rule ever judges a template expression, and a rule's report
	// lands on the real line of the .pzl file past all of them.
	it('lints the 0.8.0 fixture with positions mapped past the template', async () => {
		const src = fixture('grammar-0-8.pzl');
		const blocks = processor.preprocess(src, 'grammar-0-8.pzl');
		expect(blocks.map((b) => b.filename)).toEqual(['0_scripts.js', '1_styles.css']);
		expect(blocks[0].text.length).toBe(src.lastIndexOf('</script>'));
		expect(blocks[0].text).not.toContain('compact_number');
		expect(blocks[0].text).not.toContain('toSorted');
		expect(blocks[0].text).not.toContain('${items');
		expect(blocks[0].text).not.toContain('keep   these');

		const res = await lint(src, { quotes: ['error', 'double'] }, { filePath: 'grammar-0-8.pzl' });
		expect(res.messages.filter((m) => m.fatal)).toEqual([]);
		expect(res.messages.filter((m) => m.ruleId === 'puzzle/no-invalid-sections')).toEqual([]);
		// Every single-quoted string the rule flags is in <script>, on its real line.
		const lines = src.split('\n');
		const scriptStart = lines.indexOf('<script>') + 1;
		const flagged = res.messages.filter((m) => m.ruleId === 'quotes');
		expect(flagged.length).toBeGreaterThan(0);
		for (const m of flagged) {
			expect(m.line).toBeGreaterThan(scriptStart);
			expect(lines[m.line - 1].slice(m.column - 1)).toMatch(/^'/);
		}
		const importLine = lines.findIndex((l) => l.startsWith('import { PuzzleView }')) + 1;
		expect(flagged.some((m) => m.line === importLine)).toBe(true);
	});

	it('a file with no <script> produces no JS messages', async () => {
		const res = await lint(fixture('no-scripts.pzl'), { 'no-unused-vars': 'warn' });
		expect(res.messages).toHaveLength(0);
	});
});

// A leading U+FEFF: ESLint strips the BOM from the physical text before it
// applies fixes, so the virtual text must carry it too, or every autofix range
// lands one code unit early and corrupts the <script> body.
describe('byte-order mark', () => {
	const rules = { 'prefer-const': 'error', quotes: ['error', 'double'] };
	const cases = {
		bom: ['\uFEFF<puzzle-view>é</puzzle-view>\n<script>\n', "let a = 'x'\n", 'export default a\n</script>\n'],
		crlf: ['<puzzle-view>é</puzzle-view>\r\n<script>\r\n', "let a = 'x'\r\n", 'export default a\r\n</script>\r\n'],
		'bom, body on the <script> line': ['\uFEFF<puzzle-view>é</puzzle-view>\n<script>', "let a = 'x'\n", 'export default a\n</script>\n'],
		emoji: ['<puzzle-view>🎉🎉 é</puzzle-view>\n<script>\n', "let a = '😀x'\n", 'export default a\n</script>\n'],
		'bom + crlf + emoji': [
			'\uFEFF<puzzle-view>🎉</puzzle-view>\r\n<script>\r\n',
			"let a = '😀x'\r\n",
			'export default a\r\n</script>\r\n',
		],
	};
	for (const [name, [head, body, tail]] of Object.entries(cases)) {
		it(`autofixes the <script> body in place (${name})`, async () => {
			const res = await lint(head + body + tail, rules, { fix: true });
			const fixedBody = body.replace('let', 'const').replace(/'/g, '"');
			expect(res.output).toBe(head + fixedBody + tail);
			expect(res.messages).toEqual([]);
		});
	}

	it('keeps the BOM at index 0 of the virtual text', () => {
		const blocks = processor.preprocess('\uFEFF<puzzle-view></puzzle-view>\n<script>let a;</script>\n', 'bom.pzl');
		processor.postprocess([], 'bom.pzl');
		expect(blocks[0].text[0]).toBe('\uFEFF');
	});
});

// `recommended` only claims the JS blocks: a `lang="ts"` block needs a TS
// parser, so it is left alone unless the user's own config supplies one. This
// is the README's hand-wired variant: a parser entry, then configs.typescript.
const TS_BLOCKS = ['**/*.pzl/*_scripts.ts'];
const tsConfig = [
	{
		files: TS_BLOCKS,
		languageOptions: { parser: tseslint.parser },
		plugins: { '@typescript-eslint': tseslint.plugin },
	},
	plugin.configs.typescript,
];

async function lintWith(config, src, filePath) {
	const eslint = new ESLint({ cwd: here, overrideConfigFile: true, overrideConfig: config });
	const [res] = await eslint.lintText(src, { filePath });
	return res;
}

describe('TypeScript blocks', () => {
	it('recommended alone reports nothing on a lang="ts" file', async () => {
		const res = await lintWith(plugin.configs.recommended, fixture('basic-ts.pzl'), 'basic-ts.pzl');
		expect(res.messages).toEqual([]);
	});

	it('recommended + js.configs.recommended does not parse a lang="ts" block', async () => {
		const res = await lintWith(
			[js.configs.recommended, ...plugin.configs.recommended],
			fixture('basic-ts.pzl'),
			'basic-ts.pzl',
		);
		expect(res.messages).toEqual([]);
	});

	it('tseslint.configs.recommended + configs.typescript: tag imports used, blanked regions quiet', async () => {
		const res = await lintWith(
			[
				// Enabled broadly, as a user might; their reports on the blanked
				// regions carry fixes outside the body, so the processor drops them.
				{ rules: { 'eol-last': 'error', 'no-trailing-spaces': 'error', 'unicode-bom': 'error' } },
				js.configs.recommended,
				...tseslint.configs.recommended,
				...plugin.configs.recommended,
				plugin.configs.typescript,
			],
			fixture('template-components-ts.pzl'),
			'template-components-ts.pzl',
		);
		expect(res.messages.filter((m) => m.fatal)).toEqual([]);
		// Only the truly unused import and the `{ title }`-only const remain.
		expect(res.messages.map((m) => [m.ruleId, m.message.match(/'([^']+)'/)[1]]).sort()).toEqual([
			['@typescript-eslint/no-unused-vars', 'Unused'],
			['@typescript-eslint/no-unused-vars', 'title'],
		]);
	});

	it('the README hand-wired TypeScript entry lints TS blocks', async () => {
		const src = fixture('basic-ts.pzl').replace('const n: number = 0;', 'let n: number = 0;');
		const res = await lintWith(
			[...plugin.configs.recommended, ...tsConfig, { files: TS_BLOCKS, rules: { 'prefer-const': 'error' } }],
			src,
			'basic-ts.pzl',
		);
		expect(res.messages.filter((m) => m.fatal)).toEqual([]);
		expect(res.messages.map((m) => m.ruleId)).toEqual(['prefer-const']);
	});
});

// Component tags and <Component> selectors use script bindings.
// puzzle/uses-template-components marks each tag's root (Frame for
// <Frame.Header>) and each selector's free references, like react/jsx-uses-vars.
describe('puzzle/uses-template-components', () => {
	const unusedNames = (res, ruleId) =>
		res.messages
			.filter((m) => m.ruleId === ruleId)
			.map((m) => m.message.match(/'([^']+)'/)[1])
			.sort();

	it('an import used only as a template tag is not reported as unused', async () => {
		const res = await lintWith(
			[js.configs.recommended, ...plugin.configs.recommended],
			fixture('template-components.pzl'),
			'template-components.pzl',
		);
		expect(res.messages.filter((m) => m.fatal)).toEqual([]);
		// Plain, family-root, Unicode and `_` tags all count; the truly unused
		// import and the const read only by `{ title }` are still reported.
		expect(unusedNames(res, 'no-unused-vars')).toEqual(['Unused', 'title']);
	});

	it('works with @typescript-eslint/no-unused-vars on a lang="ts" block', async () => {
		const res = await lintWith(
			[
				...plugin.configs.recommended,
				...tsConfig,
				{ files: TS_BLOCKS, rules: { '@typescript-eslint/no-unused-vars': 'error' } },
			],
			fixture('template-components-ts.pzl'),
			'template-components-ts.pzl',
		);
		expect(res.messages.filter((m) => m.fatal)).toEqual([]);
		expect(unusedNames(res, '@typescript-eslint/no-unused-vars')).toEqual(['Unused', 'title']);
	});

	it('a tag inside a comment, {#raw}, string or attribute value is not a use', async () => {
		const res = await lintWith(
			[js.configs.recommended, ...plugin.configs.recommended],
			fixture('template-components-hidden.pzl'),
			'template-components-hidden.pzl',
		);
		expect(res.messages.filter((m) => m.fatal)).toEqual([]);
		expect(unusedNames(res, 'no-unused-vars')).toEqual(
			[
				'InAttr',
				'InSingle',
				'InHtmlComment',
				'InBlockComment',
				'InInlineComment',
				'InRaw',
				'InString',
				'InTemplate',
				'InProp',
			].sort(),
		);
	});

	it('accepts constructor and indexed-map selectors with spread props, marking module reads as used', async () => {
		const src = `<puzzle-view>
  <section>
    <Component is={TaskCard} title={title} onclose={close} {...embed.props}><p>default slot</p></Component>
    <Component is={embeds[kind]} {...embed.props ?? { label: '</puzzle-view><InSpread/>' }}><SlotCard/></Component>
  </section>
</puzzle-view>
<puzzle-skeleton><Component is={Loading}/></puzzle-skeleton>
<script>
import TaskCard from './TaskCard.pzl';
import BacktestCard from './BacktestCard.pzl';
import SlotCard from './SlotCard.pzl';
import Loading from './Loading.pzl';
import InSpread from './InSpread.pzl';
const embeds = { backtest: BacktestCard };
const kind = 'backtest';
const title = 'data props do not read module bindings';
export default class Page {}
</script>`;
		const res = await lintWith([js.configs.recommended, ...plugin.configs.recommended], src, 'component-slot.pzl');
		expect(res.messages.filter((m) => m.fatal || m.ruleId === 'puzzle/no-invalid-sections')).toEqual([]);
		expect(unusedNames(res, 'no-unused-vars')).toEqual(['InSpread', 'title']);
	});

	it('keeps name and from props in data scope beside an is selector', async () => {
		const src = `<puzzle-view><Component is={Selected} name={name} from={from}/></puzzle-view>
<script>
import Selected from './Selected.pzl';
const name = 'module name';
const from = {};
export default class Page {}
</script>`;
		const res = await lintWith([js.configs.recommended, ...plugin.configs.recommended], src, 'ordinary-props.pzl');
		expect(res.messages.filter((m) => m.fatal)).toEqual([]);
		expect(unusedNames(res, 'no-unused-vars')).toEqual(['from', 'name']);
	});

	it('does not treat reserved Component tags or a reserved family root as an import use', async () => {
		const src = `<puzzle-view><Component is={current}/><Component.Card/></puzzle-view>
<script>import Component from './Component.pzl'; export default class Page {}</script>`;
		const res = await lintWith([js.configs.recommended, ...plugin.configs.recommended], src, 'reserved-component.pzl');
		expect(res.messages.filter((m) => m.fatal)).toEqual([]);
		expect(unusedNames(res, 'no-unused-vars')).toEqual(['Component']);
	});

	it('finds selector reads without marking strings, property keys or arrow parameters', async () => {
		const src = `<puzzle-view>
  <Component is={cards.find(Card => Card.name === 'InString') ?? { InKey: Selected }.value}/>
</puzzle-view>
<script>
import Selected from './Selected.pzl';
import Card from './Card.pzl';
import InKey from './InKey.pzl';
import InString from './InString.pzl';
const cards = [];
export default class Page {}
</script>`;
		const res = await lintWith([js.configs.recommended, ...plugin.configs.recommended], src, 'selector-scopes.pzl');
		expect(res.messages.filter((m) => m.fatal)).toEqual([]);
		expect(unusedNames(res, 'no-unused-vars')).toEqual(['Card', 'InKey', 'InString']);
	});

	it('keeps module names unused when loop items or snippet parameters shadow selectors', async () => {
		const src = `<puzzle-view>
  <List><Snippet Card><Component is={Card}/></Snippet></List>
  {#for Row in rows, Index}<Component is={Row}/><Component is={maps[Index]}/>{/for}
  <Component is={After}/>
</puzzle-view>
<script>
import List from './List.pzl';
import Card from './Card.pzl';
import Row from './Row.pzl';
import Index from './Index.pzl';
import After from './After.pzl';
const maps = {};
export default class Page {}
</script>`;
		const res = await lintWith([js.configs.recommended, ...plugin.configs.recommended], src, 'template-scopes.pzl');
		expect(res.messages.filter((m) => m.fatal)).toEqual([]);
		expect(unusedNames(res, 'no-unused-vars')).toEqual(['Card', 'Index', 'Row']);
	});

	it('marks module selectors in TypeScript without changing the script offsets', async () => {
		const src = `<puzzle-view><Component is={Card}/></puzzle-view>
<script lang="ts">import Card from './Card.pzl'; const unused: number = 1; export default class Page {}</script>`;
		const res = await lintWith(
			[...plugin.configs.recommended, ...tsConfig, { files: TS_BLOCKS, rules: { '@typescript-eslint/no-unused-vars': 'error' } }],
			src,
			'dynamic-ts.pzl',
		);
		expect(res.messages.filter((m) => m.fatal)).toEqual([]);
		expect(unusedNames(res, '@typescript-eslint/no-unused-vars')).toEqual(['unused']);
	});

	it('without the rule, tag-only imports are reported (the rule is what marks them)', async () => {
		const res = await lintWith(
			[
				js.configs.recommended,
				...plugin.configs.recommended,
				{ files: ['**/*.pzl/*_scripts.js'], rules: { 'puzzle/uses-template-components': 'off' } },
			],
			fixture('template-components.pzl'),
			'template-components.pzl',
		);
		expect(unusedNames(res, 'no-unused-vars')).toEqual(
			['Frame', 'Placeholder', 'StateGroup', 'Unused', '_Hidden', 'title', 'Élan', 'Ωmega'].sort(),
		);
	});
});

// The <style> body is a CSS block. ESLint lints it only once a config gives
// `**/*.css` a language (@eslint/css here); positions and fixes map the way the
// <script> block's do, and without a CSS config nothing changes.
describe('CSS blocks', () => {
	const cssEntry = { files: ['**/*.css'], language: 'css/css', ...css.configs.recommended };
	const cssConfig = [...plugin.configs.recommended, cssEntry];
	const view = '<puzzle-view><div class="card"></div></puzzle-view>\n';
	const script = '<script>\nconst unused = 1;\nexport default class Card {}\n</script>\n';
	const crlf = (s) => s.replaceAll('\n', '\r\n');
	const found = (res) => res.messages.map((m) => [m.ruleId, m.line, m.column]);

	// [source, line, column] of the `colr` typo.
	const cases = {
		'style after script': [`${view}${script}<style>\n.card { colr: red; }\n</style>\n`, 7, 9],
		'style before script': [`${view}<style>\n.card { colr: red; }\n</style>\n${script}`, 3, 9],
		'scoped, body on the tag line': [`${view}<style scoped>.card { colr: red; }</style>\n`, 2, 23],
		crlf: [crlf(`${view}${script}<style scoped>\n\t.card { colr: red; }\n</style>\n`), 7, 10],
		'bom + crlf': [`\uFEFF${crlf(`${view}<style scoped>\n\t.card { colr: red; }\n</style>\n`)}`, 3, 10],
	};
	for (const [name, [src, line, column]] of Object.entries(cases)) {
		it(`reports a style problem on its .pzl line and column (${name})`, async () => {
			expect(found(await lintWith(cssConfig, src, 'Card.pzl'))).toEqual([['css/no-invalid-properties', line, column]]);
		});
	}

	for (const [name, wrap] of Object.entries({ lf: (s) => s, 'bom + crlf': (s) => `\uFEFF${crlf(s)}` })) {
		it(`autofixes only the style body, and a second run is clean (${name})`, async () => {
			// Style before script: the fix lands before the <script> body.
			const head = `${view}<style scoped>\n@import 'a.css';\n`;
			const tail = `.card { color: red; }\n</style>\n${script}`;
			const eslint = new ESLint({ cwd: here, overrideConfigFile: true, overrideConfig: cssConfig, fix: true });
			const [res] = await eslint.lintText(wrap(`${head}@import 'a.css';\n${tail}`), { filePath: 'Card.pzl' });
			expect(res.output).toBe(wrap(head + tail));
			expect((await lintWith(cssConfig, res.output, 'Card.pzl')).messages).toEqual([]);
		});
	}

	it('reports a script problem and a style problem in one file', async () => {
		const res = await lintWith(
			[{ files: ['**/*.js'], ...js.configs.recommended }, ...cssConfig],
			`${view}<style>\n.card { colr: red; }\n</style>\n${script}`,
			'Card.pzl',
		);
		expect(found(res)).toEqual([
			['no-unused-vars', 6, 7],
			['css/no-invalid-properties', 3, 9],
		]);
	});

	it('a file with no <style> lints as before', async () => {
		const res = await lintWith(cssConfig, fixture('template-components.pzl'), 'template-components.pzl');
		expect(res.messages).toEqual([]);
	});

	// No `files` entry matches the CSS block, so ESLint skips it: no
	// "No matching configuration" warning, no CSS parsed as JavaScript.
	it('without a CSS config, a <style> body is not linted at all', async () => {
		const src = `${view}${script}<style>\n.card { colr: red; }\n.empty {}\n</style>\n`;
		const res = await lintWith([js.configs.recommended, ...plugin.configs.recommended], src, 'Card.pzl');
		expect(found(res)).toEqual([['no-unused-vars', 3, 7]]);
	});
});
