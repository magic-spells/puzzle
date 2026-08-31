
import { PuzzleView } from '@magic-spells/puzzle';
import Frame from '../components/Frame';

export default class ComponentFamily extends PuzzleView {
  data(params, props) {
    return {
      title: props.title || 'Frame',
      body: props.body || ''
    };
  }
}

import { ViewNode, displayValue as __s } from '@magic-spells/puzzle';

ComponentFamily.prototype.render = function () {
  const __d = this.getData();

  return new ViewNode('puzzle-view', { class: 'page' }, [
    new ViewNode(Frame, { title: __d.title }, [
      new ViewNode(Frame.Wrapper, { tone: 'quiet' }, [
        new ViewNode(Frame.Content, {}, [
          new ViewNode('text', { value: __s(__d.body, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'body' : 0) }),
        ]),
      ]),
    ]),
  ]);
};
ComponentFamily.__pzlModule = 'component_family.pzl';
