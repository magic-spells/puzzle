
import { PuzzleView } from '@magic-spells/puzzle';

export default class SlotLayout extends PuzzleView {
  data() {
    return {};
  }
}

import { ViewNode, SLOT_TAG } from '@magic-spells/puzzle';

SlotLayout.prototype.render = function () {
  const __d = this.getData();
  const __f = this.ctx.formatters.getAll();

  return new ViewNode('puzzle-view', { class: 'shell' }, [
    new ViewNode('main', { class: 'content' }, [
      new ViewNode(SLOT_TAG),
    ]),
  ]);
};
