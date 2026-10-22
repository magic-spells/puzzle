// Wait for a real jsdom history traversal to finish routing.
//
// jsdom moves history on a chain of nested zero-delay timers and fires popstate
// from the last of them; the router's pop navigation then loads and commits on
// its own schedule. A fixed delay after history.back() races both on a busy
// machine. back() waits for the popstate itself, then polls `done` — the state
// that marks the navigation finished — and throws if it never arrives.

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * history.back(), resolved once popstate has fired and `done()` holds.
 *
 * @param {() => boolean} done
 * @param {number} [timeout] ms after the popstate
 */
export async function back(done, timeout = 2000) {
	const popped = new Promise((resolve) => window.addEventListener('popstate', resolve, { once: true }));
	history.back();
	await popped;
	const start = Date.now();
	while (!done()) {
		if (Date.now() - start > timeout) {
			throw new Error(`history.back(): the pop navigation did not settle within ${timeout}ms`);
		}
		await tick();
	}
}
