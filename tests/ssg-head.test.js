// Route head management, SSG half (D84, v1.50 — constellation/doc/DOC-SPEC.md §45):
// the resolveHead per-field leaf→root walk (client-runtime/head.js), the `head`
// field on prerendered pages, and the shell surgery (injectShell/injectStaticShell
// applyHead): insertion before </head>, in-place replacement of same-identity
// marker tags, removal on a non-resolving field, attribute escaping of hostile
// metadata, the title-only compatibility fallback, and both prerenderToDir output
// modes carrying the tags in the written HTML. Node env: prerender is DOM-free.
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prerender, prerenderToDir, injectShell, injectStaticShell } from '../client-runtime/ssg/index.js';
import { resolveHead, MANAGED_TAGS, HEAD_FIELDS } from '../client-runtime/head.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode, SLOT_TAG } from '../client-runtime/views/ViewNode.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const slot = () => new ViewNode(SLOT_TAG);

/** Stamp a fixture class the way CONTRACT 2 codegen will (for static mode). */
function stamp(Class, module) {
	Class.__pzlModule = module;
	return Class;
}

class Layout extends PuzzleView {
	render() {
		return h('div', { class: 'layout' }, [slot()]);
	}
}
stamp(Layout, 'app/layouts/Default.pzl');
class Home extends PuzzleView {
	render() {
		return h('h1', {}, [text('Home')]);
	}
}
stamp(Home, 'app/views/Home.pzl');
class Docs extends PuzzleView {
	render() {
		return h('div', { class: 'docs' }, [slot()]);
	}
}
stamp(Docs, 'app/views/Docs.pzl');
class Page extends PuzzleView {
	render() {
		return h('p', {}, [text('page')]);
	}
}
stamp(Page, 'app/views/Page.pzl');

const SHELL =
	'<!doctype html><html><head><title>Shell</title><meta charset="utf-8"></head>' +
	'<body><div id="app"></div></body></html>';

// A full resolved head for direct injector tests.
const FULL_HEAD = {
	title: 'Home',
	description: 'The home page',
	canonical: 'https://example.com/',
	socialImage: 'https://example.com/og.png',
};

const EMPTY_HEAD = { title: null, description: null, canonical: null, socialImage: null };

describe('resolveHead (D84) — per-field leaf→root resolution', () => {
	it('resolves each reserved field independently, nearest-defined leaf→root', () => {
		const chain = [
			{
				path: '/docs',
				meta: {
					title: 'Docs',
					description: 'Docs desc',
					canonical: 'https://example.com/docs',
					socialImage: 'https://example.com/docs.png',
				},
			},
			// leaf overrides ONLY the title; the other three inherit from the parent.
			{ path: 'intro', meta: { title: 'Intro' } },
		];
		expect(resolveHead(chain)).toEqual({
			title: 'Intro',
			description: 'Docs desc',
			canonical: 'https://example.com/docs',
			socialImage: 'https://example.com/docs.png',
		});
	});

	it('an explicit null suppresses an inherited value; undefined keeps walking', () => {
		const chain = [
			{ path: '/', meta: { description: 'Root desc', socialImage: '/root.png' } },
			// description: null STOPS the walk (suppression); socialImage: undefined
			// is indistinguishable from absent — it inherits.
			{ path: 'child', meta: { description: null, socialImage: undefined } },
		];
		const head = resolveHead(chain);
		expect(head.description).toBe(null);
		expect(head.socialImage).toBe('/root.png');
	});

	it('title suppresses on an explicit null, uniformly with the other fields (§45/D84)', () => {
		// Every reserved field shares ONE null posture: an explicit `null` STOPS the
		// walk and suppresses any inherited value. A resolved-null title then leaves
		// document.title / the shell <title> untouched (leave-alone, not blank) — see
		// syncHead. `undefined`/omit is the way to inherit. (This corrects a 0.2.0
		// pre-release divergence where title alone inherited on null.)
		const chain = [
			{ path: '/docs', meta: { title: 'Docs', description: 'Docs desc' } },
			// title: null → suppress (resolves null); description: null → suppress too.
			{ path: 'intro', meta: { title: null, description: null } },
		];
		const head = resolveHead(chain);
		expect(head.title).toBe(null); // suppressed, NOT inherited
		expect(head.description).toBe(null); // suppressed by the null

		// undefined/omit still inherits the parent title.
		const inheriting = resolveHead([
			{ path: '/docs', meta: { title: 'Docs' } },
			{ path: 'intro', meta: { description: 'x' } },
		]);
		expect(inheriting.title).toBe('Docs');
	});

	it('resolves all-null for a chain with no meta at all', () => {
		expect(resolveHead([{ path: '/' }, { path: 'a' }])).toEqual(EMPTY_HEAD);
	});

	it('custom meta keys never leak into the resolved head', () => {
		const head = resolveHead([{ path: '/', meta: { section: 'app', title: 'T' } }]);
		expect(Object.keys(head).sort()).toEqual([...HEAD_FIELDS].sort());
	});
});

