// @vitest-environment jsdom
//
// Compiler-output proof (constellation/doc/DOC-TESTING.md): the SAME integration suite as
// tests/todos-app.test.js, but the view + layout modules are the Go compiler's
// output (tests/fixtures/todos-compiled/*, produced by `npm run
// build:example-modules` from examples/todos/app/**). The model is reused from
// the hand-written fixture — only the compiled UI is under test. Green here
// means `puzzle build examples/todos` yields a working app. The compiled modules
// import '@magic-spells/puzzle', aliased to the local runtime in vitest.config.js.
import { runTodosSuite } from './helpers/todos-suite.js';
import TodoHome from './fixtures/todos-compiled/Home.compiled.js';
import DefaultLayout from './fixtures/todos-compiled/Default.compiled.js';
import Todo from './fixtures/todos/todo.model.js';

runTodosSuite({ TodoHome, DefaultLayout, Todo, label: 'compiled' });
