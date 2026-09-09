import { PuzzleApp } from '@magic-spells/puzzle';
import { installFixtures } from '@magic-spells/puzzle/fixtures';
import models from './models/index.js';
import routes from './routes.js';
import { STRESS_SEED } from './scenario-utils.js';
import { createStressControl } from './stress-controller.js';

/**
 * Fixtures are installed DIRECTLY rather than via `puzzle dev --fixtures`.
 *
 * The flag generates a wiring entry that imports the app's `app/fixtures.js` and
 * calls `installFixtures` before the app boots — great for an app that wants
 * seeded data at startup. This app instead wants `store.seed()` available as a
 * TOOL that each scenario calls on demand, with no `setup` hook and nothing
 * seeded before a scenario asks for it, so it imports the module itself. Same
 * prototype patch, same determinism, and `puzzle build examples/stress` works
 * with no extra flag.
 */
installFixtures({ seed: STRESS_SEED });

const app = new PuzzleApp({
	target: '#app',
	routes,
	models,
});

// The control surface owns mount() — `__STRESS__.ready` is the "app is up"
// signal a driver waits on, and it must not resolve before the first scenario
// has registered itself.
const stress = createStressControl(app);

if (typeof window !== 'undefined') {
	window.__STRESS__ = stress;
	window.__STRESS_APP__ = app;
}

export { stress };
export default app;
