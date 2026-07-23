
import { PuzzleView } from '@magic-spells/puzzle';

export default class EventMods extends PuzzleView {
  data() {
    return {};
  }
  events = {
    addTodo: (event) => {},
    submit: (event) => {},
    cancel: (event) => {},
    handleOnce: (event) => {},
    plain: (event) => {},
    closePanel: (event) => {},
  };
}

import { ViewNode } from '@magic-spells/puzzle';

EventMods.prototype.render = function () {
  const __d = this.getData();
  const __f = this.ctx.formatters.getAll();

  return new ViewNode('puzzle-view', { class: 'evt-mods' }, [
    new ViewNode('form', { '@submit:prevent': ((this.__h ??= {})[0] ??= (event) => this.events.addTodo(event)) }, [
      new ViewNode('input', {
        '@keydown:enter': ((this.__h ??= {})[1] ??= (event) => this.events.submit(event)),
        '@keydown:escape:prevent': ((this.__h ??= {})[2] ??= (event) => this.events.cancel(event)),
      }, []),
    ]),
    new ViewNode('button', {
      '@click:stop:once': ((this.__h ??= {})[3] ??= (event) => this.events.handleOnce(event)),
    }, [
      new ViewNode('text', { value: 'Once' }),
    ]),
    new ViewNode('button', { '@click': ((this.__h ??= {})[4] ??= (event) => this.events.plain(event)) }, [
      new ViewNode('text', { value: 'Plain' }),
    ]),
    new ViewNode('div', {
      class: 'panel',
      '@click:outside': ((this.__h ??= {})[5] ??= (event) => this.events.closePanel(event)),
      '@click': ((this.__h ??= {})[6] ??= (event) => this.events.plain(event)),
    }, [
      new ViewNode('text', { value: 'Panel' }),
    ]),
  ]);
};
EventMods.__pzlModule = 'event_modifiers.pzl';
