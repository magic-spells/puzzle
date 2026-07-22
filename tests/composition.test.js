// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode, SLOT_TAG } from '../client-runtime/views/ViewNode.js';
import { Store } from '../client-runtime/datastore/store.js';
import { PuzzleModel, Puzzle } from '../client-runtime/model.js';

// Hand-written stand-ins for what the compiler emits (SPEC §4): render()
// returns a ViewNode tree, a component vnode is `new ViewNode(Class, props,
// slotChildren)`, and a `<slot/>` becomes `new ViewNode(SLOT_TAG)`.
const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const comp = (Class, props = {}, children = []) => new ViewNode(Class, props, children);
const slot = () => new ViewNode(SLOT_TAG);

const container = () => {
	const el = document.createElement('div');
	document.body.appendChild(el);
	return el;
};

const ctxWith = (store) => ({ store, router: null, formatters: null });

class Todo extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		text: Puzzle.string().required(),
	};
}

describe('composition — inline rendering (D20)', () => {
	class Label extends PuzzleView {
		data(params, props) {
			return { label: props.label };
		}
		render() {
			return h('span', { class: 'child' }, [text(this.getData().label)]);
		}
	}

	it('renders a child component inline with NO wrapper element', async () => {
		class Host extends PuzzleView {
			render() {
				return h('div', { id: 'host' }, [comp(Label, { label: 'hi' })]);
			}
		}
		const el = container();
		await new Host().mount(el);

		const host = el.querySelector('#host');
		// the child's own root is a direct child of the host — no <puzzle-view>
		// and no other wrapper between them.
		expect(host.children).toHaveLength(1);
		expect(host.firstElementChild.tagName).toBe('SPAN');
		expect(host.innerHTML).toBe('<span class="child">hi</span>');
	});
});

describe('composition — prop reactivity (APP_ANATOMY §4)', () => {
	class Label extends PuzzleView {
		data(params, props) {
			return { label: props.label };
		}
		render() {
			return h('span', { class: 'child' }, [text(this.getData().label)]);
		}
	}

	class Host extends PuzzleView {
		created() {
			this.setData({ label: 'a', tick: 0 });
		}
		data() {
			const d = this.getData();
			return { label: d.label, tick: d.tick };
		}
		render() {
			const d = this.getData();
			return h('div', {}, [text(String(d.tick)), comp(Label, { label: d.label })]);
		}
	}

	it('changed props re-run the child data() and patch the child DOM', async () => {
		const dataSpy = vi.spyOn(Label.prototype, 'data');
		const el = container();
		const host = await new Host().mount(el);
		expect(el.querySelector('.child').textContent).toBe('a');
		expect(dataSpy).toHaveBeenCalledTimes(1);

		host.setData('label', 'b');
		host.flushUpdates();
		expect(el.querySelector('.child').textContent).toBe('b');
		expect(dataSpy).toHaveBeenCalledTimes(2);
		dataSpy.mockRestore();
	});

	it('unchanged props do NOT re-run the child data() on a parent re-render', async () => {
		const dataSpy = vi.spyOn(Label.prototype, 'data');
		const el = container();
		const host = await new Host().mount(el);
		expect(dataSpy).toHaveBeenCalledTimes(1);

		// parent re-renders (tick changes) but the child's label prop is stable
		host.setData('tick', 1);
		host.flushUpdates();
		expect(el.firstChild.firstChild.textContent).toBe('1'); // parent did re-render
		expect(dataSpy).toHaveBeenCalledTimes(1); // child untouched
		dataSpy.mockRestore();
	});
});

describe('composition — child removal tears down (APP_ANATOMY §4)', () => {
	let child;
	const destroyed = vi.fn();

	class Sub extends PuzzleView {
		created() {
			child = this;
		}
		data() {
			const todos = this.ctx.store.findMany('todo'); // auto-subscribes
			return { count: todos.length };
		}
		render() {
			return h('span', { class: 'sub' }, [text(String(this.getData().count))]);
		}
		destroyed() {
			destroyed();
		}
	}

	class Host extends PuzzleView {
		created() {
			this.setData({ show: true });
		}
		data() {
			return { show: this.getData().show };
		}
		render() {
			return h('div', {}, this.getData().show ? [comp(Sub)] : []);
		}
	}

	it('removing the vnode destroys the child and drops its store subscription', async () => {
		const store = new Store({ todo: Todo });
		const el = container();
		const host = await new Host(ctxWith(store)).mount(el);
		expect(el.querySelector('.sub')).not.toBeNull();

		const renderSpy = vi.spyOn(child, 'render');
		host.setData('show', false);
		host.flushUpdates();

		expect(el.querySelector('.sub')).toBeNull();
		expect(destroyed).toHaveBeenCalledTimes(1);

		// subscription is gone: a matching store change must not re-render it
		store.createRecord('todo', { id: 't1', text: 'x' });
		store.flush();
		expect(renderSpy).not.toHaveBeenCalled();
	});

	it('removing an ELEMENT subtree destroys components nested inside it', async () => {
		const nestedDestroyed = vi.fn();
		class Leaf extends PuzzleView {
			data() {
				this.ctx.store.findMany('todo'); // auto-subscribes
				return {};
			}
			render() {
				return h('span', { class: 'leaf' }, [text('leaf')]);
			}
			destroyed() {
				nestedDestroyed();
			}
		}
		class Wrap extends PuzzleView {
			created() {
				this.setData({ show: true });
			}
			data() {
				return { show: this.getData().show };
			}
			render() {
				// the component sits INSIDE an element vnode that gets removed
				return h('div', {}, this.getData().show ? [h('section', {}, [comp(Leaf)])] : []);
			}
		}

		const store = new Store({ todo: Todo });
		const el = container();
		const host = await new Wrap(ctxWith(store)).mount(el);
		expect(el.querySelector('.leaf')).not.toBeNull();
		expect(store.keysBySubscriber.size).toBeGreaterThan(0);

		host.setData('show', false);
		host.flushUpdates();

		expect(el.querySelector('.leaf')).toBeNull();
		expect(nestedDestroyed).toHaveBeenCalledTimes(1);
	});
});

