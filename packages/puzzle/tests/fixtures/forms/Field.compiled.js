



























        
import { PuzzleView } from '@magic-spells/puzzle';

// Field — the workhorse labeled text input (composite and config-first: label,
// hint/error, and ARIA wiring come built in). Controlled: the parent owns
// `value` and updates it from `@change`. An `error` string replaces the `hint`,
// flips aria-invalid, and paints the border/ring danger.
// A stable id is generated when `id` is absent so the label can target the input.
//
// Given a `form` from @magic-spells/puzzle/forms (D192) plus a `name`, the field
// wires itself: it reads form.values[name], shows form.errors[name] (an explicit
// `error` prop still wins), writes through form.set(name, value) and touches the
// field on blur. Duck-typed — nothing is imported, so apps without the forms
// module are unchanged.
//
//   <Field label="Email" type="email" value={ email } @change={ setEmail } />
//   <Field label="Name" required hint="As it appears on your card" />
//   <Field label="Email" value={ email } error="That address is taken" />
//   <Field form={ form } name="title" label="Title" />
let uid = 0;

const INPUT_BASE =
  'h-9 w-full rounded-lg border bg-surface px-3 text-sm text-ink placeholder:text-muted ' +
  'transition-colors ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 ' +
  'disabled:opacity-50';
const INPUT_OK = 'border-border outline-ring focus-visible:outline-ring';
const INPUT_ERROR = 'border-danger outline-danger focus-visible:outline-danger';

export default class Field extends PuzzleView {
  data({ props }) {
    // Fallback id is generated once per instance so it survives re-renders; an
    // explicit `id` prop always wins.
    const id = props.id || (this._fallbackId ??= `pp-field-${++uid}`);
    // a forms controller plus a name: the form owns the value and the error
    const form = props.form && props.name ? props.form : null;
    const error = props.error || form?.errors?.[props.name] || '';
    const hint = props.hint || '';
    const described = !!(error || hint);
    return {
      id,
      descId: `${id}-desc`,
      type: props.type || 'text',
      value: (form ? form.values[props.name] : props.value) ?? '',
      placeholder: props.placeholder ?? null,
      name: props.name ?? null,
      autocomplete: props.autocomplete ?? null,
      label: props.label,
      hint,
      error,
      disabled: !!props.disabled,
      required: !!props.required,
      invalid: error ? 'true' : false,
      describedby: described ? `${id}-desc` : false,
      rootClass: props.class || '',
      inputClass: [INPUT_BASE, error ? INPUT_ERROR : INPUT_OK].join(' '),
    };
  }

  events = {
    handleInput: (event) => {
      const { change, form, name } = this.props;
      // write the draft first so a change callback reads the new value back
      if (form && name) form.set(name, event.target.value);
      if (typeof change === 'function') change(event.target.value);
    },
    handleBlur: (event) => {
      const { blur, form, name } = this.props;
      // leaving the field is what makes its error show
      if (form && name) form.touch(name);
      if (typeof blur === 'function') blur(event);
    },
    handleFocus: (event) => {
      const { focus } = this.props;
      if (typeof focus === 'function') focus(event);
    },
  };
}

import { ViewNode, displayValue as __s } from '@magic-spells/puzzle';

Field.prototype.render = function () {
  const __d = this.getData();

  return new ViewNode('div', { class: __d.rootClass }, [
    __d.label
      ? new ViewNode('label', {
          for: __d.id,
          class: 'mb-1.5 block text-sm font-medium text-ink',
        }, [
          new ViewNode('text', { value: __s(__d.label, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'label' : 0) }),
        ])
      : new ViewNode('#'),
    new ViewNode('input', {
      id: __d.id,
      type: __d.type,
      class: __d.inputClass,
      value: __d.value,
      placeholder: __d.placeholder,
      name: __d.name,
      autocomplete: __d.autocomplete,
      disabled: __d.disabled,
      required: __d.required,
      'aria-invalid': __d.invalid,
      'aria-describedby': __d.describedby,
      '@input': ((this.__h ??= {})[0] ??= (event) => this.events.handleInput(event)),
      '@blur': ((this.__h ??= {})[1] ??= (event) => this.events.handleBlur(event)),
      '@focus': ((this.__h ??= {})[2] ??= (event) => this.events.handleFocus(event)),
    }, []),
    __d.error
      ? new ViewNode('p', {
          id: __d.descId,
          class: 'mt-1.5 text-sm text-danger',
        }, [
          new ViewNode('text', { value: __s(__d.error, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'error' : 0) }),
        ])
      : __d.hint
          ? new ViewNode('p', {
              id: __d.descId,
              class: 'mt-1.5 text-sm text-muted',
            }, [
              new ViewNode('text', { value: __s(__d.hint, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'hint' : 0) }),
            ])
          : new ViewNode('#'),
  ]);
};
