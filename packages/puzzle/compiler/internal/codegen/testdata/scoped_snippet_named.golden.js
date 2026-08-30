
import { PuzzleView } from '@magic-spells/puzzle';
import GroupedList from '../components/GroupedList.pzl';

export default class ScopedSnippetNamed extends PuzzleView {
  data() { return { groups: [] }; }
}

import { ViewNode, SNIPPET_TAG, displayValue as __s } from '@magic-spells/puzzle';

ScopedSnippetNamed.prototype.render = function () {
  const __d = this.getData();

  return new ViewNode('puzzle-view', {}, [
    new ViewNode(GroupedList, { groups: __d.groups }, [
      new ViewNode(SNIPPET_TAG, {
        fits: 'heading',
        params: ['group'],
        fn: ({ group }) => ([
            new ViewNode('h2', {}, [
              new ViewNode('text', { value: __s(group.title, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'group.title' : 0) }),
            ]),
          ]),
      }),
      new ViewNode(SNIPPET_TAG, {
        fits: 'row',
        params: ['user', 'group'],
        fn: ({ user, group }) => ([
            new ViewNode('p', {}, [
              new ViewNode('text', { value: __s(group.title, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'group.title' : 0) + ': ' + __s(user.name, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'user.name' : 0) }),
            ]),
          ]),
      }),
      new ViewNode('button', { slot: 'actions' }, [
        new ViewNode('text', { value: 'Done' }),
      ]),
    ]),
  ]);
};
ScopedSnippetNamed.__pzlModule = 'scoped_snippet_named.pzl';
