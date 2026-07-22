
import { PuzzleView } from '@magic-spells/puzzle';
import Card from './Card.pzl';

// A routed layout that wraps its router-filled <Slot/> inside a component
// invocation — the default-slot forwarding case (v1.38, D71). Pre-D71 this
// mounted a literal <slot> element and the routed view never appeared.
export default class WrappedLayout extends PuzzleView {}

import { ViewNode, SLOT_TAG } from '@magic-spells/puzzle';

WrappedLayout.prototype.render = function () {
  const __d = this.getData();
  const __f = this.ctx.formatters.getAll();

  return new ViewNode('puzzle-view', { class: 'layout' }, [
    new ViewNode(Card, {}, [
      new ViewNode(SLOT_TAG),
    ]),
  ]);
};
