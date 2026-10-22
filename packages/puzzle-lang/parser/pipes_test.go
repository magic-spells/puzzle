package parser

import (
	"reflect"
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/packages/puzzle-lang/expr"
)

// pipes_test.go covers Options.Pipes, the Sites dialect's `|`: every
// expression position accepts a pipe, and a piped expression parses to the
// tree its written call produces.

// exprTrees prints every expression tree in v, in field order.
func exprTrees(v any) []string {
	var out []string
	seen := map[uintptr]bool{}
	nodeType := reflect.TypeOf((*expr.Node)(nil)).Elem()
	var walk func(reflect.Value)
	walk = func(v reflect.Value) {
		if !v.IsValid() {
			return
		}
		if v.Kind() == reflect.Interface && v.Type() == nodeType {
			if !v.IsNil() {
				out = append(out, expr.Print(v.Interface().(expr.Node)))
			}
			return
		}
		switch v.Kind() {
		case reflect.Pointer:
			if v.IsNil() || seen[v.Pointer()] {
				return
			}
			seen[v.Pointer()] = true
			walk(v.Elem())
		case reflect.Interface:
			if !v.IsNil() {
				walk(v.Elem())
			}
		case reflect.Slice, reflect.Array:
			for i := 0; i < v.Len(); i++ {
				walk(v.Index(i))
			}
		case reflect.Struct:
			for i := 0; i < v.NumField(); i++ {
				if v.Type().Field(i).IsExported() {
					walk(v.Field(i))
				}
			}
		}
	}
	walk(reflect.ValueOf(v))
	return out
}

func TestPipesInEveryExpressionPosition(t *testing.T) {
	sites := Options{Pipes: true, Let: true}
	for _, tc := range []struct{ name, piped, called string }{
		{"text", "<p>{ price | currency }</p>", "<p>{ currency(price) }</p>"},
		{"text with arguments", "<p>{ body | truncate(120, '…') }</p>", "<p>{ truncate(body, 120, '…') }</p>"},
		{"precedence", "<p>{ price * qty | currency }</p>", "<p>{ currency(price * qty) }</p>"},
		{"chain", "<p>{ x | f | g(1) }</p>", "<p>{ g(f(x), 1) }</p>"},
		{"brace attribute", "<p title={ price | currency }></p>", "<p title={ currency(price) }></p>"},
		{"quoted attribute", `<p title="a { price | currency } b"></p>`, `<p title="a { currency(price) } b"></p>`},
		{"component prop", "<Card n={ list | pretty(', ') }/>", "<Card n={ pretty(list, ', ') }/>"},
		{"key", "{#for t in todos}<li key={ t.id | slug }></li>{/for}", "{#for t in todos}<li key={ slug(t.id) }></li>{/for}"},
		{"{#if}", "{#if tags | any}<p></p>{/if}", "{#if any(tags)}<p></p>{/if}"},
		{"{:else if}", "{#if a}<p></p>{:else if tags | any}<p></p>{/if}", "{#if a}<p></p>{:else if any(tags)}<p></p>{/if}"},
		{"{#unless}", "{#unless tags | any}<p></p>{/unless}", "{#unless any(tags)}<p></p>{/unless}"},
		{"{#case}", "{#case status | label}{:when 'a'}<p></p>{/case}", "{#case label(status)}{:when 'a'}<p></p>{/case}"},
		{"{:when}", "{#case s}{:when x | f, 'b'}<p></p>{/case}", "{#case s}{:when f(x), 'b'}<p></p>{/case}"},
		{"{#for} collection", "{#for t in todos | ordered}<p></p>{/for}", "{#for t in ordered(todos)}<p></p>{/for}"},
		{"{#for} range", "{#for 1...n | round}<p></p>{/for}", "{#for 1...round(n)}<p></p>{/for}"},
		{"inline {#if}", `<p class="{#if a | b}on{/if}"></p>`, `<p class="{#if b(a)}on{/if}"></p>`},
		{"{#let}", "{#let total = price * qty | currency}<p>{ total }</p>", "{#let total = currency(price * qty)}<p>{ total }</p>"},
		{"call argument", "<p>{ h(x | f, y) }</p>", "<p>{ h(f(x), y) }</p>"},
		{"template literal", "<p>{ `n ${ x | f }` }</p>", "<p>{ `n ${ f(x) }` }</p>"},
		{"array and object", "<Card a={ [x | f] } o={ { k: y | g } }/>", "<Card a={ [f(x)] } o={ { k: g(y) } }/>"},
		{"conditional branches", "<p>{ a ? b | f : c | g }</p>", "<p>{ a ? f(b) : g(c) }</p>"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			wrap := func(s string) []byte { return []byte("<puzzle-view>" + s + "</puzzle-view>") }
			piped, err := Parse(wrap(tc.piped), "t.pzl", sites)
			if err != nil {
				t.Fatalf("piped: %v", err)
			}
			called, err := Parse(wrap(tc.called), "t.pzl", sites)
			if err != nil {
				t.Fatalf("called: %v", err)
			}
			got, want := exprTrees(piped), exprTrees(called)
			if strings.Join(got, "\n") != strings.Join(want, "\n") {
				t.Errorf("trees differ:\n piped  %q\n called %q", got, want)
			}
			if !strings.Contains(strings.Join(got, "\n"), "(call ") {
				t.Errorf("no call in %q", got)
			}
		})
	}
}

func TestPipeErrorsWithPipesOn(t *testing.T) {
	sites := Options{Pipes: true, Let: true}
	for _, tc := range []struct{ name, src, want string }{
		{"no name", "<p>{ x | 42 }</p>", "expected a function name after `|`"},
		{"a member", "<p>{ x | a.b }</p>", "expected a function name after `|`"},
		{"a binding", "{#for item in items}<p>{ x | item }</p>{/for}", "`item` is a template variable here and cannot be called"},
		{"a {#let} name", "{#let f = 1}<p>{ x | f }</p>", "`f` is a template variable here and cannot be called"},
		// In a {:when} value a `|` before a non-name is an attempt at
		// alternatives, as with pipes off.
		{"{:when} alternatives", "{#case s}{:when 'a' | 'b'}<p></p>{/case}", whenPipeMessage},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Parse([]byte("<puzzle-view>"+tc.src+"</puzzle-view>"), "t.pzl", sites)
			pe, ok := err.(*ParseError)
			if !ok {
				t.Fatalf("want a ParseError, got %v", err)
			}
			if pe.Message != tc.want {
				t.Fatalf("got %q, want %q", pe.Message, tc.want)
			}
		})
	}
}
