/**
 * Prepare every non-routed component below an SSG/static takeover tree before
 * the prerendered DOM is cleared.
 *
 * Routed views/layouts arrive pinned and already preloaded. For each component
 * we render and slot-expand its first tree, preload any fresh child component,
 * then recurse into that child's rendered tree. The prepared tree is consumed
 * by PuzzleView.mount(), so the browser mounts these exact preloaded instances
 * instead of constructing them again through ViewManager's ordinary
 * fire-and-forget component path.
 */

import { expandSlots } from '../views/viewManager.js';

/**
 * @param {import('../views/ViewNode.js').ViewNode|string|null} vnode
 * @param {object} ctx
 * @returns {Promise<object[]>} successfully preloaded non-routed instances
 */
export async function preloadTakeoverComponents(vnode, ctx) {
	const instances = [];
	await preloadNode(vnode, ctx, instances);
	return instances;
}

async function preloadNode(vnode, ctx, instances) {
	if (vnode == null || typeof vnode === 'string' || vnode.isText || vnode.isSlot) return;

	if (!vnode.isComponent) {
		if (typeof vnode.children === 'string') return;
		for (const child of vnode.children) await preloadNode(child, ctx, instances);
		return;
	}

	// A routed instance arrives already constructed and preloaded (the Router owns
	// it). Only a NESTED component is built here — and its construction sits inside
	// the fail-soft try, because a constructor that throws (a field initializer, an
	// explicit body) would otherwise abort the whole takeover instead of degrading to
	// this one component's placeholder.
	const nested = vnode.instance == null;
	let instance = vnode.instance;

	if (nested) {
		try {
			instance = new vnode.tag(ctx);
			await instance.preload({ params: {}, props: vnode.attrs, route: null });
		} catch (err) {
			// Match mountComponent's existing fail-soft posture: log the failed child,
			// release partial subscriptions/lifecycle state, and leave a recoverable
			// comment position when the prepared parent tree mounts. A constructor that
			// threw left no instance to release.
			console.error('[puzzle] child mount failed:', err);
			instance?.destroy();
			vnode.takeoverFailed = true;
			return;
		}
	}

	let tree;
	try {
		tree = instance.render();
	} catch (err) {
		if (!nested) return;
		console.error('[puzzle] child mount failed:', err);
		instance.destroy();
		vnode.takeoverFailed = true;
		return;
	}

	if (nested) {
		vnode.instance = instance;
		vnode.takeoverPreloaded = true;
		instances.push(instance);
	}

	const expanded = tree == null ? tree : expandSlots(tree, vnode.children);
	instance.__takeoverTree = expanded;
	await preloadNode(expanded, ctx, instances);
}

export default preloadTakeoverComponents;
