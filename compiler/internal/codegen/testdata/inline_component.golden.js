
import { PuzzleView } from '@magic-spells/puzzle';

export default class InlineComponent extends PuzzleView {
  data(params, props) {
    return { label: props.label };
  }
  events = {
    onClick: (event) => {},
  };
}

import { ViewNode, displayValue as __s } from '@magic-spells/puzzle';

InlineComponent.prototype.render = function () {
  const __d = this.getData();

  return new ViewNode('button', {
    class: 'btn',
    '@click': ((this.__h ??= {})[0] ??= (event) => this.events.onClick(event)),
  }, [
    new ViewNode('text', { value: __s(__d.label, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'label' : 0) }),
  ]);
};
InlineComponent.__pzlModule = 'inline_component.pzl';
