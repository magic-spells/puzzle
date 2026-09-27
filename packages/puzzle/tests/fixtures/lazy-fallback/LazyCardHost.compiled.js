
import { PuzzleView } from '@magic-spells/puzzle';
import LazyCard from './LazyCard.compiled.js';

export default class LazyCardHost extends PuzzleView {
  created() {
    this.setData({ show: false, tips: [] });
  }
}

import { ViewNode } from '@magic-spells/puzzle';

LazyCardHost.prototype.render = function () {
  const __d = this.getData();

  return new ViewNode('puzzle-view', { class: 'lazy-card-host' }, [
    new ViewNode(LazyCard, {
      label: 'Default',
      tips: __d.tips,
    }, [
      new ViewNode('span', {
        slot: 'label',
        class: 'lazy-card-custom',
      }, [
        new ViewNode('text', { value: 'Custom' }),
      ]),
      ...(__d.show
        ? [
            new ViewNode('b', { class: 'lazy-card-shown' }, [
              new ViewNode('text', { value: 'shown' }),
            ]),
          ]
        : [
            new ViewNode('#'),
          ]),
    ]),
  ]);
};
LazyCardHost.__pzlModule = 'LazyCardHost.pzl';
