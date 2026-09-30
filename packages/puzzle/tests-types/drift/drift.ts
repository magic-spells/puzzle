/**
 * Drift guard: the published declarations (types/*.d.ts) against what the
 * JavaScript runtime actually exports. Part of `npm run test:runtime-types`.
 *
 * For every package export, three checks, each failing with the offending
 * export names ("Type '"foo"' is not assignable to type 'never'"):
 *
 * 1. undeclared — the runtime entry exports a value the .d.ts does not declare.
 * 2. unimplemented — the .d.ts declares a value the runtime does not export (a
 *    consumer's import would type-check and be `undefined` at runtime).
 * 3. mismatched — the runtime value is not ASSIGNABLE to its declaration: a
 *    function that now requires another argument, a class missing a declared
 *    member, a return type that no longer fits. The check runs one way on
 *    purpose: a declaration may be narrower than the runtime (generics, literal
 *    unions, overloads JSDoc cannot spell), never promise more than the runtime
 *    provides. Parameters compare bivariantly (strictFunctionTypes off in this
 *    project), so a declared parameter type only has to overlap the runtime's
 *    JSDoc one — arity and return types stay strict.
 *
 * Only VALUE exports count: interfaces and type aliases have no runtime side.
 * The runtime's types come from its JSDoc (allowJs), the same JSDoc
 * tsconfig.runtime.json checks; tests-types/runtime/*.d.ts supply the members
 * other modules install on the core classes. A name exported on purpose but NOT
 * public goes in that entry's internal list, with the reason — never silently.
 *
 * To see WHY an export is listed as mismatched, assign it in a scratch file:
 *   import type * as R from '../../client-runtime/index.js';
 *   import type * as T from '../../types/index.js';
 *   declare const r: typeof R;
 *   const x: typeof T.PuzzleApp = r.PuzzleApp;
 */

import type * as RootRuntime from '../../client-runtime/index.js';
import type * as RootTypes from '../../types/index.js';
import type * as AdapterRuntime from '../../client-runtime/datastore/adapter.js';
import type * as AdapterTypes from '../../types/adapter.js';
import type * as MorphRuntime from '../../client-runtime/morph.js';
import type * as MorphTypes from '../../types/morph.js';
import type * as RouterModesRuntime from '../../client-runtime/router/modes.js';
import type * as RouterModesTypes from '../../types/router-modes.js';
import type * as SsgRuntime from '../../client-runtime/ssg/index.js';
import type * as SsgTypes from '../../types/ssg.js';
import type * as StaticRuntime from '../../client-runtime/static/index.js';
import type * as StaticTypes from '../../types/static.js';
import type * as TestingRuntime from '../../client-runtime/testing/index.js';
import type * as TestingTypes from '../../types/testing.js';
import type * as FixturesRuntime from '../../client-runtime/fixtures/index.js';
import type * as FixturesTypes from '../../types/fixtures.js';

declare function undeclared<Runtime, Types, Internal = never>(): Exclude<
	keyof Runtime,
	keyof Types | Internal
>;
declare function unimplemented<Runtime, Types>(): Exclude<keyof Types, keyof Runtime>;
// The tuple wrap keeps an `any` runtime type from distributing into both branches.
// `Exempt` names an export whose shape cannot be compared, with the reason at the
// call site; its NAME is still checked above.
declare function mismatched<Runtime, Types, Exempt = never>(): {
	[K in Exclude<keyof Types & keyof Runtime, Exempt>]: [Runtime[K]] extends [Types[K]] ? never : K;
}[Exclude<keyof Types & keyof Runtime, Exempt>];

// ---- `@magic-spells/puzzle` ------------------------------------------------
export const rootUndeclared: never = undeclared<typeof RootRuntime, typeof RootTypes>();
export const rootUnimplemented: never = unimplemented<typeof RootRuntime, typeof RootTypes>();
export const rootMismatched: never = mismatched<typeof RootRuntime, typeof RootTypes>();

// ---- `@magic-spells/puzzle/adapter` ----------------------------------------
/**
 * Test seams of the adapter module, exported for its own unit tests; the
 * runtime reaches the same codec through capabilities.js. Not API.
 */
type AdapterInternal = 'STORE_RAW' | 'serializeReadState' | 'hydrateReadState';
export const adapterUndeclared: never = undeclared<
	typeof AdapterRuntime,
	typeof AdapterTypes,
	AdapterInternal
>();
export const adapterUnimplemented: never = unimplemented<typeof AdapterRuntime, typeof AdapterTypes>();
export const adapterMismatched: never = mismatched<typeof AdapterRuntime, typeof AdapterTypes>();

// ---- `@magic-spells/puzzle/morph` ------------------------------------------
export const morphUndeclared: never = undeclared<typeof MorphRuntime, typeof MorphTypes>();
export const morphUnimplemented: never = unimplemented<typeof MorphRuntime, typeof MorphTypes>();
export const morphMismatched: never = mismatched<typeof MorphRuntime, typeof MorphTypes>();

// ---- `@magic-spells/puzzle/router-modes` -----------------------------------
export const routerModesUndeclared: never = undeclared<
	typeof RouterModesRuntime,
	typeof RouterModesTypes
>();
export const routerModesUnimplemented: never = unimplemented<
	typeof RouterModesRuntime,
	typeof RouterModesTypes
>();
export const routerModesMismatched: never = mismatched<
	typeof RouterModesRuntime,
	typeof RouterModesTypes
>();

// ---- `@magic-spells/puzzle/ssg` --------------------------------------------
export const ssgUndeclared: never = undeclared<typeof SsgRuntime, typeof SsgTypes>();
export const ssgUnimplemented: never = unimplemented<typeof SsgRuntime, typeof SsgTypes>();
export const ssgMismatched: never = mismatched<typeof SsgRuntime, typeof SsgTypes>();

// ---- `@magic-spells/puzzle/static` -----------------------------------------
export const staticUndeclared: never = undeclared<typeof StaticRuntime, typeof StaticTypes>();
export const staticUnimplemented: never = unimplemented<typeof StaticRuntime, typeof StaticTypes>();
export const staticMismatched: never = mismatched<typeof StaticRuntime, typeof StaticTypes>();

// ---- `@magic-spells/puzzle/testing` ----------------------------------------
export const testingUndeclared: never = undeclared<typeof TestingRuntime, typeof TestingTypes>();
export const testingUnimplemented: never = unimplemented<typeof TestingRuntime, typeof TestingTypes>();
/**
 * mountView is generic over the view class: the declaration constrains it by the
 * published PuzzleView, the runtime by its own class, whose private `#` fields
 * make it nominal — the two constraints can never unify, whatever the JSDoc says.
 */
type TestingExempt = 'mountView';
export const testingMismatched: never = mismatched<
	typeof TestingRuntime,
	typeof TestingTypes,
	TestingExempt
>();

// ---- `@magic-spells/puzzle/fixtures` ---------------------------------------
export const fixturesUndeclared: never = undeclared<typeof FixturesRuntime, typeof FixturesTypes>();
export const fixturesUnimplemented: never = unimplemented<
	typeof FixturesRuntime,
	typeof FixturesTypes
>();
export const fixturesMismatched: never = mismatched<typeof FixturesRuntime, typeof FixturesTypes>();
