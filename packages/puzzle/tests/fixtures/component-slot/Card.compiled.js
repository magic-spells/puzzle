
import { PuzzleView } from '@magic-spells/puzzle';
export default class Card extends PuzzleView {
  data(_params, props) { return props; }
  events = { close: () => this.props.close?.(this.props.title) };
}

import { ViewNode, SLOT_TAG, displayValue as __s } from '@magic-spells/puzzle';

Card.prototype.render = function () {
  const __d = this.getData();

  return new ViewNode('section', { class: 'compiled-card' }, [
    new ViewNode('button', { '@click': ((this.__h ??= {})[0] ??= (event) => this.events.close(event)) }, [
      new ViewNode('text', { value: __s(__d.title, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'title' : 0) }),
    ]),
    new ViewNode(SLOT_TAG),
  ]);
};
Card.__pzlModule = 'Card.pzl';
