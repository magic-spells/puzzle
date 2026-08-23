
import { PuzzleView } from '@magic-spells/puzzle';

// Hazard #4 of implicit binding (D147), both arms of it in one view.
//
// `title` is the CLOBBER: a bare identifier binds to the LOCAL layer, but data()
// derives the same key from a record, and #recompose composes { ...local,
// ...model } with the model last — so every commit reverts what the user typed.
// The dev-only diagnostic must name that key.
//
// `note` is the legitimate ECHO idiom (examples/static-docs Playground): data()
// re-reads its own bound local through getData() and returns it unchanged. The
// key IS in the model layer, so a naive `key in model` check would false-positive
// here; comparing against the value data() actually committed keeps it silent.
export default class ClobberForm extends PuzzleView {
	created() {
		this.setData({ note: '' });
	}

	data() {
		const todo = this.ctx.store.findOne('todo', '1');
		return { title: todo.text, rank: todo.rank, note: this.getData().note ?? '' };
	}
}

import { ViewNode, displayValue as __s } from '@magic-spells/puzzle';

ClobberForm.prototype.render = function () {
  const __d = this.getData();

  return new ViewNode('puzzle-view', { class: 'clobber-form' }, [
    new ViewNode('input', {
      class: 'title',
      value: __d.title,
      '@input:bind': this.__bind(null, 'title', 'v'),
    }, []),
    new ViewNode('input', {
      class: 'note',
      value: __d.note,
      '@input:bind': this.__bind(null, 'note', 'v'),
    }, []),
    new ViewNode('p', { class: 'rank' }, [
      new ViewNode('text', { value: __s(__d.rank, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'rank' : 0) }),
    ]),
  ]);
};
ClobberForm.__pzlModule = 'ClobberForm.pzl';
