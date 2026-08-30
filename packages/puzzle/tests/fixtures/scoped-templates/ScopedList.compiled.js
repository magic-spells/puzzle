
import { PuzzleView } from '@magic-spells/puzzle';

export default class ScopedList extends PuzzleView {
  data(params, props) {
    return { users: props.users, group: props.group };
  }

  events = {
    renameFirst: () => {
      const users = this.getData().users.map((user, index) => (
        index === 0 ? { ...user, name: `${user.name}!` } : user
      ));
      this.setData('users', users);
    },
  };
}

import { ViewNode, SLOT_TAG, displayValue as __s } from '@magic-spells/puzzle';

ScopedList.prototype.render = function () {
  const __d = this.getData();

  return new ViewNode('section', { class: 'scoped-list' }, [
    new ViewNode('h2', { class: 'scoped-heading' }, [
      new ViewNode(SLOT_TAG, { name: 'heading', args: { group: __d.group } }, [
        new ViewNode('text', { value: 'Fallback heading' }),
      ]),
    ]),
    new ViewNode('ul', {},
      __d.users.map((user) =>
        new ViewNode('li', { key: user.id }, [
          new ViewNode(SLOT_TAG, { name: 'row', args: { user: user, group: __d.group } }, [
            new ViewNode('text', { value: __s(user.name, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'user.name' : 0) }),
          ]),
        ])
      )
    ),
    new ViewNode('p', { class: 'scoped-default' }, [
      new ViewNode(SLOT_TAG, { args: { group: __d.group } }, [
        new ViewNode('text', { value: 'Fallback default' }),
      ]),
    ]),
    new ViewNode('button', {
      class: 'component-update',
      '@click': ((this.__h ??= {})[0] ??= (event) => this.events.renameFirst(event)),
    }, [
      new ViewNode('text', { value: 'Update inside component' }),
    ]),
  ]);
};
ScopedList.__pzlModule = 'ScopedList.pzl';
