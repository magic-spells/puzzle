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

// D150 {#raw} blocks. findTemplateClose steps over a whole raw span the way
// sections.go and the compiler's lexer do (scanBlockRaw: the first tolerant
// closer wins), so nothing in a raw body is read. {/raw} also stays a
// STRUCTURAL block closer for the ordinary group scan, so a stray one's slash is
// never mistaken for a regex opener that runs past the close tag.
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
		const tpl = '{#raw}{#if ok}{ value.toUpperCase() }{:else}{#comment}x{/comment}{/if}{/raw}';
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

// The {#raw} span skip (sections.go findTemplateClose, ported from
// TestSplitSectionsRawBlockIsInert / TestSplitSectionsUnterminatedRawBlock).
// Every expectation below was cross-checked against the Go SplitSections on the
// same input. Before the skip, each "inert" case ran the brace scan past
// </puzzle-view> into this script, whose quote parity then decided the result.
describe('splitSections — {#raw} spans are skipped whole (D150)', () => {
	const script = `

<script>
import { PuzzleView } from '@magic-spells/puzzle';
import Avatar from './Avatar.pzl';
import PageCard from './PageCard.pzl';

export default class Docs extends PuzzleView {
  data(params, props) {
    // Pages I'm linking to (and not this one), newest first, capped at
    // three. Filtering/sorting live here, not in the template.
    const pages = this.ctx.store
      .findMany('page', { filter: (p) => p.id !== 'docs' && !p.draft })
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, 3);
    return { pages };
  }
}
</script>
`;
	const inert = [
		['docs page', "<p>{#raw}Write { to open an interpolation — don't forget the }.{/raw}</p>"],
		['code sample with // it\'s', "<pre>{#raw}function greet(name) {\n  // it's a sample{/raw}</pre>"],
		['odd quote between balanced braces', "<p>{#raw}Use { user's name } here{/raw}</p>"],
		['unbalanced brace, no quote', '<p>{#raw}The brace { is special.{/raw}</p>'],
		['tolerant closer {/ raw }', "<p>{#raw}{ it's{/ raw }</p>"],
		['tolerant closer {/raw }', "<p>{#raw}{ it's{/raw }</p>"],
		['spaced opener {# raw}', "<p>{# raw}{ it's{/raw}</p>"],
		['spaced opener with a suffix {#  raw json}', "<p>{#  raw json}{ it's{/raw}</p>"],
		// A literal close tag inside the span does not end the section.
		['literal </puzzle-view> in the body', '<pre>{#raw}<puzzle-view>{ sample }</puzzle-view>{/raw}</pre>'],
		['literal </template> in the body', '<pre>{#raw}<template>{ x </template>{/raw}</pre>'],
		['literal </script> in the body', "<pre>{#raw}<script>const s = '{';</script>{/raw}</pre>"],
	];
	for (const [name, body] of inert) {
		it(name, () => {
			const template = '\n  ' + body + '\n';
			const { sections, errors } = splitSections('<puzzle-view>' + template + '</puzzle-view>' + script, 'Docs.pzl');
			expect(errors).toEqual([]);
			expect(sections.view.content).toBe(template);
			expect(sections.scripts.content).toContain('class Docs');
		});
	}

	it('skeleton body', () => {
		const skeleton = "<p>{#raw}Write { to open — don't forget.{/raw}</p>";
		const src = '<puzzle-view><p>x</p></puzzle-view>\n<puzzle-skeleton>' + skeleton + '</puzzle-skeleton>' + script;
		const { sections, errors } = splitSections(src, 'Docs.pzl');
		expect(errors).toEqual([]);
		expect(sections.skeleton.content).toBe(skeleton);
		expect(sections.scripts.content).toContain('class Docs');
	});

	it('a literal </puzzle-skeleton> inside a skeleton raw body', () => {
		const skeleton = '<pre>{#raw}</puzzle-skeleton>{ x{/raw}</pre>';
		const src = '<puzzle-view><p>x</p></puzzle-view>\n<puzzle-skeleton>' + skeleton + '</puzzle-skeleton>' + script;
		const { sections, errors } = splitSections(src, 'Docs.pzl');
		expect(errors).toEqual([]);
		expect(sections.skeleton.content).toBe(skeleton);
	});

	it('the keyword is exact: {#rawx} is an ordinary group', () => {
		// As {#raw} the span would run to {/raw}; as {#rawx} the first
		// </puzzle-view> closes the view and the rest is stray content.
		expect(splitSections('<puzzle-view>{#raw}</puzzle-view>{/raw}</puzzle-view>\n', 'x.pzl').sections.view.content).toBe(
			'{#raw}</puzzle-view>{/raw}',
		);
		const { errors } = splitSections('<puzzle-view>{#rawx}</puzzle-view>{/raw}</puzzle-view>\n', 'x.pzl');
		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatchObject({ line: 1, column: 35 });
		expect(errors[0].message).toMatch(/^unexpected content outside a section/);
	});

	it('a 40 KB raw block of { splits in linear time', () => {
		const body = '<pre>{#raw}' + '{'.repeat(40000) + '{/raw}</pre>';
		const start = performance.now();
		const { sections, errors } = splitSections('<puzzle-view>' + body + '</puzzle-view>\n', 'x.pzl');
		const ms = performance.now() - start;
		expect(errors).toEqual([]);
		expect(sections.view.content).toBe(body);
		expect(ms).toBeLessThan(200);
	});
});

