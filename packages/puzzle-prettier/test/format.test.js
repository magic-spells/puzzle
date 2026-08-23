import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { format, sectionMap } from './helpers.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, 'fixtures');
const read = (name) => readFileSync(join(fixturesDir, name), 'utf8');
const fixtures = readdirSync(fixturesDir).filter((f) => f.endsWith('.pzl'));

describe('script formatting', () => {
	it('formats a JS <script> body with babel', async () => {
		const out = await format(read('js-scripts.pzl'));
		expect(out).toContain('created() {\n    this.setData({ count: 0 });\n  }');
		expect(out).toContain('import { PuzzleView } from "@magic-spells/puzzle";');
	});

	it('formats a TS <script lang="ts"> body with typescript', async () => {
		const out = await format(read('ts-scripts.pzl'));
		expect(out).toContain('interface HomeModel {\n  title: string;\n  count: number;\n}');
		expect(out).toContain('data(params: Record<string, string>): HomeModel {');
		// the open tag with its lang attribute survives verbatim
		expect(out).toContain('<script lang="ts">');
	});

	it('leaves the template body and tags byte-identical', async () => {
		const input = read('ts-scripts.pzl');
		const out = await format(input);
		const a = sectionMap(input);
		const b = sectionMap(out);
		expect(b['puzzle-view'].inner).toBe(a['puzzle-view'].inner);
		expect(b['puzzle-view'].openTag).toBe(a['puzzle-view'].openTag);
		expect(b['script'].openTag).toBe(a['script'].openTag);
		expect(b['script'].closeTag).toBe(a['script'].closeTag);
	});
});

describe('style formatting', () => {
	it('formats a <style> body with the css parser', async () => {
		const out = await format(read('styles-scoped.pzl'));
		expect(out).toContain('.box {\n  color: red;\n  padding: 1rem;\n  margin: 0;\n}');
	});

	it('preserves the bare `scoped` attribute on the open tag', async () => {
		const out = await format(read('styles-scoped.pzl'));
		expect(out).toContain('<style scoped>');
	});
});

describe('skeleton and template-only files', () => {
	it('preserves <puzzle-skeleton> byte-for-byte and still formats script', async () => {
		const input = read('skeleton.pzl');
		const out = await format(input);
		const a = sectionMap(input);
		const b = sectionMap(out);
		expect(b['puzzle-skeleton'].inner).toBe(a['puzzle-skeleton'].inner);
		expect(b['puzzle-skeleton'].openTag).toBe(a['puzzle-skeleton'].openTag);
		expect(out).toContain('const post = await fetch(`/api/posts/${params.id}`).then((r) => r.json());');
	});

	it('handles a file with no <script> and no <style> (template preserved, one trailing newline)', async () => {
		const input = read('no-scripts.pzl');
		const out = await format(input);
		// only change allowed is the trailing newline normalization
		expect(out).toBe(input.replace(/\s*$/, '\n'));
	});
});

describe('literal close tags inside bodies must not truncate', () => {
	it('keeps a literal </script> inside strings, templates, comments, and regex', async () => {
		const input = read('scripts-literal-close.pzl');
		const out = await format(input);
		// all three sections must survive the round trip
		const b = sectionMap(out);
		expect(Object.keys(b).sort()).toEqual(['puzzle-view', 'script', 'style']);
		// the close-tag literals are still present inside the formatted body
		expect(out).toContain('const a = "</script>";');
		expect(out).toContain('const re = /<\\/script>/g;');
	});

	it('keeps a literal </style> inside CSS comments and strings', async () => {
		const input = read('styles-literal-close.pzl');
		const out = await format(input);
		const b = sectionMap(out);
		expect(Object.keys(b).sort()).toEqual(['puzzle-view', 'style']);
		expect(out).toContain('content: "</style>";');
	});
});

describe('gnarly template body is byte-preserved', () => {
	it('preserves brace groups, template comments, and HTML comments exactly', async () => {
		const input = read('gnarly-template.pzl');
		const out = await format(input);
		const a = sectionMap(input);
		const b = sectionMap(out);
		expect(b['puzzle-view'].inner).toBe(a['puzzle-view'].inner);
	});
});

