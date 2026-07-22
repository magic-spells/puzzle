
import { PuzzleView } from '@magic-spells/puzzle';

export default class DefaultLayout extends PuzzleView {
  created() {
    this.setData({
      version: '1.0.0'
    });
  }

  data(params, props) {
    return {
      title: props.title || 'Puzzle Todos',
      showVersion: true
    };
  }

  // Layout-level event handlers
  events = {
    headerClick: () => {
      console.log('Header clicked!');
    }
  };
}

import { ViewNode, SLOT_TAG } from '@magic-spells/puzzle';

DefaultLayout.prototype.render = function () {
  const __d = this.getData();
  const __f = this.ctx.formatters.getAll();

  return new ViewNode('puzzle-view', { class: 'relative min-h-screen flex flex-col bg-ink text-fg' }, [
    new ViewNode('div', { class: 'app-glow pointer-events-none absolute inset-x-0 top-0 h-[440px]' }, []),
    new ViewNode('header', { class: 'relative pt-16 pb-10' }, [
      new ViewNode('div', { class: 'max-w-xl mx-auto px-6 text-center' }, [
        new ViewNode('div', { class: 'flex items-center justify-center gap-3 mb-4' }, [
          new ViewNode('span', { class: 'h-px w-8 bg-hairline' }, []),
          new ViewNode('span', { class: 'font-mono text-[11px] uppercase tracking-[0.4em] text-faint' }, [
            new ViewNode('text', { value: 'Puzzle' }),
          ]),
          new ViewNode('span', { class: 'h-px w-8 bg-hairline' }, []),
        ]),
        new ViewNode('h1', { class: 'font-display text-6xl md:text-7xl leading-none text-fg' }, [
          new ViewNode('text', { value: 'Todos' }),
        ]),
        new ViewNode('p', { class: 'mt-4 text-sm text-muted' }, [
          new ViewNode('text', { value: 'A quiet place to keep your list.' }),
        ]),
      ]),
    ]),
    new ViewNode('main', { class: 'relative flex-1 pb-16' }, [
      new ViewNode('div', { class: 'max-w-xl mx-auto px-6' }, [
        new ViewNode(SLOT_TAG),
      ]),
    ]),
    new ViewNode('footer', { class: 'relative py-8 border-t border-line' }, [
      new ViewNode('div', { class: 'max-w-xl mx-auto px-6' }, [
        new ViewNode('p', { class: 'text-center font-mono text-[11px] tracking-[0.15em] text-faint' }, [
          new ViewNode('text', { value: 'built with the puzzle framework' }),
        ]),
      ]),
    ]),
  ]);
};
