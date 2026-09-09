
import { PuzzleView } from '@magic-spells/puzzle';

// A sibling view subscribed to the same records RecordForm binds: its data()
// query auto-subscribes, so a bind write through update() must re-render it.
export default class TodoTitles extends PuzzleView {
	data() {
		return {
			titles: this.ctx.store
				.findMany('todo')
				.map((todo) => todo.text)
				.join('|'),
		};
	}
}

import { ViewNode, displayValue as __s } from '@magic-spells/puzzle';

TodoTitles.prototype.render = function () {
  const __d = this.getData();

  return new ViewNode('puzzle-view', { class: 'todo-titles' }, [
    new ViewNode('span', { class: 'titles' }, [
      new ViewNode('text', { value: __s(__d.titles, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'titles' : 0) }),
    ]),
  ]);
};
TodoTitles.__pzlModule = 'TodoTitles.pzl';
