
import { PuzzleView } from '@magic-spells/puzzle';

export default class InterpOps extends PuzzleView {
  data() {
    return { a: 1, b: 2, count: 0, ready: false, user: {} };
  }
}

import { ViewNode, displayValue as __s } from '@magic-spells/puzzle';

InterpOps.prototype.render = function () {
  const __d = this.getData();
  const __f = this.ctx.formatters.getAll();

  return new ViewNode('puzzle-view', { class: 'ops' }, [
    new ViewNode('p', { class: 'sum' }, [
      new ViewNode('text', { value: __s(__d.a + __d.b, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'a + b' : 0) }),
    ]),
    new ViewNode('p', { class: 'cmp' }, [
      new ViewNode('text', { value: __s(__d.count > 0, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'count > 0' : 0) }),
    ]),
    new ViewNode('p', { class: 'neg' }, [
      new ViewNode('text', { value: __s(!__d.ready, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? '!ready' : 0) }),
    ]),
    new ViewNode('p', { class: 'chain' }, [
      new ViewNode('text', { value: __s(__d.user.profile?.name, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'user.profile?.name' : 0) }),
    ]),
  ]);
};
InterpOps.__pzlModule = 'interp_ops.pzl';
