
import { PuzzleView } from '@magic-spells/puzzle';

export default class Panel extends PuzzleView {
  data() {
    return { placeholder: 'add one' };
  }
}

import { ViewNode, SLOT_TAG } from '@magic-spells/puzzle';

Panel.prototype.render = function () {
  const __d = this.getData();
  const __f = this.ctx.formatters.getAll();

  return new ViewNode('puzzle-view', { class: 'panel' }, [
    new ViewNode('div', { class: 'body' }, [
      new ViewNode(SLOT_TAG, {}, [
        new ViewNode('p', { class: 'empty' }, [
          new ViewNode('text', { value: 'Nothing yet, ' + String(__d.placeholder) }),
        ]),
      ]),
    ]),
  ]);
};
