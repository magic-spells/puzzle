
import { PuzzleView } from '@magic-spells/puzzle';

export default class InterpOps extends PuzzleView {
  data() {
    return { a: 1, b: 2, count: 0, ready: false, user: {} };
  }
}

import { ViewNode } from '@magic-spells/puzzle';

InterpOps.prototype.render = function () {
  const __d = this.getData();
  const __f = this.ctx.formatters.getAll();

  return new ViewNode('puzzle-view', { class: 'ops' }, [
    new ViewNode('p', { class: 'sum' }, [
      new ViewNode('text', { value: String(__d.a + __d.b) }),
    ]),
    new ViewNode('p', { class: 'cmp' }, [
      new ViewNode('text', { value: String(__d.count > 0) }),
    ]),
    new ViewNode('p', { class: 'neg' }, [
      new ViewNode('text', { value: String(!__d.ready) }),
    ]),
    new ViewNode('p', { class: 'chain' }, [
      new ViewNode('text', { value: String(__d.user.profile?.name) }),
    ]),
  ]);
};
