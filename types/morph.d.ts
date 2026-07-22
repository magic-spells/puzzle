/**
 * Declarations for the `@magic-spells/puzzle/morph` subpath (v1.23 D55; v1.35 D68).
 *
 * One export: `enableMorph(app)`, which creates a MorphEngine and registers it
 * as the app router's morph handler, returning the engine for live tuning.
 * Mirrors client-runtime/morph.js exactly. Covers BOTH morph shapes with no API
 * surface of its own: coexisting live pairs (nested-route dialogs — fly-back
 * capable) AND sibling-swap capture flights (Library ↔ Album — a clone bridges
 * the destroy-before-mount gap). Cross-view capture flights are automatic,
 * default-on, and work in BOTH directions (forward push and back/forward pop).
 * Three attributes share ONE id namespace (D69), all derived from the configured
 * base (`options.attribute` overrides all three):
 *   - `data-puzzle-morph="id"` (plain) — launches AND receives (symmetric pairs).
 *   - `data-puzzle-morph-trigger="id"` — launches ONLY, never a landing (the
 *     back-nav that renders plainly).
 *   - `data-puzzle-morph-target="id"` — receives ONLY, PREFERRED over a plain
 *     same-id element on a collision; never launches.
 *
 * The engine's real type lives in the OPTIONAL peer `@magic-spells/morph-engine`,
 * which ships no declarations. Rather than depend on that (and force a phantom
 * dependency on apps that DO import this subpath), the `MorphEngine` interface
 * below describes only the structural surface enableMorph touches — enough for a
 * strict TS app to `enableMorph(app)` without an untyped-module error.
 */

import type { PuzzleApp } from './index.js';

/**
 * The structural subset of `@magic-spells/morph-engine`'s MorphEngine used by
 * the puzzle integration and returned to callers for live tuning. The real
 * class (an EventEmitter with more surface) is a superset of this.
 */
export interface MorphEngine {
	/** 'idle' | 'showing' | 'shown' | 'hiding'. */
	readonly state: string;
	/** Morph the source element into the target (both hidden until it lands). */
	show(options: { from: Element; to: Element; display?: string }): Promise<boolean>;
	/** Morph back from target to source; the router awaits this on leave. */
	hide(): Promise<boolean>;
	/** Abort any morph and restore both elements to their resting state. */
	stop(): void;
	[key: string]: any;
}

/** Options for `enableMorph` — MorphEngine tuning plus a pairing-attribute override. */
export interface EnableMorphOptions {
	/** Override the `data-puzzle-morph` pairing attribute. */
	attribute?: string;
	/** Forwarded to the MorphEngine constructor (attraction, friction, ...). */
	[key: string]: any;
}

/**
 * Create a MorphEngine and register it as `app`'s router morph handler. Call
 * once after `new PuzzleApp(...)`. Returns the engine for live tuning/events.
 */
export declare function enableMorph(app: PuzzleApp, options?: EnableMorphOptions): MorphEngine;
