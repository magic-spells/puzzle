# Puzzle Todos Example

A complete todo application built with the Puzzle framework, demonstrating all core patterns and features.

## Features

- ✅ Add and delete todos
- ✅ Mark todos as complete/incomplete
- ✅ Filter todos (All, Active, Completed)
- ✅ Bulk actions (Mark all complete, Clear completed)
- ✅ Real-time todo statistics
- ✅ Responsive design with beautiful UI
- ✅ Local storage persistence
- 🔜 Keyboard shortcuts (Ctrl+N to focus input) — **planned, not in v1** (app-level global events are deferred, see [SPEC.md](../constellation/doc/DOC-SPEC.md))

## Architecture Highlights

### Single-File Components (.pzl)
- **DefaultLayout.pzl** - Main app layout with header/footer
- **Home.pzl** - Complete todo management interface

### Model Layer
- **models/todo.js** - Todo model with schema (via `Puzzle` field builders), computed properties, and custom methods
- **models/index.js** - Model registry

### App Structure
- **app.js** - App initialization: mount target, routes, models, and global formatters
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
  },

  toggleTodo: (todo) => {
    todo.toggle();
  }
};
```

### 3. Template Features
```html
{#if todos.length > 0}
  {#for todo in filteredTodos}
    <div class="todo-item {#if todo.completed}completed{/if}">
      <input type="checkbox" 
      checked={ todo.completed } 
      @change={ toggleTodo(todo) } />
      <span>{ todo.text }</span>
      <span>{ todo.createdAt | todoDate }</span>
    </div>
  {/for}
{:else}
  <div class="empty-state">No todos yet!</div>
{/if}
```

### 4. Custom Formatters
```javascript
// Global formatters in app.js
formatters: {
  pluralize: (count, singular, plural) => count === 1 ? singular : (plural || singular + 's'),
  todoDate: (date) => formatRelativeDate(date)
}
```

### 5. Model Methods
```javascript
// In todo.js model
toggle() {
  return this.update({
    completed: !this.completed,
    updatedAt: new Date()
  });
}

markComplete() {
  if (!this.completed) {
    return this.update({ completed: true, updatedAt: new Date() });
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
4. **Rich templating** - Formatters, conditionals, loops all built-in
5. **Integrated data layer** - Models with schema and methods live alongside the store (server reads exist; write sync is post-v1)

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