describe('composition — keyed component list (APP_ANATOMY §4)', () => {
	const instances = {};

	class Item extends PuzzleView {
		created() {
			instances[this.props.id] = this;
		}
		data(params, props) {
			return { id: props.id };
		}
		render() {
			return h('li', { 'data-id': this.getData().id }, [text(this.getData().id)]);
		}
	}

	class Host extends PuzzleView {
		created() {
			this.setData({ order: ['a', 'b', 'c'] });
		}
		data() {
			return { order: this.getData().order };
		}
		render() {
			return h('ul', {}, this.getData().order.map((id) => comp(Item, { key: id, id })));
		}
	}

	it('reorder preserves child instances and MOVES their DOM nodes', async () => {
		const el = container();
		const host = await new Host().mount(el);

		const before = [...el.querySelectorAll('li')];
		expect(before.map((n) => n.textContent)).toEqual(['a', 'b', 'c']);
		const [instA, instB, instC] = ['a', 'b', 'c'].map((k) => instances[k]);
		const [elA, elB, elC] = before;

		host.setData('order', ['c', 'a', 'b']);
		host.flushUpdates();

		const after = [...el.querySelectorAll('li')];
		expect(after.map((n) => n.textContent)).toEqual(['c', 'a', 'b']);
		// same instances (never re-created)
		expect(instances.a).toBe(instA);
		expect(instances.b).toBe(instB);
		expect(instances.c).toBe(instC);
		// same DOM nodes, moved not rebuilt
		expect(after[0]).toBe(elC);
		expect(after[1]).toBe(elA);
		expect(after[2]).toBe(elB);
	});
});

describe('composition — slots (D16)', () => {
	let clicked = false;

	class Card extends PuzzleView {
		render() {
			return h('div', { class: 'card' }, [slot()]);
		}
	}

	class Host extends PuzzleView {
		events = {
			clicked: () => {
				clicked = true;
			},
		};
		render() {
			return h('div', {}, [
				comp(Card, {}, [
					h('button', { class: 'slotbtn', '@click': (event) => this.events.clicked(event) }, [
						text('hit'),
					]),
				]),
			]);
		}
	}

	it('slot content renders inside the child and its handlers hit the PARENT', async () => {
		const el = container();
		await new Host().mount(el);

		const btn = el.querySelector('.card .slotbtn'); // rendered at the child's <children/>
		expect(btn).not.toBeNull();
		expect(btn.textContent).toBe('hit');

		btn.click();
		expect(clicked).toBe(true); // the parent-scope handler ran
	});
});

