import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	chmodSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { puzzle } from '../client-runtime/vitest/index.js';

// the @magic-spells/puzzle/vitest plugin (d193). the go side, `puzzle compile`,
// has its own go tests; these cover the plugin's plumbing with a stand-in
// executable, so the suite needs no built binary.

const dirs = [];

/**
 * write a node script that plays the `puzzle` binary and return its path.
 *
 * @param {string} body the script body; argv[3] is the .pzl path
 */
function fakeBin(body) {
	const dir = mkdtempSync(path.join(tmpdir(), 'puzzle-vitest-'));
	dirs.push(dir);
	const file = path.join(dir, 'puzzle');
	writeFileSync(file, `#!${process.execPath}\n${body}\n`);
	chmodSync(file, 0o755);
	return file;
}

afterEach(() => {
	for (const dir of dirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
	delete process.env.PUZZLE_BIN;
});

describe('puzzle() vitest plugin', () => {
	it('runs before vite and mirrors the build alias for @/', () => {
		const plugin = puzzle();
		expect(plugin.name).toBe('puzzle');
		expect(plugin.enforce).toBe('pre');

		const { alias } = plugin.config({
			root: '/projects/shop',
		}).resolve;
		expect(alias).toHaveLength(1);
		expect(alias[0].find.test('@/components/Card.pzl')).toBe(true);
		// scoped packages and a bare '@' are not the alias
		expect(alias[0].find.test('@magic-spells/puzzle')).toBe(false);
		expect(
			'@/components/Card.pzl'.replace(
				alias[0].find,
				alias[0].replacement
			)
		).toBe(
			path.join('/projects/shop', 'app') + '/components/Card.pzl'
		);
	});

	it('leaves modules that are not .pzl to vite', async () => {
		const plugin = puzzle({ bin: '/nonexistent/puzzle' });
		expect(
			await plugin.transform.call(
				{},
				'export {}',
				'/app/models/todo.js'
			)
		).toBeNull();
	});

	it('serves what `puzzle compile <file>` prints, query stripped', async () => {
		const bin = fakeBin(
			"process.stdout.write('// ' + process.argv.slice(2).join(' ') + '\\nexport default 1;\\n');"
		);
		const plugin = puzzle({ bin });
		const out = await plugin.transform.call(
			{},
			'<raw/>',
			'/app/views/Home.pzl?v=3'
		);
		expect(out.code).toBe(
			'// compile /app/views/Home.pzl\nexport default 1;\n'
		);
		expect(out.map).toBeNull();
	});

	it('takes the executable from PUZZLE_BIN when no bin option is given', async () => {
		process.env.PUZZLE_BIN = fakeBin(
			"process.stdout.write('export default 2;');"
		);
		const out = await puzzle().transform.call({}, '', '/app/x.pzl');
		expect(out.code).toBe('export default 2;');
	});

	it('rejects with the compiler diagnostic on a compile error', async () => {
		const bin = fakeBin(
			"process.stderr.write('app/views/Home.pzl:3:7: unclosed interpolation\\n'); process.exit(1);"
		);
		await expect(
			puzzle({ bin }).transform.call({}, '', '/app/views/Home.pzl')
		).rejects.toThrow(
			'app/views/Home.pzl:3:7: unclosed interpolation'
		);
	});

	it('passes codegen warnings to vite without failing the module', async () => {
		const bin = fakeBin(
			"process.stderr.write('Home.pzl:1:1: warning: advisory\\n'); process.stdout.write('export default 3;');"
		);
		const warn = vi.fn();
		const out = await puzzle({ bin }).transform.call(
			{ warn },
			'',
			'/app/views/Home.pzl'
		);
		expect(out.code).toBe('export default 3;');
		expect(warn).toHaveBeenCalledWith(
			'Home.pzl:1:1: warning: advisory'
		);
	});

	it('keys vitest module caching to the framework version', () => {
		let generator;
		puzzle().configureVitest({
			defineCacheKeyGenerator: (fn) => (generator = fn),
		});

		expect(
			generator({ id: '/app/models/todo.js', sourceCode: '' })
		).toBeUndefined();
		expect(
			generator({
				id: '/app/views/Home.pzl',
				sourceCode: '<p>{ x }</p>',
			})
		).toMatch(/^puzzle@\d+\.\d+\.\d+/);
		// an inlined svg can change without the .pzl changing, so never cache it
		expect(
			generator({
				id: '/app/views/Home.pzl',
				sourceCode: "{#svg 'a.svg'}",
			})
		).toBe(false);

		// a custom binary is not the version the key names
		let custom;
		puzzle({ bin: '/opt/puzzle' }).configureVitest({
			defineCacheKeyGenerator: (fn) => (custom = fn),
		});
		expect(
			custom({ id: '/app/views/Home.pzl', sourceCode: '' })
		).toBe(false);
	});

	it('does nothing on a vitest without the cache hook', () => {
		expect(() => puzzle().configureVitest({})).not.toThrow();
	});
});
