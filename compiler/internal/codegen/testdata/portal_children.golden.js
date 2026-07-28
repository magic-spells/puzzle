
import { PuzzleView } from '@magic-spells/puzzle';

export default class PortalChildren extends PuzzleView {}

import { ViewNode, SLOT_TAG, PORTAL_TAG } from '@magic-spells/puzzle';

PortalChildren.prototype.render = function () {
  const __d = this.getData();

  return new ViewNode('puzzle-view', {}, [
    new ViewNode(PORTAL_TAG, {}, [
      new ViewNode(SLOT_TAG),
    ]),
  ]);
};
PortalChildren.__pzlModule = 'portal_children.pzl';
