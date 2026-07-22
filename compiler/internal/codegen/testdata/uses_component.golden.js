
import { PuzzleView } from '@magic-spells/puzzle';
import Card from '../components/Card.pzl';

export default class UsesComponent extends PuzzleView {
  data() {
    return { total: 0, payload: {} };
  }
  events = {
    handleClose: (event) => {},
    save: (payload) => {},
  };
}

import { ViewNode } from '@magic-spells/puzzle';

UsesComponent.prototype.render = function () {
  const __d = this.getData();
  const __f = this.ctx.formatters.getAll();

  return new ViewNode('puzzle-view', { class: 'page' }, [
    new ViewNode(Card, {
      title: 'Save',
      count: __d.total,
      close: ((this.__h ??= {})[0] ??= (event) => this.events.handleClose(event)),
      save: (event) => this.events.save(__d.payload),
    }, [
      new ViewNode('p', { class: 'body' }, [
        new ViewNode('text', { value: 'Card body' }),
      ]),
    ]),
  ]);
};
