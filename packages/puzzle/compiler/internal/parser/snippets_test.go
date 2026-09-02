package parser

import (
	"strings"
	"testing"
)

func TestParseSnippets(t *testing.T) {
	root := parseContent(t, `<UserList>
  <Snippet fits="row" user group>
    <b>{ user.name } — { group.title }</b>
  </Snippet>
</UserList>`)
	list := elementChildren(root.Children)[0].(*Component)
	snippet, ok := elementChildren(list.Children)[0].(*Snippet)
	if !ok {
		t.Fatalf("child = %T, want *Snippet", elementChildren(list.Children)[0])
	}
	if snippet.Fits != "row" {
		t.Fatalf("Fits = %q, want row", snippet.Fits)
	}
	if got := strings.Join(snippet.Params, ","); got != "user,group" {
		t.Fatalf("Params = %q, want user,group", got)
	}
	if len(elementChildren(snippet.Body)) != 1 {
		t.Fatalf("Body nodes = %d, want 1", len(elementChildren(snippet.Body)))
	}
}

func TestParseSnippetMarkerArgs(t *testing.T) {
	root := parseContent(t, `<div>
  <Children user={ user } label="fixed" mixed="hello-{ user.name }"/>
  <Slot name="row" user={ user } group={ group }>fallback</Slot>
</div>`)
	div := elementChildren(root.Children)[0].(*Element)
	kids := elementChildren(div.Children)
	def := kids[0].(*Slot)
	if def.Name != "" || len(def.Args) != 3 {
		t.Fatalf("default marker = %#v, want 3 args", def)
	}
	row := kids[1].(*Slot)
	if row.Name != "row" || len(row.Args) != 2 {
		t.Fatalf("row marker = %#v, want name row and 2 args", row)
	}
}

func TestParseFormerTemplateSpellingsAreOrdinaryTags(t *testing.T) {
	root := parseContent(t, `<div>
		<template fits="row" user><span>ordinary HTML</span></template>
		<Template fits="row" user><span>ordinary component</span></Template>
		<List>
			<template fits="row" user>nested HTML</template>
			<Template fits="row" user>nested component</Template>
		</List>
	</div>`)
	div := elementChildren(root.Children)[0].(*Element)
	children := elementChildren(div.Children)
	if el, ok := children[0].(*Element); !ok || el.Tag != "template" {
		t.Fatalf("former lowercase marker = %#v, want ordinary <template> element", children[0])
	}
	if comp, ok := children[1].(*Component); !ok || comp.Name != "Template" {
		t.Fatalf("former capitalized marker = %#v, want ordinary <Template> component", children[1])
	}
	list := children[2].(*Component)
	nested := elementChildren(list.Children)
	if el, ok := nested[0].(*Element); !ok || el.Tag != "template" {
		t.Fatalf("nested former lowercase marker = %#v, want ordinary <template> element", nested[0])
	}
	if comp, ok := nested[1].(*Component); !ok || comp.Name != "Template" {
		t.Fatalf("nested former capitalized marker = %#v, want ordinary <Template> component", nested[1])
	}
}

func TestParseUnmarkedLowercaseSnippetIsOrdinaryHTML(t *testing.T) {
	root := parseContent(t, `<snippet class="sample">ordinary HTML</snippet>`)
	child := elementChildren(root.Children)[0]
	if el, ok := child.(*Element); !ok || el.Tag != "snippet" {
		t.Fatalf("unmarked lowercase snippet = %#v, want ordinary <snippet> element", child)
	}
}

