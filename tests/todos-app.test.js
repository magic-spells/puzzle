// @vitest-environment jsdom
//
// Todos integration test (constellation/doc/DOC-TESTING.md): drives a real PuzzleApp with the
// hand-written fixture classes (tests/fixtures/todos/*) like a user: dispatch
// real DOM events, assert the DOM. The 12 assertions live in
// tests/helpers/todos-suite.js so the compiler-output variant
// (tests/todos-app-compiled.test.js) runs the identical proof.
import { runTodosSuite } from './helpers/todos-suite.js';
import TodoHome from './fixtures/todos/Home.compiled.js';
import DefaultLayout from './fixtures/todos/Default.compiled.js';
import Todo from './fixtures/todos/todo.model.js';

runTodosSuite({ TodoHome, DefaultLayout, Todo, label: 'fixture' });
