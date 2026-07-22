
import { PuzzleView } from '@magic-spells/puzzle';

export default class Card extends PuzzleView {
  data() {
    return {};
  }
}

import { ViewNode, SLOT_TAG } from '@magic-spells/puzzle';

Card.prototype.render = function () {
  const __d = this.getData();
  const __f = this.ctx.formatters.getAll();

  return new ViewNode('puzzle-view', { class: 'card' }, [
    new ViewNode('header', {}, [
      new ViewNode(SLOT_TAG, { name: 'header' }, [
        new ViewNode('text', { value: 'Untitled' }),
      ]),
    ]),
    new ViewNode('div', { class: 'body' }, [
      new ViewNode(SLOT_TAG),
    ]),
    new ViewNode('footer', {}, [
      new ViewNode(SLOT_TAG, { name: 'footer' }, []),
    ]),
  ]);
};
