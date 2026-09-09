
import { PuzzleView } from '@magic-spells/puzzle';

// The primitive-root degradation of implicit binding (D147). `title` is a STRING,
// so `title.length` is a one-way display binding — but it is a one-member path,
// which is exactly the shape the compiler synthesizes a bind for, and no
// compile-time type tells the two apart. The runtime resolves the root at render,
// finds a primitive, and falls back to the shared inert handler.
export default class PrimitiveForm extends PuzzleView {
	data() {
		return { title: 'wash' };
	}
}

import { ViewNode, displayValue as __s } from '@magic-spells/puzzle';

PrimitiveForm.prototype.render = function () {
  const __d = this.getData();

  return new ViewNode('puzzle-view', { class: 'primitive-form' }, [
    new ViewNode('input', {
      class: 'len',
      type: 'number',
      value: __d.title.length,
      '@change:bind': this.__bind(__d.title, 'length', 'vn'),
    }, []),
    new ViewNode('p', { class: 'title' }, [
      new ViewNode('text', { value: __s(__d.title, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'title' : 0) }),
    ]),
  ]);
};
PrimitiveForm.__pzlModule = 'PrimitiveForm.pzl';
