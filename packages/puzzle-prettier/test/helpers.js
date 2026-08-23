import * as prettier from 'prettier';
import * as plugin from '../src/index.js';
import { splitSections } from '../src/split.js';

export function format(text, options = {}) {
	return prettier.format(text, { parser: 'puzzle', plugins: [plugin], ...options });
}

// sectionMap returns { name -> { openTag, inner, closeTag } } for a source, using
// the same splitter the plugin uses. Handy for asserting that tags and template
// bodies survived byte-for-byte.
export function sectionMap(text) {
	const out = {};
	for (const s of splitSections(text)) {
		out[s.name] = {
			openTag: text.slice(s.tagStart, s.contentStart),
			inner: text.slice(s.contentStart, s.contentEnd),
			closeTag: text.slice(s.contentEnd, s.closeEnd),
		};
	}
	return out;
}

export { splitSections };
