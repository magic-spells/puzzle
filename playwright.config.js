import { defineConfig, devices } from '@playwright/test';

// Browser smoke suite — a small, robust complement to the exhaustive vitest
// state-machine tests, NOT a replacement. It exercises the ONE thing jsdom
// can't: real transition/animation timing and browser history/scroll, in real
// Chromium + WebKit.
//
// Two dev servers, both driven by the REPO compiler via `go run`:
//   • examples/transitions-demo (:4173) — memory-mode, two apps on one page
//     (sequential + overlap side by side). Powers the transition-mechanics specs.
//   • examples/stays (:4174) — history-mode, multi-route, tall scrollable pages
//     that render full content on commit (no <puzzle-skeleton>, so scroll restore
//     lands on real content). Powers the browser back/forward + scroll-restore
//     specs (transitions-demo is memory-mode, so it has no URL/window scroll to
//     assert against).

const isCI = !!process.env.CI;

export default defineConfig({
	testDir: './tests-browser',
	// Animation-timing assertions are order-sensitive; keep it fully serial.
	fullyParallel: false,
	workers: 1,
	forbidOnly: isCI,
	retries: isCI ? 1 : 0,
	reporter: isCI ? 'line' : 'list',
	use: {
		trace: 'retain-on-failure',
	},
	projects: [
		{ name: 'chromium', use: { ...devices['Desktop Chrome'] } },
		{ name: 'webkit', use: { ...devices['Desktop Safari'] } },
	],
	// `go run` recompiles the compiler on each cold start (a few seconds), so the
	// timeouts are generous. reuseExistingServer locally speeds the inner loop.
	webServer: [
		{
			command: 'go run ./compiler/cmd/puzzle dev examples/transitions-demo --port 4173',
			url: 'http://localhost:4173/',
			reuseExistingServer: !isCI,
			timeout: 120_000,
		},
		{
			command: 'go run ./compiler/cmd/puzzle dev examples/stays --port 4174',
			url: 'http://localhost:4174/',
			reuseExistingServer: !isCI,
			timeout: 120_000,
		},
	],
});
