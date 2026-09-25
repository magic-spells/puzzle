
import { PuzzleView } from '@magic-spells/puzzle';
import Chip from './Chip.compiled.js';

// D173 group (b): every construct here is one the compiled output must render
// without throwing — see tests/core-semantics.test.js.
export default class CoreHost extends PuzzleView {
  data() {
    return {
      user: undefined,
      rows: undefined,
      price: 5,
      n: 3,
      unit: 'items',
      tags: [],
      status: 'open',
      one: 1,
      word: 'abc',
      missing: null,
      count: 2.7,
      profile: null,
    };
  }
}

import { ViewNode, displayValue as __s, listRows as __l, loopItems as __e, loopRange as __r } from '@magic-spells/puzzle';

const __L0 = { key: (ch) => ViewNode.keyOf(ch) };
const __L1 = { key: (m) => ViewNode.keyOf(m) };

CoreHost.prototype.render = function () {
  const __d = this.getData();
  const __f = this.ctx.formatters.getAll();

  return new ViewNode('puzzle-view', { class: 'core' }, [
    new ViewNode('p', { class: 'deep' }, [
      new ViewNode('text', { value: __s(__d.user?.profile?.name, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'user.profile.name' : 0) }),
    ]),
    new ViewNode('p', { class: 'index' }, [
      new ViewNode('text', { value: __s(__d.rows?.[0]?.label, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'rows[0].label' : 0) }),
    ]),
    new ViewNode('p', {
      class: 'title',
      title: (__f["money"] || __f.__missing("money"))(__d.price),
    }, [
      new ViewNode('text', { value: 't' }),
    ]),
    new ViewNode('p', { class: 'label' }, [
      new ViewNode('text', { value: __s((__f["t"] || __f.__missing("t"))('cart.count', { count: __d.n, unit: __d.unit }), typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? '\'cart.count\'' : 0) }),
    ]),
    new ViewNode('p', { class: 'nested' }, [
      new ViewNode('text', { value: __s((__f["echo"] || __f.__missing("echo"))('x', { outer: { inner: __d.n }, 'quoted-key': __d.unit }), typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? '\'x\'' : 0) }),
    ]),
    ...((__f["size"] || __f.__missing("size"))(__d.tags)
      ? [
          new ViewNode('p', { class: 'has-tags' }, [
            new ViewNode('text', { value: 'tags' }),
          ]),
        ]
      : [
          new ViewNode('p', { class: 'no-tags' }, [
            new ViewNode('text', { value: 'none' }),
          ]),
        ]),
    ...(!((__f["size"] || __f.__missing("size"))(__d.tags))
      ? [
          new ViewNode('p', { class: 'unless' }, [
            new ViewNode('text', { value: 'empty' }),
          ]),
        ]
      : [
          new ViewNode('#'),
        ]),
    ...(((__c) =>
      __c === ('OPEN')
        ? [
            new ViewNode('p', { class: 'case' }, [
              new ViewNode('text', { value: 'open' }),
            ]),
          ]
        : [
            new ViewNode('p', { class: 'case' }, [
              new ViewNode('text', { value: 'other' }),
            ]),
          ])((__f["upcase"] || __f.__missing("upcase"))(__d.status))),
    new ViewNode('p', { class: 'eq' }, [
      new ViewNode('text', { value: __s(__d.one == '1' ? 'loose' : 'strict', typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'one == \'1\' ? \'loose\' : \'strict\'' : 0) }),
    ]),
    new ViewNode('ul', { class: 'string-loop' },
      __l(this, this, 0, __d.word, (s) =>
        new ViewNode('li', { key: s.k }, [
          new ViewNode('text', { value: __s(s.item, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'ch' : 0) }),
        ])
      , __L0)
    ),
    new ViewNode('ul', { class: 'missing-loop' },
      __l(this, this, 1, __d.missing, (s) =>
        new ViewNode('li', { key: s.k }, [
          new ViewNode('text', { value: __s(s.item, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'm' : 0) }),
        ])
      , __L1)
    ),
    new ViewNode('ul', { class: 'range' },
      __r(1, __d.count).map((k) =>
        new ViewNode('li', { key: k }, [
          new ViewNode('text', { value: __s(k, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'k' : 0) }),
        ])
      )
    ),
    ...[1].map((__i) =>
      new ViewNode('div', {
        key: __i,
        class: 'mapped',
      },
        __e(__d.word).map((ch) =>
          new ViewNode('b', { key: ViewNode.keyOf(ch) }, [
            new ViewNode('text', { value: __s(ch, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'ch' : 0) }),
          ])
        )
      )
    ),
    new ViewNode(Chip, { tone: 'warm' }, []),
    new ViewNode('input', {
      class: 'missing-bind',
      value: __d.profile?.name,
      '@input:bind': this.__bind(__d.profile ?? 0, 'name', 'v'),
    }, []),
    new ViewNode('p', { class: 'prose' }, [
      new ViewNode('text', { value: 'tokens — ' }),
      new ViewNode('code', {}, [
        new ViewNode('text', { value: 'a' }),
      ]),
      new ViewNode('text', { value: ', ' }),
      new ViewNode('code', {}, [
        new ViewNode('text', { value: 'b' }),
      ]),
      new ViewNode('text', { value: ' and ' + __s(__d.unit, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'unit' : 0) + ' ' }),
      new ViewNode('b', {}, [
        new ViewNode('text', { value: __s(__d.n, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'n' : 0) }),
      ]),
    ]),
    (this.__c[0] ??= new ViewNode('div', { class: 'stack' }, [
      new ViewNode('button', {}, [
        new ViewNode('text', { value: 'One' }),
      ]),
      new ViewNode('button', {}, [
        new ViewNode('text', { value: 'Two' }),
      ]),
    ])),
    new ViewNode('pre', { class: 'pre' }, [
      new ViewNode('text', { value: '  indented\n    more ' + __s(__d.n, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'n' : 0) + '\n' }),
    ]),
    new ViewNode('textarea', { class: 'ta' }, [
      new ViewNode('text', { value: '  keep\n    this' }),
    ]),
  ]);
};
CoreHost.__pzlModule = 'CoreHost.pzl';
