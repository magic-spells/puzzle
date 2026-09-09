
import { PuzzleView } from '@magic-spells/puzzle';

const WORDS = ['alpha', 'beta', 'gamma', 'delta'];

// The local-state arm of implicit binding (D147). `draft` lives ONLY in the local
// layer (seeded in created(), written by the synthesized bind handler); data()
// derives `matches` from it, which is the search-box case the bind write's
// refresh() must keep live.
export default class LocalForm extends PuzzleView {
	created() {
		this.setData({
			draft: '',
			age: null,
			volume: 0,
			agree: false,
			notes: '',
			sort: 'all',
		});
	}

	data() {
		const draft = this.getData().draft ?? '';
		return { matches: WORDS.filter((word) => word.includes(draft)).length };
	}
}

import { ViewNode, displayValue as __s } from '@magic-spells/puzzle';

LocalForm.prototype.render = function () {
  const __d = this.getData();

  return new ViewNode('puzzle-view', { class: 'local-form' }, [
    new ViewNode('input', {
      class: 'draft',
      value: __d.draft,
      '@input:bind': this.__bind(null, 'draft', 'v'),
    }, []),
    new ViewNode('input', {
      class: 'age',
      type: 'number',
      value: __d.age,
      '@change:bind': this.__bind(null, 'age', 'vn'),
    }, []),
    new ViewNode('input', {
      class: 'volume',
      type: 'range',
      value: __d.volume,
      '@input:bind': this.__bind(null, 'volume', 'vn'),
    }, []),
    new ViewNode('input', {
      class: 'agree',
      type: 'checkbox',
      checked: __d.agree,
      '@change:bind': this.__bind(null, 'agree', 'c'),
    }, []),
    new ViewNode('textarea', {
      class: 'notes',
      value: __d.notes,
      '@input:bind': this.__bind(null, 'notes', 'v'),
    }, []),
    new ViewNode('select', {
      class: 'sort',
      value: __d.sort,
      '@change:bind': this.__bind(null, 'sort', 'v'),
    }, [
      new ViewNode('option', { value: 'all' }, [
        new ViewNode('text', { value: 'All' }),
      ]),
      new ViewNode('option', { value: 'done' }, [
        new ViewNode('text', { value: 'Done' }),
      ]),
    ]),
    new ViewNode('p', { class: 'matches' }, [
      new ViewNode('text', { value: __s(__d.matches, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'matches' : 0) }),
    ]),
  ]);
};
LocalForm.__pzlModule = 'LocalForm.pzl';
