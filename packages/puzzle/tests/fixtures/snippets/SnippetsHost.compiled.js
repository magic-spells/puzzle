
import { PuzzleView } from '@magic-spells/puzzle';
import Wrapper from './Wrapper.compiled.js';

export default class SnippetsHost extends PuzzleView {
  created() {
    this.setData({
      users: [{ id: 1, name: 'Ada' }, { id: 2, name: 'Grace' }],
      group: { title: 'Core' },
      suffix: 'v1',
    });
  }

  events = {
    rename: (id) => {
      const users = this.getData().users.map((user) => (
        user.id === id ? { ...user, name: `${user.name}?` } : user
      ));
      this.setData({ users, suffix: 'v2' });
    },
  };
}

import { ViewNode, SNIPPET_TAG, displayValue as __s } from '@magic-spells/puzzle';

SnippetsHost.prototype.render = function () {
  const __d = this.getData();

  return new ViewNode('puzzle-view', { class: 'snippets-host' }, [
    new ViewNode(Wrapper, {
      users: __d.users,
      group: __d.group,
    }, [
      new ViewNode(SNIPPET_TAG, {
        fits: 'heading',
        params: ['group'],
        fn: ({ group }) => ([
            new ViewNode('text', { value: __s(group.title, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'group.title' : 0) + ' / ' + __s(__d.suffix, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'suffix' : 0) }),
          ]),
      }),
      new ViewNode(SNIPPET_TAG, {
        fits: 'row',
        params: ['user', 'group'],
        fn: ({ user, group }) => ([
            new ViewNode('button', {
              class: 'person',
              '@click': (event) => this.events.rename(user.id),
            }, [
              new ViewNode('text', { value: __s(group.title, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'group.title' : 0) + ':' + __s(user.name, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'user.name' : 0) + ':' + __s(__d.suffix, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'suffix' : 0) }),
            ]),
          ]),
      }),
      new ViewNode(SNIPPET_TAG, {
        fits: '',
        params: ['group'],
        fn: ({ group }) => ([
            new ViewNode('text', { value: 'default:' + __s(group.title, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'group.title' : 0) + ':' + __s(__d.suffix, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'suffix' : 0) }),
          ]),
      }),
    ]),
  ]);
};
SnippetsHost.__pzlModule = 'SnippetsHost.pzl';
