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

// familyTemplate is the stub every member of a `--family` scaffold gets, root
// included (D167). It differs from componentTemplate in exactly one way that
// matters: the root element carries `<Children/>`, because a family exists to
// nest — `<Frame><Frame.Wrapper>…</Frame.Wrapper></Frame>` renders nothing at
// all if the members drop their children. It still compiles in component mode
// (D20: a single root element, no attributes on `<puzzle-view>`).
const familyTemplate = `<puzzle-view>
  <div class={ classes }>
    <Children/>
  </div>
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';

export default class __NAME__ extends PuzzleView {
  // Family members compose: <Children/> above renders whatever the caller
  // nests inside <__NAME__>. ` + "`class`" + ` is the usual caller override prop.
  data(params, props) {
    return {
      classes: ['__NAME__', props.class].filter(Boolean).join(' ')
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

  // Server location (D21/D157). To enable loadMany/loadOne/save/delete, import
  // the adapter capability in app.js and pass it once to PuzzleApp.
  static adapter = {
    endpoint: '/api/__MODEL__s',
  };
}
`

// TypeScript stubs, written instead of the ones above in a TypeScript app (a
// tsconfig.json at the project root — see IsTypeScriptApp). Each .pzl keeps its
// JavaScript twin's markup and style byte for byte; only the script is ported,
// in the idiom of the `puzzle init --typescript` scaffold: typed props and a
// typed data() model as named interfaces, typed event handlers, no `any`.
// generate_test.go compiles each one, and the CLI acceptance runs `puzzle check`
// over them.

const componentTemplateTS = `<puzzle-view>
  <button class="__NAME__" @click={ handleClick(event) }>
    { label }
  </button>
</puzzle-view>

<script lang="ts">
import { PuzzleView } from '@magic-spells/puzzle';

// ` + "`label`" + ` is a prop passed by the parent component.
interface __NAME__Props {
  label?: string;
}

// What data() hands the template.
interface __NAME__Model {
  label: string;
}

export default class __NAME__ extends PuzzleView {
  data(_params: Record<string, string>, props: __NAME__Props): __NAME__Model {
    return {
      label: props.label || '__NAME__',
    };
  }

  // Event handlers are arrow functions so ` + "`this`" + ` is the instance.
  events = {
    handleClick: (_event: Event): void => {
      console.log('__NAME__ clicked');
    },
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

const familyTemplateTS = `<puzzle-view>
  <div class={ classes }>
    <Children/>
  </div>
</puzzle-view>

<script lang="ts">
import { PuzzleView } from '@magic-spells/puzzle';

// ` + "`class`" + ` is the usual caller override prop.
interface __NAME__Props {
  class?: string;
}

// What data() hands the template.
interface __NAME__Model {
  classes: string;
}

export default class __NAME__ extends PuzzleView {
  // Family members compose: <Children/> above renders whatever the caller
  // nests inside <__NAME__>.
  data(_params: Record<string, string>, props: __NAME__Props): __NAME__Model {
    return {
      classes: ['__NAME__', props.class].filter(Boolean).join(' '),
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

const viewTemplateTS = `<puzzle-view class="__NAME__">
  <h1>{ title }</h1>
  <p>{ message }</p>
</puzzle-view>

<script lang="ts">
import { PuzzleView } from '@magic-spells/puzzle';

// What data() hands the template — every key the markup above reads.
interface __NAME__Model {
  title: string;
  message: string;
}

export default class __NAME__ extends PuzzleView {
  data(): __NAME__Model {
    return {
      title: '__NAME__',
      message: 'This view was scaffolded by puzzle generate.',
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

const layoutTemplateTS = `<puzzle-view class="__NAME__">
  <header>
    <h1>{ title }</h1>
  </header>

  <main>
    <Slot/>
  </main>
</puzzle-view>

<script lang="ts">
import { PuzzleView } from '@magic-spells/puzzle';

interface __NAME__Props {
  title?: string;
}

// What data() hands the template.
interface __NAME__Model {
  title: string;
}

export default class __NAME__ extends PuzzleView {
  data(_params: Record<string, string>, props: __NAME__Props): __NAME__Model {
    return {
      title: props.title || '__NAME__',
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

// modelTemplateTS mirrors the TypeScript todos scaffold's app/models/todo.ts:
// the schema, plus a hand-written fields interface and a record type the rest
// of the app types against.
const modelTemplateTS = `import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

// The fields a __NAME__ record carries. Puzzle records are dynamic — the schema
// below sets their fields at runtime — so this interface is the hand-written
// view of that schema the rest of the app types against. Keep the two in step.
export interface __NAME__Fields {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export default class __NAME__ extends PuzzleModel {
  // Schema definition — see constellation/doc/DOC-SPEC.md §7
  static schema = {
    id:        Puzzle.string().primary(),
    name:      Puzzle.string().required(),
    createdAt: Puzzle.date().default(() => new Date()),
    updatedAt: Puzzle.date().default(() => new Date())
  };

  // Computed properties — plain getters (constellation/doc/DOC-SPEC.md §7)
  get displayName(): string {
    return this.name;
  }

  // Server location (D21/D157). To enable loadMany/loadOne/save/delete, import
  // the adapter capability in app.ts and pass it once to PuzzleApp.
  static adapter = {
    endpoint: '/api/__MODEL__s',
  };
}

// A __NAME__ record: the model's methods and getters plus the schema's fields.
export type __NAME__Record = __NAME__ & __NAME__Fields;
`
