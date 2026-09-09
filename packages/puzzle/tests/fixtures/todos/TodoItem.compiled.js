
import { PuzzleView } from '@magic-spells/puzzle';

export default class TodoItem extends PuzzleView {
  // `todo` is a prop from the parent; `remove` is a callback prop (SPEC §6)
  // that routes this row's delete click up to the owning view (Home).
  //
  // Returning the record itself is what makes the checkbox writable: the
  // template's `checked={ todo.completed }` resolves to this record, so the
  // synthesized handler has something to call update() on.
  data(params, props) {
    return { todo: props.todo };
  }

  // Only deletion needs a handler. Destroying a record is the parent's call —
  // it owns the collection — so it stays a callback prop: the parent's
  // `@remove={ deleteTodo(todo) }` compiled to `props.remove = (event) =>
  // this.events.deleteTodo(todo)`, and calling this.props.remove(event) runs
  // that handler with the row's todo already closed over.
  events = {
    remove: (event) => {
      this.props.remove(event);
    }
  };

  // Enter/leave animations (constellation/doc/DOC-SPEC.md §12). The root div
  // (overflow-hidden, no padding) is the animation target; the inner h-[65px]
  // content div keeps the row from squishing while the root's height collapses.
  // The root's natural height IS 65px, so the enter `to` equals the element's
  // stylesheet state (the release contract in animate.js).
  animations = {
    in:  { from: { height: '0px', opacity: 0, transform: 'scale(0.9)' }, to: { height: '65px', opacity: 1, transform: 'scale(1)' }, duration: 220, easing: 'ease-out' },
    out: { from: { height: '65px', opacity: 1, transform: 'scale(1)' }, to: { height: '0px', opacity: 0, transform: 'scale(0.9)' }, duration: 180, easing: 'ease-in' }
  };
}

import { ViewNode } from '@magic-spells/puzzle';

TodoItem.prototype.render = function () {
  const __d = this.getData();
  const __f = this.ctx.formatters.getAll();

  return new ViewNode('div', { class: 'overflow-hidden' }, [
    new ViewNode('div', {
      class: 'group h-[65px] flex items-center px-5 border-b border-line hover:bg-surface-2 transition-colors',
    }, [
      new ViewNode('label', { class: 'flex items-center cursor-pointer mr-4' }, [
        new ViewNode('input', {
          type: 'checkbox',
          class: 'sr-only',
          checked: __d.todo.completed,
          // The synthesized write-back for `checked={ todo.completed }`: a
          // distinct listener slot on the modifier channel, and a memoized
          // handler keyed by (target, field, spec) so the identity is stable
          // across renders and the listener never re-attaches.
          '@change:bind': this.__bind(__d.todo, 'completed', 'c'),
        }, []),
        new ViewNode('div', { class: 'relative' }, [
          new ViewNode('div', {
            class: `w-5 h-5 rounded-md border transition-colors ${__d.todo.completed ? 'bg-accent border-accent' : ''}${!__d.todo.completed ? 'border-white/25 group-hover:border-white/40' : ''}`,
          }, []),
          ...(__d.todo.completed
            ? [
                new ViewNode('div', { class: 'absolute inset-0 flex items-center justify-center' }, [
                  new ViewNode('svg', {
                    class: 'w-3 h-3 text-ink',
                    fill: 'currentColor',
                    viewBox: '0 0 20 20',
                  }, [
                    new ViewNode('path', {
                      'fill-rule': 'evenodd',
                      d: 'M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z',
                      'clip-rule': 'evenodd',
                    }, []),
                  ]),
                ]),
              ]
            : []),
        ]),
      ]),
      new ViewNode('span', {
        class: `flex-1 truncate ${__d.todo.completed ? 'text-faint line-through' : ''}${!__d.todo.completed ? 'text-fg' : ''}`,
      }, [
        new ViewNode('text', { value: String(__d.todo.text) }),
      ]),
      new ViewNode('span', { class: 'ml-4 shrink-0 font-mono text-[11px] text-faint tabular-nums' }, [
        new ViewNode('text', { value: String((__f["date"] || __f.__missing("date"))(__d.todo.createdAt, 'short')) }),
      ]),
      new ViewNode('button', {
        class: 'ml-3 w-7 h-7 shrink-0 rounded-md flex items-center justify-center text-xl leading-none text-faint hover:text-danger hover:bg-danger/10 opacity-0 group-hover:opacity-100 transition-all',
        '@click': (event) => this.events.remove(event),
        title: 'Delete todo',
      }, [
        new ViewNode('text', { value: '×' }),
      ]),
    ]),
  ]);
};
