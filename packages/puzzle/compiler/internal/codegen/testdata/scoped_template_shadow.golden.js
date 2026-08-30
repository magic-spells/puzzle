
import { PuzzleView } from '@magic-spells/puzzle';
import UserList from '../components/UserList.pzl';

export default class ScopedTemplateShadow extends PuzzleView {
  data() { return { users: [], user: { name: 'data user' }, title: 'People' }; }
}

import { ViewNode, TEMPLATE_TAG, displayValue as __s } from '@magic-spells/puzzle';

ScopedTemplateShadow.prototype.render = function () {
  const __d = this.getData();

  return new ViewNode('puzzle-view', {},
    __d.users.map((user) =>
      new ViewNode(UserList, { key: user.id }, [
        new ViewNode(TEMPLATE_TAG, {
          fits: '',
          params: ['user'],
          fn: ({ user }) => ([
              new ViewNode('p', {}, [
                new ViewNode('text', { value: __s(user.name, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'user.name' : 0) + ' — ' + __s(__d.title, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'title' : 0) }),
              ]),
            ]),
        }),
      ])
    )
  );
};
ScopedTemplateShadow.__pzlModule = 'scoped_template_shadow.pzl';
