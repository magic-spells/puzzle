
import Card from './Card.pzl';
const cards = { card: Card };
let current = Card;
export default class Slots extends Object {}

import { ViewNode, listRows as __l, dynamicComponent as __dc } from '@magic-spells/puzzle';

const __L0 = { key: (row) => ViewNode.keyOf(row), fields: ['props', 'title', 'type'] };
const __L1 = { key: (row) => row?.slug, fields: ['props'], volatile: true };
const __L2 = { key: (row) => ViewNode.keyOf(row), fields: ['props', 'title'] };

Slots.prototype.render = function () {
  const __d = this.getData();

  return new ViewNode('puzzle-view', {}, [
    ...__l(this, this, 0, __d.rows, (s) =>
      __dc(cards?.[s.item?.type], {
        ...(s.item?.props),
        title: s.item?.title,
        key: s.k,
      }, [])
    , __L0),
    ...__l(this, this, 1, __d.rows, (s) =>
      __dc(current, {
        ...(s.item?.props),
        key: s.k,
      }, [])
    , __L1),
    ...__l(this, this, 2, __d.rows, (s) =>
      new ViewNode(Card, {
        ...(s.item?.props),
        title: s.item?.title,
        key: s.k,
      }, [])
    , __L2),
  ]);
};
Slots.__pzlModule = 'component_slot_lists.pzl';
