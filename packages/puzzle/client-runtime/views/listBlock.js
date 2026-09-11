/**
 * Persistent list blocks — the incremental half of the virtual DOM
 * (DECISION-D170-INCREMENTAL-VDOM-LISTS).
 *
 * An item-form `{#for}` no longer compiles to `items.map(item => new ViewNode(…))`.
 * It compiles to one call into a per-site block that keeps ONE row state per key
 * across renders and returns the SAME vnode subtree for a row whose inputs did
 * not change:
 *
 *   import { ViewNode, listRows as __l } from '@magic-spells/puzzle';
 *   const __L0 = { key: (todo) => ViewNode.keyOf(todo) };
 *   …
 *   __l(this, this, 0, __d.filteredTodos, (s) =>
 *     new ViewNode(TodoItem, { key: s.k, todo: s.item,
 *       remove: (s.h0 ??= (event) => this.events.deleteTodo(s.item)) }, [])
 *   , __L0)
 *
 * The import is injected only by a module that actually lowers a loop, exactly
 * the way `displayValue as __s` is — so a loop-free app never pulls this module
 * into its bundle.
 *
 * The returned array is spliced exactly where the `.map()` result was, so keyed
 * reconciliation, mixed keyed/unkeyed pairing, leaving rows, FLIP and the shared
 * sibling key namespace all behave as they do today (D58, D85). The block only
 * decides WHICH vnode objects appear in that array — cached or freshly built —
 * and `patch()`'s identity short-circuit makes the cached ones free.
 *
 * The row state IS the scope object the factory receives, so a rebuilt row keeps
 * its handlers (`s.h0…`), its static subtrees (`s.c`) and its nested blocks
 * (`s.__lists`). Handlers are identity-stable and read `s.item` at FIRE time,
 * which is what stops a list's callback props from waking every child on every
 * parent render (D62's measured cost, now removed at the source).
 */

import { RENDER_REV } from '../renderRev.js';
import { devperfListRows } from '../devperf.js';

/**
 * Render one loop site.
 *
 * @param {object} view the PuzzleView whose render() is running — the owner of
 *   the `__dirty` root mask (§3.6) and the reporter of the dev counters
 * @param {object} owner where this site's block lives: the view for a top-level
 *   loop, the enclosing ROW STATE for a nested one, so inner blocks are keyed
 *   per outer row and die with it
 * @param {number} id the site id (per file, shared with the `__h`/`__c` counters)
 * @param {Iterable} items the loop's items
 * @param {(row: object) => object} factory the compiled row body
 * @param {object} meta the site's static facts: `key` (always), plus `counter`,
 *   `ctrl`, `roots`, `fields`, `deep`, `volatile` when non-default
 * @returns {object[]} the row vnodes, in order
 */
