// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, settled } from '../client-runtime/testing/index.js';
import TodoHome from './fixtures/todos/Home.compiled.js';
import DefaultLayout from './fixtures/todos/Default.compiled.js';
import Todo from './fixtures/todos/todo.model.js';

// Dogfood D94 against the canonical app-author behavior lane that previously
// needed tests/helpers/todos-suite.js's private boot()/settle()/DOM helpers.
let app = null;

beforeEach(async () => {
	vi.spyOn(console, 'log').mockImplementation(() => {});
	app = await createTestApp({
		routes: [
			{
				path: '/',
				name: 'home',
				view: TodoHome,
				layout: DefaultLayout,
				meta: { title: 'Puzzle Todos' },
			},
		],
		models: { todo: Todo },
	});
});

afterEach(() => {
	app?.destroy();
	app = null;
	vi.restoreAllMocks();
});

const rows = () => app.findAll('.max-h-96 > div');
const rowText = (row) => row.querySelector('span.flex-1').textContent.trim();
const texts = () => rows().map(rowText);
const rowByText = (value) => rows().find((row) => rowText(row) === value);
const input = () => app.find('input[type="text"]');

function stats() {
	const values = app.findAll('.text-2xl').map((node) => Number(node.textContent.trim()));
	return { active: values[0], completed: values[1], total: values[2] };
}

function button(label) {
	return app.findAll('button').find((node) => node.textContent.trim() === label);
}

async function addTodo(value) {
	const field = input();
	field.value = value;
	field.dispatchEvent(new Event('input', { bubbles: true }));
	await settled();
	await app.click('button[type="submit"]');
}

describe('@magic-spells/puzzle/testing — todos dogfood', () => {
	it('adds a todo, clears the controlled input, and updates stats', async () => {
		await addTodo('buy milk');

		expect(texts()).toEqual(['buy milk']);
		expect(input().value).toBe('');
		expect(stats()).toEqual({ active: 1, completed: 0, total: 1 });
	});

	it('clicks a checkbox through native activation and settles the store refresh', async () => {
		await addTodo('write tests');
		await app.click(rowByText('write tests').querySelector('input[type="checkbox"]'));

		const row = rowByText('write tests');
		expect(row.querySelector('span.flex-1').className).toContain('line-through');
		expect(row.querySelector('input[type="checkbox"]').checked).toBe(true);
		expect(stats()).toEqual({ active: 0, completed: 1, total: 1 });
	});

	it('switches Active / Completed / All filters without a private settle loop', async () => {
		await addTodo('A');
		await addTodo('B');
		await app.click(rowByText('B').querySelector('input[type="checkbox"]'));

		await app.click(button('Active'));
		expect(texts()).toEqual(['A']);

		await app.click(button('Completed'));
		expect(texts()).toEqual(['B']);

		await app.click(button('All'));
		expect(texts().sort()).toEqual(['A', 'B']);
	});

	it('preserves the surviving keyed row across a filter change', async () => {
		await addTodo('keep-me');
		await addTodo('complete-me');
		await app.click(rowByText('complete-me').querySelector('input[type="checkbox"]'));
		const keepNode = rowByText('keep-me');

		await app.click(button('Active'));

		expect(texts()).toEqual(['keep-me']);
		expect(rowByText('keep-me')).toBe(keepNode);
	});
});