describe('paired composition markers (D141)', () => {
	// The splitter works on section boundaries only — it never parses template
	// tags — so paired <Slot>/<Children> bodies are just template bytes. This
	// pins that: the whole <puzzle-view> body survives untouched for both the
	// paired and the self-closing marker forms, and the script/style around it
	// still format. Idempotency and the trailing-newline rule come free from
	// the fixture sweeps below.
	it('preserves paired <Slot>/<Children> fallback bodies byte-for-byte', async () => {
		const input = read('paired-markers.pzl');
		const out = await format(input);
		const a = sectionMap(input);
		const b = sectionMap(out);
		expect(b['puzzle-view'].inner).toBe(a['puzzle-view'].inner);
		expect(b['puzzle-view'].openTag).toBe(a['puzzle-view'].openTag);
		expect(Object.keys(b).sort()).toEqual(['puzzle-view', 'script', 'style']);
		// every marker spelling still present verbatim
		expect(out).toContain('<Slot name="header"><h2>{ title | capitalize }</h2></Slot>');
		expect(out).toContain('<Children>');
		expect(out).toContain('</Children>');
		expect(out).toContain("<Slot>{ count | number } remaining{#svg 'icons/empty.svg'}</Slot>");
		expect(out).toContain('<Children/>');
		expect(out).toContain('<Slot name="footer"/>');
		// the surrounding script and style still got formatted
		expect(out).toContain('import { PuzzleView } from "@magic-spells/puzzle";');
		expect(out).toContain('.paired {\n  color: red;\n}');
	});
});

describe('{#raw} blocks (D150)', () => {
	// The splitter is byte-naive about a raw BODY (sections.go has no {#raw} case
	// either), but the `raw` closer keyword is load-bearing in lex.js: without it
	// the '/' in {/raw} reads as a regex opener and scanBraceGroup runs away past
	// the section's real close tag.
	it('preserves every raw span byte-for-byte and still formats script + style', async () => {
		const input = read('raw-block.pzl');
		const out = await format(input);
		const a = sectionMap(input);
		const b = sectionMap(out);
		expect(b['puzzle-view'].inner).toBe(a['puzzle-view'].inner);
		expect(b['puzzle-view'].openTag).toBe(a['puzzle-view'].openTag);
		expect(Object.keys(b).sort()).toEqual(['puzzle-view', 'script', 'style']);
		// the canonical lexer cases survive verbatim, indentation and all
		expect(out).toContain('{#raw}{ "loop": true, "slides": [1, 2], "url": "/api/x" }{/raw}');
		expect(out).toContain('{#raw}{#if ok}{ value | upper }{:else}{#comment}x{/comment}{/if}{/raw}');
		expect(out).toContain('{#raw json}{ x }{/raw }{ y }');
		expect(out).toContain('{#raw}outer {#raw} inner{/raw} tail');
		expect(out).toContain('{#raw}<b data-json={ {"x": 1} }>hi { name }</b>{/ raw }');
		// the surrounding sections DID get reformatted, proving the boundaries landed
		expect(out).toContain('return { y: closerish.source };');
		expect(out).toContain('.carousel {\n  color: red;\n}');
	});

	it('resumes normal handling after the closer (opener suffix ignored)', async () => {
		const src = '<puzzle-view><p>{#raw json}{ x }{/raw }{ y }</p></puzzle-view>\n';
		const out = await format(src);
		expect(out).toBe(src);
	});

	it('does not nest — the first closer wins', async () => {
		const src = '<puzzle-view><em>{#raw}outer {#raw} inner{/raw} tail</em></puzzle-view>\n';
		const out = await format(src);
		expect(out).toBe(src);
	});

	it('tolerates whitespace in the closer ({/raw}, {/ raw }, {/raw })', async () => {
		for (const closer of ['{/raw}', '{/ raw }', '{/raw }', '{/  raw  }']) {
			const src = `<puzzle-view><div>{#raw}a${closer}b</div></puzzle-view>\n`;
			expect(await format(src), closer).toBe(src);
		}
	});

	it('keeps a brace-heavy JSON body inert, including a {/raw} inside a string', async () => {
		// The body scan is deliberately byte-naive: a {/raw} written inside a JSON
		// string DOES close the block, exactly as scanBlockRaw does it.
		const src =
			'<puzzle-view>\n' +
			'\t<pre>{#raw}{ "a": { "b": [1, 2] }, "c": "}{", "d": "/x/y" }{/raw}</pre>\n' +
			'</puzzle-view>\n';
		const out = await format(src);
		expect(out).toBe(src);
	});

	it('finds the section close after {/raw} even with a self-closing tag and a regex in <script>', async () => {
		// Regression: with `raw` missing from BLOCK_CLOSE_KEYWORDS the '/' in {/raw}
		// opened a regex that paired off against the '/' in <br/>, then a second
		// regex swallowed </puzzle-view> and closed on the '}' inside /}/ — the
		// splitter reported "missing </puzzle-view>".
		const src =
			'<puzzle-view>{#raw}x{/raw}<br/></puzzle-view>\n<script>\nconst re = /}/;\n</script>\n';
		const out = await format(src);
		const b = sectionMap(out);
		expect(Object.keys(b).sort()).toEqual(['puzzle-view', 'script']);
		expect(b['puzzle-view'].inner).toBe('{#raw}x{/raw}<br/>');
	});

	it('finds the section close after {/raw} with a stray brace in <style>', async () => {
		const src = '<puzzle-view>{#raw}x{/raw}</puzzle-view>\n<style>\na{color:red}\n</style>\n';
		const b = sectionMap(src);
		expect(b['puzzle-view'].inner).toBe('{#raw}x{/raw}');
	});
});

