
import { PuzzleView } from '@magic-spells/puzzle';

// Argument-free markers, so plain call-site content fills them. `label`'s
// fallback counts its evaluations through `probe`; the default marker's
// fallback is a loop that builds NOTHING when `tips` is empty, and the input
// after it is the sibling whose identity must survive a toggling call-site
// {#if} (a fallback that builds nothing keeps the marker's arity constant).
export default class LazyCard extends PuzzleView {
  data(params, props) {
    return { label: props.label, tips: Array.isArray(props.tips) ? props.tips : [] };
  }
}

import { ViewNode, SLOT_TAG, displayValue as __s, listRows as __l } from '@magic-spells/puzzle';

const __L0 = { key: (tip) => ViewNode.keyOf(tip) };

LazyCard.prototype.render = function () {
  const __d = this.getData();
  const __f = this.ctx.formatters.getAll();

  return new ViewNode('div', { class: 'lazy-card' }, [
    new ViewNode('h3', {}, [
      new ViewNode(SLOT_TAG, { name: 'label', fallback: () => [
        new ViewNode('em', { class: 'lazy-card-fallback' }, [
          new ViewNode('text', { value: __s((__f["probe"] || __f.__missing("probe"))(__d.label), typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'label' : 0) }),
        ]),
      ] }),
    ]),
    new ViewNode(SLOT_TAG, { fallback: () => [
      ...__l(this, this, 0, __d.tips, (s) =>
        new ViewNode('i', {
          key: s.k,
          class: 'lazy-tip',
        }, [
          new ViewNode('text', { value: __s(s.item, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'tip' : 0) }),
        ])
      , __L0),
    ] }),
    new ViewNode('input', { class: 'lazy-card-input' }, []),
  ]);
};
LazyCard.__pzlModule = 'LazyCard.pzl';
