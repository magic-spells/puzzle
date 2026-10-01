
import { PuzzleView } from '@magic-spells/puzzle';

// The VirtualList piece's row shape (puzzle-pieces registry/ui/virtual-list):
// an args-bearing marker inside a keyed, list-block-lowered {#for} whose
// fallback prints the whole item. `note` counts its fallback evaluations
// through the `probe` formatter the tests register.
//
// Those rows wrap each item in a fresh plain object, so the list block rebuilds
// them on every render. `names` loops over primitives instead — a clean row is
// handed back cached — and `probeName` counts that marker's fallback builds.
export default class LazyRows extends PuzzleView {
  data(params, props) {
    const items = Array.isArray(props.items) ? props.items : [];
    return {
      rows: items.map((item, index) => ({ item, index, key: item?.id ?? index })),
      names: Array.isArray(props.names) ? props.names : [],
    };
  }
}

import { ViewNode, SLOT_TAG, displayValue as __s, listRows as __l } from '@magic-spells/puzzle';

const __L0 = { key: (row) => row?.key, fields: ['index', 'item'] };
const __L1 = { key: (name) => name, deep: true };

LazyRows.prototype.render = function () {
  const __d = this.getData();
  const __f = this.ctx.formatters.getAll();

  return new ViewNode('div', { class: 'lazy-lists' }, [
    new ViewNode('ul', { class: 'lazy-rows' },
      __l(this, this, 0, __d.rows, (s) =>
        new ViewNode('li', { key: s.k }, [
          new ViewNode(SLOT_TAG, { name: 'row', args: { item: s.item?.item, index: s.item?.index }, fallback: () => [
            new ViewNode('text', { value: __s(s.item?.item, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'row.item' : 0) }),
          ] }),
          new ViewNode(SLOT_TAG, { name: 'note', args: { item: s.item?.item }, fallback: () => [
            new ViewNode('em', { class: 'lazy-note' }, [
              new ViewNode('text', { value: __s((__f["probe"] || __f.__missing("probe"))(s.item?.item), typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'probe(row.item)' : 0) }),
            ]),
          ] }),
        ])
      , __L0)
    ),
    new ViewNode('ol', { class: 'lazy-names' },
      __l(this, this, 1, __d.names, (s) =>
        new ViewNode('li', { key: s.k }, [
          new ViewNode(SLOT_TAG, { name: 'name', args: { value: s.item }, fallback: () => [
            new ViewNode('i', { class: 'lazy-name' }, [
              new ViewNode('text', { value: __s((__f["probeName"] || __f.__missing("probeName"))(s.item), typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'probeName(name)' : 0) }),
            ]),
          ] }),
        ])
      , __L1)
    ),
  ]);
};
LazyRows.__pzlModule = 'LazyRows.pzl';
