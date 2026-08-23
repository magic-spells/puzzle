import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ESLint } from 'eslint';
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

describe('processor.preprocess', () => {
	it('extracts one .js block for a JS file, positions preserved', () => {
		const src = fixture('basic-js.pzl');
		const blocks = processor.preprocess(src, 'basic-js.pzl');
		expect(blocks).toHaveLength(1);
		expect(blocks[0].filename).toBe('0_scripts.js');
		const virtual = blocks[0].text;
		// Same length → offsets identical.
		expect(virtual.length).toBe(src.length);
		// Every newline preserved at the same index.
		for (let i = 0; i < src.length; i++) {
			if (src[i] === '\n' || src[i] === '\r') expect(virtual[i]).toBe(src[i]);
		}
		// The <script> body is byte-identical; outside it is blanked to spaces.
		expect(virtual).toContain('export default class Counter');
		expect(virtual).not.toContain('puzzle-view');
		expect(virtual).not.toContain('color: red');
	});

	it('names the block .ts for lang="ts"', () => {
		const blocks = processor.preprocess(fixture('basic-ts.pzl'), 'basic-ts.pzl');
		expect(blocks).toHaveLength(1);
		expect(blocks[0].filename).toBe('0_scripts.ts');
	});

	it('returns zero blocks for a file with no <script>', () => {
		const blocks = processor.preprocess(fixture('no-scripts.pzl'), 'no-scripts.pzl');
		expect(blocks).toEqual([]);
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

	// D141: paired composition markers — <Slot name="x">…</Slot>,
	// <Children>…</Children>, <Slot>…</Slot> with fallback bodies. The splitter
	// only finds section boundaries; it never parses template tags, so these are
	// inert template bytes. Pinned so a future template-grammar change cannot
	// silently start producing structural errors here.
	it('lints paired <Slot>/<Children> markers with no structural errors or fatals', async () => {
		const src = fixture('paired-markers.pzl');
		const blocks = processor.preprocess(src, 'paired-markers.pzl');
		expect(blocks).toHaveLength(1);
		expect(blocks[0].filename).toBe('0_scripts.js');
		// Positions preserved: the virtual file is the same length as the source.
		expect(blocks[0].text.length).toBe(src.length);
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
		expect(blocks).toHaveLength(1);
		expect(blocks[0].filename).toBe('0_scripts.js');
		// Positions preserved: the virtual file is the same length as the source.
		expect(blocks[0].text.length).toBe(src.length);
		// The template — raw bodies included — is blanked out of the JS block.
		expect(blocks[0].text).not.toContain('{#raw}');
		expect(blocks[0].text).not.toContain('"slides"');
		expect(blocks[0].text).toContain('const half = i++ / 2;');

		const res = await lint(src, { 'no-unused-vars': 'warn' }, { filePath: 'raw-block.pzl' });
		expect(res.messages.filter((m) => m.fatal)).toEqual([]);
		expect(res.messages.filter((m) => m.ruleId === 'puzzle/no-invalid-sections')).toEqual([]);
		expect(res.messages).toEqual([]);
	});

	it('a file with no <script> produces no JS messages', async () => {
		const res = await lint(fixture('no-scripts.pzl'), { 'no-unused-vars': 'warn' });
		expect(res.messages).toHaveLength(0);
	});
});
