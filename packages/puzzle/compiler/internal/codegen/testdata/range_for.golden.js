
import { PuzzleView } from '@magic-spells/puzzle';

export default class RangeFor extends PuzzleView {
  data() {
    return { count: 3 };
  }
}

import { ViewNode, loopRange as __r } from '@magic-spells/puzzle';

RangeFor.prototype.render = function () {
  const __d = this.getData();

  return new ViewNode('puzzle-view', { class: 'dots' },
    __r(1, __d.count).map((__i) =>
      new ViewNode('span', {
        key: __i,
        class: 'dot',
      }, [])
    )
  );
};
RangeFor.__pzlModule = 'range_for.pzl';
