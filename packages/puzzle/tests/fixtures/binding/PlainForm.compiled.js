
import { PuzzleView } from '@magic-spells/puzzle';

// The plain-object arm of implicit binding (D147), plus the duck-type negative:
// `ducky` owns an update() method but no string _type, so it is NOT a record and
// must be mutated directly rather than routed through update().
export default class PlainForm extends PuzzleView {
	created() {
		this.profile = { hue: 'red', size: 3 };
		this.ducky = {
			label: 'quack',
			update() {
				this.updateCalls = (this.updateCalls ?? 0) + 1;
			},
		};
	}

	data() {
		return { profile: this.profile, ducky: this.ducky };
	}
}

import { ViewNode } from '@magic-spells/puzzle';

PlainForm.prototype.render = function () {
  const __d = this.getData();

  return new ViewNode('puzzle-view', { class: 'plain-form' }, [
    new ViewNode('input', {
      class: 'hue',
      value: __d.profile.hue,
      '@input:bind': this.__bind(__d.profile, 'hue', 'v'),
    }, []),
    new ViewNode('input', {
      class: 'size',
      type: 'number',
      value: __d.profile.size,
      '@change:bind': this.__bind(__d.profile, 'size', 'vn'),
    }, []),
    new ViewNode('input', {
      class: 'ducky',
      value: __d.ducky.label,
      '@input:bind': this.__bind(__d.ducky, 'label', 'v'),
    }, []),
  ]);
};
PlainForm.__pzlModule = 'PlainForm.pzl';
