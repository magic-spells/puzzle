
import { PuzzleView } from '@magic-spells/puzzle';

export default class SizeCount extends PuzzleView {
  data() {
    return { items: [], user: { name: '' }, list: [], a: null, tags: [], file: null, todos: [] };
  }

  events = {
    pick: () => {},
  };
}

import { ViewNode, displayValue as __s, sizeOf as __z, listRows as __l } from '@magic-spells/puzzle';

const __L0 = { key: (todo) => todo?.id, fields: ['size'], deep: true };

SizeCount.prototype.render = function () {
  const __d = this.getData();

  return new ViewNode('puzzle-view', { class: 'counts' }, [
    new ViewNode('h2', {
      title: `${__s(__z(__d.items), typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'items.size' : 0)} items`,
      'data-count': __z(__d.items),
    }, [
      new ViewNode('text', { value: __s(__z(__d.items), typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'items.size' : 0) }),
    ]),
    new ViewNode('p', {}, [
      new ViewNode('text', { value: __s(__z(__d.user?.name), typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'user.name.size' : 0) + ' ' + __s(__z(__d.list?.[0]), typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'list[0].size' : 0) + ' ' + __s(__z(__d.a?.b), typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'a?.b.size' : 0) + ' ' + __s(__z(__d.tags) - 1, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'tags.size - 1' : 0) + ' ' + __s(__z(__d.file)?.label, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'file.size.label' : 0) }),
    ]),
    ...(__z(__d.items) > 0
      ? [
          new ViewNode('ul', {},
            __l(this, this, 0, __d.todos, (s) =>
              new ViewNode('li', {
                key: s.k,
                '@click': (s.h0 ??= (event) => this.events.pick(s.item.tags.size)),
              }, [
                new ViewNode('text', { value: __s(__z(s.item?.tags), typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'todo.tags.size' : 0) + ' ' + __s(__z(s.item), typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'todo.size' : 0) }),
              ])
            , __L0)
          ),
        ]
      : [
          new ViewNode('#'),
        ]),
  ]);
};
SizeCount.__pzlModule = 'size_count.pzl';
