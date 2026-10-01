
import { PuzzleView } from '@magic-spells/puzzle';

export default class IndexedFor extends PuzzleView {
  data() {
    return { items: this.ctx.store.findMany('item') };
  }
}

import { ViewNode, displayValue as __s, listRows as __l } from '@magic-spells/puzzle';

const __L0 = { key: (item) => ViewNode.keyOf(item), counter: true, fields: ['name'] };

IndexedFor.prototype.render = function () {
  const __d = this.getData();

  return new ViewNode('puzzle-view', { class: 'list' }, [
    new ViewNode('ul', { class: 'items' },
      __l(this, this, 0, __d.items, (s) =>
        new ViewNode('li', {
          key: s.k,
          class: 'item',
        }, [
          new ViewNode('text', { value: __s(s.i + 1, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'i + 1' : 0) + '. ' + __s(s.item?.name, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'item.name' : 0) }),
        ])
      , __L0)
    ),
  ]);
};
IndexedFor.__pzlModule = 'indexed_for.pzl';
