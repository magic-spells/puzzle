
import { PuzzleView } from '@magic-spells/puzzle';

export default class RawBlockLayout extends PuzzleView {
  data() {
    return { items: [] };
  }
}

import { ViewNode, listRows as __l } from '@magic-spells/puzzle';

const __L0 = { key: (item) => ViewNode.keyOf(item) };
const __L1 = { key: (item) => ViewNode.keyOf(item) };

RawBlockLayout.prototype.render = function () {
  const __d = this.getData();

  return new ViewNode('puzzle-view', {}, [
    new ViewNode('ul', {},
      __l(this, this, 0, __d.items, (s) =>
        new ViewNode('li', {
          key: s.k,
          class: 'sample',
        }, [
          new ViewNode('text', { value: '{ item.title }' }),
        ])
      , __L0)
    ),
    new ViewNode('ol', {},
      __l(this, this, 1, __d.items, (s) =>
        new ViewNode('li', {
          key: s.k,
          class: 'oneline',
        }, [
          new ViewNode('text', { value: '{ item.title }' }),
        ])
      , __L1)
    ),
    new ViewNode('pre', {}, [
      new ViewNode('text', { value: '\nconst a = 1;\n  const b = 2;\n' }),
    ]),
    new ViewNode('p', {}, [
      new ViewNode('text', { value: 'before' + '\n\n' + 'after' }),
    ]),
  ]);
};
RawBlockLayout.__pzlModule = 'raw_block_layout.pzl';
