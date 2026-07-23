
import { PuzzleView } from '@magic-spells/puzzle';

export default class Card extends PuzzleView {
  data() {
    return { title: 'Hi', body: 'Scoped.' };
  }
}

import { ViewNode } from '@magic-spells/puzzle';

Card.prototype.render = function () {
  const __d = this.getData();
  const __f = this.ctx.formatters.getAll();

  return new ViewNode('puzzle-view', {
    class: 'card',
    'data-pzl-97203688': true,
  }, [
    new ViewNode('h2', {}, [
      new ViewNode('text', { value: String(__d.title) }),
    ]),
    new ViewNode('p', {}, [
      new ViewNode('text', { value: String(__d.body) }),
    ]),
  ]);
};
Card.__pzlModule = 'scoped_styles.pzl';
