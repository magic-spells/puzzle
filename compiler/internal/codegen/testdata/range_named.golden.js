
import { PuzzleView } from '@magic-spells/puzzle';

export default class RangeNamed extends PuzzleView {
  data() {
    return { count: 3 };
  }
}

import { ViewNode } from '@magic-spells/puzzle';

RangeNamed.prototype.render = function () {
  const __d = this.getData();
  const __f = this.ctx.formatters.getAll();

  return new ViewNode('puzzle-view', { class: 'dots' },
    Array.from({ length: (__d.count) - (1) + 1 }, (_, __i) => (1) + __i).map((n) =>
      new ViewNode('span', {
        key: n,
        class: 'dot',
      }, [
        new ViewNode('text', { value: String(n) }),
      ])
    )
  );
};
RangeNamed.__pzlModule = 'range_named.pzl';
