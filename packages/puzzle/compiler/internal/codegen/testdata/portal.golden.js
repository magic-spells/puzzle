
import { PuzzleView } from '@magic-spells/puzzle';
import NowPlaying from './NowPlaying.pzl';

export default class PortalHost extends PuzzleView {
  events = {
    open: () => {},
    close: () => {},
  };

  data() {
    return { showing: true, title: 'Now Playing', song: null };
  }
}

import { ViewNode, PORTAL_TAG, displayValue as __s } from '@magic-spells/puzzle';

PortalHost.prototype.render = function () {
  const __d = this.getData();

  return new ViewNode('puzzle-view', { class: 'portal-host' }, [
    new ViewNode('button', { '@click': ((this.__h ??= {})[0] ??= (event) => this.events.open(event)) }, [
      new ViewNode('text', { value: 'Open' }),
    ]),
    ...(__d.showing
      ? [
          new ViewNode(PORTAL_TAG, {}, [
            new ViewNode('div', {
              class: 'pzl-overlay',
              '@click:outside': ((this.__h ??= {})[1] ??= (event) => this.events.close(event)),
            }, [
              new ViewNode('h2', {}, [
                new ViewNode('text', { value: __s(__d.title, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'title' : 0) }),
              ]),
              new ViewNode(NowPlaying, { song: __d.song }, []),
            ]),
          ]),
        ]
      : [
          new ViewNode('#'),
        ]),
  ]);
};
PortalHost.__pzlModule = 'portal.pzl';
