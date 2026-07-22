// Controllable fake Web Animations API for jsdom (constellation/doc/DOC-SPEC.md §12
// Gotchas: jsdom has NO Element.prototype.animate). Mirrors the stub embedded in
// tests/animations.test.js so the router-transition suite drives animations the
// same way: el.animate(...) returns an object with a DEFERRED `finished` promise
// (manual finish()), a cancel spy that REJECTS finished (real WAAPI AbortError
// semantics — animate.js swallows the rejection so callers see a resolve), and
// captured keyframes/options for assertions.
//
// Usage:
//   const waapi = installFakeAnimate();
//   ... drive router ...
//   waapi.animations               // every animate() call, in order
//   waapi.finishAll()              // resolve every still-running animation
//   waapi.uninstall()              // restore jsdom's real (absent) state
import { vi } from 'vitest';

export function installFakeAnimate() {
	const animations = [];
	Element.prototype.animate = function (keyframes, options) {
		let resolve, reject;
		const finished = new Promise((res, rej) => {
			resolve = res;
			reject = rej;
		});
		const anim = {
			target: this, // element, for the getAnimations fake below
			keyframes,
			options,
			finished,
			finishedState: 'running',
			finish() {
				this.finishedState = 'finished';
				resolve(this);
			},
			cancel: vi.fn(function () {
				this.finishedState = 'cancelled';
				reject(new DOMException('The user aborted a request.', 'AbortError'));
			}),
		};
		animations.push(anim);
		return anim;
	};
	// WAAPI getAnimations(): the still-RELEVANT animations targeting this element
	// — running, or finished-and-filling (fill:'both' keeps a finished animation
	// in effect); a cancelled one is gone. Backs animate.js's cancelAnimations()
	// (the router's navigation-failure strand recovery).
	Element.prototype.getAnimations = function () {
		return animations.filter((a) => a.target === this && a.finishedState !== 'cancelled');
	};

	return {
		animations,
		/** Resolve every animation still marked running (settles awaited finishes). */
		finishAll() {
			for (const a of animations) {
				if (a.finishedState === 'running') a.finish();
			}
		},
		uninstall() {
			delete Element.prototype.animate;
			delete Element.prototype.getAnimations;
		},
	};
}

export default installFakeAnimate;
