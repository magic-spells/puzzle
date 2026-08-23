
import { PuzzleView } from '@magic-spells/puzzle';

export default class Skeleton extends PuzzleView {
  async data(params) {
    const post = await this.ctx.store.findOne('post', params.id);
    return { post };
  }
}

import { ViewNode, displayValue as __s } from '@magic-spells/puzzle';

Skeleton.prototype.render = function () {
  const __d = this.getData();

  return new ViewNode('puzzle-view', { class: 'post-detail' }, [
    new ViewNode('h1', {}, [
      new ViewNode('text', { value: __s(__d.post.title, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'post.title' : 0) }),
    ]),
    new ViewNode('p', {}, [
      new ViewNode('text', { value: __s(__d.post.body, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'post.body' : 0) }),
    ]),
  ]);
};
Skeleton.__pzlModule = 'skeleton.pzl';

Skeleton.prototype.renderSkeleton = function () {
  const __d = this.getData();

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
