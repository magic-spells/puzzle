/**
 * Controllable Web Animations API for DOM test environments (v1.58, D94).
 *
 * Mirrors Puzzle's internal test fake without importing a test runner: method
 * calls are recorded on plain `.calls` arrays by default, or callers may pass a
 * Vitest/Jest-shaped `spy(implementation)` factory.
 */

export function installFakeAnimate({ spy } = {}) {
	if (typeof Element !== 'function') {
		throw new Error('[puzzle/testing] installFakeAnimate() requires a DOM with Element');
	}

	const prototype = Element.prototype;
	const animateDescriptor = Object.getOwnPropertyDescriptor(prototype, 'animate') ?? null;
	const getAnimationsDescriptor =
		Object.getOwnPropertyDescriptor(prototype, 'getAnimations') ?? null;
	const animations = [];
	const animateCalls = [];
	let installed = true;

	prototype.animate = function (keyframes, options) {
		animateCalls.push([this, keyframes, options]);
		let resolve;
		let reject;
		const finished = new Promise((res, rej) => {
			resolve = res;
			reject = rej;
		});
		const animation = {
			target: this,
			keyframes,
			options,
			finished,
			finishedState: 'running',
			playState: 'running',
			finish() {
				if (this.finishedState !== 'running') return;
				this.finishedState = 'finished';
				this.playState = 'finished';
				resolve(this);
			},
		};
		animation.cancel = makeRecorded(
			function () {
				if (this.finishedState === 'cancelled') return;
				this.finishedState = 'cancelled';
				this.playState = 'idle';
				reject(new DOMException('The user aborted a request.', 'AbortError'));
			},
			spy
		);
		animation.pause = makeRecorded(
			function () {
				this.playState = 'paused';
			},
			spy
		);
		animation.play = makeRecorded(
			function () {
				this.playState = 'running';
			},
			spy
		);
		animations.push(animation);
		return animation;
	};

	// Include running and finished-and-filling animations; cancellation removes
	// one from getAnimations(), matching the recovery path in animate.js.
	prototype.getAnimations = function () {
		return animations.filter(
			(animation) =>
				animation.target === this && animation.finishedState !== 'cancelled'
		);
	};

	return {
		animations,
		animateCalls,
		finishAll() {
			for (const animation of animations) {
				if (animation.finishedState === 'running') animation.finish();
			}
		},
		uninstall() {
			if (!installed) return;
			installed = false;
			restore(prototype, 'animate', animateDescriptor);
			restore(prototype, 'getAnimations', getAnimationsDescriptor);
		},
	};
}

function makeRecorded(implementation, spy) {
	if (typeof spy === 'function') return spy(implementation);
	const calls = [];
	const recorded = function (...args) {
		calls.push(args);
		return implementation.apply(this, args);
	};
	recorded.calls = calls;
	return recorded;
}

function restore(target, name, descriptor) {
	if (descriptor) Object.defineProperty(target, name, descriptor);
	else delete target[name];
}

export default installFakeAnimate;