describe('prerender pages carry `head` (D84)', () => {
	const routes = () => [
		{
			path: '/',
			name: 'home',
			view: Home,
			layout: Layout,
			meta: { title: 'Home', description: 'Home desc', canonical: 'https://x.dev/' },
		},
		{
			path: '/docs',
			name: 'docs',
			view: Docs,
			layout: Layout,
			meta: { title: 'Docs', description: 'Docs desc', socialImage: '/social.png' },
			children: [
				// leaf: new title, description SUPPRESSED, socialImage inherited.
				{ path: 'intro', name: 'intro', view: Page, meta: { title: 'Intro', description: null } },
			],
		},
		{ path: '/spa', name: 'spa', view: Page, layout: Layout, prerender: false },
	];
	const config = () => ({ target: '#app', routes: routes(), models: {}, formatters: {} });

	it('resolves head per page; title rides beside it (=== head.title)', async () => {
		const { pages } = await prerender(config());
		const byPath = Object.fromEntries(pages.map((p) => [p.path, p]));

		expect(byPath['/'].head).toEqual({
			title: 'Home',
			description: 'Home desc',
			canonical: 'https://x.dev/',
			socialImage: null,
		});
		expect(byPath['/docs/intro'].head).toEqual({
			title: 'Intro',
			description: null, // explicit null beat the parent's 'Docs desc'
			canonical: null,
			socialImage: '/social.png', // inherited from /docs
		});
		for (const p of pages) {
			if (p.prerender === false) continue;
			expect(p.title).toBe(p.head.title); // ONE walk feeds both (compat)
		}
	});

	it('a prerender:false page has head null (no head injection)', async () => {
		const { pages } = await prerender(config());
		const spa = pages.find((p) => p.path === '/spa');
		expect(spa).toMatchObject({ html: null, title: null, head: null, prerender: false });
	});
});

