
import { PuzzleView } from '@magic-spells/puzzle';

// D173 V4 through the Object globals: a missing argument is `{}`, so the count
// is 0 instead of a TypeError — see tests/core-semantics.test.js.
export default class ObjectGlobals extends PuzzleView {
  data() {
    return {
      settings: undefined,
      user: null,
      filters: { a: 1, b: 2 },
      word: 'abc',
    };
  }
}

import { ViewNode, displayValue as __s } from '@magic-spells/puzzle';

ObjectGlobals.prototype.render = function () {
  const __d = this.getData();

  return new ViewNode('puzzle-view', { class: 'object-globals' }, [
    new ViewNode('p', { class: 'keys' }, [
      new ViewNode('text', { value: __s(Object.keys(__d.settings ?? {})?.length, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'Object.keys(settings).length' : 0) }),
    ]),
    new ViewNode('p', { class: 'values' }, [
      new ViewNode('text', { value: __s(Object.values(__d.settings ?? {})?.length, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'Object.values(settings).length' : 0) }),
    ]),
    new ViewNode('p', { class: 'entries' }, [
      new ViewNode('text', { value: __s(Object.entries(__d.user?.prefs ?? {})?.length, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'Object.entries(user.prefs).length' : 0) }),
    ]),
    new ViewNode('p', { class: 'present' }, [
      new ViewNode('text', { value: __s(Object.keys(__d.filters ?? {})?.join(','), typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'Object.keys(filters).join(\',\')' : 0) }),
    ]),
    new ViewNode('p', { class: 'string' }, [
      new ViewNode('text', { value: __s(Object.keys(__d.word ?? {})?.length, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'Object.keys(word).length' : 0) }),
    ]),
  ]);
};
ObjectGlobals.__pzlModule = 'ObjectGlobals.pzl';
