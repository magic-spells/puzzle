
import { PuzzleView } from '@magic-spells/puzzle';

// The record arm of implicit binding (D147): a loop variable as the ROOT of a
// member path binds through PuzzleModel.update(), so validation, store
// notification, and persistence all run exactly as a hand-written handler's would.
export default class RecordForm extends PuzzleView {
	data() {
		return { todos: this.ctx.store.findMany('todo') };
	}
}

import { ViewNode } from '@magic-spells/puzzle';

RecordForm.prototype.render = function () {
  const __d = this.getData();

  return new ViewNode('puzzle-view', { class: 'record-form' },
    __d.todos.map((todo) =>
      new ViewNode('div', {
        key: ViewNode.keyOf(todo),
        class: 'row',
      }, [
        new ViewNode('input', {
          class: 'text',
          value: todo.text,
          '@input:bind': this.__bind(todo, 'text', 'v'),
        }, []),
        new ViewNode('input', {
          class: 'done',
          type: 'checkbox',
          checked: todo.completed,
          '@change:bind': this.__bind(todo, 'completed', 'c'),
        }, []),
        new ViewNode('input', {
          class: 'rank',
          type: 'number',
          value: todo.rank,
          '@change:bind': this.__bind(todo, 'rank', 'vn'),
        }, []),
      ])
    )
  );
};
RecordForm.__pzlModule = 'RecordForm.pzl';
