
import { PuzzleView } from '@magic-spells/puzzle';

export default class CaseWhen extends PuzzleView {
  data() {
    return { order: { status: 'shipped', tracking: 'ABC123' } };
  }
}

import { ViewNode } from '@magic-spells/puzzle';

CaseWhen.prototype.render = function () {
  const __d = this.getData();
  const __f = this.ctx.formatters.getAll();

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
                      new ViewNode('text', { value: String(__d.order.tracking) }),
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
