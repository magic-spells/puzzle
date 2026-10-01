import { test, expect } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import {
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// `puzzle dev` live reload across many tabs on one origin. A browser allows six
// HTTP/1.1 connections per host; when every tab held its own SSE stream, about
// six open tabs left every further request on the host pending forever. The
// injected client now elects one tab (Web Locks) to hold the only stream and
// relay hub events to the rest over a BroadcastChannel.
//
// The spec runs its own dev server on a throwaway app in the OS temp dir,
// because it edits source files: the shared example servers must stay
// untouched. PUZZLE_RUNTIME points the build at this checkout's runtime.

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4175;
const ORIGIN = `http://localhost:${PORT}`;
const TABS = 8;

let appDir;
let binDir;
let server;
let serverLog = '';

function home(text) {
	return `<puzzle-view>
  <h1>${text}</h1>
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';

export default class Home extends PuzzleView {}
</script>
`;
}

// Edits land at least a second apart: the dev server serves app.js with a
// Last-Modified validator of one-second resolution, so a rebuild inside the
// same second as the last one can revalidate as unchanged.
let lastEdit = 0;
async function writeHome(source) {
	const wait = lastEdit + 1100 - Date.now();
	if (wait > 0) await new Promise((r) => setTimeout(r, wait));
	writeFileSync(join(appDir, 'app/views/Home.pzl'), source);
	lastEdit = Date.now();
}

async function waitForServer() {
	const deadline = Date.now() + 60_000;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(ORIGIN + '/');
			if (res.ok) return;
		} catch {}
		await new Promise((r) => setTimeout(r, 200));
	}
	throw new Error(
		`puzzle dev did not come up on ${ORIGIN}\n${serverLog}`
	);
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
	appDir = mkdtempSync(join(tmpdir(), 'puzzle-dev-reload-'));
	binDir = mkdtempSync(join(tmpdir(), 'puzzle-dev-reload-bin-'));
	mkdirSync(join(appDir, 'app/views'), { recursive: true });
	mkdirSync(join(appDir, 'app/public'), { recursive: true });
	writeFileSync(
		join(appDir, 'package.json'),
		'{ "type": "module" }\n'
	);
	writeFileSync(
		join(appDir, 'puzzle.config.js'),
		'export default {};\n'
	);
	writeFileSync(
		join(appDir, 'app/public/index.html'),
		`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>reload</title></head>
<body>
  <div id="app"></div>
  <script type="module" src="/app.js"></script>
</body>
</html>
`
	);
	writeFileSync(
		join(appDir, 'app/app.js'),
		`import { PuzzleApp } from '@magic-spells/puzzle';
import Home from './views/Home.pzl';

const app = new PuzzleApp({ target: '#app', routes: [{ path: '/', view: Home }] });
app.mount();
export default app;
`
	);
	await writeHome(home('version 1'));

	const bin = join(binDir, 'puzzle');
	execFileSync('go', ['build', '-o', bin, './compiler/cmd/puzzle'], {
		cwd: PKG,
		stdio: 'inherit',
	});
	server = spawn(
		bin,
		['dev', appDir, '--port', String(PORT), '--strict-port'],
		{
			env: { ...process.env, PUZZLE_RUNTIME: PKG },
			stdio: ['ignore', 'pipe', 'pipe'],
		}
	);
	server.stdout.on('data', (d) => (serverLog += d));
	server.stderr.on('data', (d) => (serverLog += d));
	await waitForServer();
});

test.afterAll(async () => {
	if (server) {
		server.kill('SIGTERM');
		await new Promise((r) => server.once('exit', r));
	}
	if (appDir) rmSync(appDir, { recursive: true, force: true });
	if (binDir) rmSync(binDir, { recursive: true, force: true });
});

test('one SSE stream serves every tab; reloads survive the leader closing', async ({
	context,
}) => {
	test.setTimeout(120_000);

	// Count each document's live EventSources from inside the page: a wrapper
	// installed before the injected client runs. Network events are no ground
	// truth here, since a stream cut short by a reload may never report an end.
	await context.addInitScript(() => {
		const Native = window.EventSource;
		const all = [];
		window.EventSource = class extends Native {
			constructor(...args) {
				super(...args);
				all.push(this);
			}
		};
		window.__liveStreams = () =>
			all.filter((es) => es.readyState !== 2).length;
	});
	const pages = [];
	const live = (page) =>
		page.evaluate(() => window.__liveStreams()).catch(() => NaN);
	const openStreams = async () => {
		let sum = 0;
		for (const page of pages)
			if (!page.isClosed()) sum += await live(page);
		return sum;
	};
	const leader = async () => {
		for (const page of pages)
			if (!page.isClosed() && (await live(page)) > 0) return page;
	};

	for (let i = 0; i < TABS; i++) {
		const page = await context.newPage();
		await page.goto(ORIGIN + '/', { timeout: 15_000 });
		pages.push(page);
	}
	// Every tab loads: with a stream per tab, the seventh would hang here.
	for (const page of pages)
		await expect(page.locator('h1')).toHaveText('version 1');
	await expect.poll(openStreams).toBe(1);

	// A source edit reloads every tab.
	await writeHome(home('version 2'));
	for (const page of pages)
		await expect(page.locator('h1')).toHaveText('version 2', {
			timeout: 20_000,
		});
	await expect.poll(openStreams).toBe(1);

	// Close the leader; the lock passes on and the rest still reload.
	const first = await leader();
	expect(first).toBeTruthy();
	await first.close();
	const rest = pages.filter((p) => p !== first);
	await expect.poll(openStreams).toBe(1);
	await writeHome(home('version 3'));
	for (const page of rest)
		await expect(page.locator('h1')).toHaveText('version 3', {
			timeout: 20_000,
		});

	// A build error draws the overlay in a tab that does not hold the stream,
	// and a tab opened while the build is broken gets it from the leader.
	await writeHome(home('{ 1 + }'));
	const current = await leader();
	const follower = rest.find((p) => p !== current);
	await expect(follower.locator('#__puzzle-build-error')).toBeVisible(
		{ timeout: 20_000 }
	);
	const late = await context.newPage();
	pages.push(late);
	await late.goto(ORIGIN + '/');
	await expect(late.locator('#__puzzle-build-error')).toBeVisible();

	// Fixing it clears the overlay and reloads everyone.
	await writeHome(home('version 4'));
	for (const page of [...rest, late]) {
		await expect(page.locator('h1')).toHaveText('version 4', {
			timeout: 20_000,
		});
		await expect(page.locator('#__puzzle-build-error')).toHaveCount(
			0
		);
	}
	await expect.poll(openStreams).toBe(1);
});
