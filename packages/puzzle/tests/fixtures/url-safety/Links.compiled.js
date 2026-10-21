import { PuzzleView } from '@magic-spells/puzzle';
export default class Links extends PuzzleView {
  data(params, props) {
    return props;
  }
}

import { ViewNode, displayValue as __s, urlValue as __u } from '@magic-spells/puzzle';

Links.prototype.render = function () {
  const __d = this.getData();

  return new ViewNode('div', {}, [
    new ViewNode('a', {
      class: 'dynamic',
      href: __u(__d.url),
    }, [
      new ViewNode('text', { value: 'Dynamic' }),
    ]),
    new ViewNode('a', {
      class: 'mixed',
      href: __u(`${__s(__d.url, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'url' : 0)}`),
    }, [
      new ViewNode('text', { value: 'Mixed' }),
    ]),
    new ViewNode('a', {
      class: 'static',
      href: 'javascript:author()',
    }, [
      new ViewNode('text', { value: 'Static' }),
    ]),
    new ViewNode('img', {
      src: __u(__d.url, 1),
      srcset: __u(__d.candidates, 3),
    }, []),
    new ViewNode('form', { action: __u(__d.url) }, [
      new ViewNode('button', { formaction: __u(__d.url) }, [
        new ViewNode('text', { value: 'Submit' }),
      ]),
    ]),
    new ViewNode('iframe', { src: __u(__d.url) }, []),
    new ViewNode('object', { data: __u(__d.url) }, []),
    new ViewNode('svg', {}, [
      new ViewNode('a', { 'xlink:href': __u(__d.url) }, [
        new ViewNode('text', {}, [
          new ViewNode('text', { value: 'Link' }),
        ]),
      ]),
    ]),
    new ViewNode('svg', { class: 'anim' }, [
      new ViewNode('a', {}, [
        new ViewNode('set', {
          attributeName: 'href',
          to: __u(__d.url),
        }, []),
        new ViewNode('animate', {
          attributeName: 'href',
          values: __u(__d.frames, 4),
        }, []),
      ]),
    ]),
    new ViewNode('p', { title: __d.url }, [
      new ViewNode('text', { value: 'Text' }),
    ]),
  ]);
};
Links.__pzlModule = 'Links.pzl';
