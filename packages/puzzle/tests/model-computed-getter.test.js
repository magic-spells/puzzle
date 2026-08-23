import { afterEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../client-runtime/datastore/store.js';
import { adapter } from '../client-runtime/datastore/adapter.js';
import { Puzzle, PuzzleModel } from '../client-runtime/model.js';

adapter.install();

// Computed properties are ordinary JavaScript getters (SPEC §7). Keep the
// getter on an intermediate prototype so every case exercises the full property
// lookup Puzzle must mirror before assigning an incoming own key.
class ComputedBase extends PuzzleModel {
	get computed() {
		return `${this.a}:${this.b}`;
	}
}

const computedModel = () =>
	class ComputedRecord extends ComputedBase {
		static schema = {
			id: Puzzle.string().primary(),
			a: Puzzle.string(),
			b: Puzzle.string(),
		};
		static adapter = { endpoint: '/records' };
	};

// readBody() consumes text(), so this deliberately mirrors the Store's network
// boundary instead of stubbing a private reconciliation method.
const response = (body = '') => ({
	ok: true,
	status: 200,
	statusText: 'OK',
	text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('PuzzleModel computed-getter payload collisions', () => {
	it('update() ignores the getter key without partially applying the patch and warns once', () => {
		const Model = computedModel();
		const record = new Model({ id: 'r1', a: 'a0', b: 'b0' });
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		expect(() => record.update({ a: 'a1', computed: 5, b: 'b1' })).not.toThrow();
		expect(record).toMatchObject({ a: 'a1', b: 'b1' });
		expect(record.computed).toBe('a1:b1');

		// The collision remains ignored, but one model/key pair should not flood a
		// hot update path with the same diagnostic, even across record instances.
		record.update({ computed: 6 });
		new Model({ id: 'r2', a: 'a2', b: 'b2' }).update({ computed: 7 });
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0][0]).toMatch(
			/"computed" collides with a computed getter on model "ComputedRecord".*incoming value was ignored/
		);
	});

	it('a save response echoing the getter fully merges, marks synced, and makes the next save a PUT', async () => {
		const Model = computedModel();
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(
				response({ id: 'r1', a: 'server-a', computed: 5, b: 'server-b' })
			)
			.mockResolvedValueOnce(response());
		vi.stubGlobal('fetch', fetch);
		vi.spyOn(console, 'warn').mockImplementation(() => {});

		const store = new Store({ record: Model }, { apiURL: 'https://example.test' });
		const record = store.createRecord('record', { id: 'r1', a: 'local-a', b: 'local-b' });

		await expect(record.save()).resolves.toBe(record);
		expect(record).toMatchObject({ a: 'server-a', b: 'server-b' });
		expect(record.computed).toBe('server-a:server-b');
		expect(record._synced).toBe(true);

		await expect(record.save()).resolves.toBe(record);
		expect(fetch.mock.calls.map(([, init]) => init.method)).toEqual(['POST', 'PUT']);
		expect(fetch.mock.calls[1][0]).toBe('https://example.test/records/r1');
	});

	it('loadMany constructs a complete synced record when the payload includes the getter key', async () => {
		const Model = computedModel();
		const fetch = vi.fn(async () =>
			response([{ id: 'r1', a: 'server-a', computed: 5, b: 'server-b' }])
		);
		vi.stubGlobal('fetch', fetch);
		vi.spyOn(console, 'warn').mockImplementation(() => {});

		const store = new Store({ record: Model }, { apiURL: 'https://example.test' });
		await expect(store.loadMany('record')).resolves.toHaveLength(1);

		const record = store.findOne('record', 'r1');
		expect(record).toBeInstanceOf(Model);
		expect(record).toMatchObject({ a: 'server-a', b: 'server-b' });
		expect(record.computed).toBe('server-a:server-b');
		expect(record._synced).toBe(true);
	});
});