describe('injectShell managed head surgery (D84)', () => {
	it('inserts every derived tag immediately before </head>', () => {
		const out = injectShell(SHELL, { targetId: 'app', content: 'x', head: FULL_HEAD });

		expect(out).toContain('<title>Home</title>');
		expect(out).toContain('<meta property="og:title" content="Home" data-puzzle-head="og:title">');
		expect(out).toContain('<meta name="twitter:title" content="Home" data-puzzle-head="twitter:title">');
		expect(out).toContain('<meta name="description" content="The home page" data-puzzle-head="description">');
		expect(out).toContain(
			'<meta property="og:description" content="The home page" data-puzzle-head="og:description">'
		);
		expect(out).toContain(
			'<meta name="twitter:description" content="The home page" data-puzzle-head="twitter:description">'
		);
		expect(out).toContain(
			'<link rel="canonical" href="https://example.com/" data-puzzle-head="canonical">'
		);
		expect(out).toContain('<meta property="og:url" content="https://example.com/" data-puzzle-head="og:url">');
		expect(out).toContain(
			'<meta property="og:image" content="https://example.com/og.png" data-puzzle-head="og:image">'
		);
		expect(out).toContain(
			'<meta name="twitter:image" content="https://example.com/og.png" data-puzzle-head="twitter:image">'
		);
		expect(out).toContain(
			'<meta name="twitter:card" content="summary_large_image" data-puzzle-head="twitter:card">'
		);
		// all of it landed inside <head>, before the close
		const headEnd = out.indexOf('</head>');
		for (const spec of MANAGED_TAGS) {
			const idx = out.indexOf(`data-puzzle-head="${spec.id}"`);
			expect(idx).toBeGreaterThan(-1);
			expect(idx).toBeLessThan(headEnd);
		}
	});

	it('only the tags of resolving fields are emitted (per-field independence)', () => {
		const out = injectShell(SHELL, {
			targetId: 'app',
			content: 'x',
			head: { ...EMPTY_HEAD, title: 'Solo' },
		});
		expect(out).toContain('data-puzzle-head="og:title"');
		expect(out).toContain('data-puzzle-head="twitter:title"');
		expect(out).not.toContain('data-puzzle-head="description"');
		expect(out).not.toContain('data-puzzle-head="canonical"');
		expect(out).not.toContain('data-puzzle-head="og:image"');
		expect(out).not.toContain('data-puzzle-head="twitter:card"');
	});

	it('replaces same-identity marker tags in the shell IN PLACE — no duplicates', () => {
		const seeded = SHELL.replace(
			'</head>',
			'<meta name="description" content="stale" data-puzzle-head="description">' +
				"<meta property='og:title' content='stale' data-puzzle-head='og:title'></head>"
		);
		const out = injectShell(seeded, { targetId: 'app', content: 'x', head: FULL_HEAD });

		expect(out).not.toContain('stale');
		expect(out.match(/data-puzzle-head=["']description["']/g)).toHaveLength(1);
		expect(out.match(/data-puzzle-head=["']og:title["']/g)).toHaveLength(1);
		expect(out).toContain('<meta name="description" content="The home page" data-puzzle-head="description">');
	});

	it('REMOVES a shell marker tag whose field no longer resolves', () => {
		const seeded = SHELL.replace(
			'</head>',
			'<link rel="canonical" href="https://old.dev/" data-puzzle-head="canonical"></head>'
		);
		const out = injectShell(seeded, {
			targetId: 'app',
			content: 'x',
			head: { ...FULL_HEAD, canonical: null },
		});
		expect(out).not.toContain('data-puzzle-head="canonical"');
		expect(out).not.toContain('https://old.dev/');
	});

	it('escapes hostile metadata — quotes, </head>, <script> cannot break out', () => {
		const out = injectShell(SHELL, {
			targetId: 'app',
			content: 'x',
			head: {
				...EMPTY_HEAD,
				description: '"></head><script>alert(1)</script>',
			},
		});
		expect(out).not.toContain('<script>alert(1)</script>');
		expect(out).toContain(
			'content="&quot;&gt;&lt;/head&gt;&lt;script&gt;alert(1)&lt;/script&gt;"'
		);
		// the document still has exactly one </head>
		expect(out.match(/<\/head>/g)).toHaveLength(1);
	});

	it('leaves every unmanaged head element byte-identical', () => {
		const out = injectShell(SHELL, { targetId: 'app', content: 'x', head: FULL_HEAD });
		expect(out).toContain('<meta charset="utf-8">');
		// the shell before <title> is untouched
		expect(out.startsWith('<!doctype html><html><head><title>')).toBe(true);
	});

	it('title-only fallback (no head passed) is byte-compatible pre-D84: no managed tags', () => {
		const out = injectShell(SHELL, { targetId: 'app', content: 'x', title: 'Legacy' });
		expect(out).toContain('<title>Legacy</title>');
		expect(out).not.toContain('data-puzzle-head');
	});

	it('a null head.title keeps the shell title (leave-alone, like document.title)', () => {
		const out = injectShell(SHELL, {
			targetId: 'app',
			content: 'x',
			head: { ...FULL_HEAD, title: null },
		});
		expect(out).toContain('<title>Shell</title>');
		expect(out).not.toContain('data-puzzle-head="og:title"');
		expect(out).toContain('data-puzzle-head="description"');
	});

	it('degrades on a shell with no </head>: rides after </title>, never throws', () => {
		const noHeadClose = '<title>Shell</title><div id="app"></div>';
		const out = injectShell(noHeadClose, { targetId: 'app', content: 'x', head: FULL_HEAD });
		expect(out).toContain('</title><meta property="og:title"');
		expect(out).toContain('data-puzzle-head="twitter:card"');
	});

	it('warns and skips inserts when there is no </head> and no </title>', () => {
		const bare = '<div id="app"></div>';
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const out = injectShell(bare, { targetId: 'app', content: 'x', head: FULL_HEAD });
		expect(out).not.toContain('data-puzzle-head');
		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('head injection skipped'));
		warnSpy.mockRestore();
	});
});

describe('prerenderToDir output carries the head tags before any JS (D84)', () => {
	const routes = () => [
		{
			path: '/',
			name: 'home',
			view: Home,
			layout: Layout,
			meta: {
				title: 'Home',
				description: 'Home desc',
				canonical: 'https://x.dev/',
				socialImage: '/og.png',
			},
		},
		{ path: '/spa', name: 'spa', view: Page, layout: Layout, prerender: false },
	];

	function tmp() {
		return fs.mkdtempSync(path.join(os.tmpdir(), 'pzl-head-'));
	}
	function writeShell(dir, shell) {
		const shellPath = path.join(dir, 'shell.html');
		fs.writeFileSync(shellPath, shell);
		return shellPath;
	}

	it('hybrid mode: written pages contain the managed tags; prerender:false shell untouched', async () => {
		const dir = tmp();
		const outDir = path.join(dir, 'dist');
		const shellPath = writeShell(dir, SHELL);
		await prerenderToDir(
			{ target: '#app', routes: routes(), models: {}, formatters: {} },
			{ outDir, shellPath }
		);

		const index = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
		expect(index).toContain('<title>Home</title>');
		expect(index).toContain('<meta name="description" content="Home desc" data-puzzle-head="description">');
		expect(index).toContain('<link rel="canonical" href="https://x.dev/" data-puzzle-head="canonical">');
		expect(index).toContain(
			'<meta name="twitter:card" content="summary_large_image" data-puzzle-head="twitter:card">'
		);

		// opt-out page: the verbatim shell — no injection of any kind (D84 unchanged)
		const spa = fs.readFileSync(path.join(outDir, 'spa', 'index.html'), 'utf8');
		expect(spa).toBe(SHELL);
	});

	it('static mode: managed tags are baked into the page HTML (no router will ever sync them)', async () => {
		const dir = tmp();
		const outDir = path.join(dir, 'dist');
		const staticShell =
			'<!doctype html><html><head><title>Shell</title></head>' +
			'<body><div id="app"></div><script type="module" src="/app.js"></script></body></html>';
		const shellPath = writeShell(dir, staticShell);
		await prerenderToDir(
			{ target: '#app', routes: [routes()[0]], models: {}, formatters: {} },
			{ outDir, shellPath, mode: 'static' }
		);

		const index = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
		expect(index).toContain('<title>Home</title>');
		expect(index).toContain('data-puzzle-head="og:title"');
		expect(index).toContain('data-puzzle-head="og:image"');
		expect(index).not.toContain('src="/app.js"'); // still a true static page
		expect(index).toContain('data-puzzle-static-data'); // island untouched by head surgery
	});
});

describe('injectStaticShell head surgery (D84)', () => {
	it('applies head alongside the data island + module script', () => {
		const out = injectStaticShell(SHELL, {
			targetId: 'app',
			content: '<h1>Home</h1>',
			title: FULL_HEAD.title,
			head: FULL_HEAD,
			slug: 'index',
			data: {},
		});
		expect(out).toContain('data-puzzle-static');
		expect(out).toContain('data-puzzle-head="description"');
		expect(out).toContain('<script type="module" src="/_puzzle/index.js"></script>');
	});

	it('null head + null content (prerender:false): no head injection at all', () => {
		const out = injectStaticShell(SHELL, {
			targetId: 'app',
			content: null,
			title: null,
			head: null,
			slug: 'spa',
			data: {},
		});
		expect(out).not.toContain('data-puzzle-head');
		expect(out).toContain('<title>Shell</title>');
	});
});
