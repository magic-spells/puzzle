
import { PuzzleView } from '@magic-spells/puzzle';
import Wrapper from './Wrapper.compiled.js';

export default class WrapperChain extends PuzzleView {
  data(params, props) {
    return { users: props.users, group: props.group };
  }
}

import { ViewNode, SLOT_TAG } from '@magic-spells/puzzle';

WrapperChain.prototype.render = function () {
  const __d = this.getData();

  return new ViewNode('div', { class: 'snippet-wrapper-chain' }, [
    new ViewNode(Wrapper, {
      users: __d.users,
      group: __d.group,
    }, [
      new ViewNode(SLOT_TAG),
    ]),
  ]);
};
WrapperChain.__pzlModule = 'WrapperChain.pzl';
