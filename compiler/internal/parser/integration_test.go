package parser

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// repoFile resolves a path relative to the repository root (three levels up
// from compiler/internal/parser).
func repoFile(t *testing.T, rel string) string {
	t.Helper()
	return filepath.Join("..", "..", "..", rel)
}

// walk visits every node in the tree depth-first.
func walk(n Node, fn func(Node)) {
	fn(n)
	switch v := n.(type) {
	case *Element:
		for _, c := range v.Children {
			walk(c, fn)
		}
	case *Component:
		for _, c := range v.Children {
			walk(c, fn)
		}
	case *If:
		for _, c := range v.Then {
			walk(c, fn)
		}
		for _, c := range v.Else {
			walk(c, fn)
		}
	case *For:
		for _, c := range v.Body {
			walk(c, fn)
		}
	}
}

func TestIntegrationHomePzl(t *testing.T) {
	src, err := os.ReadFile(repoFile(t, "examples/todos/app/views/Home.pzl"))
	if err != nil {
		t.Fatalf("read Home.pzl: %v", err)
	}
	pf, err := ParseFile(src, "Home.pzl")
	if err != nil {
		t.Fatalf("Home.pzl must parse cleanly, got: %v", err)
	}
	root := pf.Root

	// Root attrs: class="w-full max-w-xl mx-auto".
	if root.Tag != "puzzle-view" {
		t.Fatalf("root tag: got %q", root.Tag)
	}
	if len(root.Attrs) != 1 {
		t.Fatalf("root attrs: got %d, want 1", len(root.Attrs))
	}
	if s, ok := root.Attrs[0].(*StaticAttr); !ok || s.Name != "class" || s.Value != "w-full max-w-xl mx-auto" {
		t.Errorf("root class attr: got %#v", root.Attrs[0])
	}

	// Scripts preserved verbatim and contain the exported class + the extracted
	// TodoItem component import (the todo row now lives in its own component).
	if !strings.Contains(pf.Scripts, "export default class TodoHome extends PuzzleView") {
		t.Errorf("scripts must be preserved verbatim with the class declaration")
	}
	if !strings.Contains(pf.Scripts, "import TodoItem from '../components/TodoItem.pzl'") {
		t.Errorf("scripts must import the extracted TodoItem component")
	}

	// Spot-check: exactly one keyed {#for todo in filteredTodos}.
	var fors []*For
	var mixedClass, events, ifs int
	walk(root, func(n Node) {
		switch v := n.(type) {
		case *For:
			fors = append(fors, v)
		case *If:
			ifs++
		case *Element:
			for _, a := range v.Attrs {
				if m, ok := a.(*MixedAttr); ok && m.Name == "class" {
					mixedClass++
				}
				if _, ok := a.(*EventAttr); ok {
					events++
				}
			}
		}
	})
	if len(fors) != 1 {
		t.Fatalf("expected exactly one {#for}, got %d", len(fors))
	}
	if fors[0].Item != "todo" || fors[0].Collection != "filteredTodos" {
		t.Errorf("for header: got item=%q collection=%q", fors[0].Item, fors[0].Collection)
	}
	// The {#for} body is now a single <TodoItem> component — the row markup was
	// extracted into examples/todos/app/components/TodoItem.pzl (Step 3). Its props
	// carry the todo plus the toggle/remove callback props.
	var todoItemComp *Component
	walk(fors[0], func(n Node) {
		if comp, ok := n.(*Component); ok && comp.Name == "TodoItem" {
			todoItemComp = comp
		}
	})
	if todoItemComp == nil {
		t.Fatalf("expected the {#for} body to render a <TodoItem> component")
	}
	// Three mixed class="… {#if …}…{/if}" attributes are the filter buttons. The
	// row/checkbox/text inline-if classes moved into TodoItem with the row markup.
	if mixedClass < 3 {
		t.Errorf("expected at least 3 mixed class attrs, got %d", mixedClass)
	}
	// Event handlers: @submit, @input, @click x3(filters) + clear/markAll. The
	// row's @change/@delete moved into TodoItem; @toggle/@remove now ride on the
	// <TodoItem> component tag (component props, not element EventAttrs).
	if events < 5 {
		t.Errorf("expected several event handlers, got %d", events)
	}
	// Block-level {#if}: todos.length>0 (+else), completedTodos>0, activeTodos>0.
	// The checkmark {#if todo.completed} moved into TodoItem with the row.
	if ifs < 3 {
		t.Errorf("expected several top-level {#if} blocks, got %d", ifs)
	}

	// The top-level {#if todos.length > 0} ... {:else} ... {/if} has an else.
	var topIf *If
	for _, c := range root.Children {
		if el, ok := c.(*Element); ok { // the outer wrapper div
			for _, cc := range el.Children {
				if ifn, ok := cc.(*If); ok {
					topIf = ifn
				}
			}
		}
	}
	if topIf == nil {
		t.Fatalf("expected a top-level {#if} inside the wrapper div")
	}
	if topIf.Cond != "todos.length > 0" {
		t.Errorf("top if cond: got %q", topIf.Cond)
	}
	if len(topIf.Else) == 0 {
		t.Errorf("top if should have an {:else} branch")
	}
}

