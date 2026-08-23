// Full-set built-in formatter manifest — the fallback for NON-compiler consumers
// (mapped to '@magic-spells/puzzle/formatters/manifest'). app.js and formatters.js
// import the DEFAULT here as a seed map of every built-in; a compiled app never
// reaches this file — the esbuild plugin's virtual manifest imports the exact
// named subset it uses straight from ./builtins.js (tree-shaken). Kept as a thin
// re-export of ./builtins.js so the two can never drift.
export * from './builtins.js';
import * as builtins from './builtins.js';
export default builtins;
