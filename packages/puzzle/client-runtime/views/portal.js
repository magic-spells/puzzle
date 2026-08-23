/**
 * Portal runtime (D144), split from ViewManager so D89's
 * __PUZZLE_HAS_PORTAL__ define can remove the whole module when unused.
 * ViewManager passes its recursive mount/patch/unmount operations into the
 * three integration functions, avoiding a circular module dependency.
 */

import { devperfMutation } from '../devperf.js';

let portalHost = null;
let portalOutlet = null;
// Both bracket comments of every live range map to their record, so the
// `outside` containment walk resolves a target to its owner in one backwards
// sibling scan.
const portalRanges = new Map();
let portalCount = 0;

/** Point new portal outlets at the app mount container's parent. */
export function setPortalHost(el) {
	if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
		if (portalRanges.size > 0 && el !== portalHost) {
			console.warn(
				'[puzzle] setPortalHost() called while another mounted app has live portals. ' +
					'Portal state is shared per page: multiple simultaneous PuzzleApp instances ' +
					'are not supported, and unmounting either app will tear down the other\'s portals.'
			);
		}
	}
	portalHost = el || null;
}

/** Drop the outlet and all range bookkeeping on app unmount. */
export function teardownPortals() {
	portalOutlet?.remove();
	portalOutlet = null;
	portalRanges.clear();
	portalCount = 0;
	portalHost = null;
}

function ensurePortalOutlet() {
	if (portalOutlet && portalOutlet.isConnected) return portalOutlet;
	portalOutlet = document.createElement('div');
	portalOutlet.setAttribute('data-puzzle-portal', '');
	const host = portalHost && portalHost.isConnected ? portalHost : document.body;
	host.appendChild(portalOutlet);
	if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) devperfMutation();
	return portalOutlet;
}

function releasePortalOutlet() {
	// An element lingering mid-leave-animation keeps the outlet alive until the
	// next release or app teardown.
	if (portalCount > 0 || !portalOutlet || portalOutlet.firstChild) return;
	portalOutlet.remove();
	portalOutlet = null;
	if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) devperfMutation();
}

export function mountPortal(vnode, parent, ref, ctx, owner, mount) {
	const placeholder = document.createComment('puzzle-portal');
	vnode.el = placeholder;
	parent.insertBefore(placeholder, ref ?? null);
	const outlet = ensurePortalOutlet();
	const start = document.createComment('puzzle-portal-start');
	const end = document.createComment('puzzle-portal-end');
	outlet.appendChild(start);
	outlet.appendChild(end);
	const range = { start, end, placeholder };
	vnode.portal = range;
	portalRanges.set(start, range);
	portalRanges.set(end, range);
	portalCount++;
	for (const child of vnode.children) mount(child, outlet, end, ctx, owner);
	if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) devperfMutation();
	return placeholder;
}

export function patchPortal(oldVnode, newVnode, ctx, owner, patchChildren) {
	const range = (newVnode.portal = oldVnode.portal);
	if (!range) return;
	range.placeholder = newVnode.el;
	const outlet = range.end.parentNode;
	if (!outlet) return;
	patchChildren(outlet, oldVnode.children, newVnode.children, ctx, owner, range.end);
}

export function unmountPortal(vnode, unmount) {
	for (const child of vnode.children) unmount(child);
	const range = vnode.portal;
	if (range) {
		portalRanges.delete(range.start);
		portalRanges.delete(range.end);
		range.start.remove();
		range.end.remove();
		vnode.portal = null;
		portalCount--;
	}
	if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
		if (vnode.el?.parentNode) devperfMutation();
	}
	vnode.el?.remove();
	releasePortalOutlet();
}

function owningPortalPlaceholder(target) {
	if (!portalOutlet || portalRanges.size === 0 || !target) return null;
	if (!portalOutlet.contains(target)) return null;
	let node = target;
	while (node && node.parentNode !== portalOutlet) node = node.parentNode;
	if (!node) return null;
	for (let n = node; n; n = n.previousSibling) {
		const range = portalRanges.get(n);
		if (range) return range.start === n ? range.placeholder : null;
	}
	return null;
}

/** Logical containment for @event:outside, including nested portals. */
export function portalAwareContains(el, target) {
	let t = target;
	for (let hops = 0; hops < 32; hops++) {
		if (el.contains(t)) return true;
		const placeholder = owningPortalPlaceholder(t);
		if (!placeholder) return false;
		t = placeholder;
	}
	return false;
}