// A {#raw} with no {/raw} of its own must not hide the section's real close tag.
// The first close tag seen inside a skipped span is kept as a FALLBACK, returned
// only when no close tag follows; the compiler's lexer then reports
// "unterminated {#raw}" at the opener.
describe('splitSections — unterminated {#raw} (D150)', () => {
	it('no closer anywhere: splits at the real close', () => {
		const src = "<puzzle-view>\n<p>{#raw}{ it's</p>\n</puzzle-view>\n<script>\n// the view's script\n</script>\n";
		const { sections, errors } = splitSections(src, 'F.pzl');
		expect(errors).toEqual([]);
		expect(sections.view.content).toBe("\n<p>{#raw}{ it's</p>\n");
		expect(sections.scripts.content).toBe("\n// the view's script\n");
	});

	it('next closer in the skeleton: splits at the real close', () => {
		const src =
			"<puzzle-view>\n<p>{#raw}{ it's</p>\n</puzzle-view>\n<puzzle-skeleton><pre>{#raw}{ x }{/raw}</pre></puzzle-skeleton>\n<script></script>\n";
		const { sections, errors } = splitSections(src, 'F.pzl');
		expect(errors).toEqual([]);
		expect(sections.view.content).toBe("\n<p>{#raw}{ it's</p>\n");
		expect(sections.skeleton.content).toBe('<pre>{#raw}{ x }{/raw}</pre>');
	});

	it('the only close tag is inside the span: the fallback is used', () => {
		const { sections, errors } = splitSections('<puzzle-view><pre>{#raw}<b></puzzle-view>', 'F.pzl');
		expect(errors).toEqual([]);
		expect(sections.view.content).toBe('<pre>{#raw}<b>');
	});

	it('the FIRST close tag inside the span is the fallback', () => {
		const { sections, errors } = splitSections('<puzzle-view>{#raw}a</puzzle-view>b</puzzle-view>', 'F.pzl');
		expect(sections.view.content).toBe('{#raw}a');
		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatchObject({ line: 1, column: 35 });
	});

	it('an opener with no } runs to end of input', () => {
		const { sections, errors } = splitSections('<puzzle-view><p>{#raw</p></puzzle-view>\n', 'F.pzl');
		expect(errors).toEqual([]);
		expect(sections.view.content).toBe('<p>{#raw</p>');
	});
});

// HTML void elements (area base br col embed hr img input link meta source track
// wbr) are legal without a slash since #172. The splitter never parses elements,
// so neither spelling may move a section boundary; the parser owns the rule and
// the </input>-style closer error.
describe('splitSections — void elements', () => {
	it('void tags with and without a slash leave the sections intact', () => {
		const tpl =
			'\n<p>a<br>b<br/>c<br />d</p>\n<input type="text" value={ x } readonly>\n' +
			'<img src="a.png"><hr><wbr><area><base><col><embed><link><meta charset="utf-8"><source><track>\n';
		const { sections, errors } = splitSections(`<puzzle-view>${tpl}</puzzle-view>\n<script>\nexport default 1;\n</script>\n`, 'x.pzl');
		expect(errors).toEqual([]);
		expect(sections.view.content).toBe(tpl);
		expect(sections.scripts.content).toBe('\nexport default 1;\n');
	});

	it('a void closer is not the splitter\'s error to report', () => {
		const { sections, errors } = splitSections('<puzzle-view><input></input></puzzle-view>\n', 'x.pzl');
		expect(errors).toEqual([]);
		expect(sections.view.content).toBe('<input></input>');
	});
});

