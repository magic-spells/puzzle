
import { PuzzleView } from '@magic-spells/puzzle';
import LazyRows from './LazyRows.compiled.js';

export default class LazyHost extends PuzzleView {
  data() {
    return { items: [{ id: 1, name: 'Ada' }, { id: 2, name: 'Grace' }] };
  }
}

import { ViewNode, SNIPPET_TAG, displayValue as __s } from '@magic-spells/puzzle';

LazyHost.prototype.render = function () {
  const __d = this.getData();

  return new ViewNode('puzzle-view', { class: 'lazy-host' }, [
    new ViewNode(LazyRows, { items: __d.items }, [
      new ViewNode(SNIPPET_TAG, {
        fits: 'row',
        params: ['item', 'index'],
        fn: ({ item, index }) => ([
            new ViewNode('span', { class: 'lazy-row' }, [
              new ViewNode('text', { value: __s(index, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'index' : 0) + ':' + __s(item?.name, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'item.name' : 0) }),
            ]),
          ]),
      }),
      new ViewNode(SNIPPET_TAG, {
        fits: 'note',
        params: ['item'],
        fn: ({ item }) => ([
            new ViewNode('b', { class: 'lazy-note-filled' }, [
              new ViewNode('text', { value: __s(item?.name, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'item.name' : 0) }),
            ]),
          ]),
      }),
    ]),
  ]);
};
LazyHost.__pzlModule = 'LazyHost.pzl';
