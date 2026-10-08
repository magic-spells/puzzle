
import { PuzzleView } from '@magic-spells/puzzle';
import TaskCard from './TaskCard.pzl';
import BacktestCard from './BacktestCard.pzl';
import Card from './Card.pzl';
const embeds = { task: TaskCard, backtest: BacktestCard };
export default class Slots extends PuzzleView {
  events = { close: () => {} };
}

import { ViewNode, displayValue as __s, dynamicComponent as __dc } from '@magic-spells/puzzle';

Slots.prototype.render = function () {
  const __d = this.getData();

  return new ViewNode('puzzle-view', {}, [
    new ViewNode('div', {}, [
      __dc(TaskCard, {
        title: __d.title,
        close: ((this.__h ??= {})[0] ??= (event) => this.events.close(event)),
        ...(__d.extra),
      }, [
        new ViewNode('p', {}, [
          new ViewNode('text', { value: 'Default slot: ' + __s(__d.caption, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'caption' : 0) }),
        ]),
      ]),
      __dc(__d.current, { ...(__d.embed?.props) }, []),
      __dc(embeds?.[__d.embed?.type], {
        name: __d.embed?.type,
        from: __d.origin,
        ...(__d.embed?.props),
        title: __d.title,
      }, [
        new ViewNode('p', {}, [
          new ViewNode('text', { value: 'Selected ' + __s(__d.embed?.type, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'embed.type' : 0) }),
        ]),
        __dc(TaskCard, {}, []),
      ]),
      __dc(embeds?.['task'], {}, []),
      new ViewNode(Card, {
        ...(__d.extra),
        title: __d.title,
      }, []),
    ]),
  ]);
};
Slots.__pzlModule = 'component_slot.pzl';
