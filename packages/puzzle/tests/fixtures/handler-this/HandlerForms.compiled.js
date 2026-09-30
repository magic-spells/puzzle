
import { PuzzleView } from '@magic-spells/puzzle';

// Every way to write an `events` handler — see tests/handler-this.test.js. The
// runtime calls each as this.events.name(…), so only the arrows see the view.
export default class HandlerForms extends PuzzleView {
  created() {
    this.setData('count', 0);
  }

  events = {
    // Method shorthand using `this`: it is the events object here.
    play() {
      this.played = true;
    },
    // A `function` expression: the same trap.
    legacy: function () {
      this.legacyRan = true;
    },
    // Async method shorthand.
    async load() {
      await null;
      this.loaded = true;
    },
    // Shorthand that never touches the view works; a string saying so is not a use.
    reset() {
      return 'this is fine';
    },
    // Arrows close over the view — the correct form.
    bump: () => {
      this.setData('count', this.getData().count + 1);
    },
    save: async () => {
      await null;
      this.setData('saved', true);
    },
  };
}

import { ViewNode, displayValue as __s } from '@magic-spells/puzzle';

HandlerForms.prototype.render = function () {
  const __d = this.getData();

  return new ViewNode('puzzle-view', {}, [
    new ViewNode('button', {
      class: 'play',
      '@click': ((this.__h ??= {})[0] ??= (event) => this.events.play(event)),
    }, [
      new ViewNode('text', { value: 'play' }),
    ]),
    new ViewNode('button', {
      class: 'legacy',
      '@click': ((this.__h ??= {})[1] ??= (event) => this.events.legacy(event)),
    }, [
      new ViewNode('text', { value: 'legacy' }),
    ]),
    new ViewNode('button', {
      class: 'load',
      '@click': ((this.__h ??= {})[2] ??= (event) => this.events.load(event)),
    }, [
      new ViewNode('text', { value: 'load' }),
    ]),
    new ViewNode('button', {
      class: 'reset',
      '@click': ((this.__h ??= {})[3] ??= (event) => this.events.reset(event)),
    }, [
      new ViewNode('text', { value: 'reset' }),
    ]),
    new ViewNode('button', {
      class: 'bump',
      '@click': ((this.__h ??= {})[4] ??= (event) => this.events.bump(event)),
    }, [
      new ViewNode('text', { value: __s(__d.count, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'count' : 0) }),
    ]),
    new ViewNode('button', {
      class: 'save',
      '@click': ((this.__h ??= {})[5] ??= (event) => this.events.save(event)),
    }, [
      new ViewNode('text', { value: 'save' }),
    ]),
  ]);
};
HandlerForms.__pzlModule = 'HandlerForms.pzl';
