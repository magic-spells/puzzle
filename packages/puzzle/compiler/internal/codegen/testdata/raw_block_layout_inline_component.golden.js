
import { PuzzleView } from '@magic-spells/puzzle';

export default class RawBlockLayoutInlineComponent extends PuzzleView {}

import { ViewNode } from '@magic-spells/puzzle';

RawBlockLayoutInlineComponent.prototype.render = function () {
  const __d = this.getData();

  return new ViewNode('div', { class: 'doc-sample' }, [
    new ViewNode('text', { value: '\n      ' }),
    new ViewNode('b', {}, [
      new ViewNode('text', { value: '{ literal }' }),
    ]),
    new ViewNode('text', { value: '\n    ' }),
  ]);
};
RawBlockLayoutInlineComponent.__pzlModule = 'raw_block_layout_inline_component.pzl';

RawBlockLayoutInlineComponent.prototype.renderSkeleton = function () {
  const __d = this.getData();

  return new ViewNode('div', { class: 'doc-sample is-loading' }, []);
};
