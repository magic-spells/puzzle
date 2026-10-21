// D63: the frame/timer scheduler shared by store flushes, view renders and
// app.idle(). Chrome suspends rAF in hidden tabs, so a hidden tab (or a runtime
// without rAF) takes a timer directly; a visible one also arms a 220ms fallback
// in case the tab hides before the frame. Whichever fires first runs `run`; the
// other does nothing.
/** @param {() => void} run */
export function frame(run) {
	let done = 0;
	const go = () => done++ || (clearTimeout(timer), run());
	const visible = !(typeof document !== 'undefined' && document.hidden) && typeof requestAnimationFrame === 'function';
	const timer = setTimeout(go, visible ? 220 : 0);
	if (visible) requestAnimationFrame(go);
}

// Jobs still waiting for their frame, and the tick() callers waiting for none.
let pending = 0;
/** @type {(() => void)[]} */
const waiters = [];

/**
 * frame() for render work that tick() observes (D188): a store flush or a view
 * render. A job queued by a running job keeps the count above zero.
 * @param {() => void} job
 */
export function schedule(job) {
	pending++;
	frame(() => {
		try {
			job();
		} finally {
			if (!--pending) for (const resolve of waiters.splice(0)) resolve();
		}
	});
}

/** How many scheduled store flushes and view renders are still pending (D185). */
export const scheduled = () => pending;

/** Resolve once no scheduled store flush or view render is pending (D188). */
export async function tick() {
	while (pending) await new Promise((resolve) => waiters.push(/** @type {() => void} */ (resolve)));
}