// 0.7.0 grammar (D167 dotted component tags, the \{ \} brace escape, the
// {#for} range steer). The splitter never parses template tags or block
// headers — sections.go does not either — so the whole point of these cases is
// that none of them desyncs a section boundary. Component-name validation and
// the for-header steer are the COMPILER's job; this port must not grow its own
// opinion about either, or it would reject files the real compiler accepts.
describe('splitSections — 0.7.0 template grammar', () => {
	const wrap = (tpl, tail = '<script>\nexport default 1;\n</script>\n') =>
		`<puzzle-view>${tpl}</puzzle-view>\n${tail}`;

	it('carves a file whose template uses dotted family tags (D167)', () => {
		const tpl = '<Frame><Frame.Header>hi</Frame.Header><Frame.Body.Inner/></Frame>';
		const { sections, errors } = splitSections(wrap(tpl), 'x.pzl');
		expect(errors).toEqual([]);
		expect(sections.view.content).toBe(tpl);
		expect(sections.scripts.content).toBe('\nexport default 1;\n');
	});

	it('passes an INVALID capitalized tag name through without an opinion', () => {
		// <Frame-x>, <Frame:Wrapper>, <Frame.> and <Slot.Foo> are positioned
		// compile errors (D167), but they are template-grammar errors the
		// compiler reports one stage later. The splitter's contract is to carve
		// the file so the <script> body still gets linted.
		for (const tag of ['<Frame-x/>', '<Frame:Wrapper/>', '<Frame./>', '<Slot.Foo/>']) {
			const { sections, errors } = splitSections(wrap(tag), 'x.pzl');
			expect(errors, tag).toEqual([]);
			expect(sections.view.content, tag).toBe(tag);
			expect(sections.scripts.content, tag).toBe('\nexport default 1;\n');
		}
	});

	it('honors the \\{ \\} brace escape in template text', () => {
		const tpl = '<p>a literal \\{ brace \\} is not a group</p>';
		const { sections, errors } = splitSections(wrap(tpl), 'x.pzl');
		expect(errors).toEqual([]);
		expect(sections.view.content).toBe(tpl);
		expect(sections.scripts.content).toBe('\nexport default 1;\n');
	});

	it('handles a brace escape adjacent to an interpolation', () => {
		// \{{ name }\} — an escaped brace, a real group, an escaped brace. Read
		// the first two bytes as an unescaped '{' and the group scan would open
		// one brace too early and run past </puzzle-view>.
		const tpl = '<p>\\{{ name }\\} and { name }</p>';
		const { sections, errors } = splitSections(wrap(tpl), 'x.pzl');
		expect(errors).toEqual([]);
		expect(sections.view.content).toBe(tpl);
		expect(sections.scripts.content).toBe('\nexport default 1;\n');
	});

	it('an escaped closing brace does not close an enclosing group', () => {
		const tpl = '<p>{ a }\\}</p>';
		const { sections, errors } = splitSections(wrap(tpl, '<style>\n.a { color: red; }\n</style>\n'), 'x.pzl');
		expect(errors).toEqual([]);
		expect(sections.view.content).toBe(tpl);
		expect(sections.styles.content).toBe('\n.a { color: red; }\n');
	});

	it('passes both {#for} range spellings through, valid and steered', () => {
		// {#for 1...5, i} is the documented form; {#for i in 1...5} is now a
		// positioned compiler error. Both are just template bytes here.
		for (const header of ['{#for 1...5, i}', '{#for i in 1...5}']) {
			const tpl = `<ul>${header}<li>{ i }</li>{/for}</ul>`;
			const { sections, errors } = splitSections(wrap(tpl), 'x.pzl');
			expect(errors, header).toEqual([]);
			expect(sections.view.content, header).toBe(tpl);
			expect(sections.scripts.content, header).toBe('\nexport default 1;\n');
		}
	});

	it('splits the 0.7.0 grammar fixture with zero structural errors', () => {
		const src = fixture('grammar-0-7.pzl');
		const { sections, errors } = splitSections(src, 'grammar-0-7.pzl');
		expect(errors).toEqual([]);
		expect(sections.view.content).toContain('<Frame.Header>');
		expect(sections.view.content).toContain('\\{{ count }\\}');
		expect(sections.view.content).toContain('{#for 1...5, i}');
		expect(sections.styles.scoped).toBe(true);
		// The whole file was carved: the script body is the real one, and its
		// span round-trips byte for byte.
		expect(sections.scripts.content).toContain('export default class GrammarSpecimen');
		expect(src.slice(sections.scripts.contentStart, sections.scripts.contentEnd)).toBe(sections.scripts.content);
	});
});

