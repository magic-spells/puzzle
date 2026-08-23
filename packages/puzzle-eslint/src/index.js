// index.js — the @magic-spells/eslint-plugin-puzzle plugin object.
//
// ESLint >= 9 flat config only. The plugin exposes a single processor
// (`puzzle/puzzle`) that lints the <script> body of a .pzl file as real JS/TS
// and reports section-structure errors, plus a `recommended` flat-config array
// that wires it up.

import { processor } from './processor.js';

const meta = {
	name: '@magic-spells/eslint-plugin-puzzle',
	version: '0.1.0',
};

// The plugin object. `configs.recommended` is attached below so it can reference
// the plugin itself without a circular initializer.
const plugin = {
	meta,
	processors: {
		puzzle: processor,
	},
	configs: {},
};

// recommended is a flat-config ARRAY:
//   1. Apply the processor to every .pzl file. Its <script> body becomes a
//      virtual JS/TS file that your OTHER config entries (e.g. @eslint/js
//      recommended, @typescript-eslint) lint as ordinary code.
//   2. Relax a few whitespace/BOM rules on the virtual files, because the
//      blanked-out regions around the <script> body can leave trailing spaces
//      and no final newline that would otherwise trip these rules. They are not
//      in eslint:recommended, so this only matters if you enable them broadly.
plugin.configs.recommended = [
	{
		name: 'puzzle/recommended',
		files: ['**/*.pzl'],
		plugins: { puzzle: plugin },
		processor: 'puzzle/puzzle',
	},
	{
		name: 'puzzle/virtual-scripts',
		files: ['**/*.pzl/*_scripts.{js,ts}'],
		rules: {
			'eol-last': 'off',
			'no-trailing-spaces': 'off',
			'unicode-bom': 'off',
		},
	},
];

export default plugin;
export { plugin, processor };
