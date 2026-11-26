import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Test-harness analogue of the compiler's esbuild plugin module-graph role
// (constellation/doc/DOC-COMPILER-DESIGN.md, "The lane", constellation/doc/DOC-SPEC.md §12). The Go
// compiler emits the .pzl <script> VERBATIM, so a component import survives as
// its source specifier — the compiled Home.compiled.js contains
// `import TodoItem from '../components/TodoItem.pzl'`. In a real `puzzle build`,
// esbuild's .pzl loader compiles and resolves that specifier through the real
// module graph. The compiled-lane fixtures instead live FLAT in
// tests/fixtures/todos-compiled/, so this plugin rewrites any '*.pzl' import
// originating from that directory to its sibling '*.compiled.js' (produced by
// `npm run build:example-modules`). The hand-written fixture lane
// (tests/fixtures/todos/) imports './TodoItem.compiled.js' directly and never
// trips this rule. This keeps examples/todos a real app whose sources `puzzle
// build` compiles unchanged — the harness, not the app, adapts.
function pzlModuleGraph() {
	const compiledDirs = [
		fileURLToPath(new URL('./tests/fixtures/todos-compiled/', import.meta.url)),
		fileURLToPath(new URL('./tests/fixtures/slot-forwarding/', import.meta.url)),
		fileURLToPath(new URL('./tests/fixtures/component-slot/', import.meta.url)),
		fileURLToPath(new URL('./tests/fixtures/forms/', import.meta.url)),
	];
	// examples/auth's compiled views import plain js from the app too
	// (`../auth.js`, `../models/credentials.js`). every one of them sat one
	// level under app/ (views/ or layouts/), so a relative specifier resolves
	// against app/views/ to the example's own source file, the same module
	// instance the test imports.
	const authCompiled = fileURLToPath(new URL('./tests/fixtures/auth-example/', import.meta.url));
	const authAppLevel = fileURLToPath(new URL('./examples/auth/app/views/', import.meta.url));
	return {
		name: 'puzzle-pzl-module-graph',
		enforce: 'pre',
		resolveId(source, importer) {
			if (importer?.startsWith(authCompiled) && source.startsWith('.') && source.endsWith('.js')) {
				return path.resolve(authAppLevel, source);
			}
			if (!source.endsWith('.pzl') || !importer) return null;
			if (!compiledDirs.some((dir) => importer.startsWith(dir))) return null;
			const base = path.basename(source).replace(/\.pzl$/, '.compiled.js');
			return path.join(path.dirname(importer), base);
		},
	};
}

export default defineConfig({
	plugins: [pzlModuleGraph()],
	resolve: {
		// The compiler emits the published package name; in this repo it resolves
		// to the local runtime. Lets tests/fixtures/todos-compiled/* (compiler
		// output) import '@magic-spells/puzzle' the same way a real app would.
		alias: {
			'@magic-spells/puzzle/formatters/manifest': fileURLToPath(new URL('./client-runtime/formatters/builtins-all.js', import.meta.url)),
			'@magic-spells/puzzle/i18n/manifest': fileURLToPath(new URL('./client-runtime/i18n-manifest.js', import.meta.url)),
			'@magic-spells/puzzle/forms': fileURLToPath(new URL('./client-runtime/forms.js', import.meta.url)),
			'@magic-spells/puzzle/adapter': fileURLToPath(new URL('./client-runtime/datastore/adapter.js', import.meta.url)),
			'@magic-spells/puzzle': fileURLToPath(new URL('./client-runtime/index.js', import.meta.url)),
		},
	},
	test: {
		// node by default; view/DOM suites opt into jsdom per-file with
		// `// @vitest-environment jsdom`
		environment: 'node',
		setupFiles: ['tests/setup.js'],
		include: ['tests/**/*.test.js'],
	},
});
