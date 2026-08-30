package parser

import (
	"strings"
	"testing"
)

func TestParseScopedTemplates(t *testing.T) {
	root := parseContent(t, `<UserList>
  <Template fits="row" user group>
    <b>{ user.name } — { group.title }</b>
  </Template>
</UserList>`)
	list := elementChildren(root.Children)[0].(*Component)
	tmpl, ok := elementChildren(list.Children)[0].(*Template)
	if !ok {
		t.Fatalf("child = %T, want *Template", elementChildren(list.Children)[0])
	}
	if tmpl.Fits != "row" {
		t.Fatalf("Fits = %q, want row", tmpl.Fits)
	}
	if got := strings.Join(tmpl.Params, ","); got != "user,group" {
		t.Fatalf("Params = %q, want user,group", got)
	}
	if len(elementChildren(tmpl.Body)) != 1 {
		t.Fatalf("Body nodes = %d, want 1", len(elementChildren(tmpl.Body)))
	}
}

func TestParseScopedMarkerArgs(t *testing.T) {
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

func TestParseLowercaseTemplateElement(t *testing.T) {
	root := parseContent(t, `<template id="native"><span>ordinary HTML</span></template>`)
	el, ok := elementChildren(root.Children)[0].(*Element)
	if !ok || el.Tag != "template" {
		t.Fatalf("node = %#v, want ordinary <template> element", elementChildren(root.Children)[0])
	}
}

func TestParseScopedTemplateValidationErrors(t *testing.T) {
	tests := []struct {
		name string
		src  string
		want string
	}{
		{"self closing", `<List><Template user/></List>`, "<Template/> is paired-only"},
		{"dynamic fits", `<List><Template fits={ region } user>x</Template></List>`, "template target must be a static string"},
		{"mixed fits", `<List><Template fits="row-{ region }" user>x</Template></List>`, "template target must be a static string"},
		{"empty fits", `<List><Template fits="" user>x</Template></List>`, "<Template fits> cannot be empty"},
		{"fits cannot be a param", `<List><Template fits>x</Template></List>`, `"fits" routes a <Template>`},
		{"valued dynamic param", `<List><Template user={ value }>x</Template></List>`, "parameters on <Template> are bare — write user, not user={ … }"},
		{"valued static param", `<List><Template user="value">x</Template></List>`, "parameters on <Template> are bare — write user, not user={ … }"},
		{"valued mixed param", `<List><Template user="pre-{ value }">x</Template></List>`, "parameters on <Template> are bare — write user, not user={ … }"},
		{"event param", `<List><Template @click={ value }>x</Template></List>`, "parameters on <Template> are bare"},
		{"invalid param", `<List><Template user-name>x</Template></List>`, "must be a valid identifier"},
		{"strict reserved param", `<List><Template class>x</Template></List>`, "not a legal binding identifier"},
		{"compiler reserved param", `<List><Template TEMPLATE_TAG>x</Template></List>`, "template parameter \"TEMPLATE_TAG\" uses a reserved name"},
		{"duplicate param", `<List><Template user user>x</Template></List>`, "duplicate template parameter \"user\""},
		{"duplicate fits attr", `<List><Template fits="row" fits="cell" user>x</Template></List>`, "duplicate fits attribute"},
		{"lowercase marker steer", `<List><template fits="row">x</template></List>`, `the template marker is spelled <Template fits="…">`},
		{"outside component", `<Template user>x</Template>`, "only allowed as a direct child of a component invocation"},
		{"nested under element", `<List><div><Template user>x</Template></div></List>`, "only allowed as a direct child of a component invocation"},
		{"inside direct control flow", `<List>{#if show}<Template user>x</Template>{/if}</List>`, "put the <Template> immediately inside the component tag"},
		{"duplicate default templates", `<List><Template user>a</Template><Template item>b</Template></List>`, `duplicate Template for "default"`},
		{"duplicate named templates", `<List><Template fits="row" user>a</Template><Template fits="row" item>b</Template></List>`, `duplicate Template for "row"`},
		{"default template with plain content", `<List><Template user>x</Template><p>plain</p></List>`, "cannot be mixed with ordinary default content"},
		{"named template with slot content", `<List><Template fits="row" user>x</Template><p slot="row">plain</p></List>`, "conflicts with ordinary content routed to slot"},
		{"bare Children arg", `<Children user/>`, "bare attributes belong on <Template> as parameters"},
		{"bare Slot arg", `<Slot name="row" user/>`, "bare attributes belong on <Template> as parameters"},
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

func TestParseScopedTemplateCompositionRules(t *testing.T) {
	ok := []string{
		`<List><Template user>x</Template><p slot="footer">plain footer</p></List>`,
		`<List><Template fits="row" user>x</Template><Template fits="heading" group>h</Template></List>`,
		// One args-bearing marker AST site inside a loop is the intended N-stamp
		// shape. walkSlots visits the declaration once, regardless of iterations.
		`<ul>{#for user in users}<li><Children user={ user }/></li>{/for}</ul>`,
		// Component invocations themselves remain ordinary legal stamped output.
		`<List><Template item><Card><span>{ item }</span></Card></Template></List>`,
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

func TestParseScopedTemplateBodyRejectsCompositionMarkers(t *testing.T) {
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
		{"nested Template declaration", `<Card><Template cell>{ cell }</Template></Card>`, `<Template cell>`},
		{"nested below Portal", `<Portal><Slot name="overlay" item={ item }/></Portal>`, `<Slot name="overlay" item={ item }/>`},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			src := `<puzzle-view><List><Template item>` + tc.body + `</Template></List></puzzle-view>` + "\n<script></script>"
			_, err := Parse([]byte(src), "test.pzl")
			if err == nil {
				t.Fatal("expected positioned parse error")
			}
			pe, ok := err.(*ParseError)
			if !ok {
				t.Fatalf("error = %T (%v), want *ParseError", err, err)
			}
			wantMessage := "a composition marker cannot appear inside a <Template> body — stamped output cannot declare composition positions; put the marker in the component's own template"
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
