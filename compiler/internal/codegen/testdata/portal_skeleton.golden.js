
import { PuzzleView } from '@magic-spells/puzzle';

export default class PortalSkeleton extends PuzzleView {}

import { ViewNode, SLOT_TAG, PORTAL_TAG } from '@magic-spells/puzzle';

PortalSkeleton.prototype.render = function () {
  const __d = this.getData();

  return new ViewNode('puzzle-view', {}, [
    new ViewNode('main', {}, [
      new ViewNode('text', { value: 'Ready' }),
    ]),
  ]);
};
PortalSkeleton.__pzlModule = 'portal_skeleton.pzl';

PortalSkeleton.prototype.renderSkeleton = function () {
  const __d = this.getData();

  return new ViewNode('puzzle-view', {}, [
    new ViewNode(PORTAL_TAG, {}, [
      new ViewNode(SLOT_TAG),
    ]),
  ]);
};
