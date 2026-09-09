
import { PuzzleView } from '@magic-spells/puzzle';
import Foo from './Foo.pzl';

export default class Binding extends PuzzleView {
  data() {
    return {
      draft: '',
      age: null,
      volume: 0,
      todos: [],
      sort: 'all',
      notes: '',
      profile: { birthday: '' },
      inputOwned: '',
      changeOwned: null,
      keyboard: '',
      readOnlyValue: '',
      disabledValue: '',
      inputType: 'text',
      dynamicValue: '',
      radioValue: '',
      fileValue: '',
      checkboxValue: '',
      multiValue: [],
      x: '',
    };
  }

  events = {
    syncInput: (event) => {},
    syncChange: (event) => {},
    submit: (event) => {},
  };
}

import { ViewNode } from '@magic-spells/puzzle';

Binding.prototype.render = function () {
  const __d = this.getData();

  return new ViewNode('puzzle-view', { class: 'binding' }, [
    new ViewNode('input', {
      value: __d.draft,
      '@input:bind': this.__bind(null, 'draft', 'v'),
    }, []),
    new ViewNode('input', {
      type: 'number',
      value: __d.age,
      '@change:bind': this.__bind(null, 'age', 'vn'),
    }, []),
    new ViewNode('input', {
      type: 'range',
      value: __d.volume,
      '@input:bind': this.__bind(null, 'volume', 'vn'),
    }, []),
    new ViewNode('ul', {},
      __d.todos.map((todo) =>
        new ViewNode('input', {
          key: ViewNode.keyOf(todo),
          type: 'checkbox',
          checked: todo.completed,
          '@change:bind': this.__bind(todo, 'completed', 'c'),
        }, [])
      )
    ),
    new ViewNode('select', {
      value: __d.sort,
      '@change:bind': this.__bind(null, 'sort', 'v'),
    }, [
      new ViewNode('option', { value: 'all' }, [
        new ViewNode('text', { value: 'All' }),
      ]),
    ]),
    new ViewNode('textarea', {
      value: __d.notes,
      '@input:bind': this.__bind(null, 'notes', 'v'),
    }, []),
    new ViewNode('input', {
      type: 'date',
      value: __d.profile.birthday,
      '@change:bind': this.__bind(__d.profile, 'birthday', 'v'),
    }, []),
    new ViewNode('input', {
      value: __d.inputOwned,
      '@input': ((this.__h ??= {})[0] ??= (event) => this.events.syncInput(event)),
    }, []),
    new ViewNode('input', {
      type: 'number',
      value: __d.changeOwned,
      '@change:prevent': ((this.__h ??= {})[1] ??= (event) => this.events.syncChange(event)),
    }, []),
    new ViewNode('input', {
      value: __d.keyboard,
      '@keydown:enter': ((this.__h ??= {})[2] ??= (event) => this.events.submit(event)),
      '@input:bind': this.__bind(null, 'keyboard', 'v'),
    }, []),
    new ViewNode('input', {
      value: __d.readOnlyValue,
      readonly: true,
    }, []),
    new ViewNode('input', {
      value: __d.disabledValue,
      disabled: true,
    }, []),
    new ViewNode('input', {
      type: __d.inputType,
      value: __d.dynamicValue,
    }, []),
    new ViewNode('input', {
      type: 'radio',
      value: __d.radioValue,
    }, []),
    new ViewNode('input', {
      type: 'file',
      value: __d.fileValue,
    }, []),
    new ViewNode('input', {
      type: 'checkbox',
      value: __d.checkboxValue,
    }, []),
    new ViewNode('select', {
      value: __d.multiValue,
      multiple: true,
    }, []),
    new ViewNode(Foo, { value: __d.x }, []),
    new ViewNode('input', { value: __d.x.trim() }, []),
  ]);
};
Binding.__pzlModule = 'binding.pzl';
