
import { PuzzleView } from '@magic-spells/puzzle';

export default class Events extends PuzzleView {
  data() {
    return {};
  }
  events = {
    clear: (event) => {},
    setFilter: (f) => {},
    addTodo: (event) => {},
    update: (event) => {},
  };
}

import { ViewNode } from '@magic-spells/puzzle';

Events.prototype.render = function () {
  const __d = this.getData();
  const __f = this.ctx.formatters.getAll();

  return new ViewNode('puzzle-view', { class: 'evt' }, [
    new ViewNode('button', { '@click': ((this.__h ??= {})[0] ??= (event) => this.events.clear(event)) }, [
      new ViewNode('text', { value: 'Clear' }),
    ]),
    new ViewNode('button', { '@click': ((this.__h ??= {})[1] ??= (event) => this.events.setFilter('all')) }, [
      new ViewNode('text', { value: 'All' }),
    ]),
    new ViewNode('form', { '@submit': ((this.__h ??= {})[2] ??= (event) => this.events.addTodo(event)) }, [
      new ViewNode('input', { '@input': ((this.__h ??= {})[3] ??= (event) => this.events.update(event)) }, []),
    ]),
  ]);
};
Events.__pzlModule = 'events.pzl';
