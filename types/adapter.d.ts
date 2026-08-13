/** Public declarations for the opt-in @magic-spells/puzzle/adapter subpath. */

import type { ModelAdapter, PuzzleModel, RequestOptions } from './index.js';

/**
 * Install the adapter runtime on Store/PuzzleModel and return the exact config
 * object for `static adapter = adapter({ endpoint })`.
 */
export declare function adapter<T extends ModelAdapter>(config: T): T;

/** Thrown when an adapter write/request responds non-OK. */
export declare class PuzzleAdapterError extends Error {
	constructor(status: number, statusText?: string, body?: any);
	status: number;
	statusText?: string;
	body?: any;
}

declare module './index.js' {
	interface Store {
		/** GET the collection endpoint and upsert every record. */
		loadAll(type: string): Promise<any[]>;
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