describe('lexer table parity with the compiler', () => {
	it('treats ++ / -- as update operators, not a cleared regex context', async () => {
		// LexSkip consumes both bytes of ++/--; in `a+++/re/` the third '+' clears
		// the state so the '/' opens a regex. Getting this wrong mis-pairs the
		// slashes and derails the rest of the brace group.
		const src = '<puzzle-view><b>{ a+++/}/.source }</b></puzzle-view>\n';
		const out = await format(src);
		expect(out).toBe(src);
	});

	it('steers a plural <scripts>/<styles> section to the singular name', async () => {
		await expect(
			format('<puzzle-view><a/></puzzle-view>\n<scripts>\n1\n</scripts>\n'),
		).rejects.toThrow(/<scripts> should be named <script>/);
		await expect(
			format('<puzzle-view><a/></puzzle-view>\n<styles>\na{}\n</styles>\n'),
		).rejects.toThrow(/<styles> should be named <style>/);
	});

	it('skips a leading UTF-8 BOM instead of reporting it as stray content', async () => {
		const out = await format('﻿<puzzle-view><div>x</div></puzzle-view>\n');
		expect(out).toBe('﻿<puzzle-view><div>x</div></puzzle-view>\n');
	});
});

describe('options passthrough', () => {
	it('respects singleQuote for the embedded JS', async () => {
		const out = await format(read('ts-scripts.pzl'), { singleQuote: true });
		expect(out).toContain("return { title: 'Hello', count: n };");
	});

	it('respects useTabs for the embedded JS and CSS', async () => {
		const out = await format(read('styles-scoped.pzl'), { useTabs: true });
		// css indentation should use a tab
		expect(out).toContain('.box {\n\tcolor: red;');
		// js indentation should use a tab
		expect(out).toContain('data() {\n\t\treturn');
	});

	it('respects semi:false and printWidth for embedded JS', async () => {
		const out = await format(read('js-scripts.pzl'), { semi: false });
		expect(out).toContain('import { PuzzleView } from "@magic-spells/puzzle"');
		expect(out).not.toContain('from "@magic-spells/puzzle";');
	});
});

describe('trailing newline', () => {
	it('always ends with exactly one newline', async () => {
		for (const f of fixtures) {
			const out = await format(read(f));
			expect(out.endsWith('\n')).toBe(true);
			expect(out.endsWith('\n\n')).toBe(false);
		}
	});

	it('normalizes a file that ends without a trailing newline', async () => {
		const input = '<puzzle-view><div>x</div></puzzle-view>';
		const out = await format(input);
		expect(out).toBe('<puzzle-view><div>x</div></puzzle-view>\n');
	});
});

describe('idempotency', () => {
	for (const f of fixtures) {
		it(`format(format(x)) === format(x) for ${f}`, async () => {
			const once = await format(read(f));
			const twice = await format(once);
			expect(twice).toBe(once);
		});
	}
});

describe('error handling', () => {
	it('throws a positioned error when <puzzle-view> is missing', async () => {
		await expect(format('<script>\nexport default 1;\n</script>\n')).rejects.toThrow(/missing <puzzle-view>/);
	});

	it('throws on stray top-level content after a truncating-looking body', async () => {
		// a real stray: junk between sections at the top level
		await expect(format('<puzzle-view><div/></puzzle-view>\nhello stray\n')).rejects.toThrow(
			/unexpected content/,
		);
	});

	it('throws on a duplicated section', async () => {
		const src = '<puzzle-view><a/></puzzle-view>\n<script>1</script>\n<script>2</script>\n';
		await expect(format(src)).rejects.toThrow(/multiple <script>/);
	});

	it('throws on an unterminated section tag', async () => {
		await expect(format('<puzzle-view class="x"\n')).rejects.toThrow(/unterminated <puzzle-view> tag/);
	});
});
