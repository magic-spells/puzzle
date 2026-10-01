
import { PuzzleView } from '@magic-spells/puzzle';

export default class ExprHandlers extends PuzzleView {
  data() {
    return { draft: '', tags: [], form: {}, open: false, user: {}, locked: false, when: null, items: [] };
  }
}

import { ViewNode, displayValue as __s, listRows as __l } from '@magic-spells/puzzle';

const __L0 = { key: (item) => ViewNode.keyOf(item), fields: ['done', 'name'] };

ExprHandlers.prototype.render = function () {
  const __d = this.getData();
  const __f = this.ctx.formatters.getAll();

  return new ViewNode('puzzle-view', { class: 'handlers' }, [
    new ViewNode('button', { '@click': ((this.__h ??= {})[0] ??= (event) => this.events.clear(event)) }, [
      new ViewNode('text', { value: 'Clear' }),
    ]),
    new ViewNode('button', { '@click': (event) => this.events.save(__d.draft?.trim(), __d.tags?.length) }, [
      new ViewNode('text', { value: 'Save' }),
    ]),
    new ViewNode('input', {
      '@input': ((this.__h ??= {})[1] ??= (event) => this.events.rename(event.target.value.trim())),
    }, []),
    new ViewNode('form', {
      '@submit:prevent': (event) => this.events.submit(event, { id: __d.form?.id, tags: __d.tags?.toSorted() }),
    }, []),
    new ViewNode('button', { '@click': (__d.open) ? (event) => this.events.close(event) : null }, [
      new ViewNode('text', { value: 'Toggle' }),
    ]),
    new ViewNode('button', {
      '@click': (__d.user?.admin && !__d.locked) ? (event) => this.events.promote(__d.user?.id) : null,
    }, [
      new ViewNode('text', { value: 'Promote' }),
    ]),
    new ViewNode('button', { '@click': (event) => this.events.date(__d.when) }, [
      new ViewNode('text', { value: 'Pick' }),
    ]),
    new ViewNode('button', {
      '@click': (event) => this.events.notify((__f["t"] || __f.__missing("t"))('saved', { name: __d.user?.name })),
    }, [
      new ViewNode('text', { value: 'Notify' }),
    ]),
    new ViewNode('button', {
      '@click': (event) => this.events.remove(__d.items?.filter((item) => item?.done)?.map((item) => item?.id)),
    }, [
      new ViewNode('text', { value: 'Purge' }),
    ]),
    new ViewNode('ul', {},
      __l(this, this, 0, __d.items, (s) =>
        new ViewNode('li', {
          key: s.k,
          '@click': (s.h0 ??= (event) => this.events.select(s.item?.id, s.i)),
          '@dblclick': (s.h1 ??= (event) => this.events.edit(s.item, event.detail)),
          '@keydown:enter': (s.item?.done) ? (event) => this.events.undo(s.item) : null,
        }, [
          new ViewNode('text', { value: __s(s.item?.name, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'item.name' : 0) }),
        ])
      , __L0)
    ),
  ]);
};
ExprHandlers.__pzlModule = 'expr_handlers.pzl';
