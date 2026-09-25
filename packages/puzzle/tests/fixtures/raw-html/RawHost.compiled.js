
import { PuzzleView } from '@magic-spells/puzzle';

// D174 group (e): every placement of a live-HTML interpolation the reconciler
// has to keep in position — see tests/raw-html.test.js.
export default class RawHost extends PuzzleView {
  data() {
    return this.fixture;
  }
}

import { ViewNode, displayValue as __s, listRows as __l } from '@magic-spells/puzzle';

const __L0 = { key: (row) => ViewNode.keyOf(row), fields: ['html', 'label'] };
const __L1 = { key: (row) => ViewNode.keyOf(row), fields: ['label'] };

RawHost.prototype.render = function () {
  const __d = this.getData();
  const __f = this.ctx.formatters.getAll();

  return new ViewNode('puzzle-view', {}, [
    new ViewNode('div', { class: 'intro' }, [
      new ViewNode('#html', { value: __s(__d.intro, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'intro' : 0) }),
    ]),
    new ViewNode('p', { class: 'mix' }, [
      new ViewNode('text', { value: 'Before ' + __s(__d.lead, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'lead' : 0) + ' ' }),
      new ViewNode('#html', { value: __s((__f["truncate"] || __f.__missing("truncate"))(__d.body, 40), typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'body' : 0) }),
      new ViewNode('text', { value: ' after' }),
    ]),
    new ViewNode('p', { class: 'note' }, [
      new ViewNode('#html', { value: __s(__d.note, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'note' : 0), br: true }),
    ]),
    new ViewNode('div', { class: 'cond' }, [
      ...(__d.flag
        ? [
            new ViewNode('#html', { value: __s(__d.extra, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'extra' : 0) }),
          ]
        : [
            new ViewNode('text', { value: 'plain' }),
          ]),
      new ViewNode('text', { value: ' tail' }),
    ]),
    new ViewNode('ul', { class: 'rows' },
      __l(this, this, 0, __d.rows, (s) =>
        new ViewNode('li', { key: s.k }, [
          new ViewNode('text', { value: __s(s.item?.label, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'row.label' : 0) + ': ' }),
          new ViewNode('#html', { value: __s(s.item?.html, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'row.html' : 0) }),
        ])
      , __L0)
    ),
    new ViewNode('div', { class: 'keyed' }, [
      new ViewNode('#html', { value: __s(__d.header, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'header' : 0) }),
      ...__l(this, this, 1, __d.rows, (s) =>
        new ViewNode('span', { key: s.k }, [
          new ViewNode('text', { value: __s(s.item?.label, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'row.label' : 0) }),
        ])
      , __L1),
    ]),
  ]);
};
RawHost.__pzlModule = 'RawHost.pzl';
