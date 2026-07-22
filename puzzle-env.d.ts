/**
 * Ambient module shim so `import Home from './views/Home.pzl'` type-checks in a
 * Puzzle app authored with `<scripts lang="ts">`. Each `.pzl` file compiles to a
 * module whose default export is a PuzzleView subclass.
 *
 * Reference it from your app's tsconfig.json — either add this file to the
 * `"include"` array, or add a triple-slash directive to one of your `.ts` files:
 *
 *   /// <reference types="@magic-spells/puzzle/puzzle-env" />
 */

declare module '*.pzl' {
	import { PuzzleView } from '@magic-spells/puzzle';
	const component: typeof PuzzleView;
	export default component;
}
