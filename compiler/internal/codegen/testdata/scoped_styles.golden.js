
import { PuzzleView } from '@magic-spells/puzzle';

export default class Card extends PuzzleView {
  data() {
    return { title: 'Hi', body: 'Scoped.' };
  }
}

import { ViewNode, displayValue as __s } from '@magic-spells/puzzle';

Card.prototype.render = function () {
  const __d = this.getData();
  const __f = this.ctx.formatters.getAll();

  return new ViewNode('puzzle-view', {
    class: 'card',
    'data-pzl-97203688': true,
  }, [
    new ViewNode('h2', {}, [
      new ViewNode('text', { value: __s(__d.title, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'title' : 0) }),
    ]),
    new ViewNode('p', {}, [
      new ViewNode('text', { value: __s(__d.body, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'body' : 0) }),
    ]),
  ]);
};
Card.__pzlModule = 'scoped_styles.pzl';
