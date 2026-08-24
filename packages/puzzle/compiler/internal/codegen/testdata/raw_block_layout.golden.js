
import { PuzzleView } from '@magic-spells/puzzle';

export default class RawBlockLayout extends PuzzleView {
  data() {
    return { items: [] };
  }
}

import { ViewNode } from '@magic-spells/puzzle';

RawBlockLayout.prototype.render = function () {
  const __d = this.getData();

  return new ViewNode('puzzle-view', {}, [
    new ViewNode('ul', {},
      __d.items.map((item) =>
        new ViewNode('li', {
          key: ViewNode.keyOf(item),
          class: 'sample',
        }, [
          new ViewNode('text', { value: '{ item.title }' }),
        ])
      )
    ),
    new ViewNode('ol', {},
      __d.items.map((item) =>
        new ViewNode('li', {
          key: ViewNode.keyOf(item),
          class: 'oneline',
        }, [
          new ViewNode('text', { value: '{ item.title }' }),
        ])
      )
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
