
import { PuzzleView } from '@magic-spells/puzzle';
import TodoItem from './TodoItem.compiled.js';

export default class TodoHome extends PuzzleView {
  // Subtle view fade-in on load (constellation/doc/DOC-SPEC.md §12). No `out`
  // for now — snappy back-navigation.
  animations = {
    in: { from: { opacity: 0 }, to: { opacity: 1 }, duration: 200 }
  };

  // runs one time when object is created, before data() runs
  created() {
    this.setData({
      newTodoText: '',
      currentFilter: 'all'
    });
  }

  // data() defines component model - runs on mount and when subscribed store data changes
  data(params, props) {
    const store = this.ctx.store;
    const localData = this.getData();

    const todos = store.findMany('todo');
    const activeTodos = todos.filter(todo => !todo.completed);
    const completedTodos = todos.filter(todo => todo.completed);

    let filteredTodos = todos;
    if (localData.currentFilter === 'active') {
      filteredTodos = activeTodos;
    } else if (localData.currentFilter === 'completed') {
      filteredTodos = completedTodos;
    }

    return {
      todos,
      activeTodos,
      completedTodos,
      filteredTodos,
      newTodoText: localData.newTodoText,
      currentFilter: localData.currentFilter,
      hasData: todos.length > 0
    };
  }

  // Event handlers — class field of arrow functions so `this` is always
  // the component instance (see constellation/doc/DOC-SPEC.md §4–5)
  events = {
    updateNewTodoText: (event) => {
      this.setData('newTodoText', event.target.value);
    },

    addTodo: (event) => {
      event.preventDefault();
      const text = this.getData().newTodoText.trim();

      if (text) {
        const store = this.ctx.store;
        store.createRecord('todo', { text });
        this.setData('newTodoText', '');
      }
    },

    toggleTodo: (todo) => {
      todo.toggle();
    },

    deleteTodo: (todo) => {
      todo.destroy();
    },

    setFilter: (filter) => {
      this.setData('currentFilter', filter);
      // filteredTodos is derived in data(); setData() alone does not re-run
      // data() (SPEC §4), so refresh() re-runs it to recompute the filtered
      // list from the just-updated currentFilter.
      this.refresh();
    },

    clearCompleted: () => {
      if (confirm('Clear all completed todos?')) {
        const store = this.ctx.store;
        const completed = store.findMany('todo').filter(t => t.completed);
        completed.forEach(todo => todo.destroy());
      }
    },

    markAllComplete: () => {
      const store = this.ctx.store;
      const active = store.findMany('todo').filter(t => !t.completed);
      active.forEach(todo => todo.markComplete());
    }
  };

  // Component lifecycle
  mounted() {
    console.log('Todo app mounted!');

    // Focus the input when component mounts
    const input = this.element.querySelector('input[type="text"]');
    if (input) {
      input.focus();
    }
  }

  beforeUpdate() {
    // Could add optimizations here
  }

  afterUpdate() {
    // Update document title with todo count
    const data = this.getData();
    const activeCount = data.activeTodos ? data.activeTodos.length : 0;
    document.title = activeCount > 0
      ? `(${activeCount}) Puzzle Todos`
      : 'Puzzle Todos';
  }
}

import { ViewNode } from '@magic-spells/puzzle';

