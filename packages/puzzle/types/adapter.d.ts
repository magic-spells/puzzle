/** Public declarations for the opt-in @magic-spells/puzzle/adapter subpath. */

import type {
	AdapterMock,
	PuzzleAdapterCapability,
	PuzzleModel,
	RequestOptions,
} from './index.js';

export type AdapterMaybePromise<T> = T | Promise<T>;

/** The fetch-compatible function Puzzle binds to every adapter function. */
export type AdapterFetch = typeof globalThis.fetch;

/** Values serialized by the endpoint-generated loadMany transport. */
export type AdapterLoadManyOptions = Record<
	string,
	string | number | boolean | Array<string | number | boolean> | null | undefined
>;

/** A server-returned record shape. The framework validates primary keys at runtime. */
export type AdapterRecord = Record<string, any>;

/**
 * What a `loadMany` verb may answer (D193): the records alone, or the records
 * with response `meta` (a cursor, a total, a next page) that a query read
 * exposes as `findMany(...).meta`.
 */
export type AdapterLoadManyResult =
	| AdapterRecord[]
	| { records: AdapterRecord[]; meta?: Record<string, any> | null };

/** A record's write status (D193), from `store.syncStatus(record)`. */
export interface SyncStatus {
	/** The write running at the front of the record's chain, or null when none is queued. */
	readonly pending: 'save' | 'delete' | null;
	/** The last failed write's error, cleared when the next write starts. */
	readonly error: unknown;
}

/** A `save()`/`delete()` promise, carrying its own status while it runs (D193). */
export type WritePromise<T> = Promise<T> & {
	/** true until the write settles. Not reactive — read `store.syncStatus()` in data(). */
	pending: boolean;
	/** null, or the rejection reason once the write has failed. */
	error: unknown;
};

/** Per-model identity supplied last to every app-wide adapter default. */
export interface AdapterDefaultContext {
	type: string;
	endpoint?: string;
}

/** App-wide implementations for the five framework adapter verbs. */
export interface AdapterDefaults<TRecord extends PuzzleModel = PuzzleModel> {
	loadMany?(
		fetch: AdapterFetch,
		options: AdapterLoadManyOptions | undefined,
		context: AdapterDefaultContext
	): AdapterMaybePromise<Response | AdapterLoadManyResult>;
	loadOne?(
		fetch: AdapterFetch,
		id: any,
		context: AdapterDefaultContext
	): AdapterMaybePromise<Response | AdapterRecord>;
	create?(
		fetch: AdapterFetch,
		record: TRecord,
		context: AdapterDefaultContext
	): AdapterMaybePromise<Response | AdapterRecord | null | undefined>;
	update?(
		fetch: AdapterFetch,
		record: TRecord,
		context: AdapterDefaultContext
	): AdapterMaybePromise<Response | AdapterRecord | null | undefined>;
	delete?(
		fetch: AdapterFetch,
		record: TRecord,
		context: AdapterDefaultContext
	): AdapterMaybePromise<unknown>;
}

/**
 * Per-model transport functions. `endpoint` is optional REST shorthand; any
 * authored verb wins over its generated default. Custom function keys are
 * supported and become callable through `store.adapter(type)`.
 */
export interface AdapterConfig<TRecord extends PuzzleModel = PuzzleModel> {
	endpoint?: string;
	/** Development/test mock served in place of the network (D95). */
	mock?: AdapterMock;
	loadMany?(
		fetch: AdapterFetch,
		options?: AdapterLoadManyOptions
	): AdapterMaybePromise<Response | AdapterLoadManyResult>;
	loadOne?(fetch: AdapterFetch, id: any): AdapterMaybePromise<Response | AdapterRecord>;
	create?(
		fetch: AdapterFetch,
		record: TRecord
	): AdapterMaybePromise<Response | AdapterRecord | null | undefined>;
	update?(
		fetch: AdapterFetch,
		record: TRecord
	): AdapterMaybePromise<Response | AdapterRecord | null | undefined>;
	delete?(fetch: AdapterFetch, record: TRecord): AdapterMaybePromise<unknown>;
}

