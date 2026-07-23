
import { PuzzleView } from '@magic-spells/puzzle';

export default class Unless extends PuzzleView {
  data() {
    return { user: { verified: false }, items: [], loading: false };
  }
}

import { ViewNode } from '@magic-spells/puzzle';

Unless.prototype.render = function () {
  const __d = this.getData();
  const __f = this.ctx.formatters.getAll();

  return new ViewNode('puzzle-view', { class: 'account' }, [
    ...(!(__d.user.verified)
      ? [
          new ViewNode('p', { class: 'warn' }, [
            new ViewNode('text', { value: 'Please verify your account.' }),
          ]),
        ]
      : [
          new ViewNode('p', { class: 'ok' }, [
            new ViewNode('text', { value: 'You are verified.' }),
          ]),
        ]),
    ...(!(__d.items.length)
      ? [
          new ViewNode('div', { class: 'empty' }, [
            ...(!(__d.loading)
              ? [
                  new ViewNode('span', {}, [
                    new ViewNode('text', { value: 'No items yet.' }),
                  ]),
                ]
              : [
                  new ViewNode('#'),
                ]),
          ]),
        ]
      : [
          new ViewNode('#'),
        ]),
  ]);
};
Unless.__pzlModule = 'unless.pzl';