TodoHome.prototype.render = function () {
  const __d = this.getData();
  const __f = this.ctx.formatters.getAll();

  return new ViewNode('puzzle-view', { class: 'w-full max-w-xl mx-auto' }, [
    new ViewNode('div', {
      class: 'bg-surface border border-hairline rounded-2xl overflow-hidden shadow-2xl shadow-black/50',
    }, [
      new ViewNode('div', { class: 'p-5 border-b border-line' }, [
        new ViewNode('form', {
          class: 'flex items-center gap-2.5',
          '@submit': ((this.__h ??= {})[0] ??= (event) => this.events.addTodo(event)),
        }, [
          new ViewNode('input', {
            type: 'text',
            class: 'flex-1 h-12 px-4 rounded-xl bg-ink border border-hairline text-fg placeholder-faint focus:outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20 transition-colors',
            placeholder: 'What needs doing?',
            value: __d.newTodoText,
            '@input': ((this.__h ??= {})[1] ??= (event) => this.events.updateNewTodoText(event)),
            autofocus: true,
          }, []),
          new ViewNode('button', {
            type: 'submit',
            class: 'h-12 px-5 rounded-xl bg-accent text-ink font-semibold tracking-tight hover:bg-accent-2 disabled:bg-elevated disabled:text-faint disabled:cursor-not-allowed transition-colors',
            disabled: !__d.newTodoText.trim(),
          }, [
            new ViewNode('text', { value: 'Add' }),
          ]),
        ]),
      ]),
      ...(__d.todos.length > 0
        ? [
            new ViewNode('div', { class: 'grid grid-cols-3 divide-x divide-line border-b border-line' }, [
              new ViewNode('div', { class: 'py-5 text-center' }, [
                new ViewNode('div', { class: 'font-mono text-2xl tabular-nums text-fg' }, [
                  new ViewNode('text', { value: String(__d.activeTodos.length) }),
                ]),
                new ViewNode('div', { class: 'mt-1 text-[10px] uppercase tracking-[0.22em] text-faint' }, [
                  new ViewNode('text', { value: 'active' }),
                ]),
              ]),
              new ViewNode('div', { class: 'py-5 text-center' }, [
                new ViewNode('div', { class: 'font-mono text-2xl tabular-nums text-fg' }, [
                  new ViewNode('text', { value: String(__d.completedTodos.length) }),
                ]),
                new ViewNode('div', { class: 'mt-1 text-[10px] uppercase tracking-[0.22em] text-faint' }, [
                  new ViewNode('text', { value: 'done' }),
                ]),
              ]),
              new ViewNode('div', { class: 'py-5 text-center' }, [
                new ViewNode('div', { class: 'font-mono text-2xl tabular-nums text-fg' }, [
                  new ViewNode('text', { value: String(__d.todos.length) }),
                ]),
                new ViewNode('div', { class: 'mt-1 text-[10px] uppercase tracking-[0.22em] text-faint' }, [
                  new ViewNode('text', { value: 'total' }),
                ]),
              ]),
            ]),
            new ViewNode('div', { class: 'flex border-b border-line px-2' }, [
              new ViewNode('button', {
                class: `relative flex-1 py-3.5 text-sm font-medium transition-colors ${__d.currentFilter === 'all' ? 'text-accent' : ''}${__d.currentFilter !== 'all' ? 'text-muted hover:text-fg' : ''}`,
                '@click': ((this.__h ??= {})[2] ??= (event) => this.events.setFilter('all')),
              }, [
                new ViewNode('text', { value: 'All' }),
                ...(__d.currentFilter === 'all'
                  ? [
                      new ViewNode('span', { class: 'absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-accent' }, []),
                    ]
                  : [
                      new ViewNode('#'),
                    ]),
              ]),
              new ViewNode('button', {
                class: `relative flex-1 py-3.5 text-sm font-medium transition-colors ${__d.currentFilter === 'active' ? 'text-accent' : ''}${__d.currentFilter !== 'active' ? 'text-muted hover:text-fg' : ''}`,
                '@click': ((this.__h ??= {})[3] ??= (event) => this.events.setFilter('active')),
              }, [
                new ViewNode('text', { value: 'Active' }),
                ...(__d.currentFilter === 'active'
                  ? [
                      new ViewNode('span', { class: 'absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-accent' }, []),
                    ]
                  : [
                      new ViewNode('#'),
                    ]),
              ]),
              new ViewNode('button', {
                class: `relative flex-1 py-3.5 text-sm font-medium transition-colors ${__d.currentFilter === 'completed' ? 'text-accent' : ''}${__d.currentFilter !== 'completed' ? 'text-muted hover:text-fg' : ''}`,
                '@click': ((this.__h ??= {})[4] ??= (event) => this.events.setFilter('completed')),
              }, [
                new ViewNode('text', { value: 'Completed' }),
                ...(__d.currentFilter === 'completed'
                  ? [
                      new ViewNode('span', { class: 'absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-accent' }, []),
                    ]
                  : [
                      new ViewNode('#'),
                    ]),
              ]),
            ]),
            new ViewNode('div', { class: 'max-h-96 overflow-y-auto' },
              __d.filteredTodos.map((todo) =>
                new ViewNode(TodoItem, {
                  key: ViewNode.keyOf(todo),
                  todo: todo,
                  toggle: (event) => this.events.toggleTodo(todo),
                  remove: (event) => this.events.deleteTodo(todo),
                }, [])
              )
            ),
            new ViewNode('div', { class: 'p-5 flex flex-col sm:flex-row gap-2.5 justify-center' }, [
              ...(__d.completedTodos.length > 0
                ? [
                    new ViewNode('button', {
                      class: 'px-4 py-2.5 rounded-xl border border-hairline text-muted hover:text-fg hover:border-white/20 text-sm font-medium transition-colors',
                      '@click': ((this.__h ??= {})[5] ??= (event) => this.events.clearCompleted(event)),
                    }, [
                      new ViewNode('text', { value: 'Clear completed (' + String(__d.completedTodos.length) + ')' }),
                    ]),
                  ]
                : [
                    new ViewNode('#'),
                  ]),
              ...(__d.activeTodos.length > 0
                ? [
                    new ViewNode('button', {
                      class: 'px-4 py-2.5 rounded-xl border border-accent/40 text-accent hover:bg-accent/10 text-sm font-medium transition-colors',
                      '@click': ((this.__h ??= {})[6] ??= (event) => this.events.markAllComplete(event)),
                    }, [
                      new ViewNode('text', { value: 'Complete all' }),
                    ]),
                  ]
                : [
                    new ViewNode('#'),
                  ]),
            ]),
          ]
        : [
            new ViewNode('div', { class: 'py-16 px-8 text-center' }, [
              new ViewNode('div', { class: 'text-4xl mb-4 opacity-40 grayscale' }, [
                new ViewNode('text', { value: '📝' }),
              ]),
              new ViewNode('h3', { class: 'font-display text-2xl text-fg mb-1' }, [
                new ViewNode('text', { value: 'Nothing here yet' }),
              ]),
              new ViewNode('p', { class: 'text-sm text-muted' }, [
                new ViewNode('text', { value: 'Add your first todo above to get started.' }),
              ]),
            ]),
            new ViewNode('#'),
            new ViewNode('#'),
            new ViewNode('#'),
          ]),
    ]),
  ]);
};
