
import { PuzzleView } from '@magic-spells/puzzle';

export default class FormatterChain extends PuzzleView {
  data() {
    return { tags: [], price: 0 };
  }
}

import { ViewNode } from '@magic-spells/puzzle';

FormatterChain.prototype.render = function () {
  const __d = this.getData();
  const __f = this.ctx.formatters.getAll();

  return new ViewNode('puzzle-view', { class: 'fmt' }, [
    new ViewNode('p', { class: 'joined' }, [
      new ViewNode('text', { value: String((__f["upcase"] || __f.__missing("upcase"))((__f["join"] || __f.__missing("join"))(__d.tags, ', '))) }),
    ]),
    new ViewNode('p', { class: 'money' }, [
      new ViewNode('text', { value: String((__f["currency"] || __f.__missing("currency"))(__d.price, '$', 2)) }),
    ]),
  ]);
};
FormatterChain.__pzlModule = 'formatter_chain.pzl';
