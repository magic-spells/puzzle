
import { PuzzleView } from '@magic-spells/puzzle';

export default class SkeletonMinDuration extends PuzzleView {
  async data(params) {
    const post = await this.ctx.store.findOne('post', params.id);
    return { post };
  }
}

import { ViewNode } from '@magic-spells/puzzle';

SkeletonMinDuration.prototype.render = function () {
  const __d = this.getData();
  const __f = this.ctx.formatters.getAll();

  return new ViewNode('puzzle-view', { class: 'post-detail' }, [
    new ViewNode('h1', {}, [
      new ViewNode('text', { value: String(__d.post.title) }),
    ]),
    new ViewNode('p', {}, [
      new ViewNode('text', { value: String(__d.post.body) }),
    ]),
  ]);
};

SkeletonMinDuration.prototype.renderSkeleton = function () {
  const __d = this.getData();
  const __f = this.ctx.formatters.getAll();

  return new ViewNode('puzzle-view', { class: 'post-detail' }, [
    new ViewNode('div', { class: 'animate-pulse' },
      Array.from({ length: (3) - (1) + 1 }, (_, __i) => (1) + __i).map((n) =>
        new ViewNode('div', {
          key: n,
          class: 'bg-skeleton h-4',
          'data-row': n,
        }, [])
      )
    ),
  ]);
};

SkeletonMinDuration.prototype.skeletonMinDuration = 300;
