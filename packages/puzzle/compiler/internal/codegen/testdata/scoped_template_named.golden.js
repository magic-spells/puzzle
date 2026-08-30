
import { PuzzleView } from '@magic-spells/puzzle';
import GroupedList from '../components/GroupedList.pzl';

export default class ScopedTemplateNamed extends PuzzleView {
  data() { return { groups: [] }; }
}

import { ViewNode, TEMPLATE_TAG, displayValue as __s } from '@magic-spells/puzzle';

ScopedTemplateNamed.prototype.render = function () {
  const __d = this.getData();

  return new ViewNode('puzzle-view', {}, [
    new ViewNode(GroupedList, { groups: __d.groups }, [
      new ViewNode(TEMPLATE_TAG, {
        fits: 'heading',
        params: ['group'],
        fn: ({ group }) => ([
            new ViewNode('h2', {}, [
              new ViewNode('text', { value: __s(group.title, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'group.title' : 0) }),
            ]),
          ]),
      }),
      new ViewNode(TEMPLATE_TAG, {
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
ScopedTemplateNamed.__pzlModule = 'scoped_template_named.pzl';
