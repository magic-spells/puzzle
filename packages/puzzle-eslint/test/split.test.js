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
});
