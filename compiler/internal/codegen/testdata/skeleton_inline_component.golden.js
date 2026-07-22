
import { PuzzleView } from '@magic-spells/puzzle';

export default class SkeletonInlineComponent extends PuzzleView {
  async data(params, props) {
    const user = await this.ctx.store.findOne('user', props.userId);
    return { user };
  }
}

import { ViewNode } from '@magic-spells/puzzle';

SkeletonInlineComponent.prototype.render = function () {
  const __d = this.getData();
  const __f = this.ctx.formatters.getAll();

  return new ViewNode('div', { class: 'user-card' }, [
    new ViewNode('h2', {}, [
      new ViewNode('text', { value: String(__d.user.name) }),
    ]),
  ]);
};

SkeletonInlineComponent.prototype.renderSkeleton = function () {
  const __d = this.getData();
  const __f = this.ctx.formatters.getAll();

  return new ViewNode('div', { class: 'user-card is-loading' }, [
    new ViewNode('h2', { class: 'bg-skeleton h-5' }, []),
  ]);
};