// TestIntegrationTodoItemPzl covers the row markup extracted from Home.pzl into
// its own component (Step 3): the svg/path checkmark, the date formatter, the
// checkbox @change, and the callback-prop handlers in <script>.
func TestIntegrationTodoItemPzl(t *testing.T) {
	src, err := os.ReadFile(repoFile(t, "examples/todos/app/components/TodoItem.pzl"))
	if err != nil {
		t.Fatalf("read TodoItem.pzl: %v", err)
	}
	pf, err := ParseFile(src, "TodoItem.pzl")
	if err != nil {
		t.Fatalf("TodoItem.pzl must parse cleanly, got: %v", err)
	}
	root := pf.Root

	// Scripts: the exported component class + callback-prop invocations, plus the
	// reserved animations field.
	if !strings.Contains(pf.Scripts, "export default class TodoItem extends PuzzleView") {
		t.Errorf("scripts must contain the TodoItem class")
	}
	if !strings.Contains(pf.Scripts, "this.props.toggle(event)") ||
		!strings.Contains(pf.Scripts, "this.props.remove(event)") {
		t.Errorf("scripts must invoke the toggle/remove callback props")
	}
	if !strings.Contains(pf.Scripts, "animations = {") {
		t.Errorf("scripts must declare the animations field")
	}

	// The svg/path checkmark elements moved here from Home.pzl.
	var sawSvg, sawPath bool
	walk(root, func(n Node) {
		if el, ok := n.(*Element); ok {
			if el.Tag == "svg" {
				sawSvg = true
			}
			if el.Tag == "path" {
				sawPath = true
			}
		}
	})
	if !sawSvg || !sawPath {
		t.Errorf("expected <svg> and <path> elements (svg=%v path=%v)", sawSvg, sawPath)
	}

	// The { todo.createdAt | date('short') } interpolation moved here too.
	var sawDateFmt bool
	walk(root, func(n Node) {
		if in, ok := n.(*Interpolation); ok {
			for _, f := range in.Formatters {
				if f.Name == "date" && len(f.Args) == 1 && f.Args[0] == "'short'" {
					sawDateFmt = true
				}
			}
		}
	})
	if !sawDateFmt {
		t.Errorf("expected the { todo.createdAt | date('short') } interpolation")
	}

	// The checkbox @change handler is present as an element EventAttr.
	var sawChange bool
	walk(root, func(n Node) {
		if el, ok := n.(*Element); ok {
			for _, a := range el.Attrs {
				if ev, ok := a.(*EventAttr); ok && ev.Name == "change" {
					sawChange = true
				}
			}
		}
	})
	if !sawChange {
		t.Errorf("expected the checkbox @change handler")
	}
}

func TestIntegrationDefaultPzl(t *testing.T) {
	src, err := os.ReadFile(repoFile(t, "examples/todos/app/layouts/Default.pzl"))
	if err != nil {
		t.Fatalf("read Default.pzl: %v", err)
	}
	pf, err := ParseFile(src, "Default.pzl")
	if err != nil {
		t.Fatalf("Default.pzl must parse cleanly, got: %v", err)
	}

	// It contains exactly one <Slot/>.
	var slots int
	walk(pf.Root, func(n Node) {
		if _, ok := n.(*Slot); ok {
			slots++
		}
	})
	if slots != 1 {
		t.Errorf("expected exactly one <Slot/>, got %d", slots)
	}

	if !strings.Contains(pf.Scripts, "export default class DefaultLayout extends PuzzleView") {
		t.Errorf("scripts must contain the DefaultLayout class")
	}
}
