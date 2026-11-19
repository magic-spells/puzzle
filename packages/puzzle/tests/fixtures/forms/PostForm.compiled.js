
import { PuzzleView } from '@magic-spells/puzzle';
import { createForm } from '@magic-spells/puzzle/forms';
import Field from './Field.pzl';

// the forms module (d192) end to end: a raw input bound through the deep
// d147 path, the field piece wired by form + name, one focusout handler that
// touches whichever field was left, and a submit whose callback the test owns.
export default class PostForm extends PuzzleView {
  created() {
    this.form = createForm(this, this.props.Model, { from: this.props.post, fields: ['title', 'body'] });
  }

  events = {
    save: (event) => {
      this.pending = this.form.submit(event, (values) => this.props.onSave(values));
    },
    touch: (event) => this.form.touch(event),
    cancel: () => this.form.reset(),
  };
}

import { ViewNode, displayValue as __s } from '@magic-spells/puzzle';

PostForm.prototype.render = function () {
  const __d = this.getData();

  return new ViewNode('puzzle-view', {}, [
    new ViewNode('form', {
      class: 'post-form',
      '@submit': ((this.__h ??= {})[0] ??= (event) => this.events.save(event)),
      '@focusout': ((this.__h ??= {})[1] ??= (event) => this.events.touch(event)),
      novalidate: true,
    }, [
      new ViewNode('input', {
        class: 'title',
        name: 'title',
        value: __d.form?.values?.title,
        '@input:bind': this.__bind(__d.form?.values ?? 0, 'title', 'v'),
      }, []),
      ...(__d.form?.errors?.title
        ? [
            new ViewNode('p', { class: 'title-error' }, [
              new ViewNode('text', { value: __s(__d.form?.errors?.title, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'form.errors.title' : 0) }),
            ]),
          ]
        : [
            new ViewNode('#'),
          ]),
      new ViewNode(Field, {
        form: __d.form,
        name: 'body',
        label: 'Body',
      }, []),
      ...(__d.form?.error
        ? [
            new ViewNode('p', { class: 'form-error' }, [
              new ViewNode('text', { value: __s(__d.form?.error, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'form.error' : 0) }),
            ]),
          ]
        : [
            new ViewNode('#'),
          ]),
      new ViewNode('p', { class: 'flags' }, [
        new ViewNode('text', { value: __s(__d.form?.dirty ? 'dirty' : 'clean', typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'form.dirty ? \'dirty\' : \'clean\'' : 0) + ' ' + __s(__d.form?.submitting ? 'busy' : 'idle', typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'form.submitting ? \'busy\' : \'idle\'' : 0) }),
      ]),
      new ViewNode('button', {
        class: 'save',
        type: 'submit',
        disabled: __d.form?.submitting,
      }, [
        new ViewNode('text', { value: 'Save' }),
      ]),
      new ViewNode('button', {
        class: 'cancel',
        type: 'button',
        '@click': ((this.__h ??= {})[2] ??= (event) => this.events.cancel(event)),
      }, [
        new ViewNode('text', { value: 'Cancel' }),
      ]),
    ]),
  ]);
};
