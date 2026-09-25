
import { PuzzleView } from '@magic-spells/puzzle';

// The record arm of implicit binding (D147): a loop variable as the ROOT of a
// member path binds through PuzzleModel.update(), so validation, store
// notification, and persistence all run exactly as a hand-written handler's would.
export default class RecordForm extends PuzzleView {
	data() {
		return { todos: this.ctx.store.findMany('todo') };
	}
}

import { ViewNode, listRows as __l } from '@magic-spells/puzzle';

const __L0 = { key: (todo) => ViewNode.keyOf(todo), ctrl: true, fields: ['completed', 'rank', 'text'] };

RecordForm.prototype.render = function () {
  const __d = this.getData();

  return new ViewNode('puzzle-view', { class: 'record-form' },
    __l(this, this, 0, __d.todos, (s) =>
      new ViewNode('div', {
        key: s.k,
        class: 'row',
      }, [
        new ViewNode('input', {
          class: 'text',
          value: s.item?.text,
          '@input:bind': this.__bind(s.item ?? 0, 'text', 'v'),
        }, []),
        new ViewNode('input', {
          class: 'done',
          type: 'checkbox',
          checked: s.item?.completed,
          '@change:bind': this.__bind(s.item ?? 0, 'completed', 'c'),
        }, []),
        new ViewNode('input', {
          class: 'rank',
          type: 'number',
          value: s.item?.rank,
          '@change:bind': this.__bind(s.item ?? 0, 'rank', 'vn'),
        }, []),
      ])
    , __L0)
  );
};
RecordForm.__pzlModule = 'RecordForm.pzl';
