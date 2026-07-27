
import { PuzzleView } from '@magic-spells/puzzle';

export default class KeyedFor extends PuzzleView {
  data() {
    return { items: this.ctx.store.findMany('item') };
  }
}

import { ViewNode, displayValue as __s } from '@magic-spells/puzzle';

KeyedFor.prototype.render = function () {
  const __d = this.getData();

  return new ViewNode('puzzle-view', { class: 'list' }, [
    new ViewNode('ul', { class: 'items' },
      __d.items.map((item) =>
        new ViewNode('li', {
          key: ViewNode.keyOf(item),
          class: 'item',
        }, [
          new ViewNode('text', { value: __s(item.name, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'item.name' : 0) }),
        ])
      )
    ),
  ]);
};
KeyedFor.__pzlModule = 'keyed_for.pzl';
