
import { PuzzleView } from '@magic-spells/puzzle';

export default class CaseWhen extends PuzzleView {
  data() {
    return { order: { status: 'shipped', tracking: 'ABC123' } };
  }
}

import { ViewNode, displayValue as __s } from '@magic-spells/puzzle';

CaseWhen.prototype.render = function () {
  const __d = this.getData();

  return new ViewNode('puzzle-view', { class: 'order' }, [
    ...(((__c) =>
      __c === ('pending') || __c === ('processing')
        ? [
            new ViewNode('span', { class: 'spin' }, [
              new ViewNode('text', { value: 'Working…' }),
            ]),
          ]
        : __c === ('shipped')
        ? [
            new ViewNode('div', { class: 'track' }, [
              ...(__d.order.tracking
                ? [
                    new ViewNode('a', { href: '/t' }, [
                      new ViewNode('text', { value: __s(__d.order.tracking, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'order.tracking' : 0) }),
                    ]),
                  ]
                : [
                    new ViewNode('span', {}, [
                      new ViewNode('text', { value: 'No tracking yet' }),
                    ]),
                  ]),
            ]),
          ]
        : [
            new ViewNode('p', { class: 'unknown' }, [
              new ViewNode('text', { value: 'Unknown status' }),
            ]),
          ])(__d.order.status)),
  ]);
};
CaseWhen.__pzlModule = 'case_when.pzl';
