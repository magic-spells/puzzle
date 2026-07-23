package generate

// Stub templates. __NAME__ is the class/component name; __MODEL__ is the
// lower-case model name (model template only). Each .pzl below is held to the
// frozen grammar (constellation/doc/DOC-SPEC.md §6): single-brace interpolation,
// a `<puzzle-view>` delimiter, `@event={ handler(event) }`, a `<script>` block
// importing PuzzleView, and a `<style>` block. generate_test.go compiles every
// one of these through the repo's parser+codegen.

// componentTemplate renders inline (D20): `<puzzle-view>` carries no attributes
// and wraps a SINGLE root element. It shows a prop plus an arrow-function event
// handler in an `events = {}` class field (arrow functions are mandatory —
// method shorthand is a compile error, constellation/doc/DOC-SPEC.md §4–5).
const componentTemplate = `<puzzle-view>
  <button class="__NAME__" @click={ handleClick(event) }>
    { label }
  </button>
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';

export default class __NAME__ extends PuzzleView {
  // ` + "`label`" + ` is a prop passed by the parent component.
  data(params, props) {
    return {
      label: props.label || '__NAME__'
    };
  }

  // Event handlers are arrow functions so ` + "`this`" + ` is the instance.
  events = {
    handleClick: (event) => {
      console.log('__NAME__ clicked');
    }
  };
}
</script>

<style>
.__NAME__ {
  display: inline-flex;
  align-items: center;
}
</style>
`

// viewTemplate compiles in view mode (D20): the `<puzzle-view>` root becomes a
// real element and may carry attributes. data(params, props) returns the model.
const viewTemplate = `<puzzle-view class="__NAME__">
  <h1>{ title }</h1>
  <p>{ message }</p>
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';

export default class __NAME__ extends PuzzleView {
  data(params, props) {
    return {
      title: '__NAME__',
      message: 'This view was scaffolded by puzzle generate.'
    };
  }
}
</script>

<style>
.__NAME__ {
  display: block;
}
</style>
`

// layoutTemplate is a view-mode file that hosts its routed child at <Slot/>
// (see examples/todos/app/layouts/Default.pzl).
const layoutTemplate = `<puzzle-view class="__NAME__">
  <header>
    <h1>{ title }</h1>
  </header>

  <main>
    <Slot/>
  </main>
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';

export default class __NAME__ extends PuzzleView {
  data(params, props) {
    return {
      title: props.title || '__NAME__'
    };
  }
}
</script>

<style>
.__NAME__ {
  display: block;
}
</style>
`

// modelTemplate mirrors examples/todos/app/models/todo.js (constellation/doc/DOC-MODELS.md).
const modelTemplate = `import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

export default class __NAME__ extends PuzzleModel {
  // Schema definition — see constellation/doc/DOC-SPEC.md §7
  static schema = {
    id:        Puzzle.string().primary(),
    name:      Puzzle.string().required(),
    createdAt: Puzzle.date().default(() => new Date()),
    updatedAt: Puzzle.date().default(() => new Date())
  };

  // Computed properties — plain getters (constellation/doc/DOC-SPEC.md §7)
  get displayName() {
    return this.name;
  }

  // Server location (D21): consumed by store.loadAll('__MODEL__') / loadOne.
  static adapter = {
    endpoint: '/api/__MODEL__s',
  };
}
`
