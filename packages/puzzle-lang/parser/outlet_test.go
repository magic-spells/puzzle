package parser

import (
	"strings"
	"testing"
)

// outletParseErr parses one template body wrapped in a view and returns the
// positioned error, failing the test when the parse succeeds.
func outletParseErr(t *testing.T, body string, opts ...Options) *ParseError {
	t.Helper()
	_, err := Parse([]byte("<puzzle-view>"+body+"</puzzle-view>\n<script></script>"), "test.pzl", opts...)
	if err == nil {
		t.Fatalf("%s: want a parse error, got none", body)
	}
	pe, ok := err.(*ParseError)
	if !ok {
		t.Fatalf("%s: error %T is not a *ParseError: %v", body, err, err)
	}
	return pe
}

// each of the three default-position tags records the spelling the author
// wrote, which is what the post-pass and the codemod read (D199).
func TestMarkerRecordsSpelling(t *testing.T) {
	cases := []struct{ src, marker, name string }{
		{"<Children/>", "Children", ""},
		{"<Outlet/>", "Outlet", ""},
		{"<Outlet><p>loading</p></Outlet>", "Outlet", ""},
		{`<Slot name="nav"/>`, "Slot", "nav"},
	}
	for _, c := range cases {
		root := parseContent(t, c.src)
		s, ok := elementChildren(root.Children)[0].(*Slot)
		if !ok {
			t.Fatalf("%s: expected *Slot", c.src)
		}
		if s.Marker != c.marker || s.Name != c.name {
			t.Errorf("%s: Marker = %q, Name = %q; want %q, %q", c.src, s.Marker, s.Name, c.marker, c.name)
		}
	}
}

// a <Slot> without a name is the pre-0.10 router outlet: it is a positioned
// error naming all three replacements, with a note that says which to pick
// and that the codemod does it.
func TestBareSlotIsAnError(t *testing.T) {
	for _, body := range []string{
		"<Slot/>",
		"<Slot />",
		"<Slot>fallback</Slot>",
		"<main><Slot/></main>",
		"{#if a}<Slot/>{/if}",
		"<Card><Slot/></Card>",
	} {
		pe := outletParseErr(t, body)
		if !strings.Contains(pe.Message, "<Slot> needs a name since 0.10 (D199)") {
			t.Errorf("%s: message = %q", body, pe.Message)
		}
		for _, want := range []string{"<Outlet/>", "<Children/>", "npx puzzle check --fix"} {
			if !strings.Contains(pe.Message+pe.Note, want) {
				t.Errorf("%s: error and note never mention %s", body, want)
			}
		}
		if pe.Line != 1 || pe.Col < 14 {
			t.Errorf("%s: position %d:%d should point at the <Slot> tag", body, pe.Line, pe.Col)
		}
	}
}

// the error is a post-pass rule, so a host that runs its own composition
// rules (Sites) still parses a bare <Slot/> the way it always has.
func TestBareSlotSkippedWithSlotCheck(t *testing.T) {
	src := []byte("<puzzle-view><Slot/></puzzle-view>\n<script></script>")
	if _, err := Parse(src, "test.pzl", Options{SkipSlotCheck: true}); err != nil {
		t.Fatalf("SkipSlotCheck: want no error, got %v", err)
	}
}

// <Outlet> takes no attributes, with a message for each likely mistake.
func TestOutletAttributes(t *testing.T) {
	cases := []struct{ body, want string }{
		{`<Outlet name="main"/>`, "<Outlet> takes no name"},
		{`<Outlet ref="o"/>`, "ref cannot be placed on an <Outlet>"},
		{`<Outlet class="x"/>`, "<Outlet> takes no attributes"},
		{`<Outlet item={ item }/>`, "<Outlet> takes no attributes"},
	}
	for _, c := range cases {
		if pe := outletParseErr(t, c.body); !strings.Contains(pe.Message, c.want) {
			t.Errorf("%s: message = %q, want it to contain %q", c.body, pe.Message, c.want)
		}
	}
}

// the lowercase spelling steers to the reserved tag rather than parsing as a
// custom element.
func TestLowercaseOutletSteers(t *testing.T) {
	for _, body := range []string{"<outlet/>", "<outlet></outlet>"} {
		if pe := outletParseErr(t, body); !strings.Contains(pe.Message, "the router outlet is spelled <Outlet/> (D199)") {
			t.Errorf("%s: message = %q", body, pe.Message)
		}
	}
}

// <Outlet/> and <Children/> fill the same default position, so a template may
// hold one of them per render path, never both.
func TestOutletAndChildrenShareOnePosition(t *testing.T) {
	pe := outletParseErr(t, "<Outlet/><Children/>")
	if !strings.Contains(pe.Message, "duplicate default marker (<Children/>/<Outlet/>)") {
		t.Errorf("message = %q", pe.Message)
	}
	if _, err := Parse([]byte("<puzzle-view>{#if a}<Outlet/>{:else}<Children/>{/if}</puzzle-view>\n<script></script>"), "test.pzl"); err != nil {
		t.Errorf("one per branch should parse, got %v", err)
	}
}
