
import { PuzzleView } from '@magic-spells/puzzle';
import WrapperChain from './WrapperChain.compiled.js';

export default class SnippetChainHost extends PuzzleView {
  data() {
    return {
      users: [{ id: 1, name: 'Ada' }, { id: 2, name: 'Grace' }],
      group: { title: 'Core' },
    };
  }
}

import { ViewNode, SNIPPET_TAG, displayValue as __s } from '@magic-spells/puzzle';

SnippetChainHost.prototype.render = function () {
  const __d = this.getData();

  return new ViewNode('puzzle-view', { class: 'snippets-chain-host' }, [
    new ViewNode(WrapperChain, {
      users: __d.users,
      group: __d.group,
    }, [
      new ViewNode(SNIPPET_TAG, {
        fits: 'heading',
        params: ['group'],
        fn: ({ group }) => ([
            new ViewNode('text', { value: 'chain-heading:' + __s(group.title, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'group.title' : 0) }),
          ]),
      }),
      new ViewNode(SNIPPET_TAG, {
        fits: 'row',
        params: ['user', 'group'],
        fn: ({ user, group }) => ([
            new ViewNode('span', { class: 'chain-person' }, [
              new ViewNode('text', { value: 'chain-row:' + __s(group.title, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'group.title' : 0) + ':' + __s(user.name, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'user.name' : 0) }),
            ]),
          ]),
      }),
      new ViewNode(SNIPPET_TAG, {
        fits: '',
        params: ['group'],
        fn: ({ group }) => ([
            new ViewNode('span', { class: 'chain-default' }, [
              new ViewNode('text', { value: 'chain-default:' + __s(group.title, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'group.title' : 0) }),
            ]),
          ]),
      }),
    ]),
  ]);
};
SnippetChainHost.__pzlModule = 'SnippetChainHost.pzl';
