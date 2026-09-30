# Puzzle Todos Example

A complete todo application built with the Puzzle framework, demonstrating all core patterns and features.

## Features

- ✅ Add and delete todos
- ✅ Mark todos as complete/incomplete
- ✅ Filter todos (All, Active, Completed)
- ✅ Bulk actions (Mark all complete, Clear completed)
- ✅ Real-time todo statistics
- ✅ Responsive design with beautiful UI
- ✅ Fixture data for development (`puzzle dev --fixtures`, from `app/fixtures.js`)
- 🔜 Keyboard shortcuts (Ctrl+N to focus input) — **planned, not in v1** (app-level global events are deferred, see [SPEC.md](../../constellation/doc/DOC-SPEC.md))

## Architecture Highlights

### Single-File Components (.pzl)
- **layouts/Default.pzl** - Main app layout with header/footer
- **views/Home.pzl** - Complete todo management interface
- **components/TodoItem.pzl** - One todo row: the bound checkbox, the text, the created date and a delete button

### Model Layer
- **models/todo.js** - Todo model with schema (via `Puzzle` field builders), computed properties, and custom methods
- **models/index.js** - Model registry

### App Structure
- **app.js** - App initialization: mount target, routes, and models
- **routes.js** - Simple routing configuration

## Puzzle Framework Patterns Demonstrated

### 1. Reactive Data Loading
```javascript
data(params, props) {
  const todos = this.ctx.store.findMany('todo'); // auto-subscribes
  return {
    todos,
    activeTodos: todos.filter(todo => !todo.completed),
    completedTodos: todos.filter(todo => todo.completed)
  };
}
```

### 2. Event Handling
```javascript
// Class field of arrow functions — `this` is always the component instance
events = {
  addTodo: (event) => {
    event.preventDefault();
    const text = this.getData().newTodoText.trim();
    if (text) {
      this.ctx.store.createRecord('todo', { text });
      this.setData('newTodoText', '');
    }
  }
};
```

### 3. Template Features
```html
{#if todos.length > 0}
  {#for todo in filteredTodos}
    <div class="todo-item {#if todo.completed}completed{/if}">
      <input type="checkbox" checked={ todo.completed } />
      <span>{ todo.text }</span>
      <span>{ datetime(todo.createdAt, 'short') }</span>
    </div>
  {/for}
{:else}
  <div class="empty-state">No todos yet!</div>
{/if}
```

The checkbox needs no handler: `checked={ todo.completed }` is a two-way bind, so
a click writes through `todo.update()` and every view reading that record
re-renders. Writing your own `@input`/`@change` on the control suppresses the
bind — the handler owns the write instead.

### 4. Display Functions
`datetime(todo.createdAt, 'short')` above is a standard display function, called
by name. Your own register through the `formatters` config in app.js and are
called the same way:
```javascript
// A function of your own in app.js (this example registers none),
// called in a template as { todoDate(todo.createdAt) }
formatters: {
  todoDate: (date) => formatRelativeDate(date)
}
```

### 5. Model Methods
```javascript
// In todo.js model
markComplete() {
  if (!this.completed) {
    return this.update({ completed: true, updatedAt: new Date() });
  }
  return this;
}

markIncomplete() {
  if (this.completed) {
    return this.update({ completed: false, updatedAt: new Date() });
  }
  return this;
}
```

## Running the Example

```bash
cd examples/todos
npm install
npm run dev
```

Open http://localhost:3000 to see the app.

## What This Demonstrates

This example shows how Puzzle enables rapid development with:

1. **Zero boilerplate** - No Redux setup, no router configuration hell
2. **Clear patterns** - data() for data, events for interactions
3. **Reactive updates** - Change a model, UI updates automatically
4. **Rich templating** - JavaScript expressions, display functions, conditionals, loops all built-in
5. **Integrated data layer** - Models with schema and methods live alongside the store (server sync is the opt-in `adapter` capability)

## Key Takeaways

Building this todo app felt **fast and intuitive**. The patterns are clear, there's no decision fatigue, and everything just works together seamlessly.

Compared to React, this would have required:
- Redux setup and boilerplate
- React Router configuration
- useEffect dependency arrays
- Custom hooks for data fetching
- Context providers or prop drilling
- 10+ npm packages

With Puzzle: **Just write your app. Everything else is handled.**
