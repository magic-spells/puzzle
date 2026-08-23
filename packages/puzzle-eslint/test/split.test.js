import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { splitSections, posAt } from '../src/split.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, 'fixtures', name), 'utf8');

describe('posAt', () => {
	it('is 1-based line/col, offset preserved, newline resets column', () => {
		const s = 'ab\ncd';
		expect(posAt(s, 0)).toEqual({ line: 1, col: 1, offset: 0 });
		expect(posAt(s, 2)).toEqual({ line: 1, col: 3, offset: 2 });
		expect(posAt(s, 3)).toEqual({ line: 2, col: 1, offset: 3 });
		expect(posAt(s, 4)).toEqual({ line: 2, col: 2, offset: 4 });
	});
});

describe('splitSections — happy paths', () => {
	it('splits a JS file with view, script, style', () => {
		const src = fixture('basic-js.pzl');
		const { sections, errors } = splitSections(src, 'basic-js.pzl');
		expect(errors).toEqual([]);
		expect(sections.view).not.toBeNull();
		expect(sections.scripts).not.toBeNull();
		expect(sections.styles).not.toBeNull();
		expect(sections.scripts.lang).toBe('');
		expect(sections.styles.scoped).toBe(true);
		// The extracted script body round-trips exactly.
		expect(src.slice(sections.scripts.contentStart, sections.scripts.contentEnd)).toBe(sections.scripts.content);
		expect(sections.scripts.content).toContain('export default class Counter');
	});

	it('marks a lang="ts" script', () => {
		const { sections, errors } = splitSections(fixture('basic-ts.pzl'), 'basic-ts.pzl');
		expect(errors).toEqual([]);
		expect(sections.scripts.lang).toBe('ts');
	});

	it('handles a file with no <script> section', () => {
		const { sections, errors } = splitSections(fixture('no-scripts.pzl'), 'no-scripts.pzl');
		expect(errors).toEqual([]);
		expect(sections.scripts).toBeNull();
		expect(sections.view).not.toBeNull();
		expect(sections.styles).not.toBeNull();
		expect(sections.styles.scoped).toBe(false);
	});
});

describe('splitSections — a literal </script> must not truncate the body', () => {
	it('ignores close tags inside strings, template literals, comments, and regexes', () => {
		const src = fixture('literal-close.pzl');
		const { sections, errors } = splitSections(src, 'literal-close.pzl');
		expect(errors).toEqual([]);
		// The real close is the last line; body includes the whole thing.
		expect(sections.scripts.content).toContain('export const real = a + b;');
		expect(sections.scripts.content).toContain('const re =');
		// Three literal </script> decoys stay inside the body (string, template
		// literal, comment); the regex line uses <\/script> so it is not a bare
		// close tag but is still correctly skipped as a regex literal.
		const decoys = sections.scripts.content.match(/<\/script>/g) || [];
		expect(decoys.length).toBe(3);
		expect(sections.scripts.content).toContain('/<\\/script>/');
	});

	it('ignores </style> inside a CSS string and comment', () => {
		const src = [
			'<puzzle-view><div/></puzzle-view>',
			'<style>',
			'.a { content: "</style>"; }',
			'/* </style> */',
			'.b { color: red; }',
			'</style>',
		].join('\n');
		const { sections, errors } = splitSections(src, 'x.pzl');
		expect(errors).toEqual([]);
		expect(sections.styles.content).toContain('.b { color: red; }');
		expect((sections.styles.content.match(/<\/style>/g) || []).length).toBe(2);
	});

	it('ignores a literal close tag inside a template ${...} interpolation string', () => {
		const src = [
			'<puzzle-view><div/></puzzle-view>',
			'<script>',
			'const x = `${ "</script>" }`;',
			'export default x;',
			'</script>',
		].join('\n');
		const { sections, errors } = splitSections(src, 'x.pzl');
		expect(errors).toEqual([]);
		expect(sections.scripts.content).toContain('export default x;');
	});
});

