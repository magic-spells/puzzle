
import { PuzzleView } from '@magic-spells/puzzle';

export default class FormatterChain extends PuzzleView {
  data() {
    return { title: '', price: 0 };
  }
}

import { ViewNode, displayValue as __s } from '@magic-spells/puzzle';

FormatterChain.prototype.render = function () {
  const __d = this.getData();
  const __f = this.ctx.formatters.getAll();

  return new ViewNode('puzzle-view', { class: 'fmt' }, [
    new ViewNode('p', { class: 'nested' }, [
      new ViewNode('text', { value: __s((__f["truncate"] || __f.__missing("truncate"))((__f["capitalize"] || __f.__missing("capitalize"))(__d.title), 20), typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'truncate(capitalize(title), 20)' : 0) }),
    ]),
    new ViewNode('p', { class: 'money' }, [
      new ViewNode('text', { value: __s((__f["currency"] || __f.__missing("currency"))(__d.price, '$', 2), typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'currency(price, \'$\', 2)' : 0) }),
    ]),
  ]);
};
FormatterChain.__pzlModule = 'formatter_chain.pzl';