export function listRows(view, owner, id, items, factory, meta) {
	const blocks = (owner.__lists ??= []);
	const block = (blocks[id] ??= { rows: new Map(), gen: 0, seen: 0, verdicts: null });
	const rows = block.rows;
	const gen = ++block.gen;

	// A block that MISSED a render cannot trust the root mask (D170). `view.__dirty`
	// is a per-render DELTA: a site whose `{#if}` was false — or whose enclosing row
	// was cached, which is exactly "not invoked" for a nested block — never sees the
	// bits that flipped while it was away, and by the time it runs again the mask is
	// clean and its rows would hand back stale vnodes. So if this view rendered more
	// than once since this block last ran, every row is dirty for this pass; the row
	// STATE survives, so handlers and nested blocks stay stable. A view that renders
	// outside the counter (prerender, takeover) leaves `__rgen` at 0 and this false.
	const rgen = view.__rgen;
	const missedRender = rgen - block.seen > 1;
	block.seen = rgen;

	const key = meta.key;
	const counter = meta.counter === true;
	const ctrl = meta.ctrl === true;
	const roots = meta.roots || 0;
	// A body reading a parent root the render changed (`selectedId === todo.id`)
	// dirties every row of this site, once, for the whole pass (§3.6).
	const rootsDirty = roots !== 0 && (view.__dirty & roots) !== 0;
	// `volatile` is the compiler's "I could not analyse this body" flag: an
	// expression reaching through `this` (`{ this.ctx.router.current.path }`)
	// depends on state no root mask and no record revision covers, so the site
	// gives up caching exactly as a plain-object row does.
	const volatile = meta.volatile === true;
	// A `deep` site is conservative for every class, so it needs no schema check
	// at all; a site with `fields` needs one verdict per model class (cached on
	// the block). A site with neither — the common one, and the shape the todos
	// loop compiles to — decides both with this pair of booleans and never
	// touches the schema.
	const deep = meta.deep === true;
	const fields = meta.fields;
	const checkFields = !deep && fields !== undefined && fields.length > 0;

	const out = new Array(items.length);
	// Rows reached through the key map this pass. When it equals the map's size
	// nothing was dropped, and the sweep below is skipped entirely.
	let seen = 0;
	let cached = 0;
	let built = 0;

	for (let i = 0; i < items.length; i++) {
		const item = items[i];
		const k = key(item, i);
		let row = k == null ? undefined : rows.get(k);

		// Two uncached shapes, both of which keep today's semantics exactly:
		//
		// - a NULL key drops this row to positional diffing (D58). ViewNode.keyOf
		//   has already warned through its own once-guard, so nothing is said here.
		// - a DUPLICATE key within one render would alias two logical rows onto one
		//   row state (and one DOM node). The keyed patcher warns about the vnodes;
		//   this warns about the caching, because the row that loses the race would
		//   otherwise silently render its neighbour's item.
		if (k == null || (row !== undefined && row.gen === gen)) {
			if (
				k != null &&
				(typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__)
			) {
				warnDuplicateListKey(k);
			}
			out[i] = factory(newRow(k, item, i, gen, revisionOf(item)));
			built++;
			continue;
		}

		const rev = revisionOf(item);
		let dirty;
		seen++;
		if (row === undefined) {
			// A brand-new row stores the item's CURRENT revision, not 0: it is about
			// to be built against exactly this state, and the next pass compares
			// against what this build saw.
			row = newRow(k, item, i, gen, rev);
			rows.set(k, row);
			dirty = true;
		} else {
			// §3.2's dirtiness rules, in the order they are cheapest to decide:
			//
			// - a different item object (a replacement record, a new plain object);
			// - a RECORD whose stored revision advanced — the reference is identical,
			//   so this is the only thing that can say its data changed;
			// - anything else object-shaped (plain object, array, function): it can be
			//   mutated in place with no revision to observe, so it is always dirty,
			//   exactly as today. Primitive items cache on `!==` alone;
			// - the index, when the body reads the counter;
			// - a parent root the body reads, or an unanalysable body.
			dirty =
				row.item !== item ||
				(rev >= 0
					? rev !== row.rev || deep || (checkFields && isConservative(block, item, fields))
					: rev === NOT_CACHEABLE) ||
				(counter && row.i !== i) ||
				rootsDirty ||
				missedRender ||
				volatile;
			row.item = item;
			row.i = i;
			row.rev = rev >= 0 ? rev : 0;
			row.gen = gen;
		}

		if (dirty) {
			built++;
			row.vnode = factory(row);
			// Controlled form values inside a CACHED row are re-asserted from this
			// list by patch()'s identity short-circuit, which is the contract
			// patchAttrs/reassertSelectValue carry for every other subtree (§3.2).
			// Collected once per build, walked once per clean pass: O(controls).
			if (ctrl) {
				const controls = collectControls(row.vnode);
				row.controls = controls;
				if (controls) row.vnode.controls = controls;
			}
		} else {
			cached++;
		}
		out[i] = row.vnode;
	}

	// Rows the pass never visited have left the list: their vnodes are gone from
	// the returned array, so the patcher unmounts them through its ordinary leave
	// path. One pass, and only when something actually went missing.
	if (seen !== rows.size) {
		for (const [k, row] of rows) {
			if (row.gen !== gen) rows.delete(k);
		}
	}

	if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
		devperfListRows(view, cached, built, deep || isConservativeSite(block) ? 1 : 0);
	}
	return out;
}

/**
 * A fresh row state. The shape is fixed here — every field present from the
 * start, so a row keeps one hidden class for its whole life — while the compiled
 * body adds its own cached handlers as `s.h0`, `s.h1`, … on first use. `c` is
 * the row's static-subtree cache (`(s.c[0] ??= …)`) and `__lists` holds nested
 * blocks, allocated by listRows only if a nested site is actually visited.
 */
function newRow(k, item, i, gen, rev) {
	return {
		k,
		item,
		i,
		rev: rev >= 0 ? rev : 0,
		vnode: null,
		controls: null,
		gen,
		c: [],
		__lists: undefined,
	};
}

// Sentinel for "object-shaped but carries no revision" — a plain object, array
// or function, which can be mutated in place and therefore never caches.
const NOT_CACHEABLE = -1;
// Sentinel for a primitive item: nothing to mutate in place, so `!==` on the
// item itself is the whole test.
const PRIMITIVE = -2;

