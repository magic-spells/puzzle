/** Public declarations for the opt-in @magic-spells/puzzle/adapter subpath. */

import type { PuzzleAdapterCapability, PuzzleModel, RequestOptions } from './index.js';

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