// 0.8.0 template expressions (D176): JavaScript-shaped values — library
// functions, methods from the method table, arrow functions as call arguments,
// object literals and template literals. The splitter never parses a template
// value — sections.go does not either — so these pin only that the new shapes
// cannot desync a section boundary, and that values the compiler rejects still
// carve cleanly so the <script> is linted.
describe('splitSections — 0.8.0 template expressions', () => {
	const wrap = (tpl, tail = '<script>\nexport default 1;\n</script>\n') =>
		`<puzzle-view>${tpl}</puzzle-view>\n${tail}`;
	const closingScript = '<script>\nconst re = /}/;\n</script>\n';

	it('carves function calls, methods and object-literal arguments in attributes and props', () => {
		const tpl =
			"<Frame.Wrapper title={ truncate(name.trim(), 20) } class=\"card { tone ?? 'plain' }\">" +
			"{ t('cart.count', { count: items.length, unit }) }</Frame.Wrapper>";
		const { sections, errors } = splitSections(wrap(tpl), 'x.pzl');
		expect(errors).toEqual([]);
		expect(sections.view.content).toBe(tpl);
		expect(sections.scripts.content).toBe('\nexport default 1;\n');
	});

	it('skips a brace string inside an object-literal argument', () => {
		// A misread '}' string closes the interpolation early; a misread '{' runs
		// it away. Either way the regex in <script> would land the boundary wrong.
		const tpl = "<p>{ t('k', { close: '}', open: '{' }) }</p>";
		const { sections, errors } = splitSections(wrap(tpl, closingScript), 'x.pzl');
		expect(errors).toEqual([]);
		expect(sections.view.content).toBe(tpl);
		expect(sections.scripts.content).toBe('\nconst re = /}/;\n');
	});

	it('skips braces inside template literals, in the static text and in ${…}', () => {
		for (const tpl of [
			'<p>{ `${items.length} }` }</p>',
			"<p>{ `{${tone ?? '}'}}` }</p>",
			'<p>{ `${ { a: 1 }.a } and ${`nested ${x} }`}` }</p>',
			'<p title={ `</puzzle-view> ${name}` }>x</p>',
		]) {
			const { sections, errors } = splitSections(wrap(tpl, closingScript), 'x.pzl');
			expect(errors, tpl).toEqual([]);
			expect(sections.view.content, tpl).toBe(tpl);
			expect(sections.scripts.content, tpl).toBe('\nconst re = /}/;\n');
		}
	});

	it('reads arrow functions, division and comparison without opening a regex', () => {
		// `=>` and `>` are plain operators; a `/` after `)` or an identifier is
		// division. A misread regex would swallow up to the `/` in the script.
		for (const tpl of [
			'{#for n in items.toSorted((a, b) => b - a)}<i>{ n }</i>{/for}',
			'{#if items.some(n => n.qty > 1)}<b>{ items.filter(n => n.done).length / total }</b>{/if}',
			"<p>{ tags.map((tag, i) => `${i}:${tag.toUpperCase()}`).join(', ') }</p>",
			'<p>{ Math.round(total * 100) / 100 }</p>',
			'<li @click={ pick(n, event.target.dataset.i) }>x</li>',
		]) {
			const { sections, errors } = splitSections(wrap(tpl, closingScript), 'x.pzl');
			expect(errors, tpl).toEqual([]);
			expect(sections.view.content, tpl).toBe(tpl);
			expect(sections.scripts.content, tpl).toBe('\nconst re = /}/;\n');
		}
	});

	it('carves template values the compiler rejects without an opinion', () => {
		// A method outside the method table, `this`, `new`, a bitwise `|` and a
		// leading object literal are positioned COMPILE errors (D176), one stage
		// later than the splitter.
		for (const tpl of [
			'{ items.sort() }',
			'{ this.label }',
			'{ new Date() }',
			'{ a | b }',
			'{#if flags & 1}x{/if}',
			'{ {a: 1} }',
		]) {
			const { sections, errors } = splitSections(wrap(`<p>${tpl}</p>`), 'x.pzl');
			expect(errors, tpl).toEqual([]);
			expect(sections.scripts.content, tpl).toBe('\nexport default 1;\n');
		}
	});

	it('splits the 0.8.0 fixture with zero structural errors', () => {
		const src = fixture('grammar-0-8.pzl');
		const { sections, errors } = splitSections(src, 'grammar-0-8.pzl');
		expect(errors).toEqual([]);
		expect(sections.view.content).toContain('<Frame.Wrapper title={ truncate(name.trim(), 20) }');
		expect(sections.view.content).toContain("{ `{${tone ?? '}'}}` }");
		expect(sections.view.content).toContain('<pre>\n    keep   these\n\tbytes exactly\n  </pre>');
		expect(sections.view.content.trimEnd().endsWith('</textarea>')).toBe(true);
		expect(sections.styles.scoped).toBe(true);
		expect(sections.scripts.content).toContain('export default class GrammarSpecimen');
		expect(src.slice(sections.scripts.contentStart, sections.scripts.contentEnd)).toBe(sections.scripts.content);
	});
});

