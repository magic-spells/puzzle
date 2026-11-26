
import { PuzzleView } from '@magic-spells/puzzle';

export default class FormatterChain extends PuzzleView {
  data() {
    return { title: '', price: 0 };
  }
}

import { ViewNode, displayValue as __s } from '@magic-spells/puzzle';

FormatterChain.prototype.render = function () {
  const __d = this.getData();
  const __f = this.ctx.formatters;

  return new ViewNode('puzzle-view', { class: 'fmt' }, [
    new ViewNode('p', { class: 'nested' }, [
      new ViewNode('text', { value: __s(__f.get("truncate")(__f.get("capitalize")(__d.title), 20), typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'truncate(capitalize(title), 20)' : 0) }),
    ]),
    new ViewNode('p', { class: 'money' }, [
      new ViewNode('text', { value: __s(__f.get("currency")(__d.price, '$', 2), typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'currency(price, \'$\', 2)' : 0) }),
    ]),
  ]);
};
