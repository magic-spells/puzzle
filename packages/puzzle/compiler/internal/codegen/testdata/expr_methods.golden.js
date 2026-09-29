
import { PuzzleView } from '@magic-spells/puzzle';

export default class ExprMethods extends PuzzleView {
  data() {
    return { title: '', name: '', tags: [], filters: {}, price: 0, stock: 0, held: 0, user: {}, items: [] };
  }
}

import { ViewNode, displayValue as __s, listRows as __l } from '@magic-spells/puzzle';

const __L0 = { key: (item) => ViewNode.keyOf(item), counter: true, fields: ['qty'], deep: true };

ExprMethods.prototype.render = function () {
  const __d = this.getData();
  const __f = this.ctx.formatters.getAll();

  return new ViewNode('puzzle-view', { class: 'methods' }, [
    new ViewNode('h1', { title: __d.title?.trim() }, [
      new ViewNode('text', { value: __s(__d.title?.trim()?.toUpperCase(), typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'title.trim().toUpperCase()' : 0) }),
    ]),
    new ViewNode('p', { class: 'slug' }, [
      new ViewNode('text', { value: __s(__d.name?.toLowerCase()?.replaceAll(' ', '-')?.padStart(12, '.'), typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'name.toLowerCase().replaceAll(\' \', \'-\').padStart(12, \'.\')' : 0) }),
    ]),
    new ViewNode('p', { class: 'initial' }, [
      new ViewNode('text', { value: __s(__d.name?.at(0) ?? '?', typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'name.at(0) ?? \'?\'' : 0) }),
    ]),
    new ViewNode('p', { class: 'tags' }, [
      new ViewNode('text', { value: __s(__d.tags?.toSorted()?.join(', '), typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'tags.toSorted().join(\', \')' : 0) }),
    ]),
    new ViewNode('p', { class: 'count' }, [
      new ViewNode('text', { value: __s(__d.tags?.length, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'tags.length' : 0) + ' of ' + __s(Object.keys(__d.filters)?.length, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'Object.keys(filters).length' : 0) }),
    ]),
    new ViewNode('p', { class: 'price' }, [
      new ViewNode('text', { value: __s((__d.price * 1.2)?.toFixed(2), typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? '(price * 1.2).toFixed(2)' : 0) + ' / ' + __s(Math.round(__d.price), typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'Math.round(price)' : 0) + ' / ' + __s(Math.max(0, __d.stock - __d.held), typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'Math.max(0, stock - held)' : 0) }),
    ]),
    new ViewNode('p', { class: 'city' }, [
      new ViewNode('text', { value: __s(__d.user?.address?.city ?? 'unknown', typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'user?.address?.city ?? \'unknown\'' : 0) }),
    ]),
    new ViewNode('p', { class: 'greeting' }, [
      new ViewNode('text', { value: __s(`Hello, ${__d.user?.name ?? 'friend'}!`, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? '`Hello, ${ user.name ?? \'friend\' }!`' : 0) }),
    ]),
    new ViewNode('p', { class: 'edges' }, [
      new ViewNode('text', { value: __s(NaN, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'NaN' : 0) + ' ' + __s(Infinity, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'Infinity' : 0) + ' ' + __s(-Infinity, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? '-Infinity' : 0) + ' ' + __s(undefined, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'undefined' : 0) }),
    ]),
    new ViewNode('p', { class: 'total' }, [
      new ViewNode('text', { value: __s(__d.items?.reduce((sum, item) => sum + item?.price * item?.qty, 0), typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'items.reduce((sum, item) => sum + item.price * item.qty, 0)' : 0) }),
    ]),
    new ViewNode('p', { class: 'any' }, [
      new ViewNode('text', { value: __s(__d.items?.some((item) => item?.done) ? 'some done' : 'none done', typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'items.some(item => item.done) ? \'some done\' : \'none done\'' : 0) }),
    ]),
    new ViewNode('p', { class: 'first' }, [
      new ViewNode('text', { value: __s(__d.items?.find((item) => item?.qty > 1)?.name, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'items.find(item => item.qty > 1)?.name' : 0) }),
    ]),
    new ViewNode('p', { class: 'label' }, [
      new ViewNode('text', { value: __s((__f["currency"] || __f.__missing("currency"))(__d.price, '$'), typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'currency(price, \'$\')' : 0) + ' ' + __s((__f["truncate"] || __f.__missing("truncate"))((__f["capitalize"] || __f.__missing("capitalize"))(__d.title), 20), typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'truncate(capitalize(title), 20)' : 0) }),
    ]),
    ...(__d.items?.filter((item) => !item?.done)?.length > 0
      ? [
          new ViewNode('ul', {},
            __l(this, this, 0, __d.items?.filter((item) => !item?.done), (s) =>
              new ViewNode('li', {
                key: s.k,
                class: 'row',
              }, [
                new ViewNode('text', { value: __s(s.i + 1, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'i + 1' : 0) + '. ' + __s(s.item?.name?.trim(), typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'item.name.trim()' : 0) + ' — ' + __s(s.item?.tags?.map((tag) => tag?.toUpperCase())?.join('/'), typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'item.tags.map(tag => tag.toUpperCase()).join(\'/\')' : 0) + ' ' + __s(s.item?.qty, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'item.qty' : 0) }),
              ])
            , __L0)
          ),
        ]
      : [
          new ViewNode('#'),
        ]),
  ]);
};
ExprMethods.__pzlModule = 'expr_methods.pzl';