func TestParseSnippetValidationErrors(t *testing.T) {
	tests := []struct {
		name string
		src  string
		want string
	}{
		{"self closing", `<List><Snippet user/></List>`, "<Snippet/> is paired-only"},
		{"dynamic fits", `<List><Snippet fits={ region } user>x</Snippet></List>`, "snippet target must be a static string"},
		{"mixed fits", `<List><Snippet fits="row-{ region }" user>x</Snippet></List>`, "snippet target must be a static string"},
		{"empty fits", `<List><Snippet fits="" user>x</Snippet></List>`, "<Snippet fits> cannot be empty"},
		{"fits cannot be a param", `<List><Snippet fits>x</Snippet></List>`, `"fits" routes a <Snippet>`},
		{"valued dynamic param", `<List><Snippet user={ value }>x</Snippet></List>`, "parameters on <Snippet> are bare — write user, not user={ … }"},
		{"valued static param", `<List><Snippet user="value">x</Snippet></List>`, "parameters on <Snippet> are bare — write user, not user={ … }"},
		{"valued mixed param", `<List><Snippet user="pre-{ value }">x</Snippet></List>`, "parameters on <Snippet> are bare — write user, not user={ … }"},
		{"event param", `<List><Snippet @click={ value }>x</Snippet></List>`, "parameters on <Snippet> are bare"},
		{"invalid param", `<List><Snippet user-name>x</Snippet></List>`, "must be a valid identifier"},
		{"strict reserved param", `<List><Snippet class>x</Snippet></List>`, "not a legal binding identifier"},
		{"compiler reserved param", `<List><Snippet SNIPPET_TAG>x</Snippet></List>`, "snippet parameter \"SNIPPET_TAG\" uses a reserved name"},
		{"duplicate param", `<List><Snippet user user>x</Snippet></List>`, "duplicate snippet parameter \"user\""},
		{"duplicate fits attr", `<List><Snippet fits="row" fits="cell" user>x</Snippet></List>`, "duplicate fits attribute"},
		{"lowercase fits steer", `<List><snippet fits="row">x</snippet></List>`, `the snippet marker is spelled <Snippet ...>`},
		{"lowercase bare-param steer", `<List><snippet user>x</snippet></List>`, `the snippet marker is spelled <Snippet ...>`},
		{"outside component", `<Snippet user>x</Snippet>`, "only allowed as a direct child of a component invocation"},
		{"nested under element", `<List><div><Snippet user>x</Snippet></div></List>`, "only allowed as a direct child of a component invocation"},
		{"inside direct control flow", `<List>{#if show}<Snippet user>x</Snippet>{/if}</List>`, "put the <Snippet> immediately inside the component tag"},
		{"duplicate default snippets", `<List><Snippet user>a</Snippet><Snippet item>b</Snippet></List>`, `duplicate Snippet for "default"`},
		{"duplicate named snippets", `<List><Snippet fits="row" user>a</Snippet><Snippet fits="row" item>b</Snippet></List>`, `duplicate Snippet for "row"`},
		{"default snippet with plain content", `<List><Snippet user>x</Snippet><p>plain</p></List>`, "cannot be mixed with ordinary default content"},
		{"named snippet with slot content", `<List><Snippet fits="row" user>x</Snippet><p slot="row">plain</p></List>`, "conflicts with ordinary content routed to slot"},
		{"bare Children arg", `<Children user/>`, "bare attributes belong on <Snippet> as parameters"},
		{"bare Slot arg", `<Slot name="row" user/>`, "bare attributes belong on <Snippet> as parameters"},
		{"Children event", `<Children @ready={ ready }/>`, "<Children> does not take event handlers"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			src := `<puzzle-view>` + tc.src + `</puzzle-view>` + "\n<script></script>"
			_, err := Parse([]byte(src), "test.pzl")
			if err == nil {
				t.Fatal("expected positioned parse error")
			}
			pe, ok := err.(*ParseError)
			if !ok {
				t.Fatalf("error = %T (%v), want *ParseError", err, err)
			}
			if !strings.Contains(pe.Message, tc.want) {
				t.Fatalf("message = %q, want substring %q", pe.Message, tc.want)
			}
			if pe.Line < 1 || pe.Col < 1 {
				t.Fatalf("position = %d:%d, want positioned error", pe.Line, pe.Col)
			}
		})
	}
}

