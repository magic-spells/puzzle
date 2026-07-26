
import { PuzzleView } from '@magic-spells/puzzle';

export default class Editor extends PuzzleView {
  data() {
    return { block: { text: '' }, blockClass: 'block' };
  }
  events = {
    onBackspace: (event) => {},
    onDelete: (event) => {},
    syncText: (event) => {},
  };
}

import { ViewNode, displayValue as __s } from '@magic-spells/puzzle';

Editor.prototype.render = function () {
  const __d = this.getData();
  const __f = this.ctx.formatters.getAll();

  return new ViewNode('puzzle-view', { class: 'editor' }, [
    new ViewNode('div', {
      contenteditable: 'true',
      island: true,
      class: __d.blockClass,
      '@keydown:backspace': ((this.__h ??= {})[0] ??= (event) => this.events.onBackspace(event)),
      '@keydown:delete': ((this.__h ??= {})[1] ??= (event) => this.events.onDelete(event)),
      '@input': ((this.__h ??= {})[2] ??= (event) => this.events.syncText(event)),
    }, [
      new ViewNode('text', { value: __s(__d.block.text, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'block.text' : 0) }),
    ]),
  ]);
};
Editor.__pzlModule = 'island.pzl';