describe('splitSections — structural errors with positions', () => {
	it('missing <puzzle-view>', () => {
		const { errors } = splitSections('<script>\nconst a = 1;\n</script>\n', 'x.pzl');
		expect(errors).toHaveLength(1);
		expect(errors[0].message).toBe('missing <puzzle-view> section');
		expect(errors[0]).toMatchObject({ line: 1, column: 1 });
	});

	it('duplicate <script>', () => {
		const src = [
			'<puzzle-view><div/></puzzle-view>', // line 1
			'<script>const a = 1;</script>', //     line 2
			'<script>const b = 2;</script>', //     line 3
		].join('\n');
		const { sections, errors } = splitSections(src, 'x.pzl');
		expect(errors).toHaveLength(1);
		expect(errors[0].message).toBe('multiple <script> sections (only one allowed)');
		expect(errors[0]).toMatchObject({ line: 3, column: 1 });
		// The first script is retained for linting.
		expect(sections.scripts.content).toBe('const a = 1;');
	});

	it('duplicate <puzzle-view>', () => {
		const src = '<puzzle-view><a/></puzzle-view><puzzle-view><b/></puzzle-view>';
		const { errors } = splitSections(src, 'x.pzl');
		expect(errors[0].message).toBe('multiple <puzzle-view> sections (only one allowed)');
	});

	it('bad <script> lang value', () => {
		const src = '<puzzle-view><a/></puzzle-view>\n<script lang="typescript">const a=1;</script>';
		const { errors } = splitSections(src, 'x.pzl');
		expect(errors[0].message).toBe('unknown <script> lang "typescript" — expected "ts" (TypeScript) or "js" (JavaScript, the default) — did you mean "ts"?');
		// Position points at the `lang` attribute name on line 2.
		expect(errors[0].line).toBe(2);
		expect(errors[0].column).toBe(9);
	});

	it('extra attribute on <script>', () => {
		const src = '<puzzle-view><a/></puzzle-view>\n<script foo="bar">const a=1;</script>';
		const { errors } = splitSections(src, 'x.pzl');
		expect(errors[0].message).toBe('the only attribute allowed on <script> is `lang` (got "foo")');
	});

	it('valued scoped on <style>', () => {
		const src = '<puzzle-view><a/></puzzle-view>\n<style scoped="true">.a{}</style>';
		const { errors } = splitSections(src, 'x.pzl');
		expect(errors[0].message).toBe('`scoped` on <style> is a bare attribute — write <style scoped>, not scoped="…"');
	});

	it('near-miss style attribute gets a did-you-mean', () => {
		const src = '<puzzle-view><a/></puzzle-view>\n<style scopd>.a{}</style>';
		const { errors } = splitSections(src, 'x.pzl');
		expect(errors[0].message).toBe('the only attribute allowed on <style> is `scoped` (got "scopd") — did you mean `scoped`?');
	});

	it('bad min-duration on <puzzle-skeleton>', () => {
		const src = '<puzzle-view><a/></puzzle-view>\n<puzzle-skeleton min-duration="fast"><a/></puzzle-skeleton>';
		const { errors } = splitSections(src, 'x.pzl');
		expect(errors[0].message).toBe('`min-duration` on <puzzle-skeleton> must be a non-negative integer in ms (got "fast")');
	});

	it('accepts a valid min-duration', () => {
		const src = '<puzzle-view><a/></puzzle-view>\n<puzzle-skeleton min-duration="300"><a/></puzzle-skeleton>';
		const { sections, errors } = splitSections(src, 'x.pzl');
		expect(errors).toEqual([]);
		expect(sections.skeleton.minDuration).toBe(300);
	});

	it('stray top-level content', () => {
		const src = '<puzzle-view><a/></puzzle-view>\ngarbage here';
		const { errors } = splitSections(src, 'x.pzl');
		expect(errors[0].message).toContain('unexpected content outside a section');
		expect(errors[0].line).toBe(2);
	});

	it('a body truncated by a stray close tag surfaces as trailing content', () => {
		// This <style> body has an *unescaped* literal </style> in neither a
		// comment nor a string, so it really does close early and the rest is stray.
		const src = '<puzzle-view><a/></puzzle-view>\n<style>.a{}</style>\nleftover';
		const { errors } = splitSections(src, 'x.pzl');
		expect(errors[0].message).toContain('unexpected content after the <style> section');
	});

	it('missing close tag', () => {
		const src = '<puzzle-view><a/></puzzle-view>\n<script>const a = 1;';
		const { errors } = splitSections(src, 'x.pzl');
		expect(errors[0].message).toBe('missing </script> for <script>');
	});

	it('top-level HTML comments are allowed', () => {
		const src = '<!-- a comment -->\n<puzzle-view><a/></puzzle-view>\n<!-- another -->';
		const { errors } = splitSections(src, 'x.pzl');
		expect(errors).toEqual([]);
	});

	it('<scripts>/<styles> get the singular-name steering error', () => {
		// Mirrors misnamedSectionTagAt in sections.go: the plural spellings are the
		// common mistake and earn a specific message, not the generic stray one.
		const bad = splitSections('<puzzle-view><a/></puzzle-view>\n<scripts>\nconst a = 1;\n</scripts>\n', 'x.pzl');
		expect(bad.errors[0].message).toBe('<scripts> should be named <script>');
		expect(bad.errors[0]).toMatchObject({ line: 2, column: 1 });

		const bad2 = splitSections('<puzzle-view><a/></puzzle-view>\n<styles>.a{}</styles>\n', 'x.pzl');
		expect(bad2.errors[0].message).toBe('<styles> should be named <style>');

		// A boundary is required, so similarly prefixed markup is still ordinary
		// stray content rather than a misnamed section.
		const other = splitSections('<puzzle-view><a/></puzzle-view>\n<scriptsomething/>\n', 'x.pzl');
		expect(other.errors[0].message).toContain('unexpected content outside a section');
	});

	it('a leading BOM is an encoding marker, not stray content', () => {
		const src = '\uFEFF<puzzle-view><a/></puzzle-view>\n<script>const a = 1;</script>\n';
		const { sections, errors } = splitSections(src, 'x.pzl');
		expect(errors).toEqual([]);
		expect(sections.scripts.content).toBe('const a = 1;');
		// The BOM stays in src, so offsets still index the real file.
		expect(src.slice(sections.scripts.contentStart, sections.scripts.contentEnd)).toBe('const a = 1;');
	});
});

