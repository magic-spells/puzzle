import { PuzzleView } from '@magic-spells/puzzle';
export default class Chip extends PuzzleView {
  data(params, props) {
    return props;
  }
}

import { ViewNode, displayValue as __s } from '@magic-spells/puzzle';

Chip.prototype.render = function () {
  const __d = this.getData();

  return new ViewNode('span', { class: 'chip' }, [
    new ViewNode('text', { value: __s(__d.tone, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'tone' : 0) }),
  ]);
};
Chip.__pzlModule = 'Chip.pzl';
