
import { PuzzleView } from '@magic-spells/puzzle';

export default class FormatterChain extends PuzzleView {
  data() {
    return { tags: [], price: 0 };
  }
}

import { ViewNode, displayValue as __s } from '@magic-spells/puzzle';

FormatterChain.prototype.render = function () {
  const __d = this.getData();
  const __f = this.ctx.formatters.getAll();

  return new ViewNode('puzzle-view', { class: 'fmt' }, [
    new ViewNode('p', { class: 'joined' }, [
      new ViewNode('text', { value: __s((__f["upcase"] || __f.__missing("upcase"))((__f["join"] || __f.__missing("join"))(__d.tags, ', ')), typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'tags' : 0) }),
    ]),
    new ViewNode('p', { class: 'money' }, [
      new ViewNode('text', { value: __s((__f["currency"] || __f.__missing("currency"))(__d.price, '$', 2), typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'price' : 0) }),
    ]),
  ]);
};
FormatterChain.__pzlModule = 'formatter_chain.pzl';
