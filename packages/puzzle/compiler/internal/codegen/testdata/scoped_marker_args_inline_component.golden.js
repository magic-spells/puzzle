
import { PuzzleView } from '@magic-spells/puzzle';

export default class ScopedMarkerArgs extends PuzzleView {
  data() { return { lead: null, users: [], group: null }; }
}

import { ViewNode, SLOT_TAG, displayValue as __s, listRows as __l } from '@magic-spells/puzzle';

const __L0 = { key: (user) => ViewNode.keyOf(user), roots: 1, fields: ['name'] };

ScopedMarkerArgs.prototype.render = function () {
  const __d = this.getData();

  return new ViewNode('div', { class: 'list' }, [
    new ViewNode(SLOT_TAG, { args: { user: __d.lead } }, [
      new ViewNode('text', { value: 'No lead' }),
    ]),
    ...__l(this, this, 0, __d.users, (s) =>
      new ViewNode('div', {
        key: s.k,
        class: 'row',
      }, [
        new ViewNode(SLOT_TAG, { name: 'row', args: { user: s.item, group: __d.group } }, [
          new ViewNode('span', {}, [
            new ViewNode('text', { value: __s(s.item.name, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'user.name' : 0) }),
          ]),
        ]),
      ])
    , __L0),
  ]);
};
ScopedMarkerArgs.__pzlModule = 'scoped_marker_args_inline_component.pzl';
ScopedMarkerArgs.__roots = ['group'];
