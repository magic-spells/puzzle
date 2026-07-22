
import { PuzzleView } from '@magic-spells/puzzle';

export default class BooleanAttr extends PuzzleView {
  data() {
    return { name: '' };
  }
}

import { ViewNode } from '@magic-spells/puzzle';

BooleanAttr.prototype.render = function () {
  const __d = this.getData();
  const __f = this.ctx.formatters.getAll();

  return new ViewNode('puzzle-view', { class: 'form' }, [
    new ViewNode('input', {
      type: 'text',
      value: __d.name,
      autofocus: true,
    }, []),
    new ViewNode('button', { disabled: !__d.name.trim() }, [
      new ViewNode('text', { value: 'Go' }),
    ]),
  ]);
};
