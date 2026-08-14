/** Public declarations for the opt-in @magic-spells/puzzle/adapter subpath. */

import type { PuzzleAdapterCapability, PuzzleModel, RequestOptions } from './index.js';

export type AdapterMaybePromise<T> = T | Promise<T>;

/** The fetch-compatible function Puzzle binds to every adapter function. */
export type AdapterFetch = typeof globalThis.fetch;

/** Values serialized by the endpoint-generated loadAll transport. */
export type AdapterLoadAllOptions = Record<
	string,
	string | number | boolean | null | undefined
>;

/** A server-returned record shape. The framework validates primary keys at runtime. */
export type AdapterRecord = Record<string, any>;

/**
 * Per-model transport functions. `endpoint` is optional REST shorthand; any
 * authored verb wins over its generated default. Custom function keys are
 * supported and become callable through `store.adapter(type)`.
 */
export interface AdapterConfig<TRecord extends PuzzleModel = PuzzleModel> {
	endpoint?: string;
	loadAll?(
		fetch: AdapterFetch,
		options?: AdapterLoadAllOptions
	): AdapterMaybePromise<Response | AdapterRecord[]>;
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
	loadAll(
		options?: AdapterLoadAllOptions
	): AdapterMaybePromise<Response | AdapterRecord[]>;
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

/** Opaque app-config capability for Puzzle's REST adapter runtime. */
export interface AdapterCapability extends PuzzleAdapterCapability {}

/** Pass once as `new PuzzleApp({ ..., adapter })`. */
export declare const adapter: AdapterCapability;

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
		/** GET the collection endpoint and upsert every record. */
		loadAll(type: string, options?: AdapterLoadAllOptions): Promise<any[]>;
		/** GET one record by id and upsert it. */
		loadOne(type: string, id: any): Promise<any>;
		/** Apply server-authoritative object(s), preserving record identity. */
		upsert(type: string, objectOrArray: Record<string, any> | Record<string, any>[]): any;
		/** Queue a record save through the per-record adapter write chain. */
		saveRecord(record: PuzzleModel): Promise<PuzzleModel>;
		/** Queue a confirmed record delete through the shared write chain. */
		deleteRecord(record: PuzzleModel): Promise<PuzzleModel>;
		/** Custom-endpoint escape hatch. */
		request(type: string, path?: string, options?: RequestOptions): Promise<any>;
	}

	interface PuzzleModel {
		/** POST when new, PUT after synchronization. */
		save(): Promise<this>;
		/** Confirmed server delete, then local removal. */
		delete(): Promise<this>;
	}
}
