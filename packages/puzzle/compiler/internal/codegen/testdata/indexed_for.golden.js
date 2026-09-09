
import { PuzzleView } from '@magic-spells/puzzle';

export default class IndexedFor extends PuzzleView {
  data() {
    return { items: this.ctx.store.findMany('item') };
  }
}

import { ViewNode, displayValue as __s } from '@magic-spells/puzzle';

IndexedFor.prototype.render = function () {
  const __d = this.getData();

  return new ViewNode('puzzle-view', { class: 'list' }, [
    new ViewNode('ul', { class: 'items' },
      __d.items.map((item, i) =>
        new ViewNode('li', {
          key: ViewNode.keyOf(item),
          class: 'item',
        }, [
          new ViewNode('text', { value: __s(i + 1, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'i + 1' : 0) + '. ' + __s(item.name, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'item.name' : 0) }),
        ])
      )
    ),
  ]);
};
IndexedFor.__pzlModule = 'indexed_for.pzl';