type BoundAdapterVerbs<TRecord extends PuzzleModel> = {
	loadMany(
		options?: AdapterLoadManyOptions
	): AdapterMaybePromise<Response | AdapterLoadManyResult>;
	loadOne(id: any): AdapterMaybePromise<Response | AdapterRecord>;
	create(
		record: TRecord
	): AdapterMaybePromise<Response | AdapterRecord | null | undefined>;
	update(
		record: TRecord
	): AdapterMaybePromise<Response | AdapterRecord | null | undefined>;
	delete(record: TRecord): AdapterMaybePromise<unknown>;
};

/** Adapter functions after the enhanced fetch has been bound by a Store. */
export type BoundAdapterConfig<TConfig extends AdapterConfig<any> = AdapterConfig> = {
	[K in keyof TConfig]: NonNullable<TConfig[K]> extends (
		fetch: AdapterFetch,
		...args: infer TArgs
	) => infer TResult
		? (...args: TArgs) => TResult
		: TConfig[K];
} &
	(TConfig extends { endpoint: string }
		? BoundAdapterVerbs<TConfig extends AdapterConfig<infer TRecord> ? TRecord : PuzzleModel>
		: Partial<
				BoundAdapterVerbs<
					TConfig extends AdapterConfig<infer TRecord> ? TRecord : PuzzleModel
				>
			>) & {
		/** Custom adapter methods are author-defined and preserve their bound signatures with a generic. */
		[key: string]: any;
	};

/** Opaque app-config capability for Puzzle's adapter runtime. */
export interface AdapterCapability extends PuzzleAdapterCapability {}

/** The bare capability additionally creates app-configured capability values. */
export interface AdapterFactoryCapability extends AdapterCapability {
	/** Return a new capability carrying app-wide defaults for framework verbs. */
	defaults<TDefaults extends AdapterDefaults>(
		verbs: TDefaults & Record<Exclude<keyof TDefaults, keyof AdapterDefaults>, never>
	): AdapterCapability;
}

/** Pass once as `new PuzzleApp({ ..., adapter })`. */
export declare const adapter: AdapterFactoryCapability;

/** Thrown when an adapter write/request responds non-OK. */
export declare class PuzzleAdapterError extends Error {
	constructor(status: number, statusText?: string, body?: any);
	status: number;
	statusText?: string;
	body?: any;
}

declare module './index.js' {
	interface ModelAdapter extends AdapterConfig {}

	interface Store {
		/** Return the memoized model adapter with enhanced fetch bound to every function. */
		adapter<TConfig extends AdapterConfig<any> = AdapterConfig>(
			type: string
		): BoundAdapterConfig<TConfig>;
		/**
		 * GET the collection endpoint and upsert every record. Called with no
		 * options the type stops re-faulting on a tracked findMany, and — when the
		 * generated REST transport made the request — is also marked exhaustive, so
		 * a findOne miss answers locally. An authored loadMany may have returned one
		 * page, so it never marks exhaustive; an options-bearing call marks neither
		 * (D161/D158).
		 */
		loadMany(type: string, options?: AdapterLoadManyOptions): Promise<any[]>;
		/** GET one record by id and upsert it. Bypasses the negative cache. */
		loadOne(type: string, id: any): Promise<any>;
		/** Apply server-authoritative object(s), preserving record identity. */
		upsert(type: string, objectOrArray: Record<string, any> | Record<string, any>[]): any;
		/** Queue a record save through the per-record adapter write chain. */
		saveRecord(record: PuzzleModel): WritePromise<PuzzleModel>;
		/** Queue a confirmed record delete through the shared write chain. */
		deleteRecord(record: PuzzleModel): WritePromise<PuzzleModel>;
		/**
		 * Mark server data stale so the views reading it refetch (D193). Never
		 * fetches by itself. `invalidate(type)` covers every query, the collection
		 * and every synced record of the type; `invalidate(type, id)` one record;
		 * `invalidate(type, { query })` one query by its exact key.
		 */
		invalidate(type: string, target?: string | number | { query: AdapterLoadManyOptions }): void;
		/** A record's write status (D193); reactive when read inside data(). */
		syncStatus(record: PuzzleModel): SyncStatus;
		/** Custom-endpoint escape hatch. */
		request(type: string, path?: string, options?: RequestOptions): Promise<any>;
	}

	interface PuzzleModel {
		/** POST when new, PUT after synchronization. The promise carries `pending`/`error` (D193). */
		save(): WritePromise<this>;
		/** Confirmed server delete, then local removal. The promise carries `pending`/`error` (D193). */
		delete(): WritePromise<this>;
	}
}