/** A record's stored render revision, or one of the two sentinels above. */
function revisionOf(item) {
	if (item === null || (typeof item !== 'object' && typeof item !== 'function')) {
		return PRIMITIVE;
	}
	const rev = item[RENDER_REV];
	return typeof rev === 'number' ? rev : NOT_CACHEABLE;
}

/**
 * Is this site conservative for this item's model class (§3.2)?
 *
 * A record's revision covers its OWN fields. A body reading `todo.author.name`
 * (a relation), a computed getter, or any deeper path depends on data the
 * revision does not describe, so such a site must treat its record rows as
 * always dirty — the row cache is an optimisation and may never hide a
 * legitimate update.
 *
 * The compiler reports, per site, the item members read at depth one (`fields`)
 * and a `deep` flag for anything deeper or any call. `deep` is decided by the
 * caller (it holds for every class); here every field is checked against the
 * model's own schema and relationship names, ONCE per (block, constructor) — the
 * verdict is a property of the class, not of the record, and a list of 1,000
 * todos must not pay 1,000 schema walks. Formatters are display-pure by SPEC
 * contract and do not count.
 */
function isConservative(block, item, fields) {
	const Model = item.constructor;
	const verdicts = (block.verdicts ??= new Map());
	let verdict = verdicts.get(Model);
	if (verdict === undefined) {
		verdict = false;
		const schema =
			typeof Model.normalizedSchema === 'function' ? Model.normalizedSchema() : null;
		const rels =
			typeof Model.relationshipDefs === 'function' ? Model.relationshipDefs() : null;
		for (let i = 0; i < fields.length; i++) {
			const field = fields[i];
			// A relationship resolves through the RELATED collection, and a field that
			// is not in the schema at all is a computed getter over who-knows-what.
			if ((rels !== null && field in rels) || schema === null || !(field in schema)) {
				verdict = true;
				break;
			}
		}
		verdicts.set(Model, verdict);
	}
	return verdict;
}

/**
 * Dev-only: has this site decided it must be conservative about any model class
 * it has seen? Reported as a counter so an author can see WHY a list is still
 * rebuilding every row (the dev-counter half of §12's risk mitigation) — a
 * conservative site is the one shape that keeps paying full price.
 */
function isConservativeSite(block) {
	const verdicts = block.verdicts;
	if (!verdicts) return false;
	for (const verdict of verdicts.values()) if (verdict) return true;
	return false;
}

/**
 * Collect the controlled form vnodes inside a freshly built row (§3.2).
 * Returns null when there are none, so the common row stores nothing and
 * `patch()`'s `newVnode.controls` test reads undefined.
 *
 * Skipped: component vnodes (a child owns its own subtree and re-asserts its own
 * controls when it patches), string children (an inline-SVG seed is verbatim
 * markup, never vnodes), and an ISLAND element's children — the D44 contract is
 * that the patcher never reconciles them after the seed, so replaying identity
 * into one would reset a user-edited input inside a third-party widget back to
 * its mount-time value. The island ELEMENT's own `value`/`checked` still counts.
 *
 * PORTALS are walked through: their children are reconciled by patchPortal only
 * when the patch actually reaches the portal vnode, and a cached ancestor returns
 * before that ever happens. The portaled vnodes keep usable `el` links (they live
 * in the outlet), so re-asserting from here is the same work patchAttrs would do.
 */
function collectControls(vnode) {
	const out = [];
	collectInto(vnode, out);
	return out.length > 0 ? out : null;
}

function collectInto(vnode, out) {
	const tag = vnode.tag;
	if (typeof tag !== 'string') return;
	const attrs = vnode.attrs;
	if (tag === 'input' || tag === 'textarea' || tag === 'select') {
		if ('value' in attrs || 'checked' in attrs) out.push(vnode);
	}
	if ('island' in attrs) return;
	const children = vnode.children;
	if (typeof children === 'string') return;
	for (let i = 0; i < children.length; i++) collectInto(children[i], out);
}

// Two rows sharing a key within one render would share one row state: the second
// would overwrite the first's item and both positions would render the same row.
// The block builds both uncached instead (today's semantics, unchanged), and says
// so once per session — dev-only, behind the inline probe, exactly like
// viewManager's warnDuplicateKey, so production tree-shakes the helper and its
// once-state away.
let warnedDuplicateListKey = false;
function warnDuplicateListKey(key) {
	if (warnedDuplicateListKey) return;
	warnedDuplicateListKey = true;
	console.warn(
		`[puzzle] duplicate key ${JSON.stringify(key)} in one {#for} pass — keys must be unique ` +
			'within a list; the duplicate rows render uncached and reconcile positionally.'
	);
}
