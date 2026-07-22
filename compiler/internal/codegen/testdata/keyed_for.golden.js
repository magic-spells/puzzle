
import { PuzzleView } from '@magic-spells/puzzle';

export default class KeyedFor extends PuzzleView {
  data() {
    return { items: this.ctx.store.findMany('item') };
  }
}

import { ViewNode } from '@magic-spells/puzzle';

KeyedFor.prototype.render = function () {
  const __d = this.getData();
  const __f = this.ctx.formatters.getAll();

  return new ViewNode('puzzle-view', { class: 'list' }, [
    new ViewNode('ul', { class: 'items' },
      __d.items.map((item) =>
        new ViewNode('li', {
          key: ViewNode.keyOf(item),
          class: 'item',
        }, [
          new ViewNode('text', { value: String(item.name) }),
        ])
      )
    ),
  ]);
};
