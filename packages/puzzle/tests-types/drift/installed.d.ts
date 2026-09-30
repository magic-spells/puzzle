/**
 * The drift guard compares the runtime with everything installed, because the
 * published declarations it reads include types/adapter.d.ts and
 * types/fixtures.d.ts, whose augmentations add the installed methods to the
 * published Store and PuzzleModel. The runtime side gets the same members here — taken from
 * the runtime's own JSDoc, never restated, so their signatures are checked too.
 */

import type {
	AdapterModelInstalled,
	AdapterStoreInstalled,
} from '../../client-runtime/datastore/adapter.js';
import type { FixtureStoreInstalled } from '../../client-runtime/fixtures/index.js';
import type { AdapterInstall } from '../../client-runtime/capabilities.js';

type AdapterInstalled = Pick<
	AdapterStoreInstalled,
	'adapter' | 'loadMany' | 'loadOne' | 'upsert' | 'saveRecord' | 'deleteRecord' | 'request' | '_network'
>;

declare module '../../client-runtime/datastore/store.js' {
	interface Store extends AdapterInstalled, FixtureStoreInstalled {}
}

declare module '../../client-runtime/model.js' {
	interface PuzzleModel extends Pick<AdapterModelInstalled, 'save' | 'delete'> {}
}

// The published adapter capability is opaque (a type-only brand); at runtime it
// is always the frozen value capabilities.js creates, so it carries `install`.
// Modelling that here lets a runtime parameter typed with the internal shape be
// compared against the public opaque one.
declare module '../../types/index.js' {
	interface PuzzleAdapterCapability extends AdapterInstall {}
}
