// index.js — the @magic-spells/eslint-plugin-puzzle plugin object.
//
// ESLint >= 9 flat config only. The plugin exposes a single processor
// (`puzzle/puzzle`) that lints the <script> body of a .pzl file as real JS/TS
// and reports section-structure errors, one rule
// (`puzzle/uses-template-components`) that marks components rendered as
// template tags as used, plus a `recommended` flat-config array that wires
// them up.

import { createRequire } from 'node:module';
import { processor, usesTemplateComponents } from './processor.js';

// meta comes from package.json so the version a plugin reports (ESLint uses it
// in cache keys and --print-config) always matches the published package.
const pkg = createRequire(import.meta.url)('../package.json');

const meta = {
	name: pkg.name,
	version: pkg.version,
};

// The plugin object. `configs.recommended` is attached below so it can reference
// the plugin itself without a circular initializer.
const plugin = {
	meta,
	processors: {
		puzzle: processor,
	},
	rules: {
		'uses-template-components': usesTemplateComponents,
	},
	configs: {},
};

// recommended is a flat-config ARRAY:
//   1. Apply the processor to every .pzl file. Its <script> body becomes a
//      virtual JS/TS file that your OTHER config entries (e.g. @eslint/js
//      recommended, @typescript-eslint) lint as ordinary code.
//   2. On the virtual JS files, enable puzzle/uses-template-components and
//      relax a few whitespace/BOM rules, because the blanked-out regions around
//      the <script> body can leave trailing spaces and no final newline that
//      would otherwise trip them. Those three are not in eslint:recommended, so
//      that only matters if you enable them broadly. The glob is JS-only on
//      purpose: a config entry whose `files` matches a virtual file makes
//      ESLint lint it, and a `lang="ts"` block handed to the default parser is
//      a fatal parse error. TS blocks are linted only when the user's config
//      adds a TS-parser entry for `**/*.pzl/*_scripts.ts` (see README).
plugin.configs.recommended = [
	{
		name: 'puzzle/recommended',
		files: ['**/*.pzl'],
		plugins: { puzzle: plugin },
		processor: 'puzzle/puzzle',
	},
	{
		name: 'puzzle/virtual-scripts',
		files: ['**/*.pzl/*_scripts.js'],
		plugins: { puzzle: plugin },
		rules: {
			'puzzle/uses-template-components': 'error',
			'eol-last': 'off',
			'no-trailing-spaces': 'off',
			'unicode-bom': 'off',
		},
	},
];

export default plugin;
export { plugin, processor };
