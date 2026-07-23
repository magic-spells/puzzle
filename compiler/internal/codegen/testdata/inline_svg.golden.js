
import { PuzzleView } from '@magic-spells/puzzle';

export default class InlineSvg extends PuzzleView {
  data() {
    return { items: [] };
  }
}

import { ViewNode } from '@magic-spells/puzzle';

InlineSvg.prototype.render = function () {
  const __d = this.getData();
  const __f = this.ctx.formatters.getAll();

  return new ViewNode('puzzle-view', { class: 'icons' }, [
    new ViewNode('span', { class: 'inline-block size-5' }, [
      new ViewNode('svg', {
        xmlns: 'http://www.w3.org/2000/svg',
        viewBox: '0 0 24 24',
        fill: 'currentColor',
      }, '<path d="M12 21l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.18L12 21z"/>'),
    ]),
    ...__d.items.map((item) =>
      new ViewNode('li', { key: ViewNode.keyOf(item) }, [
        new ViewNode('svg', {
          xmlns: 'http://www.w3.org/2000/svg',
          viewBox: '0 0 24 24',
          fill: 'currentColor',
        }, '<path d="M12 21l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.18L12 21z"/>'),
      ])
    ),
  ]);
};
InlineSvg.__pzlModule = 'inline_svg.pzl';

InlineSvg.prototype.renderSkeleton = function () {
  const __d = this.getData();
  const __f = this.ctx.formatters.getAll();

  return new ViewNode('puzzle-view', { class: 'icons' }, [
    new ViewNode('div', { class: 'animate-pulse' }, [
      new ViewNode('svg', {
        xmlns: 'http://www.w3.org/2000/svg',
        viewBox: '0 0 24 24',
        fill: 'currentColor',
      }, '<path d="M12 21l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.18L12 21z"/>'),
    ]),
  ]);
};
