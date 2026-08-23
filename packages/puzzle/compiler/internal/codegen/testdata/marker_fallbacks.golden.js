
import { PuzzleView } from '@magic-spells/puzzle';
import Badge from './Badge.pzl';

export default class MarkerFallbacks extends PuzzleView {
  events = {
    activate: () => {},
  };

  data() {
    return { n: 42, show: true, label: 'New' };
  }
}

import { ViewNode, SLOT_TAG, displayValue as __s } from '@magic-spells/puzzle';

MarkerFallbacks.prototype.render = function () {
  const __d = this.getData();
  const __f = this.ctx.formatters.getAll();

  return new ViewNode('puzzle-view', { class: 'fallbacks' }, [
    new ViewNode(SLOT_TAG, {}, [
      new ViewNode('p', { class: 'pzl-test-fallback' }, [
        new ViewNode('text', { value: __s((__f["number"] || __f.__missing("number"))(__d.n), typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'n' : 0) }),
      ]),
    ]),
    new ViewNode(SLOT_TAG, { name: 'control' }, [
      ...(__d.show
        ? [
            new ViewNode('button', {
              ref: this.__ref("fallbackButton"),
              '@click': ((this.__h ??= {})[0] ??= (event) => this.events.activate(event)),
            }, [
              new ViewNode('text', { value: 'Ready' }),
            ]),
          ]
        : [
            new ViewNode('span', {}, [
              new ViewNode('text', { value: 'Waiting' }),
            ]),
          ]),
    ]),
    new ViewNode(SLOT_TAG, { name: 'component' }, [
      new ViewNode(Badge, { label: __d.label }, []),
    ]),
    new ViewNode(SLOT_TAG, { name: 'icon' }, [
      new ViewNode('svg', {
        xmlns: 'http://www.w3.org/2000/svg',
        viewBox: '0 0 24 24',
        fill: 'currentColor',
      }, '<path d="M12 21l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.18L12 21z"/>'),
    ]),
    new ViewNode(SLOT_TAG, { name: 'empty' }),
  ]);
};
MarkerFallbacks.__pzlModule = 'marker_fallbacks.pzl';
