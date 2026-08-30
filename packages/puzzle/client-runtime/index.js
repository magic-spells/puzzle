/**
 * @magic-spells/puzzle — package entry (constellation/doc/DOC-SPEC.md §1).
 *
 * Target export surface: { PuzzleApp, PuzzleView, PuzzleModel, Puzzle, lazy }.
 * Phase 1 (constellation/doc/DOC-RUNTIME-KERNEL.md) is landing module by module — exports
 * appear here as they reach SPEC conformance:
 *
 *   [x] PuzzleModel, Puzzle (field builders)  — model.js
 *   [x] PuzzleView                            — views/PuzzleView.js
 *   [x] FormatterRegistry                     — formatters.js (internal)
 *   [x] PuzzleApp                             — app.js
 *   [x] lazy                                  — router/lazy.js
 */

export { PuzzleApp } from './app.js';
export { PuzzleModel, Puzzle, PuzzleValidationError } from './model.js';
export { PuzzleView } from './views/PuzzleView.js';
export { FormatterRegistry } from './formatters.js';
export { lazy } from './router/lazy.js';

// Compiler support (constellation/doc/DOC-COMPILER-DESIGN.md §b): compiled .pzl modules import
// ViewNode/SLOT_TAG/displayValue from the package root — the injected render()
// builds trees and applies the shared display-coercion rule with them. Not part
// of the SPEC §1 user-facing surface.
export { ViewNode, SLOT_TAG, SNIPPET_TAG, PORTAL_TAG } from './views/ViewNode.js';
export { displayValue } from './display.js';
