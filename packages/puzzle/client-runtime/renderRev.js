/**
 * The record render revision (DECISION-D170-INCREMENTAL-VDOM-LISTS).
 *
 * `Store._notify` stamps the notification sequence of the last observable
 * mutation onto the record under this Symbol, so two readers that hold the SAME
 * record reference can still tell "unchanged" from "changed since I last looked":
 *
 * - `listBlock.js` stores the revision on a row and rebuilds the row when it
 *   advances (a record mutates IN PLACE, so the reference never moves);
 * - `viewManager.js`'s `propsEqual` compares it against the snapshot the child
 *   view wrote the last time props were applied, which is what finally makes
 *   `<TodoItem todo={todo}/>` refresh on the record's own mutations.
 *
 * It lives in its own module with NO imports because both of those readers sit
 * on opposite sides of the model/view seam: `store.js` writes it,
 * `views/viewManager.js` and `views/PuzzleView.js` read it, and neither may
 * import the other (PuzzleView.js deliberately never imports model.js — see
 * D147's duck-typed record test). A Symbol key is invisible to payload merges,
 * `toJSON()`, schema-name assertions and reserved-name checks, so no model
 * surface moves to accommodate it.
 *
 * NOT public API: nothing exports it from index.js, and app code never spells it.
 * The separate `MUTATION_REVISIONS` counter (D125) is untouched — it counts
 * local edits for save reconciliation and answers a different question.
 */
export const RENDER_REV = Symbol('puzzle-render-rev');
