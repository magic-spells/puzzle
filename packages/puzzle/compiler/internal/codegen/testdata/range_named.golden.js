
import { PuzzleView } from '@magic-spells/puzzle';

export default class RangeNamed extends PuzzleView {
  data() {
    return { count: 3 };
  }
}

import { ViewNode, displayValue as __s, loopRange as __r } from '@magic-spells/puzzle';

RangeNamed.prototype.render = function () {
  const __d = this.getData();

  return new ViewNode('puzzle-view', { class: 'dots' },
    __r(1, __d.count).map((n) =>
      new ViewNode('span', {
        key: n,
        class: 'dot',
      }, [
        new ViewNode('text', { value: __s(n, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'n' : 0) }),
      ])
    )
  );
};
RangeNamed.__pzlModule = 'range_named.pzl';
