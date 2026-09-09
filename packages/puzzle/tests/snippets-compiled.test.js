// @vitest-environment jsdom
//
// End-to-end compiler/runtime proof for D166. The imported fixture graph is
// generated from the neighboring .pzl sources by the build:snippets pretest script.
import { afterEach, describe, expect, it, vi } from 'vitest';
import SnippetChainHost from './fixtures/snippets/SnippetChainHost.compiled.js';
import SnippetsHost from './fixtures/snippets/SnippetsHost.compiled.js';

let mounted = null;

afterEach(() => {
	mounted?.destroy();
	mounted = null;
	document.body.replaceChildren();
	vi.restoreAllMocks();
});

describe('snippets — real compiler output (D166)', () => {
	it('forwards through the compiled wrapper, binds args, and re-stamps from either owner', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const el = document.createElement('div');
		document.body.appendChild(el);
		mounted = new SnippetsHost();
		await mounted.mount(el);

		expect(el.querySelector('.snippet-wrapper')).not.toBeNull();
		expect(el.querySelector('.snippet-heading').textContent.trim()).toBe('Core / v1');
		expect([...el.querySelectorAll('.person')].map((node) => node.textContent.trim())).toEqual([
			'Core:Ada:v1',
			'Core:Grace:v1',
		]);
		expect(el.querySelector('.snippet-default').textContent.trim()).toBe('default:Core:v1');
		expect(el.querySelector('slot')).toBeNull();
		expect(el.querySelector('#snippet')).toBeNull();

		const rows = [...el.querySelectorAll('li')];
		el.querySelectorAll('.person')[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
		mounted.flushUpdates();

		expect([...el.querySelectorAll('.person')].map((node) => node.textContent.trim())).toEqual([
			'Core:Ada:v2',
			'Core:Grace?:v2',
		]);
		expect([...el.querySelectorAll('li')]).toEqual(rows);

		el.querySelector('.component-update').dispatchEvent(new MouseEvent('click', { bubbles: true }));
		await new Promise((resolve) => requestAnimationFrame(resolve));

		expect([...el.querySelectorAll('.person')].map((node) => node.textContent.trim())).toEqual([
			'Core:Ada!:v2',
			'Core:Grace?:v2',
		]);
		expect([...el.querySelectorAll('li')]).toEqual(rows);
		expect(warn).not.toHaveBeenCalled();
	});

	it('forwards through a two-wrapper compiled chain into SnippetList', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const el = document.createElement('div');
		document.body.appendChild(el);
		mounted = new SnippetChainHost();
		await mounted.mount(el);

		expect(el.querySelector('.snippet-wrapper-chain .snippet-wrapper .snippet-list')).not.toBeNull();
		expect(el.querySelector('.snippet-heading').textContent.trim()).toBe('chain-heading:Core');
		expect([...el.querySelectorAll('.chain-person')].map((node) => node.textContent.trim())).toEqual([
			'chain-row:Core:Ada',
			'chain-row:Core:Grace',
		]);
		expect(el.querySelector('.chain-default').textContent.trim()).toBe('chain-default:Core');
		expect(el.querySelector('slot')).toBeNull();
		expect(el.querySelector('#snippet')).toBeNull();
		expect(warn).not.toHaveBeenCalled();
	});
});