// Update operators are their own LexSkip case in lexskip.go: they preserve the
// incoming prevEndsExpr so a following '/' stays division. Without that case a
// postfix update turns `/ 2;\n</script>` into a "regex literal" that runs right
// past the close tag and the whole file goes unlinted.
describe('splitSections — ++/-- keep a following slash a division', () => {
	for (const expr of ['i++ / 2', 'i-- / 2', 'i++/2']) {
		it(`does not read the slash in \`${expr}\` as a regex literal`, () => {
			const src = `<puzzle-view><a/></puzzle-view>\n<script>\nconst half = ${expr};\n</script>\n`;
			const { sections, errors } = splitSections(src, 'x.pzl');
			expect(errors).toEqual([]);
			expect(sections.scripts.content).toBe(`\nconst half = ${expr};\n`);
		});
	}

	it('still opens a regex after a plain operator (a+++/re/)', () => {
		const src = '<puzzle-view><a/></puzzle-view>\n<script>\nconst r = a+++/re/.source;\n</script>\n';
		const { sections, errors } = splitSections(src, 'x.pzl');
		expect(errors).toEqual([]);
		expect(sections.scripts.content).toContain('a+++/re/.source');
	});
});

// D150 {#raw} blocks. The splitter never lexes a raw BODY — sections.go does not
// either; the compiler's raw-body skip lives one stage later, in the lexer. What
// the splitter must get right is that {/raw} is a STRUCTURAL block closer, so its
// slash is never mistaken for a regex opener that runs past the close tag.
describe('splitSections — {#raw} blocks (D150)', () => {
	const wrap = (tpl, tail = '<script>\nexport default 1;\n</script>\n') =>
		`<puzzle-view>${tpl}</puzzle-view>\n${tail}`;

	it('a brace-heavy JSON body leaves the sections intact', () => {
		const tpl = '{#raw}{ "loop": true, "slides": [{ "id": 1 }, { "id": 2 }], "labels": { "next": "}" } }{/raw}';
		const { sections, errors } = splitSections(wrap(tpl), 'x.pzl');
		expect(errors).toEqual([]);
		expect(sections.view.content).toBe(tpl);
		expect(sections.scripts.content).toBe('\nexport default 1;\n');
	});

	it('the opener suffix is ignored and lexing resumes after the closer', () => {
		// The canonical lexer_test.go case: {#raw json}{ x }{/raw }{ y }. The
		// splitter sees the whole thing as template bytes; what matters is that the
		// tolerant closer ends the block and { y } is still an ordinary group.
		const tpl = '{#raw json}{ x }{/raw }{ y }';
		const { sections, errors } = splitSections(wrap(tpl), 'x.pzl');
		expect(errors).toEqual([]);
		expect(sections.view.content).toBe(tpl);
		expect(sections.scripts.content).toBe('\nexport default 1;\n');
	});

	it('raw blocks do not nest — the first closer wins', () => {
		const tpl = '{#raw}outer {#raw} inner{/raw} tail';
		const { sections, errors } = splitSections(wrap(tpl), 'x.pzl');
		expect(errors).toEqual([]);
		expect(sections.view.content).toBe(tpl);
		expect(sections.scripts.content).toBe('\nexport default 1;\n');
	});

	it('tolerates whitespace in the closer ({/ raw }, {/raw })', () => {
		for (const closer of ['{/raw}', '{/ raw }', '{/raw }']) {
			const tpl = `<p>{#raw}x${closer}</p>`;
			const { sections, errors } = splitSections(wrap(tpl), 'x.pzl');
			expect(errors, closer).toEqual([]);
			expect(sections.view.content).toBe(tpl);
		}
	});

	it('template grammar inside a raw body is inert text', () => {
		const tpl = '{#raw}{#if ok}{ value | upper }{:else}{#comment}x{/comment}{/if}{/raw}';
		const { sections, errors } = splitSections(wrap(tpl), 'x.pzl');
		expect(errors).toEqual([]);
		expect(sections.view.content).toBe(tpl);
	});

	it('{/raw} is a block closer, not a regex opener, even with extra } later', () => {
		// The regression: with `raw` missing from blockCloseKeywords the slash in
		// {/raw} opened a "regex literal" that ran past </puzzle-view>, and any
		// later net-extra '}' (here a stray brace in the CSS) then closed the
		// runaway group — yielding a bogus "missing </puzzle-view>" and dropping
		// the <script> from linting entirely. The real compiler splits this fine.
		const src = [
			'<puzzle-view>{#raw}x{/raw}</puzzle-view>',
			'<style>',
			'.a { color: red; }}',
			'</style>',
			'<script>',
			'export default 1;',
			'</script>',
			'',
		].join('\n');
		const { sections, errors } = splitSections(src, 'x.pzl');
		expect(errors).toEqual([]);
		expect(sections.scripts.content).toBe('\nexport default 1;\n');
		expect(sections.styles.content).toBe('\n.a { color: red; }}\n');
	});

	it('splits the raw-block fixture with zero structural errors', () => {
		const src = fixture('raw-block.pzl');
		const { sections, errors } = splitSections(src, 'raw-block.pzl');
		expect(errors).toEqual([]);
		expect(sections.view.content).toContain('{#raw}');
		expect(sections.scripts.content).toContain('const half = i++ / 2;');
		expect(sections.styles.scoped).toBe(true);
		// The script span round-trips byte for byte.
		expect(src.slice(sections.scripts.contentStart, sections.scripts.contentEnd)).toBe(sections.scripts.content);
	});
});
