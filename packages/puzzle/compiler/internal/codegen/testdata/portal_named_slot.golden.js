
import { PuzzleView } from '@magic-spells/puzzle';

export default class PortalNamedSlot extends PuzzleView {}

import { ViewNode, SLOT_TAG, PORTAL_TAG } from '@magic-spells/puzzle';

PortalNamedSlot.prototype.render = function () {
  const __d = this.getData();

  return new ViewNode('puzzle-view', {}, [
    new ViewNode(PORTAL_TAG, {}, [
      new ViewNode(SLOT_TAG, { name: 'x' }),
    ]),
  ]);
};
PortalNamedSlot.__pzlModule = 'portal_named_slot.pzl';