// Mirrors the lexskip.go fix for division after a non-ASCII name, a
// trailing-dot number, or a field named `of`. Each of those used to leave the
// scanner expecting an operand, so the '/' opened a bogus regex that ran to the
// '/' of the script's /}/ and landed the section boundary in the wrong place.
// Every UTF-16 unit of a non-ASCII character is >= 0x80, as every UTF-8 byte
// is, so a surrogate pair (CJK Extension B, emoji) behaves like Go's
// multi-byte run.
describe('splitSections — division after a non-ASCII name, `5.` or `of`', () => {
	const wrap = (tpl, tail) => `<puzzle-view>${tpl}</puzzle-view>\n${tail}`;
	const closingScript = '<script>\nconst re = /}/;\n</script>\n';

	it('reads the / as division in every template position', () => {
		for (const tpl of [
			'<p>{ café / 2 }</p>',
			'<p title={ 金額 / 2 }>x</p>',
			'{#if 価格 / 2 > 1}<b>y</b>{/if}',
			'<p>{ items.map(радиус => радиус / 2) }</p>',
			'<p>{ round(π / 2) }</p>',
			'<p title="a { café / 2 } b">x</p>',
			'{#case n}{:when 金額 / 2, 0}<b>z</b>{/case}',
			'{#for x in 一覧.slice(総数 / 2), i}<b>{ x }</b>{/for}',
			'<p>{ 価格new / 2 }</p>',
			'<p>{ 価格return / 2 }</p>',
			'<p>{ 5. / 2 }</p>',
			'<p>{ of / 2 }</p>',
			'<p>{ a /2}</p>',
			'<p>{ a/ 2 }</p>',
			'<p>{ a / b / c }</p>',
			// Astral characters are two UTF-16 units, both >= 0x80.
			'<p>{ 𠀀 / 2 }</p>',
			'<p>{ 𠀀new / 2 }</p>',
			'<p>{ 😀 / 2 }</p>',
			'<p>{ x😀 / 2 }</p>',
		]) {
			const { sections, errors } = splitSections(wrap(tpl, closingScript), 'x.pzl');
			expect(errors, tpl).toEqual([]);
			expect(sections.view.content, tpl).toBe(tpl);
			expect(sections.scripts.content, tpl).toBe('\nconst re = /}/;\n');
		}
	});

	it('still reads a regex in <script> after (, = and return', () => {
		// A regex holding a quote must stay opaque, or the quote opens a string
		// that swallows </script>. A division after a non-ASCII name in the same
		// body is still division.
		for (const body of [
			"\nconst half = 金額 / 2;\nconst quote = /'/;\nexport default class A {}\n",
			"\nconst half = 𠀀 / 2;\nfoo(/'/);\nexport default class A {}\n",
			"\nfunction f() { return /'/; }\nconst r = café / 2;\n",
			'\nconst re = /}/;\nconst n = 5. / 2;\n',
			"\nconst tick = x.replace(/`([^`]+)`/g, '$1');\n",
		]) {
			const src = wrap('<p>x</p>', `<script>${body}</script>\n<style>p { color: red }</style>\n`);
			const { sections, errors } = splitSections(src, 'x.pzl');
			expect(errors, body).toEqual([]);
			expect(sections.scripts.content, body).toBe(body);
			expect(sections.styles.content, body).toBe('p { color: red }');
		}
	});

	it('still reads a regex after a keyword that cannot end an expression', () => {
		// `(a + /}/.source)` and `typeof /}/` keep their regex reading, so the
		// '}' inside the literal does not close the interpolation.
		for (const tpl of ['<b>{ (a + /}/.source).length }</b>', '<b>{ typeof /}/ }</b>']) {
			const { sections, errors } = splitSections(wrap(tpl, '<script>\nexport default 1;\n</script>\n'), 'x.pzl');
			expect(errors, tpl).toEqual([]);
			expect(sections.view.content, tpl).toBe(tpl);
		}
	});
});
