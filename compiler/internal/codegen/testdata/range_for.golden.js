
import { PuzzleView } from '@magic-spells/puzzle';

export default class RangeFor extends PuzzleView {
  data() {
    return { count: 3 };
  }
}

import { ViewNode } from '@magic-spells/puzzle';

RangeFor.prototype.render = function () {
  const __d = this.getData();
  const __f = this.ctx.formatters.getAll();

  return new ViewNode('puzzle-view', { class: 'dots' },
    Array.from({ length: (__d.count) - (1) + 1 }, (_, __i) =>
      new ViewNode('span', {
        key: __i,
        class: 'dot',
      }, [])
    )
  );
};
RangeFor.__pzlModule = 'range_for.pzl';