describe('composition — pre-first-commit slot-update guard (APP_ANATOMY §4, DOC-VIEW-LIFECYCLE §3)', () => {
	// A non-skeleton async child holds ONLY its anchor placeholder while data() is
	// in flight — #vm exists, but #mounted/#loaded are still false. If the parent
	// re-renders in that window with fresh SLOT content but unchanged props, it
	// reaches applyParentUpdate's slot-only branch. That branch must NOT run the
	// real template yet: render() here reads the loaded data and would throw
	// mid-patch (or paint blank). The #mounted gate defers it; the fresh
	// slotChildren are stored anyway, so the pending FIRST commit renders them in.
	const deferred = () => {
		let resolve, reject;
		const promise = new Promise((res, rej) => {
			resolve = res;
			reject = rej;
		});
		return { promise, resolve, reject };
	};

	it('a slot update while an async child loads never renders it early, then lands with the fresh slot', async () => {
		const gate = deferred();
		let childInstance;

		class Child extends PuzzleView {
			created() {
				childInstance = this;
			}
			async data() {
				const user = await gate.promise;
				return { user };
			}
			render() {
				// reads loaded data — a premature (pre-commit) render throws here
				return h('div', { class: 'child' }, [h('em', {}, [text(this.getData().user.name)]), slot()]);
			}
		}

		class Host extends PuzzleView {
			created() {
				this.setData({ tick: 0, slotText: 'first' });
			}
			data() {
				const d = this.getData();
				return { tick: d.tick, slotText: d.slotText };
			}
			render() {
				const d = this.getData();
				return h('div', {}, [
					h('span', { class: 'tick' }, [text(String(d.tick))]),
					comp(Child, {}, [h('span', { class: 'slotc' }, [text(d.slotText)])]),
				]);
			}
		}

		// a swallowed mid-patch throw would surface here (flushUpdates logs, not rethrows)
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const el = container();
		const host = await new Host().mount(el); // Child is async — mid-load after this

		// child holds only its anchor comment: no real render, no throw
		expect(el.querySelector('.child')).toBeNull();
		const renderSpy = vi.spyOn(childInstance, 'render');

		// parent re-renders with NEW slot content while the child's data() is pending;
		// props stay shallow-equal ({}), so this is exactly the slot-only branch
		host.setData({ tick: 1, slotText: 'second' });
		host.flushUpdates();

		expect(el.querySelector('.tick').textContent).toBe('1'); // parent DID re-render
		expect(renderSpy).not.toHaveBeenCalled(); // child NEVER rendered pre-commit
		expect(el.querySelector('.child')).toBeNull(); // still just the anchor
		expect(errSpy).not.toHaveBeenCalled(); // nothing threw mid-patch

		// data() resolves — the first commit renders the real template WITH the
		// already-updated slot content ('second', not 'first')
		gate.resolve({ name: 'Ada' });
		await gate.promise;
		await Promise.resolve(); // let refresh()'s .then(commit) run

		expect(renderSpy).toHaveBeenCalledTimes(1);
		expect(el.querySelector('.child em').textContent).toBe('Ada');
		expect(el.querySelector('.child .slotc').textContent).toBe('second');
		expect(errSpy).not.toHaveBeenCalled();
		errSpy.mockRestore();
	});
});

describe('composition — replacing a settled async-data component (stale anchor, FIX 9)', () => {
	const deferred = () => {
		let resolve, reject;
		const promise = new Promise((res, rej) => {
			resolve = res;
			reject = rej;
		});
		return { promise, resolve, reject };
	};

	it('swapping a committed async component for a different tag inserts against the LIVE root, not the detached anchor', async () => {
		const gate = deferred();

		class Alpha extends PuzzleView {
			async data() {
				return { name: await gate.promise };
			}
			render() {
				return h('div', { class: 'alpha' }, [text(this.getData().name)]);
			}
		}
		class Beta extends PuzzleView {
			render() {
				return h('section', { class: 'beta' }, [text('beta')]);
			}
		}
		class Host extends PuzzleView {
			created() {
				this.setData({ which: 'alpha' });
			}
			data() {
				return { which: this.getData().which };
			}
			render() {
				return h('div', {}, [this.getData().which === 'alpha' ? comp(Alpha) : comp(Beta)]);
			}
		}

		// A mid-patch throw (insertBefore on the detached anchor) would be logged here.
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const el = container();
		const host = await new Host().mount(el);

		// Alpha is mid-load: only its anchor comment occupies the slot.
		expect(el.querySelector('.alpha')).toBeNull();

		// Alpha's async data() settles → its real root replaces the anchor in the DOM.
		gate.resolve('Ada');
		await gate.promise;
		await new Promise((r) => setTimeout(r, 0));
		expect(el.querySelector('.alpha')).not.toBeNull();

		// Swap Alpha (component vnode) → Beta (different tag): a REPLACE whose insertion
		// reference must resolve from Alpha's LIVE root, not the now-detached comment
		// anchor that mountComponent cached. Pre-fix this threw NotFoundError and emptied
		// the container.
		host.setData({ which: 'beta' });
		host.flushUpdates();

		expect(errSpy).not.toHaveBeenCalled();
		expect(el.querySelector('.beta')).not.toBeNull();
		expect(el.querySelector('.alpha')).toBeNull();
		expect(el.textContent).toContain('beta');
		errSpy.mockRestore();
	});
});

describe('composition — callback props (D16)', () => {
	let saved = null;

	class SaveButton extends PuzzleView {
		events = {
			onClick: () => {
				this.props.save('payload'); // child invokes the callback prop
			},
		};
		render() {
			return h('button', { class: 'save', '@click': (event) => this.events.onClick(event) }, [
				text('Save'),
			]);
		}
	}

	class Host extends PuzzleView {
		events = {
			doSave: (payload) => {
				saved = payload;
			},
		};
		render() {
			return h('div', {}, [comp(SaveButton, { save: (p) => this.events.doSave(p) })]);
		}
	}

	it('a function prop invoked by the child runs the parent handler', async () => {
		const el = container();
		await new Host().mount(el);

		el.querySelector('.save').click();
		expect(saved).toBe('payload');
	});
});
