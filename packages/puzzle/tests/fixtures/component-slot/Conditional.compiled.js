
import { PuzzleView } from '@magic-spells/puzzle';
import Card from './Card.pzl';
export default class Conditional extends PuzzleView {
  data(_params, props) { return props; }
}

import { ViewNode, dynamicComponent as __dc } from '@magic-spells/puzzle';

Conditional.prototype.render = function () {
  const __d = this.getData();

  return new ViewNode('puzzle-view', {}, [
    new ViewNode('input', { class: 'before' }, []),
    ...(__d.selected
      ? [
          ...(__d.open
            ? [
                __dc(Card, { title: 'selected' }, []),
              ]
            : [
                new ViewNode('p', {}, [
                  new ViewNode('text', { value: 'closed' }),
                ]),
              ]),
        ]
      : [
          ...(__d.open
            ? [
                new ViewNode(Card, { title: 'selected' }, []),
              ]
            : [
                new ViewNode('p', {}, [
                  new ViewNode('text', { value: 'closed' }),
                ]),
              ]),
        ]),
    new ViewNode('input', { class: 'after' }, []),
  ]);
};
Conditional.__pzlModule = 'Conditional.pzl';
