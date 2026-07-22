
import { PuzzleView } from '@magic-spells/puzzle';

// The global wrapper component a layout forwards routed content into (D71).
export default class Card extends PuzzleView {}

import { ViewNode, SLOT_TAG } from '@magic-spells/puzzle';

Card.prototype.render = function () {
  const __d = this.getData();
  const __f = this.ctx.formatters.getAll();

  return new ViewNode('div', { class: 'card' }, [
    new ViewNode('div', { class: 'body' }, [
      new ViewNode(SLOT_TAG),
    ]),
  ]);
};
