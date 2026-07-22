
import { PuzzleView } from '@magic-spells/puzzle';

export default class AttrInlineIf extends PuzzleView {
  data() {
    return { active: false };
  }
}

import { ViewNode } from '@magic-spells/puzzle';

AttrInlineIf.prototype.render = function () {
  const __d = this.getData();
  const __f = this.ctx.formatters.getAll();

  return new ViewNode('puzzle-view', { class: 'root' }, [
    new ViewNode('span', {
      class: `badge ${__d.active ? 'on' : 'off'}`,
    }, [
      new ViewNode('text', { value: 'Status' }),
    ]),
  ]);
};
