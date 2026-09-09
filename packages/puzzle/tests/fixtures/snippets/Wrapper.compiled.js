
import { PuzzleView } from '@magic-spells/puzzle';
import SnippetList from './SnippetList.compiled.js';

export default class Wrapper extends PuzzleView {
  data(params, props) {
    return { users: props.users, group: props.group };
  }
}

import { ViewNode, SLOT_TAG } from '@magic-spells/puzzle';

Wrapper.prototype.render = function () {
  const __d = this.getData();

  return new ViewNode('div', { class: 'snippet-wrapper' }, [
    new ViewNode(SnippetList, {
      users: __d.users,
      group: __d.group,
    }, [
      new ViewNode(SLOT_TAG),
    ]),
  ]);
};
Wrapper.__pzlModule = 'Wrapper.pzl';
