
import { PuzzleView } from '@magic-spells/puzzle';

export default class ElseIf extends PuzzleView {
  data() {
    return { state: 'loading' };
  }
}

import { ViewNode } from '@magic-spells/puzzle';

ElseIf.prototype.render = function () {
  const __d = this.getData();
  const __f = this.ctx.formatters.getAll();

  return new ViewNode('puzzle-view', { class: 'status' }, [
    ...(__d.state === 'loading'
      ? [
          new ViewNode('p', { class: 'loading' }, [
            new ViewNode('text', { value: 'Loading…' }),
          ]),
        ]
      : [
          ...(__d.state === 'error'
            ? [
                new ViewNode('p', { class: 'error' }, [
                  new ViewNode('text', { value: 'Something went wrong.' }),
                ]),
              ]
            : [
                ...(__d.state === 'empty'
                  ? [
                      new ViewNode('p', { class: 'empty' }, [
                        new ViewNode('text', { value: 'Nothing here yet.' }),
                      ]),
                    ]
                  : [
                      new ViewNode('p', { class: 'ready' }, [
                        new ViewNode('text', { value: 'Ready.' }),
                      ]),
                    ]),
              ]),
        ]),
  ]);
};
ElseIf.__pzlModule = 'else_if.pzl';