func TestParseSnippetCompositionRules(t *testing.T) {
	ok := []string{
		`<List><Snippet user>x</Snippet><p slot="footer">plain footer</p></List>`,
		`<List><Snippet fits="row" user>x</Snippet><Snippet fits="heading" group>h</Snippet></List>`,
		// One args-bearing marker AST site inside a loop is the intended N-stamp
		// shape. walkSlots visits the declaration once, regardless of iterations.
		`<ul>{#for user in users}<li><Children user={ user }/></li>{/for}</ul>`,
		// Component invocations themselves remain ordinary legal stamped output.
		`<List><Snippet item><Card><span>{ item }</span></Card></Snippet></List>`,
	}
	for _, content := range ok {
		if _, err := Parse([]byte(`<puzzle-view>`+content+`</puzzle-view>`+"\n<script></script>"), "test.pzl"); err != nil {
			t.Errorf("%s: unexpected error: %v", content, err)
		}
	}

	_, err := Parse([]byte(`<puzzle-view><div><Children/><Slot/></div></puzzle-view>`+"\n<script></script>"), "test.pzl")
	if err == nil || !strings.Contains(err.Error(), "duplicate default marker") {
		t.Fatalf("no-args duplicate markers must stay rejected, got %v", err)
	}

	duplicates := []struct {
		name string
		src  string
		want string
	}{
		{
			name: "distinct args-bearing named marker declarations",
			src:  `<div><Slot name="row" item={ first }/><Slot name="row" item={ second }/></div>`,
			want: `duplicate slot name "row"`,
		},
		{
			name: "distinct args-bearing default marker declarations",
			src:  `<div><Children item={ first }/><Slot item={ second }/></div>`,
			want: "duplicate default marker",
		},
	}
	for _, tc := range duplicates {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Parse([]byte(`<puzzle-view>`+tc.src+`</puzzle-view>`+"\n<script></script>"), "test.pzl")
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("distinct marker declarations must be rejected with %q, got %v", tc.want, err)
			}
		})
	}
}

// A snippet body is a composition LEAF (D166): no Children, Slot, Portal, or
// Snippet inside it at any depth, including a Snippet attached to a nested
// component invocation. The workaround is extraction — move that invocation and
// its snippet into their own component, whose template declares the marker at
// top level.
func TestParseSnippetBodyRejectsCompositionMarkers(t *testing.T) {
	tests := []struct {
		name   string
		body   string
		marker string
	}{
		{"direct Children", `<Children item={ item }/>`, `<Children item={ item }/>`},
		{"direct named Slot", `<Slot name="row" item={ item }/>`, `<Slot name="row" item={ item }/>`},
		{"nested below element", `<section><Slot/></section>`, `<Slot/>`},
		{"nested below control flow", `{#if item}<Children item={ item }/>{/if}`, `<Children item={ item }/>`},
		{"nested below component invocation", `<Card><Children item={ item }/></Card>`, `<Children item={ item }/>`},
		{"nested Snippet declaration", `<Card><Snippet cell>{ cell }</Snippet></Card>`, `<Snippet cell>`},
		{"nested below Portal", `<Portal><Slot name="overlay" item={ item }/></Portal>`, `<Slot name="overlay" item={ item }/>`},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			src := `<puzzle-view><List><Snippet item>` + tc.body + `</Snippet></List></puzzle-view>` + "\n<script></script>"
			_, err := Parse([]byte(src), "test.pzl")
			if err == nil {
				t.Fatal("expected positioned parse error")
			}
			pe, ok := err.(*ParseError)
			if !ok {
				t.Fatalf("error = %T (%v), want *ParseError", err, err)
			}
			wantMessage := "a composition marker cannot appear inside a <Snippet> body — stamped output cannot declare composition positions; put the marker in the component's own template, and to give a nested component invocation a snippet of its own, move that invocation and its snippet into their own component"
			if pe.Message != wantMessage {
				t.Fatalf("message = %q, want %q", pe.Message, wantMessage)
			}
			wantCol := strings.Index(src, tc.marker) + 1
			if pe.Line != 1 || pe.Col != wantCol {
				t.Fatalf("position = %d:%d, want 1:%d at inner marker", pe.Line, pe.Col, wantCol)
			}
		})
	}
}
