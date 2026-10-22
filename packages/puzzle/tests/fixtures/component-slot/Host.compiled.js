
import { PuzzleView } from '@magic-spells/puzzle';
import Card from './Card.pzl';
import Panel from './Panel.pzl';
const cards = { card: Card, panel: Panel };
export default class Host extends PuzzleView {
  data(_params, props) { return { ...props, current: cards[props.type] }; }
  events = { close: (title) => this.props.onclose?.(title) };
}

import { ViewNode, displayValue as __s, dynamicComponent as __dc } from '@magic-spells/puzzle';

Host.prototype.render = function () {
  const __d = this.getData();

  return new ViewNode('puzzle-view', {}, [
    new ViewNode('div', { class: 'current' }, [
      __dc(__d.current, {
        ...(__d.extra),
        title: __d.title,
        close: ((this.__h ??= {})[0] ??= (event) => this.events.close(event)),
      }, [
        new ViewNode('b', {}, [
          new ViewNode('text', { value: 'slot ' + __s(__d.title, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'title' : 0) }),
        ]),
      ]),
    ]),
    new ViewNode('div', { class: 'mapped' }, [
      __dc(cards?.[__d.type], {
        ...(__d.extra),
        title: __d.title,
        close: ((this.__h ??= {})[1] ??= (event) => this.events.close(event)),
      }, [
        new ViewNode('b', {}, [
          new ViewNode('text', { value: 'map slot ' + __s(__d.title, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'title' : 0) }),
        ]),
      ]),
    ]),
    new ViewNode('div', { class: 'direct' }, [
      __dc(Card, { title: 'direct' }, []),
    ]),
    new ViewNode('input', { class: 'persistent' }, []),
  ]);
};
Host.__pzlModule = 'Host.pzl';
