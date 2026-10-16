/**
 * Members the runtime reads on its own classes but never declares in a way
 * TypeScript can see from the JavaScript: fields installed with
 * Object.defineProperty, stamped on from another module, installed onto the
 * prototype by the opt-in adapter capability, or declared by the author's
 * compiled subclass. Type-only, and part of the runtime check alone
 * (tsconfig.runtime.json) — the published types/ never see these.
 */

import type { Store } from '../../client-runtime/datastore/store.js';

declare module '../../client-runtime/model.js' {
	interface PuzzleModel {
		/** Owning store; non-enumerable, set by Store.createRecord / cleared on remove. */
		_store: Store | null;
		/** The model type name the owning store registered the record under. */
		_type: string;
		/** Server round-trip provenance (D50); non-enumerable. */
		_synced: boolean;
		/** Removed-instance flag (D50); non-enumerable. */
		_deleted: boolean;
	}
	// The author's subclass declares these statics.
	namespace PuzzleModel {
		let schema: Record<string, any> | undefined;
		let adapter: Record<string, any> | undefined;
	}
}

declare module '../../client-runtime/views/PuzzleView.js' {
	interface PuzzleView {
		// ---- author-declared on the compiled subclass ----
		/** Compiled from <puzzle-skeleton> (D39). */
		renderSkeleton?(): any;
		/** Declarative enter/leave animations (D28). */
		animations?: import('../../types/index.js').Animations;
		/** Minimum ms a shown skeleton stays up. */
		skeletonMinDuration?: number;

		// ---- stamped on by other runtime modules ----
		/** The view that mounted this component (viewManager), walked upward to mark owners dirty. */
		__retryParent?: PuzzleView;
		/** The expanded prerender tree a takeover adopts (stamped by ssg/preload). */
		__takeoverTree?: any;
		/** Set on a mounted errorView so its own failure reports as `error-view`. */
		__errorViewFailed?: () => void;

		// ---- installed by the adapter capability (D161) ----
		_settleData?(
			store: Store,
			run: () => any,
			expectsAsync: boolean,
			isStale: () => boolean,
			parked: { reconcile?: (committed: boolean) => void } | null,
			token?: any
		): any;
	}
}

declare module '../../client-runtime/views/ViewNode.js' {
	interface ViewNode {
		/** Closing comment of a <Component> selection range (D180). */
		slotEnd?: Comment;
		/** An html vnode's parsed nodes (views/html.js). */
		nodes?: ChildNode[];
		/** A <Portal> vnode's outlet range (views/portal.js). */
		portal?: { start: Comment; end: Comment; placeholder: Comment } | null;
	}
}
