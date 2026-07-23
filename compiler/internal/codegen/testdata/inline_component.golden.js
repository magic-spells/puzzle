
import { PuzzleView } from '@magic-spells/puzzle';

export default class InlineComponent extends PuzzleView {
  data(params, props) {
    return { label: props.label };
  }
  events = {
    onClick: (event) => {},
  };
}

import { ViewNode } from '@magic-spells/puzzle';

InlineComponent.prototype.render = function () {
  const __d = this.getData();
  const __f = this.ctx.formatters.getAll();

  return new ViewNode('button', {
    class: 'btn',
    '@click': ((this.__h ??= {})[0] ??= (event) => this.events.onClick(event)),
  }, [
    new ViewNode('text', { value: String(__d.label) }),
  ]);
};
InlineComponent.__pzlModule = 'inline_component.pzl';
