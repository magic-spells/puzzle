// @vitest-environment jsdom
//
// End-to-end compiler/runtime proof for D166. Both modules are generated from
// the neighboring .pzl sources by the build:snippets pretest script.
import { afterEach, describe, expect, it } from 'vitest';
import SnippetsHost from './fixtures/snippets/SnippetsHost.compiled.js';

let mounted = null;

afterEach(() => {
	mounted?.destroy();
	mounted = null;
	document.body.replaceChildren();
});

describe('snippets — real compiler output (D166)', () => {
	it('routes named/default snippets, binds args, and re-stamps from either owner', async () => {
		const el = document.createElement('div');
		document.body.appendChild(el);
		mounted = new SnippetsHost();
		await mounted.mount(el);

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
	});
});
