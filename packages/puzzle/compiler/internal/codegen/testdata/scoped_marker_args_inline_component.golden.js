
import { PuzzleView } from '@magic-spells/puzzle';

export default class ScopedMarkerArgs extends PuzzleView {
  data() { return { lead: null, users: [], group: null }; }
}

import { ViewNode, SLOT_TAG, displayValue as __s } from '@magic-spells/puzzle';

ScopedMarkerArgs.prototype.render = function () {
  const __d = this.getData();

  return new ViewNode('div', { class: 'list' }, [
    new ViewNode(SLOT_TAG, { args: { user: __d.lead } }, [
      new ViewNode('text', { value: 'No lead' }),
    ]),
    ...__d.users.map((user) =>
      new ViewNode('div', {
        key: ViewNode.keyOf(user),
        class: 'row',
      }, [
        new ViewNode(SLOT_TAG, { name: 'row', args: { user: user, group: __d.group } }, [
          new ViewNode('span', {}, [
            new ViewNode('text', { value: __s(user.name, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'user.name' : 0) }),
          ]),
        ]),
      ])
    ),
  ]);
};
ScopedMarkerArgs.__pzlModule = 'scoped_marker_args_inline_component.pzl';
