// @magic-spells/prettier-plugin-puzzle
//
// A Prettier 3 plugin for Puzzle Framework .pzl single-file components.
//
// v1 is deliberately conservative: the output is the original file byte-for-byte,
// EXCEPT the <script> body is reprinted with Prettier's JS/TS formatter and the
// <style> body with its CSS formatter (both honoring the user's Prettier
// options). The <puzzle-view> / <puzzle-skeleton> template bodies, every section
// tag and attribute, top-level comments, and inter-section whitespace are
// preserved exactly — template reformatting is deferred to a future version. The
// file is normalized to end with exactly one newline.
//
// The splitter mirrors the compiler's canonical splitter,
// compiler/internal/parser/sections.go (see src/split.js).
import { doc } from 'prettier';
import { splitSections } from './split.js';

const { printDocToString } = doc.printer;

// parse builds a flat AST: a root whose children are `verbatim` slices of the
// source interleaved with `embed` nodes for the <script>/<style> inner bodies.
// Only those two inner bodies are ever cut out; everything else (tags, template
// bodies, comments, whitespace) rides through untouched as verbatim text.
function parse(text) {
	const sections = splitSections(text);
	const cuts = sections
		.filter((s) => s.name === 'script' || s.name === 'style')
		.sort((a, b) => a.contentStart - b.contentStart);

	const children = [];
	let pos = 0;
	for (const cut of cuts) {
		if (cut.contentStart > pos) {
			children.push({ type: 'verbatim', value: text.slice(pos, cut.contentStart), start: pos, end: cut.contentStart });
		}
		children.push({
			type: 'embed',
			kind: cut.name,
			parser: cut.parser,
			value: text.slice(cut.contentStart, cut.contentEnd),
			start: cut.contentStart,
			end: cut.contentEnd,
		});
		pos = cut.contentEnd;
	}
	// Trailing verbatim: close tag of the last section plus any trailing bytes,
	// or (no script/style sections) the whole file. Always present and non-empty because
	// a section is always followed by its close tag.
	children.push({ type: 'verbatim', value: text.slice(pos), start: pos, end: text.length });
	children[children.length - 1].last = true;

	return { type: 'root', children, start: 0, end: text.length };
}

const printer = {
	print(path, options, print) {
		const node = path.node;
		if (node.type === 'root') {
			return path.map(print, 'children');
		}
		if (node.type === 'verbatim') {
			// The final verbatim segment owns the end of the file: normalize its
			// trailing whitespace to exactly one newline. All other verbatim bytes
			// (leading, inter-section, tags, template bodies) pass through exactly.
			if (node.last) return node.value.replace(/\s*$/, '\n');
			return node.value;
		}
		// embed nodes are handled by embed(); this is only a defensive fallback.
		return node.value;
	},

	// embed reprints the <script>/<style> body via Prettier's own formatters.
	// Using textToDoc is the sanctioned Prettier-3 way to inherit the user's
	// options; we then materialize the sub-doc to a string so we control the
	// leading/trailing newlines exactly (one newline after the open tag, the
	// formatted body, one newline before the close tag), independent of whatever
	// trailing-newline convention the embedded formatter's doc carries.
	embed(path) {
		const node = path.node;
		if (node.type !== 'embed') return undefined;
		return async (textToDoc, _print, _path, options) => {
			const bodyDoc = await textToDoc(node.value, { parser: node.parser });
			const { formatted } = printDocToString(bodyDoc, options);
			const code = formatted.replace(/^\n+/, '').replace(/\s+$/, '');
			return code === '' ? '\n' : '\n' + code + '\n';
		};
	},
};

export const languages = [
	{
		name: 'puzzle',
		parsers: ['puzzle'],
		extensions: ['.pzl'],
		vscodeLanguageIds: ['puzzle'],
	},
];

export const parsers = {
	puzzle: {
		parse: (text) => parse(text),
		astFormat: 'puzzle-ast',
		locStart: (node) => node.start,
		locEnd: (node) => node.end,
	},
};

export const printers = {
	'puzzle-ast': printer,
};

export default { languages, parsers, printers };
