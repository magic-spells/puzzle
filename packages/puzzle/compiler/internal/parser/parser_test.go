package parser

import (
	"strings"
	"testing"
)

// parseContent wraps template content in a minimal .pzl file and returns the
// parsed <puzzle-view> root.
func parseContent(t *testing.T, content string) *Element {
	t.Helper()
	src := "<puzzle-view>" + content + "</puzzle-view>\n<script></script>"
	root, err := Parse([]byte(src), "test.pzl")
	if err != nil {
		t.Fatalf("unexpected parse error: %v", err)
	}
	return root
}

// elementChildren returns child nodes with whitespace-only Text nodes removed,
// so AST-shape assertions ignore inter-element whitespace.
func elementChildren(nodes []Node) []Node {
	var out []Node
	for _, n := range nodes {
		if tn, ok := n.(*Text); ok && strings.TrimSpace(tn.Value) == "" {
			continue
		}
		out = append(out, n)
	}
	return out
}

// serializeNodes renders a node list to a position-free string, so a template
// containing D70 comments can be asserted structurally identical to its
// comment-free equivalent (comments must leave zero trace in the AST). Only the
// node kinds exercised by the comment tests are handled.
func serializeNodes(nodes []Node) string {
	var b strings.Builder
	for _, n := range nodes {
		switch t := n.(type) {
		case *Text:
			// Whitespace-only text is inter-node noise the comment tests don't pin;
			// non-blank text is compared verbatim.
			if strings.TrimSpace(t.Value) == "" {
				b.WriteString("ws;")
			} else {
				b.WriteString("text(" + t.Value + ");")
			}
		case *Interpolation:
			b.WriteString("interp(" + t.Expr + ");")
		case *Element:
			b.WriteString("el:" + t.Tag + "[" + serializeNodes(t.Children) + "];")
		case *Component:
			b.WriteString("comp:" + t.Name + "[" + serializeNodes(t.Children) + "];")
		case *If:
			b.WriteString("if(" + t.Cond + "){" + serializeNodes(t.Then) + "|" + serializeNodes(t.Else) + "};")
		case *For:
			b.WriteString("for(" + t.Item + " in " + t.Collection + "){" + serializeNodes(t.Body) + "};")
		case *Case:
			b.WriteString("case(" + t.Expr + "){")
			for _, c := range t.Clauses {
				b.WriteString("when(" + strings.Join(c.Values, ",") + "):" + serializeNodes(c.Body) + ";")
			}
			b.WriteString("else:" + serializeNodes(t.Else) + "};")
		default:
			b.WriteString("?;")
		}
	}
	return b.String()
}

func TestParseInterpolationFormatters(t *testing.T) {
	tests := []struct {
		name     string
		content  string
		wantExpr string
		wantFmts []FormatterCall
	}{
		{
			name:     "no formatter",
			content:  "{ user.name }",
			wantExpr: "user.name",
		},
		{
			name:     "single formatter with quoted arg",
			content:  "{ todo.createdAt | date('short') }",
			wantExpr: "todo.createdAt",
			wantFmts: []FormatterCall{{Name: "date", Args: []string{"'short'"}}},
		},
		{
			name:     "join with comma inside quotes",
			content:  "{ names | join(', ') }",
			wantExpr: "names",
			wantFmts: []FormatterCall{{Name: "join", Args: []string{"', '"}}},
		},
		{
			name:     "chained formatters",
			content:  "{ text | trim | capitalize }",
			wantExpr: "text",
			wantFmts: []FormatterCall{{Name: "trim"}, {Name: "capitalize"}},
		},
		{
			name:     "logical-or is not a pipe",
			content:  "{ a || b }",
			wantExpr: "a || b",
		},
		{
			name:     "nested parens in formatter args",
			content:  "{ x | pad(max(1, 2), '0') }",
			wantExpr: "x",
			wantFmts: []FormatterCall{{Name: "pad", Args: []string{"max(1, 2)", "'0'"}}},
		},
		{
			// A '}' inside a regex must not close the interpolation early.
			name:     "regex with close brace",
			content:  "{ /}/.test(name) }",
			wantExpr: "/}/.test(name)",
		},
		{
			// A '|' inside a regex is not a formatter pipe.
			name:     "regex with pipe is not a formatter",
			content:  "{ /a|b/.test(name) }",
			wantExpr: "/a|b/.test(name)",
		},
		{
			// Genuine division still splits at the trailing formatter pipe.
			name:     "division still splits at pipe",
			content:  "{ a / b | upcase }",
			wantExpr: "a / b",
			wantFmts: []FormatterCall{{Name: "upcase"}},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			root := parseContent(t, tc.content)
			kids := elementChildren(root.Children)
			if len(kids) != 1 {
				t.Fatalf("expected 1 child, got %d", len(kids))
			}
			interp, ok := kids[0].(*Interpolation)
			if !ok {
				t.Fatalf("expected *Interpolation, got %T", kids[0])
			}
			if interp.Expr != tc.wantExpr {
				t.Errorf("expr: got %q, want %q", interp.Expr, tc.wantExpr)
			}
			if len(interp.Formatters) != len(tc.wantFmts) {
				t.Fatalf("formatter count: got %d, want %d", len(interp.Formatters), len(tc.wantFmts))
			}
			for i, f := range tc.wantFmts {
				if interp.Formatters[i].Name != f.Name {
					t.Errorf("fmt %d name: got %q, want %q", i, interp.Formatters[i].Name, f.Name)
				}
				if strings.Join(interp.Formatters[i].Args, "|") != strings.Join(f.Args, "|") {
					t.Errorf("fmt %d args: got %v, want %v", i, interp.Formatters[i].Args, f.Args)
				}
			}
		})
	}
}

func TestParseControlFlow(t *testing.T) {
	t.Run("if/else", func(t *testing.T) {
		root := parseContent(t, "{#if a > 0}<p>yes</p>{:else}<p>no</p>{/if}")
		kids := elementChildren(root.Children)
		ifn, ok := kids[0].(*If)
		if !ok {
			t.Fatalf("expected *If, got %T", kids[0])
		}
		if ifn.Cond != "a > 0" {
			t.Errorf("cond: got %q", ifn.Cond)
		}
		if len(elementChildren(ifn.Then)) != 1 || len(elementChildren(ifn.Else)) != 1 {
			t.Errorf("then/else branch shapes wrong")
		}
	})

	t.Run("for item in collection keyed body", func(t *testing.T) {
		root := parseContent(t, "{#for todo in filteredTodos}<div>{ todo.text }</div>{/for}")
		kids := elementChildren(root.Children)
		f, ok := kids[0].(*For)
		if !ok {
			t.Fatalf("expected *For, got %T", kids[0])
		}
		if f.Item != "todo" || f.Collection != "filteredTodos" || f.IsRange {
			t.Errorf("for header wrong: %+v", f)
		}
	})

	t.Run("range for", func(t *testing.T) {
		root := parseContent(t, "{#for 1...n}<li>x</li>{/for}")
		f := elementChildren(root.Children)[0].(*For)
		if !f.IsRange || f.RangeFrom != "1" || f.RangeTo != "n" {
			t.Errorf("range for wrong: %+v", f)
		}
	})
}

// TestParseForCounter covers the trailing loop-counter binding (0-based index
// for the item form, current number for the range form). Both counter-free forms
// must stay unchanged and a top-level comma must not be mis-peeled out of a
// collection literal or call expression.
func TestParseForCounter(t *testing.T) {
	tests := []struct {
		name        string
		content     string
		wantItem    string
		wantColl    string
		wantRange   bool
		wantFrom    string
		wantTo      string
		wantCounter string
	}{
		{
			name:        "item form with counter",
			content:     "{#for post in posts, i}<div>{ post.title }</div>{/for}",
			wantItem:    "post",
			wantColl:    "posts",
			wantCounter: "i",
		},
		{
			name:        "range form with counter",
			content:     "{#for 1...5, n}<span>{ n }</span>{/for}",
			wantRange:   true,
			wantFrom:    "1",
			wantTo:      "5",
			wantCounter: "n",
		},
		{
			name:        "counter with surrounding whitespace",
			content:     "{#for post in posts , i }<div>x</div>{/for}",
			wantItem:    "post",
			wantColl:    "posts",
			wantCounter: "i",
		},
		{
			name:     "item form unchanged without counter",
			content:  "{#for post in posts}<div>x</div>{/for}",
			wantItem: "post",
			wantColl: "posts",
		},
		{
			name:      "range form unchanged without counter",
			content:   "{#for 1...5}<span>x</span>{/for}",
			wantRange: true,
			wantFrom:  "1",
			wantTo:    "5",
		},
		{
			name:     "comma inside call is not a counter",
			content:  "{#for x in fn(a, b)}<div>x</div>{/for}",
			wantItem: "x",
			wantColl: "fn(a, b)",
		},
		{
			name:     "comma inside collection literal is not a counter",
			content:  "{#for x in [1, 2, 3]}<div>x</div>{/for}",
			wantItem: "x",
			wantColl: "[1, 2, 3]",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			root := parseContent(t, tc.content)
			f, ok := elementChildren(root.Children)[0].(*For)
			if !ok {
				t.Fatalf("expected *For, got %T", elementChildren(root.Children)[0])
			}
			if f.IsRange != tc.wantRange {
				t.Fatalf("IsRange: got %v, want %v", f.IsRange, tc.wantRange)
			}
			if f.Item != tc.wantItem || f.Collection != tc.wantColl {
				t.Errorf("item/coll: got %q/%q, want %q/%q", f.Item, f.Collection, tc.wantItem, tc.wantColl)
			}
			if f.RangeFrom != tc.wantFrom || f.RangeTo != tc.wantTo {
				t.Errorf("range: got %q...%q, want %q...%q", f.RangeFrom, f.RangeTo, tc.wantFrom, tc.wantTo)
			}
			if f.Counter != tc.wantCounter {
				t.Errorf("counter: got %q, want %q", f.Counter, tc.wantCounter)
			}
		})
	}
}

// TestParseForCounterNested pins that nested {#for} counters are shadow-distinct.
func TestParseForCounterNested(t *testing.T) {
	root := parseContent(t, "{#for row in rows, i}<ul>{#for cell in row.cells, j}<li>x</li>{/for}</ul>{/for}")
	outer := elementChildren(root.Children)[0].(*For)
	if outer.Item != "row" || outer.Counter != "i" {
		t.Fatalf("outer for wrong: %+v", outer)
	}
	inner := elementChildren(outer.Body)[0].(*Element)
	innerFor := elementChildren(inner.Children)[0].(*For)
	if innerFor.Item != "cell" || innerFor.Collection != "row.cells" || innerFor.Counter != "j" {
		t.Errorf("inner for wrong: %+v", innerFor)
	}
}

// TestParseForCounterErrors covers the empty-tail and item/counter-collision
// error cases.
func TestParseForCounterErrors(t *testing.T) {
	tests := []struct {
		name       string
		content    string
		wantSubstr string
	}{
		{
			name:       "empty tail after comma",
			content:    "{#for x in xs,}<div>x</div>{/for}",
			wantSubstr: "{#for} loop counter is empty",
		},
		{
			name:       "counter duplicates item name",
			content:    "{#for x in xs, x}<div>x</div>{/for}",
			wantSubstr: "duplicates the item name",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			src := "<puzzle-view>" + tc.content + "</puzzle-view>\n<script></script>"
			_, err := Parse([]byte(src), "test.pzl")
			if err == nil {
				t.Fatalf("expected error, got nil")
			}
			if !strings.Contains(err.Error(), tc.wantSubstr) {
				t.Fatalf("error %q does not contain %q", err.Error(), tc.wantSubstr)
			}
		})
	}
}

func TestParseForReservedIdentifiers(t *testing.T) {
	tests := []struct {
		name    string
		content string
		ident   string
	}{
		{name: "reserved item prefix", content: "{#for __d in items}<div>x</div>{/for}", ident: "__d"},
		{name: "reserved counter prefix", content: "{#for item in items, __i}<div>x</div>{/for}", ident: "__i"},
		{name: "reserved ViewNode item", content: "{#for ViewNode in items}<div>x</div>{/for}", ident: "ViewNode"},
		{name: "reserved ViewNode counter", content: "{#for item in items, ViewNode}<div>x</div>{/for}", ident: "ViewNode"},
		// SLOT_TAG is imported whenever the template holds a slot; a loop binding of
		// that name shadows the outlet marker inside the body.
		{name: "reserved SLOT_TAG item", content: "{#for SLOT_TAG in items}<Slot/>{/for}", ident: "SLOT_TAG"},
		{name: "reserved SLOT_TAG counter", content: "{#for item in items, SLOT_TAG}<Slot/>{/for}", ident: "SLOT_TAG"},
		// Reserved regardless of whether this template actually emits the import.
		{name: "reserved SLOT_TAG without a slot", content: "{#for SLOT_TAG in items}<div>x</div>{/for}", ident: "SLOT_TAG"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			src := "<puzzle-view>" + tc.content + "</puzzle-view>\n<script></script>"
			_, err := Parse([]byte(src), "test.pzl")
			if err == nil {
				t.Fatal("expected a reserved loop identifier error")
			}
			want := `loop variable "` + tc.ident + `" uses a reserved name (identifiers starting with "__" and the names "ViewNode", "SLOT_TAG" and "PORTAL_TAG" are reserved by the compiler)`
			if !strings.Contains(err.Error(), want) {
				t.Errorf("error %q should contain %q", err, want)
			}
			if !strings.Contains(err.Error(), "test.pzl:1:") {
				t.Errorf("error should be positioned at test.pzl:1, got %v", err)
			}
		})
	}
}

func TestParseForRejectsStrictModeReservedBindings(t *testing.T) {
	reserved := strings.Fields(
		"break class const return new this let await yield var function typeof delete in static enum super null true false import export do if else for while switch case default try catch finally throw void instanceof with debugger " +
			"continue extends implements interface package private protected public arguments eval",
	)
	for _, ident := range reserved {
		t.Run(ident, func(t *testing.T) {
			src := "<puzzle-view>{#for " + ident + " in items}<div>x</div>{/for}</puzzle-view>"
			_, err := Parse([]byte(src), "test.pzl")
			if err == nil {
				t.Fatalf("expected %q to be rejected as a loop binding", ident)
			}
			pe, ok := err.(*ParseError)
			if !ok {
				t.Fatalf("error type = %T, want *ParseError", err)
			}
			if pe.Line != 1 || pe.Col != 14 {
				t.Fatalf("position = %d:%d, want 1:14", pe.Line, pe.Col)
			}
			want := `loop variable "` + ident + `" is not a legal binding identifier in strict-mode JavaScript`
			if pe.Message != want {
				t.Fatalf("message = %q, want %q", pe.Message, want)
			}
		})
	}
}

func TestParseForRejectsReservedCounters(t *testing.T) {
	tests := map[string]string{
		"item form":  "{#for item in items, class}<div>x</div>{/for}",
		"range form": "{#for 1...3, class}<div>x</div>{/for}",
	}
	for name, content := range tests {
		t.Run(name, func(t *testing.T) {
			src := "<puzzle-view>" + content + "</puzzle-view>"
			_, err := Parse([]byte(src), "test.pzl")
			if err == nil {
				t.Fatal("expected reserved loop counter to be rejected")
			}
			if !strings.Contains(err.Error(), `loop variable "class" is not a legal binding identifier in strict-mode JavaScript`) {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}

func TestParseForAllowsContextualBindingIdentifiers(t *testing.T) {
	for _, ident := range []string{"of", "async", "get", "set"} {
		t.Run(ident+" item", func(t *testing.T) {
			parseContent(t, "{#for "+ident+" in items}<div>x</div>{/for}")
		})
		t.Run(ident+" counter", func(t *testing.T) {
			parseContent(t, "{#for item in items, "+ident+"}<div>x</div>{/for}")
		})
	}
}

// TestParseForItemIdentifier pins that the loop variable is validated as a bare
// JS identifier (the same isBareIdent rule as the counter): a '$'-prefixed name
// is accepted, while a name carrying an HTML-name char like '-' is a positioned
// compile error instead of compiling into invalid JS.
func TestParseForItemIdentifier(t *testing.T) {
	t.Run("dollar-prefixed item is accepted", func(t *testing.T) {
		root := parseContent(t, "{#for $foo in items}<div>{ $foo }</div>{/for}")
		f, ok := elementChildren(root.Children)[0].(*For)
		if !ok {
			t.Fatalf("expected *For, got %T", elementChildren(root.Children)[0])
		}
		if f.Item != "$foo" || f.Collection != "items" || f.IsRange {
			t.Errorf("for header wrong: %+v", f)
		}
	})

	t.Run("hyphenated item is a positioned error", func(t *testing.T) {
		src := "<puzzle-view>{#for todo-item in items}<div>x</div>{/for}</puzzle-view>\n<script></script>"
		_, err := Parse([]byte(src), "test.pzl")
		if err == nil {
			t.Fatal("expected an error for a non-identifier {#for} item")
		}
		if !strings.Contains(err.Error(), "{#for} item must be a valid identifier") {
			t.Errorf("unexpected error message: %v", err)
		}
		if !strings.Contains(err.Error(), "todo-item") {
			t.Errorf("error should name the offending item, got: %v", err)
		}
	})
}

// TestParseUnless covers {#unless}, which desugars at parse time into the If
// node with a precedence-safe negated condition so codegen reuses the
// conditional path. The body is the Then branch (renders when expr is falsy);
// an optional {:else} becomes the Else branch (renders when expr is truthy).
func TestParseUnless(t *testing.T) {
	t.Run("bare unless desugars to negated If", func(t *testing.T) {
		root := parseContent(t, "{#unless done}<p>x</p>{/unless}")
		kids := elementChildren(root.Children)
		ifn, ok := kids[0].(*If)
		if !ok {
			t.Fatalf("expected *If (desugared), got %T", kids[0])
		}
		if ifn.Cond != "!(done)" {
			t.Errorf("cond: got %q, want %q", ifn.Cond, "!(done)")
		}
		if len(elementChildren(ifn.Then)) != 1 {
			t.Errorf("then branch: got %d nodes, want 1", len(elementChildren(ifn.Then)))
		}
		if ifn.Else != nil {
			t.Errorf("else branch: got %v, want nil", ifn.Else)
		}
	})

	t.Run("unless with else", func(t *testing.T) {
		root := parseContent(t, "{#unless user.active}<p>off</p>{:else}<p>on</p>{/unless}")
		ifn := elementChildren(root.Children)[0].(*If)
		if ifn.Cond != "!(user.active)" {
			t.Errorf("cond: got %q, want %q", ifn.Cond, "!(user.active)")
		}
		if len(elementChildren(ifn.Then)) != 1 || len(elementChildren(ifn.Else)) != 1 {
			t.Errorf("then/else shapes wrong")
		}
	})

	t.Run("nested unless inside unless", func(t *testing.T) {
		root := parseContent(t, "{#unless a}{#unless b}<p>x</p>{/unless}{/unless}")
		outer := elementChildren(root.Children)[0].(*If)
		if outer.Cond != "!(a)" {
			t.Fatalf("outer cond: got %q", outer.Cond)
		}
		inner, ok := elementChildren(outer.Then)[0].(*If)
		if !ok {
			t.Fatalf("expected nested *If, got %T", elementChildren(outer.Then)[0])
		}
		if inner.Cond != "!(b)" {
			t.Errorf("inner cond: got %q", inner.Cond)
		}
	})

	t.Run("unless nested in if", func(t *testing.T) {
		root := parseContent(t, "{#if a}{#unless b}<p>x</p>{/unless}{/if}")
		outer := elementChildren(root.Children)[0].(*If)
		if outer.Cond != "a" {
			t.Fatalf("outer if cond: got %q", outer.Cond)
		}
		inner := elementChildren(outer.Then)[0].(*If)
		if inner.Cond != "!(b)" {
			t.Errorf("inner unless cond: got %q", inner.Cond)
		}
	})
}

// TestParseComment covers D70 template comments: both spellings vanish from the
// AST, so a template with comments at structural boundaries parses identically to
// its comment-free equivalent (compared position-free via serializeNodes).
func TestParseComment(t *testing.T) {
	tests := []struct {
		name        string
		withComment string
		plain       string
	}{
		{
			name:        "inline comment between {#case} and its first {:when}",
			withComment: "{#case s}{## pick a branch }{:when 'a'}<p>x</p>{:when 'b'}<p>y</p>{/case}",
			plain:       "{#case s}{:when 'a'}<p>x</p>{:when 'b'}<p>y</p>{/case}",
		},
		{
			name:        "inline comment between {#case} clauses",
			withComment: "{#case s}{:when 'a'}<p>x</p>{## note }{:when 'b'}<p>y</p>{/case}",
			plain:       "{#case s}{:when 'a'}<p>x</p>{:when 'b'}<p>y</p>{/case}",
		},
		{
			name:        "inline comment adjacent to {:else}",
			withComment: "{#if a}<p>x</p>{## disabled }{:else}<p>y</p>{/if}",
			plain:       "{#if a}<p>x</p>{:else}<p>y</p>{/if}",
		},
		{
			name:        "block comment adjacent to {:else}",
			withComment: "{#if a}<p>x</p>{#comment}whole branch off{/comment}{:else}<p>y</p>{/if}",
			plain:       "{#if a}<p>x</p>{:else}<p>y</p>{/if}",
		},
		{
			name:        "inline comment inside a {#for} body",
			withComment: "{#for item in items}{## lead }<li>{ item.name }</li>{## trail }{/for}",
			plain:       "{#for item in items}<li>{ item.name }</li>{/for}",
		},
		{
			name:        "block comment with raw body inside a {#for}",
			withComment: "{#for item in items}<li>{ item.name }</li>{#comment}{#if broken}<span>{/comment}{/for}",
			plain:       "{#for item in items}<li>{ item.name }</li>{/for}",
		},
		{
			name:        "comment between sibling elements",
			withComment: "<section>{## header note }<h1>Title</h1></section>",
			plain:       "<section><h1>Title</h1></section>",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := serializeNodes(parseContent(t, tc.withComment).Children)
			want := serializeNodes(parseContent(t, tc.plain).Children)
			if got != want {
				t.Fatalf("comment version differs from plain:\n  got:  %s\n  want: %s", got, want)
			}
		})
	}

	t.Run("comments work in a skeleton via ParseSkeleton", func(t *testing.T) {
		mk := func(body string) *Element {
			src := "<puzzle-view><span>a</span></puzzle-view>\n<puzzle-skeleton>" + body +
				"</puzzle-skeleton>\n<script></script>"
			sec, err := SplitSections(src, "test.pzl")
			if err != nil {
				t.Fatalf("split: %v", err)
			}
			root, err := ParseSkeleton(sec, "test.pzl")
			if err != nil {
				t.Fatalf("parse skeleton: %v", err)
			}
			return root
		}
		got := serializeNodes(mk("{## loading note }<div>{#comment}x{/comment}Loading…</div>").Children)
		want := serializeNodes(mk("<div>Loading…</div>").Children)
		if got != want {
			t.Fatalf("skeleton comment version differs from plain:\n  got:  %s\n  want: %s", got, want)
		}
	})
}

// TestParseCommentErrors covers the positioned error cases for D70 comments in
// contexts where they are rejected or malformed.
func TestParseCommentErrors(t *testing.T) {
	tests := []struct {
		name       string
		content    string
		wantSubstr string
	}{
		{
			name:       "inline comment in a quoted attribute value",
			content:    `<div class="a {## note } b"></div>`,
			wantSubstr: "template comments are not allowed in attribute values",
		},
		{
			name:       "block comment in a quoted attribute value",
			content:    `<div class="a {#comment}x{/comment} b"></div>`,
			wantSubstr: "template comments are not allowed in attribute values",
		},
		{
			name:       "inline comment in an unquoted attribute value",
			content:    `<div data-x={##note}></div>`,
			wantSubstr: "template comments are not allowed in attribute values",
		},
		{
			name:       "block comment in an unquoted attribute value",
			content:    `<div data-x={#comment}></div>`,
			wantSubstr: "template comments are not allowed in attribute values",
		},
		{
			name:       "stray {/comment} at root",
			content:    `<p>x</p>{/comment}`,
			wantSubstr: "unexpected {/comment}",
		},
		{
			name:       "unterminated block comment",
			content:    `<p>x</p>{#comment}never closed`,
			wantSubstr: "unterminated {#comment} — expected {/comment}",
		},
		{
			name:       "unclosed inline comment",
			content:    `<p>x</p>{## never closed`,
			wantSubstr: "unclosed {## comment",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			src := "<puzzle-view>" + tc.content + "</puzzle-view>\n<script></script>"
			_, err := Parse([]byte(src), "test.pzl")
			if err == nil {
				t.Fatalf("expected error, got nil")
			}
			if !strings.Contains(err.Error(), tc.wantSubstr) {
				t.Fatalf("error %q does not contain %q", err.Error(), tc.wantSubstr)
			}
		})
	}
}

// TestParseRaw covers D150's lex-off block through the AST. Raw text becomes
// literal Text nodes, but HTML inside the span remains ordinary elements.
func TestParseRaw(t *testing.T) {
	t.Run("JSON body is one literal text node", func(t *testing.T) {
		root := parseContent(t, `<script type="application/json">{#raw}{ "loop": true, "slidesPerView": 3 }{/raw}</script>`)
		script := elementChildren(root.Children)[0].(*Element)
		if script.Tag != "script" {
			t.Fatalf("tag: got %q, want script", script.Tag)
		}
		kids := elementChildren(script.Children)
		if len(kids) != 1 {
			t.Fatalf("script children: got %d, want 1", len(kids))
		}
		text, ok := kids[0].(*Text)
		if !ok || text.Value != `{ "loop": true, "slidesPerView": 3 }` {
			t.Fatalf("raw JSON: got %#v", kids[0])
		}
	})

	t.Run("script raw body keeps tag-like and closing-tag text opaque", func(t *testing.T) {
		body := `{ "html": "<b>x</b>", "closer": "</script>" }`
		root := parseContent(t, `<script type="application/json">{#raw}`+body+`{/raw}</script>`)
		script := elementChildren(root.Children)[0].(*Element)
		kids := elementChildren(script.Children)
		if len(kids) != 1 {
			t.Fatalf("script children: got %d, want one opaque text node", len(kids))
		}
		text, ok := kids[0].(*Text)
		if !ok || text.Value != body {
			t.Fatalf("script raw body: got %#v, want %q", kids[0], body)
		}
	})

	t.Run("HTML body parses as elements", func(t *testing.T) {
		root := parseContent(t, `{#raw}<b>hi</b><i>{ literal }</i>{/raw}`)
		kids := elementChildren(root.Children)
		if len(kids) != 2 {
			t.Fatalf("children: got %d, want 2", len(kids))
		}
		bold, ok := kids[0].(*Element)
		if !ok || bold.Tag != "b" {
			t.Fatalf("first child: got %#v, want <b>", kids[0])
		}
		italic, ok := kids[1].(*Element)
		if !ok || italic.Tag != "i" {
			t.Fatalf("second child: got %#v, want <i>", kids[1])
		}
		text := elementChildren(italic.Children)[0].(*Text)
		if text.Value != "{ literal }" {
			t.Fatalf("italic text: got %q", text.Value)
		}
	})

	t.Run("block-looking text and formatter pipes stay literal", func(t *testing.T) {
		root := parseContent(t, `<pre>{#raw}{#if ok}{#comment}x{/comment}{:else}{ value | upper }{/if}{/raw}</pre>`)
		pre := elementChildren(root.Children)[0].(*Element)
		text := elementChildren(pre.Children)[0].(*Text)
		want := `{#if ok}{#comment}x{/comment}{:else}{ value | upper }{/if}`
		if text.Value != want {
			t.Fatalf("literal grammar: got %q, want %q", text.Value, want)
		}
	})

	t.Run("closer whitespace variants", func(t *testing.T) {
		for _, closer := range []string{"{/raw}", "{/ raw }", "{/raw }"} {
			root := parseContent(t, "{#raw}x"+closer)
			text := elementChildren(root.Children)[0].(*Text)
			if text.Value != "x" {
				t.Fatalf("closer %q: got %q", closer, text.Value)
			}
		}
	})

	t.Run("brace-valued attributes are static and @event is literal", func(t *testing.T) {
		root := parseContent(t, `{#raw}<button @click={ handler } data-json={ {"x": 1} }>x</button>{/raw}`)
		button := elementChildren(root.Children)[0].(*Element)
		if len(button.Attrs) != 2 {
			t.Fatalf("attrs: got %d, want 2", len(button.Attrs))
		}
		click, ok := button.Attrs[0].(*StaticAttr)
		if !ok || click.Name != "@click" || click.Value != "{ handler }" || !click.LiteralName {
			t.Fatalf("literal @click attr: got %#v", button.Attrs[0])
		}
		data, ok := button.Attrs[1].(*StaticAttr)
		if !ok || data.Value != `{ {"x": 1} }` {
			t.Fatalf("literal data attr: got %#v", button.Attrs[1])
		}
		if !data.LiteralName {
			t.Fatalf("non-@ raw attr must also be a literal name: got %#v", data)
		}
	})

	// Every attribute in a raw body is an authored literal, not just the
	// @-prefixed ones: a framework directive name there is sample markup, so it
	// must neither fail the build nor be wired up.
	t.Run("framework directive attrs are literal names", func(t *testing.T) {
		root := parseContent(t, `{#raw}<li ref="my-chart" island="false" key="row-1" flip>x</li>{/raw}`)
		li := elementChildren(root.Children)[0].(*Element)
		if len(li.Attrs) != 4 {
			t.Fatalf("attrs: got %d, want 4", len(li.Attrs))
		}
		for _, a := range li.Attrs {
			at, ok := a.(*StaticAttr)
			if !ok || !at.LiteralName {
				t.Fatalf("attr %#v is not a literal-name static attr", a)
			}
		}
	})

	t.Run("directive attr names that would fail validation are accepted", func(t *testing.T) {
		// Each of these is a compile error in a live template: a non-identifier
		// ref name, a duplicate ref name, a valued island, and a reserved
		// attribute namespace. In sample markup they are just bytes.
		for _, content := range []string{
			`{#raw}<div ref="my-chart"></div>{/raw}`,
			`{#raw}<div ref="input"></div><span ref="input"></span>{/raw}`,
			`{#raw}<div island="false"></div>{/raw}`,
			`{#raw}<input bind:value="x" />{/raw}`,
		} {
			src := "<puzzle-view>" + content + "</puzzle-view>\n<script></script>"
			if _, err := Parse([]byte(src), "test.pzl"); err != nil {
				t.Fatalf("raw body %q: unexpected error %v", content, err)
			}
		}
	})

	// A raw body documents markup, so composition markers and component tags are
	// literal elements there — not instantiated, and not D134 steering errors.
	t.Run("markers and components are literal elements", func(t *testing.T) {
		root := parseContent(t, `{#raw}<slot></slot><children/><Children/><Slot name="header"/><Portal>x</Portal><Card title="a"/>{/raw}`)
		kids := elementChildren(root.Children)
		want := []string{"slot", "children", "Children", "Slot", "Portal", "Card"}
		if len(kids) != len(want) {
			t.Fatalf("children: got %d, want %d (%#v)", len(kids), len(want), kids)
		}
		for i, tag := range want {
			el, ok := kids[i].(*Element)
			if !ok {
				t.Fatalf("child %d (%s): got %#v, want a literal *Element", i, tag, kids[i])
			}
			if el.Tag != tag {
				t.Fatalf("child %d: tag %q, want %q", i, el.Tag, tag)
			}
		}
	})

	t.Run("marker grammar still applies outside the raw block", func(t *testing.T) {
		src := "<puzzle-view>{#raw}<slot></slot>{/raw}<slot></slot></puzzle-view>\n<script></script>"
		_, err := Parse([]byte(src), "test.pzl")
		if err == nil || !strings.Contains(err.Error(), "bare <slot> is not a marker") {
			t.Fatalf("error: got %v, want the D134 steering error", err)
		}
	})

	t.Run("raw blocks work in skeleton bodies", func(t *testing.T) {
		src := `<puzzle-view><span>loaded</span></puzzle-view>
<puzzle-skeleton><pre>{#raw}{ "loading": true }{/raw}</pre></puzzle-skeleton>
<script></script>`
		sec, err := SplitSections(src, "test.pzl")
		if err != nil {
			t.Fatalf("split: %v", err)
		}
		root, err := ParseSkeleton(sec, "test.pzl")
		if err != nil {
			t.Fatalf("parse skeleton: %v", err)
		}
		pre := elementChildren(root.Children)[0].(*Element)
		text := elementChildren(pre.Children)[0].(*Text)
		if text.Value != `{ "loading": true }` {
			t.Fatalf("skeleton raw text: got %q", text.Value)
		}
	})
}

// rawTextFlags renders a node list as one string per node: `raw(…)` for text
// still claiming raw bytes, `text(…)` for text back under the ordinary
// whitespace policy, and `<tag>` for anything structural.
func rawTextFlags(nodes []Node) []string {
	out := make([]string, 0, len(nodes))
	for _, n := range nodes {
		switch t := n.(type) {
		case *Text:
			if t.Raw {
				out = append(out, "raw("+t.Value+")")
			} else {
				out = append(out, "text("+t.Value+")")
			}
		case *Element:
			out = append(out, "<"+t.Tag+">")
		default:
			out = append(out, "node")
		}
	}
	return out
}

// TestParseRawMarkerLayout pins the boundary D150 has to draw between the bytes
// a {#raw} body preserves and the newline/indentation an author spends writing
// {#raw} and {/raw} on their own lines. The span is flattened into the enclosing
// child list, so only the parser can still see which text nodes sit at its two
// ends; leaving those flagged raw materializes formatting as text vnodes and
// trips the single-root gates ({#for} body, component root, component skeleton).
func TestParseRawMarkerLayout(t *testing.T) {
	t.Run("span edges demote, interior stays raw", func(t *testing.T) {
		root := parseContent(t, "{#raw}\n    <b>a</b>   <i>b</i>\n  {/raw}")
		got := rawTextFlags(root.Children)
		want := []string{
			"text(\n    )", "<b>", "raw(   )", "<i>", "text(\n  )",
		}
		if strings.Join(got, "|") != strings.Join(want, "|") {
			t.Fatalf("raw span nodes:\n got %q\nwant %q", got, want)
		}
	})

	t.Run("edge bytes are demoted, never rewritten", func(t *testing.T) {
		root := parseContent(t, "{#raw}\n\t  <b>a</b>{/raw}")
		lead, ok := root.Children[0].(*Text)
		if !ok {
			t.Fatalf("first node: got %#v, want Text", root.Children[0])
		}
		if lead.Raw {
			t.Fatalf("leading marker layout still flagged raw")
		}
		if lead.Value != "\n\t  " {
			t.Fatalf("leading bytes: got %q, want %q", lead.Value, "\n\t  ")
		}
	})

	t.Run("an all-whitespace span is content, not layout", func(t *testing.T) {
		// {#raw} wrapped around nothing but whitespace can only be a request to
		// keep it: there is no content for those bytes to be laying out.
		root := parseContent(t, "<p>before{#raw}\n  \t\n{/raw}after</p>")
		p := elementChildren(root.Children)[0].(*Element)
		got := rawTextFlags(p.Children)
		want := []string{"text(before)", "raw(\n  \t\n)", "text(after)"}
		if strings.Join(got, "|") != strings.Join(want, "|") {
			t.Fatalf("whitespace-only raw span:\n got %q\nwant %q", got, want)
		}
	})

	t.Run("only the outermost span edges demote", func(t *testing.T) {
		// Text at the edges of a NESTED element inside the span is captured
		// content, not marker layout, so it keeps its bytes verbatim.
		root := parseContent(t, "{#raw}\n  <pre>\n  x\n  </pre>\n{/raw}")
		pre := elementChildren(root.Children)[0].(*Element)
		got := rawTextFlags(pre.Children)
		want := []string{"raw(\n  x\n  )"}
		if strings.Join(got, "|") != strings.Join(want, "|") {
			t.Fatalf("nested raw content:\n got %q\nwant %q", got, want)
		}
	})

	t.Run("script/style bodies are untouched", func(t *testing.T) {
		// The RAWTEXT path captures the whole body as one node; its edges are
		// content the JSON/CSS author wrote, and no gate ever counts them.
		root := parseContent(t, "<script type=\"application/json\">{#raw}\n  { \"a\": 1 }\n{/raw}</script>")
		script := elementChildren(root.Children)[0].(*Element)
		text := script.Children[0].(*Text)
		if !text.Raw || text.Value != "\n  { \"a\": 1 }\n" {
			t.Fatalf("script raw body: got raw=%v %q", text.Raw, text.Value)
		}
	})
}

func TestParseRawErrors(t *testing.T) {
	tests := []struct {
		name       string
		content    string
		wantSubstr string
	}{
		{"quoted attribute", `<div class="a {#raw}x{/raw}"></div>`, "{#raw} blocks are not allowed in attribute values"},
		{"unquoted attribute", `<div data-x={#raw}></div>`, "{#raw} blocks are not allowed in attribute values"},
		{"unterminated", `<p>x</p>{#raw}{ "x": 1 }`, "unterminated {#raw} — expected {/raw}"},
		{"stray closer", `<p>x</p>{/raw}`, "unexpected {/raw}"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			src := "<puzzle-view>" + tc.content + "</puzzle-view>\n<script></script>"
			_, err := Parse([]byte(src), "test.pzl")
			if err == nil || !strings.Contains(err.Error(), tc.wantSubstr) {
				t.Fatalf("error: got %v, want substring %q", err, tc.wantSubstr)
			}
		})
	}

	t.Run("attribute error is positioned at raw opener", func(t *testing.T) {
		src := "<puzzle-view>\n  <div class=\"a {#raw}x{/raw}\"></div>\n</puzzle-view>"
		_, err := Parse([]byte(src), "test.pzl")
		perr, ok := err.(*ParseError)
		if !ok {
			t.Fatalf("error: got %T %v, want *ParseError", err, err)
		}
		if perr.Line != 2 || perr.Col != 17 {
			t.Fatalf("error position: got %d:%d, want 2:17", perr.Line, perr.Col)
		}
	})
}

// TestParseElseIf covers {:else if} chaining (D40), which desugars at parse time
// into nested If nodes in the parent's Else list — codegen reuses the
// conditional path unchanged.
func TestParseElseIf(t *testing.T) {
	t.Run("single else-if nests one If in the Else branch", func(t *testing.T) {
		root := parseContent(t, "{#if a}<p>x</p>{:else if b}<p>y</p>{/if}")
		outer, ok := elementChildren(root.Children)[0].(*If)
		if !ok {
			t.Fatalf("expected *If, got %T", elementChildren(root.Children)[0])
		}
		if outer.Cond != "a" {
			t.Errorf("outer cond: got %q, want %q", outer.Cond, "a")
		}
		if len(elementChildren(outer.Then)) != 1 {
			t.Errorf("outer then: got %d nodes, want 1", len(elementChildren(outer.Then)))
		}
		// Else holds exactly the desugared nested If (no whitespace nodes).
		if len(outer.Else) != 1 {
			t.Fatalf("outer else: got %d nodes, want 1 (nested If)", len(outer.Else))
		}
		inner, ok := outer.Else[0].(*If)
		if !ok {
			t.Fatalf("expected nested *If in Else, got %T", outer.Else[0])
		}
		if inner.Cond != "b" {
			t.Errorf("inner cond: got %q, want %q", inner.Cond, "b")
		}
		if len(elementChildren(inner.Then)) != 1 {
			t.Errorf("inner then: got %d nodes, want 1", len(elementChildren(inner.Then)))
		}
		if inner.Else != nil {
			t.Errorf("inner else: got %v, want nil", inner.Else)
		}
	})

	t.Run("chain of two else-if with trailing else nests fully", func(t *testing.T) {
		root := parseContent(t, "{#if a}<p>1</p>{:else if b}<p>2</p>{:else if c}<p>3</p>{:else}<p>4</p>{/if}")
		outer := elementChildren(root.Children)[0].(*If)
		if outer.Cond != "a" {
			t.Fatalf("outer cond: got %q", outer.Cond)
		}
		second := outer.Else[0].(*If)
		if second.Cond != "b" {
			t.Fatalf("second cond: got %q", second.Cond)
		}
		third := second.Else[0].(*If)
		if third.Cond != "c" {
			t.Fatalf("third cond: got %q", third.Cond)
		}
		// The final {:else} body lands as the innermost Else (no more nested If).
		if len(elementChildren(third.Else)) != 1 {
			t.Fatalf("final else: got %d nodes, want 1", len(elementChildren(third.Else)))
		}
		if _, isIf := third.Else[0].(*If); isIf {
			t.Fatalf("final else should be the {:else} body, not a nested If")
		}
	})
}

// TestParseElseIfErrors covers the positioned error cases specific to {:else if}
// chaining in {#if}.
func TestParseElseIfErrors(t *testing.T) {
	tests := []struct {
		name       string
		content    string
		wantSubstr string
	}{
		{
			name:       "else-if after else must be last clause",
			content:    "{#if a}x{:else}y{:else if b}z{/if}",
			wantSubstr: "{:else} must be the last clause",
		},
		{
			name:       "bare else-if requires a condition",
			content:    "{#if a}x{:else if}y{/if}",
			wantSubstr: "{:else if} requires a condition",
		},
		{
			name:       "else-if at template root is outside an if block",
			content:    "{:else if b}x",
			wantSubstr: "{:else if} outside of {#if} block",
		},
		{
			name:       "unclosed if with else-if names the if opener",
			content:    "{#if a}x{:else if b}y",
			wantSubstr: "unclosed {#if}",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			src := "<puzzle-view>" + tc.content + "</puzzle-view>\n<script></script>"
			_, err := Parse([]byte(src), "test.pzl")
			if err == nil {
				t.Fatalf("expected error, got nil")
			}
			if !strings.Contains(err.Error(), tc.wantSubstr) {
				t.Fatalf("error %q does not contain %q", err.Error(), tc.wantSubstr)
			}
		})
	}
}

// TestParseUnlessErrors covers the positioned error cases specific to {#unless}:
// {:else if} is rejected (suggest {#if}), and unclosed / mismatched closers name
// the {#unless} opener.
func TestParseUnlessErrors(t *testing.T) {
	tests := []struct {
		name       string
		content    string
		wantSubstr string
	}{
		{
			name:       "else-if in unless suggests restructuring as if",
			content:    "{#unless a}x{:else if b}y{/unless}",
			wantSubstr: "{:else if} is not allowed inside {#unless}",
		},
		{
			name:       "unclosed unless",
			content:    "{#unless a}<p>x</p>",
			wantSubstr: "unclosed {#unless}",
		},
		{
			name:       "mismatched closer for unless",
			content:    "{#unless a}<p>x</p>{/if}",
			wantSubstr: "{/if} does not match {#unless}",
		},
		{
			name:       "unless without a condition",
			content:    "{#unless}x{/unless}",
			wantSubstr: "{#unless} requires a condition",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			src := "<puzzle-view>" + tc.content + "</puzzle-view>\n<script></script>"
			_, err := Parse([]byte(src), "test.pzl")
			if err == nil {
				t.Fatalf("expected error, got nil")
			}
			if !strings.Contains(err.Error(), tc.wantSubstr) {
				t.Fatalf("error %q does not contain %q", err.Error(), tc.wantSubstr)
			}
		})
	}
}

// TestParseCase covers the {#case}/{:when} block: it keeps its own Case AST node
// (it does NOT desugar to If), splits when-values at top-level commas, matches in
// declaration order, and allows an optional trailing {:else} plus arbitrary
// nested blocks in a clause body.
func TestParseCase(t *testing.T) {
	t.Run("single when clause", func(t *testing.T) {
		root := parseContent(t, "{#case s}{:when 'a'}<p>x</p>{/case}")
		cn, ok := elementChildren(root.Children)[0].(*Case)
		if !ok {
			t.Fatalf("expected *Case, got %T", elementChildren(root.Children)[0])
		}
		if cn.Expr != "s" {
			t.Errorf("expr: got %q, want %q", cn.Expr, "s")
		}
		if len(cn.Clauses) != 1 {
			t.Fatalf("clauses: got %d, want 1", len(cn.Clauses))
		}
		if got := cn.Clauses[0].Values; len(got) != 1 || got[0] != "'a'" {
			t.Errorf("values: got %v, want ['a']", got)
		}
		if len(elementChildren(cn.Clauses[0].Body)) != 1 {
			t.Errorf("body: got %d nodes, want 1", len(elementChildren(cn.Clauses[0].Body)))
		}
		if cn.Else != nil {
			t.Errorf("else: got %v, want nil", cn.Else)
		}
	})

	t.Run("multi-value when splits at top-level commas only", func(t *testing.T) {
		root := parseContent(t, "{#case order.status}{:when 'pending', 'processing', n + 1}<p>x</p>{/case}")
		cn := elementChildren(root.Children)[0].(*Case)
		if cn.Expr != "order.status" {
			t.Errorf("expr: got %q", cn.Expr)
		}
		want := []string{"'pending'", "'processing'", "n + 1"}
		got := cn.Clauses[0].Values
		if len(got) != len(want) {
			t.Fatalf("values: got %v, want %v", got, want)
		}
		for i := range want {
			if got[i] != want[i] {
				t.Errorf("value %d: got %q, want %q", i, got[i], want[i])
			}
		}
	})

	t.Run("comma inside a call/literal value is not a split point", func(t *testing.T) {
		root := parseContent(t, "{#case s}{:when f(1, 2), [3, 4]}<p>x</p>{/case}")
		cn := elementChildren(root.Children)[0].(*Case)
		want := []string{"f(1, 2)", "[3, 4]"}
		got := cn.Clauses[0].Values
		if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
			t.Fatalf("values: got %v, want %v", got, want)
		}
	})

	t.Run("multiple clauses with trailing else", func(t *testing.T) {
		root := parseContent(t, "{#case s}{:when 'a'}<p>a</p>{:when 'b'}<p>b</p>{:else}<p>d</p>{/case}")
		cn := elementChildren(root.Children)[0].(*Case)
		if len(cn.Clauses) != 2 {
			t.Fatalf("clauses: got %d, want 2", len(cn.Clauses))
		}
		if cn.Clauses[0].Values[0] != "'a'" || cn.Clauses[1].Values[0] != "'b'" {
			t.Errorf("clause order wrong: %v / %v", cn.Clauses[0].Values, cn.Clauses[1].Values)
		}
		if len(elementChildren(cn.Else)) != 1 {
			t.Errorf("else: got %d nodes, want 1", len(elementChildren(cn.Else)))
		}
	})

	t.Run("nested if inside a when body", func(t *testing.T) {
		root := parseContent(t, "{#case s}{:when 'a'}{#if flag}<p>x</p>{:else}<p>y</p>{/if}{/case}")
		cn := elementChildren(root.Children)[0].(*Case)
		inner, ok := elementChildren(cn.Clauses[0].Body)[0].(*If)
		if !ok {
			t.Fatalf("expected nested *If, got %T", elementChildren(cn.Clauses[0].Body)[0])
		}
		if inner.Cond != "flag" {
			t.Errorf("nested if cond: got %q", inner.Cond)
		}
	})

	t.Run("nested case inside a when body", func(t *testing.T) {
		root := parseContent(t, "{#case a}{:when 1}{#case b}{:when 2}<p>x</p>{/case}{/case}")
		outer := elementChildren(root.Children)[0].(*Case)
		inner, ok := elementChildren(outer.Clauses[0].Body)[0].(*Case)
		if !ok {
			t.Fatalf("expected nested *Case, got %T", elementChildren(outer.Clauses[0].Body)[0])
		}
		if inner.Expr != "b" || inner.Clauses[0].Values[0] != "2" {
			t.Errorf("nested case wrong: expr %q, values %v", inner.Expr, inner.Clauses[0].Values)
		}
	})
}

// TestParseCaseErrors covers the positioned compile errors specific to {#case}:
// missing expression, no clauses, content before the first {:when}, empty/valueless
// {:when}, {:when} after {:else}, {:else if} inside case, and unclosed/mismatched
// closers.
func TestParseCaseErrors(t *testing.T) {
	tests := []struct {
		name       string
		content    string
		wantSubstr string
	}{
		{
			name:       "case without an expression",
			content:    "{#case}{:when 'a'}x{/case}",
			wantSubstr: "{#case} requires an expression",
		},
		{
			name:       "case with zero when clauses",
			content:    "{#case s}{/case}",
			wantSubstr: "{#case} has no {:when} clauses",
		},
		{
			name:       "content before the first when",
			content:    "{#case s}<p>stray</p>{:when 'a'}x{/case}",
			wantSubstr: "content between {#case} and its first {:when} must be whitespace",
		},
		{
			name:       "interpolation before the first when",
			content:    "{#case s}{ leak }{:when 'a'}x{/case}",
			wantSubstr: "content between {#case} and its first {:when} must be whitespace",
		},
		{
			name:       "valueless when",
			content:    "{#case s}{:when}x{/case}",
			wantSubstr: "{:when} requires at least one value",
		},
		{
			name:       "when with a stray trailing comma",
			content:    "{#case s}{:when 'a', }x{/case}",
			wantSubstr: "{:when} has an empty value",
		},
		{
			name:       "when after else",
			content:    "{#case s}{:when 'a'}x{:else}d{:when 'b'}y{/case}",
			wantSubstr: "{:when} after {:else}",
		},
		{
			name:       "else-if inside case",
			content:    "{#case s}{:when 'a'}x{:else if y}z{/case}",
			wantSubstr: "{:else if} is not allowed inside {#case}",
		},
		{
			name:       "unclosed case",
			content:    "{#case s}{:when 'a'}<p>x</p>",
			wantSubstr: "unclosed {#case}",
		},
		{
			name:       "mismatched closer for case",
			content:    "{#case s}{:when 'a'}<p>x</p>{/if}",
			wantSubstr: "{/if} does not match {#case}",
		},
		{
			name:       "when outside of a case block",
			content:    "{:when 'a'}x",
			wantSubstr: "{:when} outside of {#case} block",
		},
		{
			name:       "element closes across an open when clause",
			content:    "{#case s}{:when 'a'}<div>{/case}",
			wantSubstr: "closes across unclosed <div>",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			src := "<puzzle-view>" + tc.content + "</puzzle-view>\n<script></script>"
			_, err := Parse([]byte(src), "test.pzl")
			if err == nil {
				t.Fatalf("expected error, got nil")
			}
			if !strings.Contains(err.Error(), tc.wantSubstr) {
				t.Fatalf("error %q does not contain %q", err.Error(), tc.wantSubstr)
			}
		})
	}
}

func TestParseComponentAndSlot(t *testing.T) {
	t.Run("component with props and children", func(t *testing.T) {
		root := parseContent(t, `<Card title="Hi" userId={ selectedUserId } @save={ onSave }><p>body</p></Card>`)
		kids := elementChildren(root.Children)
		comp, ok := kids[0].(*Component)
		if !ok {
			t.Fatalf("expected *Component, got %T", kids[0])
		}
		if comp.Name != "Card" {
			t.Errorf("name: got %q", comp.Name)
		}
		if len(comp.Props) != 3 {
			t.Fatalf("props: got %d, want 3", len(comp.Props))
		}
		if _, ok := comp.Props[0].(*StaticAttr); !ok {
			t.Errorf("prop0: got %T, want StaticAttr", comp.Props[0])
		}
		if d, ok := comp.Props[1].(*DynamicAttr); !ok || d.Expr != "selectedUserId" {
			t.Errorf("prop1: got %#v, want DynamicAttr selectedUserId", comp.Props[1])
		}
		if e, ok := comp.Props[2].(*EventAttr); !ok || e.Name != "save" || e.Expr != "onSave" {
			t.Errorf("prop2: got %#v, want EventAttr save/onSave", comp.Props[2])
		}
		if len(elementChildren(comp.Children)) != 1 {
			t.Errorf("component children: got %d, want 1", len(elementChildren(comp.Children)))
		}
	})

	t.Run("self-closing slot", func(t *testing.T) {
		root := parseContent(t, "<Slot/>")
		if _, ok := elementChildren(root.Children)[0].(*Slot); !ok {
			t.Fatalf("expected *Slot")
		}
	})
}

// TestParseCompositionMarkersD141 covers the capitalized marker grammar:
// self-closing or paired-with-fallback forms, with Slot's role split by the
// static name attr. Lowercase D134 spellings stay retired.
func TestParseCompositionMarkersD141(t *testing.T) {
	t.Run("happy paths", func(t *testing.T) {
		cases := []struct {
			name          string
			src           string
			slotName      string
			fallbackNodes int
		}{
			{"Children default marker", "<Children/>", "", 0},
			{"Children fallback", "<Children><p>Default</p></Children>", "", 1},
			{"Children empty paired body", "<Children></Children>", "", 0},
			{"Slot bare outlet", "<Slot/>", "", 0},
			{"Slot outlet fallback", "<Slot>{#if show}<p>Empty</p>{/if}</Slot>", "", 1},
			{"Slot named marker", `<Slot name="header"/>`, "header", 0},
			{"Slot named fallback", `<Slot name="header"><h2>Untitled</h2></Slot>`, "header", 1},
			{"Slot named empty paired body", `<Slot name="header"></Slot>`, "header", 0},
		}
		for _, c := range cases {
			t.Run(c.name, func(t *testing.T) {
				root := parseContent(t, c.src)
				s, ok := elementChildren(root.Children)[0].(*Slot)
				if !ok {
					t.Fatalf("expected *Slot, got %T", elementChildren(root.Children)[0])
				}
				if s.Name != c.slotName {
					t.Fatalf("slot name: got %q, want %q", s.Name, c.slotName)
				}
				if got := len(elementChildren(s.Children)); got != c.fallbackNodes {
					t.Fatalf("fallback nodes: got %d, want %d", got, c.fallbackNodes)
				}
			})
		}
	})

	t.Run("Children marker forwards inside a component invocation", func(t *testing.T) {
		if _, err := Parse([]byte(`<puzzle-view><Card><Children/></Card></puzzle-view>`+"\n<script></script>"), "test.pzl"); err != nil {
			t.Fatalf("<Children/> inside an invocation should forward, got %v", err)
		}
	})

	errs := []struct {
		name        string
		src         string
		wantMessage string
	}{
		{
			name:        "lowercase children is retired",
			src:         `<puzzle-view><children/></puzzle-view>` + "\n<script></script>",
			wantMessage: "the default marker is spelled <Children/> since v1.64 (D134)",
		},
		{
			name:        "lowercase children paired form is retired",
			src:         `<puzzle-view><children>fallback</children></puzzle-view>` + "\n<script></script>",
			wantMessage: "the default marker is spelled <Children/> since v1.64 (D134)",
		},
		{
			name:        "bare lowercase slot is retired",
			src:         `<puzzle-view><slot/></puzzle-view>` + "\n<script></script>",
			wantMessage: "bare <slot> is not a marker — use <Children/> for call-site content or <Slot/> for the router outlet (D134)",
		},
		{
			name:        "bare lowercase slot with body is retired",
			src:         `<puzzle-view><slot>fallback</slot></puzzle-view>` + "\n<script></script>",
			wantMessage: "bare <slot> is not a marker — use <Children/> for call-site content or <Slot/> for the router outlet (D134)",
		},
		{
			name:        "lowercase named slot is retired",
			src:         `<puzzle-view><slot name="x"/></puzzle-view>` + "\n<script></script>",
			wantMessage: `named slots are spelled <Slot name="…"/> since v1.64 (D134)`,
		},
		{
			name:        "lowercase dynamic named slot is retired",
			src:         `<puzzle-view><slot name={ target }/></puzzle-view>` + "\n<script></script>",
			wantMessage: `named slots are spelled <Slot name="…"/> since v1.64 (D134)`,
		},
		{
			name:        "class attribute on Children marker",
			src:         `<puzzle-view><Children class="x"/></puzzle-view>` + "\n<script></script>",
			wantMessage: "<Children> takes no attributes — call-site content needs no configuration",
		},
		{
			name:        "ref on Children marker",
			src:         `<puzzle-view><Children ref="x"/></puzzle-view>` + "\n<script></script>",
			wantMessage: "ref cannot be placed on a <Children> — a children marker is a render target, not a real element",
		},
		{
			name:        "ref on Slot marker",
			src:         `<puzzle-view><Slot ref="x"/></puzzle-view>` + "\n<script></script>",
			wantMessage: "ref cannot be placed on a <Slot> — a slot is a render target, not a real element",
		},
		{
			name:        "dynamic Slot name",
			src:         `<puzzle-view><Slot name={ target }/></puzzle-view>` + "\n<script></script>",
			wantMessage: "<Slot> name must be a static string, not name={ ... }",
		},
		{
			name:        "interpolated Slot name",
			src:         `<puzzle-view><Slot name="pre-{ target }"/></puzzle-view>` + "\n<script></script>",
			wantMessage: "<Slot> name must be a static string, not an interpolated value",
		},
		{
			name:        "empty Slot name",
			src:         `<puzzle-view><Slot name=""/></puzzle-view>` + "\n<script></script>",
			wantMessage: "<Slot name> cannot be empty",
		},
		{
			name:        "reserved Slot name default",
			src:         `<puzzle-view><Slot name="default"/></puzzle-view>` + "\n<script></script>",
			wantMessage: `<Slot name="default"> is reserved — use <Children/>`,
		},
		{
			name:        "reserved Slot name children",
			src:         `<puzzle-view><Slot name="children"/></puzzle-view>` + "\n<script></script>",
			wantMessage: `<Slot name="children"> is reserved — use <Children/>`,
		},
		{
			name:        "non-name Slot attribute",
			src:         `<puzzle-view><Slot class="x"/></puzzle-view>` + "\n<script></script>",
			wantMessage: "<Slot> only takes a static name attribute",
		},
		{
			name:        "Slot event handler",
			src:         `<puzzle-view><Slot @click={ open }/></puzzle-view>` + "\n<script></script>",
			wantMessage: "<Slot> does not take event handlers",
		},
		{
			name:        "duplicate default markers across spellings",
			src:         `<puzzle-view><Children/><Slot/></puzzle-view>` + "\n<script></script>",
			wantMessage: "duplicate default marker (<Children/>/<Slot/>) — already declared at 1:14",
		},
		{
			name:        "named marker inside component invocation",
			src:         `<puzzle-view><Card><Slot name="header"/></Card></puzzle-view>` + "\n<script></script>",
			wantMessage: `<Slot name="header"> inside a component invocation is not supported — only the bare default <Children/> or <Slot/> forwards through a component`,
		},
	}
	for _, tc := range errs {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Parse([]byte(tc.src), "test.pzl")
			if err == nil {
				t.Fatalf("expected error, got nil")
			}
			pe, ok := err.(*ParseError)
			if !ok {
				t.Fatalf("expected positioned *ParseError, got %T (%v)", err, err)
			}
			if pe.Message != tc.wantMessage {
				t.Fatalf("message = %q, want %q", pe.Message, tc.wantMessage)
			}
			if pe.Line != 1 || pe.Col < 1 {
				t.Fatalf("position = %d:%d, want a valid line-1 position", pe.Line, pe.Col)
			}
		})
	}

	t.Run("nested marker in fallback is positioned at the inner marker", func(t *testing.T) {
		src := `<puzzle-view><Children><div><Slot name="inner"/></div></Children></puzzle-view>` + "\n<script></script>"
		_, err := Parse([]byte(src), "test.pzl")
		if err == nil {
			t.Fatal("expected a nested-marker error")
		}
		pe, ok := err.(*ParseError)
		if !ok {
			t.Fatalf("expected positioned *ParseError, got %T (%v)", err, err)
		}
		if pe.Message != "a composition marker cannot appear inside another marker's fallback body (D141)" {
			t.Fatalf("message = %q", pe.Message)
		}
		wantCol := strings.Index(src, `<Slot name="inner"/>`) + 1
		if pe.Line != 1 || pe.Col != wantCol {
			t.Fatalf("position = %d:%d, want 1:%d at inner marker", pe.Line, pe.Col, wantCol)
		}
	})
}

// TestParseNamedSlotErrors keeps the D53 shape and uniqueness errors pinned on
// the capitalized v1.64 spelling.
func TestParseNamedSlotErrors(t *testing.T) {
	tests := []struct {
		name       string
		src        string
		wantSubstr string
	}{
		{
			name:       "dynamic name",
			src:        `<puzzle-view><Slot name={ x }/></puzzle-view>` + "\n<script></script>",
			wantSubstr: "name must be a static string",
		},
		{
			name:       "interpolated name",
			src:        `<puzzle-view><Slot name="a{ b }"/></puzzle-view>` + "\n<script></script>",
			wantSubstr: "name must be a static string",
		},
		{
			name:       "empty name",
			src:        `<puzzle-view><Slot name=""/></puzzle-view>` + "\n<script></script>",
			wantSubstr: "cannot be empty",
		},
		{
			name:       "reserved default name",
			src:        `<puzzle-view><Slot name="default"/></puzzle-view>` + "\n<script></script>",
			wantSubstr: `reserved`,
		},
		{
			name:       "foreign attribute on slot",
			src:        `<puzzle-view><Slot class="x"/></puzzle-view>` + "\n<script></script>",
			wantSubstr: "only takes a static name attribute",
		},
		{
			name:       "duplicate slot name in one template",
			src:        `<puzzle-view><Slot name="a"/><Slot name="a"/></puzzle-view>` + "\n<script></script>",
			wantSubstr: "duplicate slot name",
		},
		{
			name:       "duplicate default marker in one template",
			src:        `<puzzle-view><Children/><Slot/></puzzle-view>` + "\n<script></script>",
			wantSubstr: "duplicate default marker",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Parse([]byte(tc.src), "test.pzl")
			if err == nil {
				t.Fatalf("expected error, got nil")
			}
			if !strings.Contains(err.Error(), tc.wantSubstr) {
				t.Fatalf("error %q does not contain %q", err.Error(), tc.wantSubstr)
			}
		})
	}
}

// TestParseDefaultAndNamedSlotOK asserts one default marker <Children/> plus one
// named slot in the same template is legal — the duplicate-default guard keys on
// "default" only, so it never collides with a named slot.
func TestParseDefaultAndNamedSlotOK(t *testing.T) {
	if _, err := Parse([]byte(`<puzzle-view><Children/><Slot name="header"/></puzzle-view>`+"\n<script></script>"), "test.pzl"); err != nil {
		t.Fatalf("one default marker + one named slot should be legal, got %v", err)
	}
}

// TestParseSlotForwarding covers the D71 call-site forwarding rules (v1.38,
// respelled by v1.64/D134): the default marker <Children/> (or <Slot/>) may sit
// inside a component invocation (it forwards through the component at runtime),
// but a NAMED marker there is a positioned compile error — named forwarding
// semantics are deliberately unspecified.
func TestParseSlotForwarding(t *testing.T) {
	ok := []struct {
		name string
		src  string
	}{
		{
			name: "Children marker inside a component invocation",
			src:  `<puzzle-view><Card><Children/></Card></puzzle-view>` + "\n<script></script>",
		},
		{
			name: "Children marker nested deeper inside call-site markup",
			src:  `<puzzle-view><Card><div class="wrap"><Children/></div></Card></puzzle-view>` + "\n<script></script>",
		},
		{
			name: "named declaration outside plus default forwarding inside",
			src:  `<puzzle-view><Slot name="header"/><Card><Children/></Card></puzzle-view>` + "\n<script></script>",
		},
		{
			name: "capitalized Slot outlet forwarding inside an invocation",
			src:  `<puzzle-view><Card><Slot/></Card></puzzle-view>` + "\n<script></script>",
		},
	}
	for _, tc := range ok {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := Parse([]byte(tc.src), "test.pzl"); err != nil {
				t.Fatalf("expected no error, got %v", err)
			}
		})
	}

	errs := []struct {
		name       string
		src        string
		wantSubstr string
	}{
		{
			name:       "named slot as a direct child of a component invocation",
			src:        `<puzzle-view><Card><Slot name="header"/></Card></puzzle-view>` + "\n<script></script>",
			wantSubstr: "inside a component invocation is not supported",
		},
		{
			name:       "named slot nested in an element inside an invocation",
			src:        `<puzzle-view><Card><div><Slot name="header"/></div></Card></puzzle-view>` + "\n<script></script>",
			wantSubstr: "inside a component invocation is not supported",
		},
		{
			name:       "named slot inside control flow inside an invocation",
			src:        `<puzzle-view><Card>{#if a}<Slot name="header"/>{/if}</Card></puzzle-view>` + "\n<script></script>",
			wantSubstr: "inside a component invocation is not supported",
		},
		{
			name:       "named slot inside a nested component invocation",
			src:        `<puzzle-view><Card><Panel><Slot name="header"/></Panel></Card></puzzle-view>` + "\n<script></script>",
			wantSubstr: "inside a component invocation is not supported",
		},
		{
			name:       "default marker both inside and outside an invocation is still a duplicate",
			src:        `<puzzle-view><Children/><Card><Children/></Card></puzzle-view>` + "\n<script></script>",
			wantSubstr: "duplicate default marker",
		},
		{
			name:       "bare lowercase slot inside an invocation is the retired-spelling error",
			src:        `<puzzle-view><Card><slot/></Card></puzzle-view>` + "\n<script></script>",
			wantSubstr: "bare <slot> is not a marker",
		},
	}
	for _, tc := range errs {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Parse([]byte(tc.src), "test.pzl")
			if err == nil {
				t.Fatalf("expected error, got nil")
			}
			if !strings.Contains(err.Error(), tc.wantSubstr) {
				t.Fatalf("error %q does not contain %q", err.Error(), tc.wantSubstr)
			}
		})
	}
}

// TestParseCallSiteSlots asserts a static `slot` attribute on a direct component
// child rides through as an ordinary attribute (parser does not strip it — the
// ViewManager does at runtime, D53), on both element and component children.
func TestParseCallSiteSlots(t *testing.T) {
	root := parseContent(t, `<Card><h2 slot="header">Hi</h2><Button slot="footer">Go</Button><p>body</p></Card>`)
	card := elementChildren(root.Children)[0].(*Component)
	kids := elementChildren(card.Children)
	h2 := kids[0].(*Element)
	if sa, ok := slotOf(h2.Attrs); !ok || sa != "header" {
		t.Errorf("h2 slot attr: got %q ok=%v, want header", sa, ok)
	}
	btn := kids[1].(*Component)
	if sa, ok := slotOf(btn.Props); !ok || sa != "footer" {
		t.Errorf("Button slot prop: got %q ok=%v, want footer", sa, ok)
	}
	p := kids[2].(*Element)
	if _, ok := slotOf(p.Attrs); ok {
		t.Errorf("default child <p> should carry no slot attr")
	}
}

// slotOf returns a static `slot` attribute's value among attrs, if present.
func slotOf(attrs []Attr) (string, bool) {
	for _, a := range attrs {
		if sa, ok := a.(*StaticAttr); ok && sa.Name == "slot" {
			return sa.Value, true
		}
	}
	return "", false
}

// TestParseCallSiteSlotErrors covers the positioned call-site errors (v1.21,
// D53): a dynamic slot target and a control-flow block carrying top-level
// slot-attributed nodes, both on a component's direct child.
func TestParseCallSiteSlotErrors(t *testing.T) {
	tests := []struct {
		name       string
		src        string
		wantSubstr string
	}{
		{
			name:       "dynamic slot on element child",
			src:        `<puzzle-view><Card><h2 slot={ region }>Hi</h2></Card></puzzle-view>` + "\n<script></script>",
			wantSubstr: "slot target must be a static string",
		},
		{
			name:       "dynamic slot on component child",
			src:        `<puzzle-view><Card><Button slot={ region }>Hi</Button></Card></puzzle-view>` + "\n<script></script>",
			wantSubstr: "slot target must be a static string",
		},
		{
			name:       "interpolated slot target",
			src:        `<puzzle-view><Card><h2 slot="a{ b }">Hi</h2></Card></puzzle-view>` + "\n<script></script>",
			wantSubstr: "slot target must be a static string",
		},
		{
			name:       "slot inside #if block at direct-child level",
			src:        `<puzzle-view><Card>{#if show}<h2 slot="header">Hi</h2>{/if}</Card></puzzle-view>` + "\n<script></script>",
			wantSubstr: "move the control-flow block inside the slotted element",
		},
		{
			name:       "slot inside #for block at direct-child level",
			src:        `<puzzle-view><Card>{#for x in xs}<li slot="footer">{ x }</li>{/for}</Card></puzzle-view>` + "\n<script></script>",
			wantSubstr: "move the control-flow block inside the slotted element",
		},
		{
			name:       "slot inside #unless block at direct-child level",
			src:        `<puzzle-view><Card>{#unless hide}<h2 slot="header">Hi</h2>{/unless}</Card></puzzle-view>` + "\n<script></script>",
			wantSubstr: "move the control-flow block inside the slotted element",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Parse([]byte(tc.src), "test.pzl")
			if err == nil {
				t.Fatalf("expected error, got nil")
			}
			if !strings.Contains(err.Error(), tc.wantSubstr) {
				t.Fatalf("error %q does not contain %q", err.Error(), tc.wantSubstr)
			}
		})
	}
}

// TestParseCallSiteSlotPassthrough asserts a static `slot` attribute that is NOT
// a direct child of a component invocation (a plain element's child, or deeper)
// is left untouched — it is the ordinary HTML global attribute there (D53).
func TestParseCallSiteSlotPassthrough(t *testing.T) {
	// slot on a direct child of a plain <div> — not ours.
	root := parseContent(t, `<div><h2 slot="header">Hi</h2></div>`)
	div := elementChildren(root.Children)[0].(*Element)
	h2 := elementChildren(div.Children)[0].(*Element)
	if sa, ok := slotOf(h2.Attrs); !ok || sa != "header" {
		t.Errorf("passthrough slot attr: got %q ok=%v, want header", sa, ok)
	}
	// A dynamic slot on a plain element's child must NOT error (not a call site).
	if _, err := Parse([]byte(`<puzzle-view><div><h2 slot={ x }>Hi</h2></div></puzzle-view>`+"\n<script></script>"), "test.pzl"); err != nil {
		t.Errorf("dynamic slot on non-call-site child should not error, got %v", err)
	}
}

// TestParseAttributeInlineIf covers the three real class="… {#if …}…{/if}" cases
// from Home.pzl lines ~41–51 verbatim, plus the completed-todo variant.
func TestParseAttributeInlineIf(t *testing.T) {
	cases := []string{
		`class="flex-1 py-4 px-4 font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-800 transition-colors {#if currentFilter === 'all'}bg-white text-indigo-600 border-b-2 border-indigo-600{/if}"`,
		`class="flex-1 py-4 px-4 font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-800 transition-colors {#if currentFilter === 'active'}bg-white text-indigo-600 border-b-2 border-indigo-600{/if}"`,
		`class="flex-1 text-gray-900 {#if todo.completed}line-through text-gray-500{/if}"`,
	}
	for _, attr := range cases {
		root := parseContent(t, "<button "+attr+"></button>")
		btn := elementChildren(root.Children)[0].(*Element)
		if len(btn.Attrs) != 1 {
			t.Fatalf("expected 1 attr, got %d", len(btn.Attrs))
		}
		mixed, ok := btn.Attrs[0].(*MixedAttr)
		if !ok {
			t.Fatalf("expected *MixedAttr, got %T", btn.Attrs[0])
		}
		if mixed.Name != "class" {
			t.Errorf("name: got %q", mixed.Name)
		}
		// last part is the inline-if
		last := mixed.Parts[len(mixed.Parts)-1]
		iff, ok := last.(*InlineIfPart)
		if !ok {
			t.Fatalf("expected trailing *InlineIfPart, got %T", last)
		}
		if !strings.Contains(iff.Cond, "===") && iff.Cond != "todo.completed" {
			t.Errorf("inline-if cond unexpected: %q", iff.Cond)
		}
		if len(iff.Then) != 1 {
			t.Errorf("inline-if then parts: got %d, want 1", len(iff.Then))
		}
	}
}

func TestParseMixedAttributeInterpolation(t *testing.T) {
	root := parseContent(t, `<span class="btn { variantClass }"></span>`)
	span := elementChildren(root.Children)[0].(*Element)
	mixed, ok := span.Attrs[0].(*MixedAttr)
	if !ok {
		t.Fatalf("expected *MixedAttr, got %T", span.Attrs[0])
	}
	if len(mixed.Parts) != 2 {
		t.Fatalf("parts: got %d, want 2", len(mixed.Parts))
	}
	if sp, ok := mixed.Parts[0].(*StaticPart); !ok || sp.Text != "btn " {
		t.Errorf("part0: got %#v", mixed.Parts[0])
	}
	if ip, ok := mixed.Parts[1].(*InterpPart); !ok || ip.Interp.Expr != "variantClass" {
		t.Errorf("part1: got %#v", mixed.Parts[1])
	}
}

func TestParseBooleanAndDynamicAttrs(t *testing.T) {
	root := parseContent(t, `<input autofocus disabled={ !x.trim() } value={ y } />`)
	in := elementChildren(root.Children)[0].(*Element)
	if len(in.Attrs) != 3 {
		t.Fatalf("attrs: got %d, want 3", len(in.Attrs))
	}
	if s, ok := in.Attrs[0].(*StaticAttr); !ok || s.Name != "autofocus" || s.Value != "" {
		t.Errorf("attr0: got %#v, want boolean StaticAttr autofocus", in.Attrs[0])
	}
	if d, ok := in.Attrs[1].(*DynamicAttr); !ok || d.Expr != "!x.trim()" {
		t.Errorf("attr1: got %#v", in.Attrs[1])
	}
	if d, ok := in.Attrs[2].(*DynamicAttr); !ok || d.Name != "value" || d.Expr != "y" {
		t.Errorf("attr2: got %#v", in.Attrs[2])
	}
}

func TestParseReservedAttributeNamespaces(t *testing.T) {
	t.Run("non-XML namespace is a positioned error", func(t *testing.T) {
		src := "<puzzle-view>\n  <input bind:value={ x } />\n</puzzle-view>\n<script></script>"
		_, err := Parse([]byte(src), "Binding.pzl")
		if err == nil {
			t.Fatal("expected parse error, got nil")
		}
		pe, ok := err.(*ParseError)
		if !ok {
			t.Fatalf("expected *ParseError, got %T (%v)", err, err)
		}
		// A directive-shaped prefix gets the binding steer, not the SVG one: the
		// author who types this arrived from Svelte/Vue and needs the keyword-free
		// form, and telling them about Inkscape exports would be noise.
		wantMessage := "attribute namespace \"bind:\" is reserved — two-way binding needs no prefix. Write `value={ expr }` (or `checked={ expr }`) on a plain <input>/<textarea>/<select> and the compiler synthesizes the write-back; see template SPEC §6"
		if pe.Message != wantMessage {
			t.Errorf("message: got %q, want %q", pe.Message, wantMessage)
		}
		if pe.File != "Binding.pzl" || pe.Line != 2 || pe.Col != 10 {
			t.Errorf("position: got %s:%d:%d, want Binding.pzl:2:10", pe.File, pe.Line, pe.Col)
		}
	})

	// The reservation is validated at the attribute NAME, not inside buildAttr, so
	// the valueless spelling cannot slip through as a plain boolean attribute. It
	// used to: `<input bind:value>` compiled to `{ 'bind:value': true }` with no
	// error — the exact syntax the reservation exists to reject.
	t.Run("valueless namespace is rejected too", func(t *testing.T) {
		src := "<puzzle-view>\n  <input bind:value />\n</puzzle-view>\n<script></script>"
		_, err := Parse([]byte(src), "Binding.pzl")
		if err == nil {
			t.Fatal("expected parse error, got nil")
		}
		pe, ok := err.(*ParseError)
		if !ok {
			t.Fatalf("expected *ParseError, got %T (%v)", err, err)
		}
		if !strings.Contains(pe.Message, `attribute namespace "bind:" is reserved`) {
			t.Errorf("message: got %q", pe.Message)
		}
		if !strings.Contains(pe.Message, "two-way binding needs no prefix") {
			t.Errorf("valueless form should carry the binding steer too: %q", pe.Message)
		}
		if pe.File != "Binding.pzl" || pe.Line != 2 || pe.Col != 10 {
			t.Errorf("position: got %s:%d:%d, want Binding.pzl:2:10", pe.File, pe.Line, pe.Col)
		}
	})

	// A non-directive prefix is almost always pasted SVG-editor output, so that
	// author gets the file-asset escape instead of a lecture about form controls.
	t.Run("an SVG-editor namespace gets the {#svg} steer", func(t *testing.T) {
		src := "<puzzle-view>\n  <g inkscape:label=\"Layer 1\"></g>\n</puzzle-view>\n<script></script>"
		_, err := Parse([]byte(src), "Icon.pzl")
		if err == nil {
			t.Fatal("expected parse error, got nil")
		}
		pe := err.(*ParseError)
		if !strings.Contains(pe.Message, `attribute namespace "inkscape:" is reserved`) {
			t.Errorf("message: got %q", pe.Message)
		}
		if !strings.Contains(pe.Message, "{#svg}") {
			t.Errorf("expected the file-asset escape: %q", pe.Message)
		}
		if strings.Contains(pe.Message, "two-way binding") {
			t.Errorf("SVG author should not get the binding steer: %q", pe.Message)
		}
	})

	// An event attr owns the colon for its modifier channel; parseEventModifiers
	// validates those, so the namespace check must not intercept them.
	t.Run("event modifiers are exempt", func(t *testing.T) {
		root := parseContent(t, `<button @click:prevent:once={ go }></button>`)
		btn := elementChildren(root.Children)[0].(*Element)
		ev, ok := btn.Attrs[0].(*EventAttr)
		if !ok {
			t.Fatalf("expected *EventAttr, got %#v", btn.Attrs[0])
		}
		if ev.Name != "click" {
			t.Errorf("event: got %q, want %q", ev.Name, "click")
		}
	})

	t.Run("XML namespaces remain valid", func(t *testing.T) {
		root := parseContent(t, `<svg xlink:href="#icon" xml:lang="en" xmlns:icons="urn:icons"></svg>`)
		svg := elementChildren(root.Children)[0].(*Element)
		want := []string{"xlink:href", "xml:lang", "xmlns:icons"}
		if len(svg.Attrs) != len(want) {
			t.Fatalf("attrs: got %d, want %d", len(svg.Attrs), len(want))
		}
		for i, name := range want {
			attr, ok := svg.Attrs[i].(*StaticAttr)
			if !ok || attr.Name != name {
				t.Errorf("attr %d: got %#v, want StaticAttr %q", i, svg.Attrs[i], name)
			}
		}
	})
}

// TestParseErrors asserts message content + line/col for malformed input.
func TestParseErrors(t *testing.T) {
	tests := []struct {
		name        string
		src         string
		wantSubstr  string
		wantLine    int
		wantColZero bool // when true, only substring is checked
	}{
		{
			name:       "unclosed if",
			src:        "<puzzle-view>{#if a}<p>x</p></puzzle-view>\n<script></script>",
			wantSubstr: "unclosed {#if}",
		},
		{
			name:       "orphan else",
			src:        "<puzzle-view>{:else}</puzzle-view>\n<script></script>",
			wantSubstr: "{:else} outside of {#if} block",
		},
		{
			name:       "for inside attribute value",
			src:        `<puzzle-view><div class="a {#for x in xs}b{/for}"></div></puzzle-view>` + "\n<script></script>",
			wantSubstr: "{#for} is not allowed in attribute values",
		},
		{
			name:       "element/block cross nesting: /if across div",
			src:        "<puzzle-view>{#if a}<div>{/if}</puzzle-view>\n<script></script>",
			wantSubstr: "closes across unclosed <div>",
		},
		{
			name:       "block/element cross nesting: close tag across if",
			src:        "<puzzle-view><div>{#if a}</div>{/if}</div></puzzle-view>\n<script></script>",
			wantSubstr: "closes across unclosed {#if}",
		},
		{
			name:       "mismatched closing tag",
			src:        "<puzzle-view><div></span></puzzle-view>\n<script></script>",
			wantSubstr: "does not match <div>",
		},
		{
			name:       "unknown block",
			src:        "<puzzle-view>{#each x}{/each}</puzzle-view>\n<script></script>",
			wantSubstr: "unknown block {#each}",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Parse([]byte(tc.src), "test.pzl")
			if err == nil {
				t.Fatalf("expected error, got nil")
			}
			if !strings.Contains(err.Error(), tc.wantSubstr) {
				t.Fatalf("error %q does not contain %q", err.Error(), tc.wantSubstr)
			}
		})
	}
}

// TestParseErrorPositions checks a couple of errors report a specific position.
func TestParseErrorPositions(t *testing.T) {
	// {:else} on line 2, col 1
	src := "<puzzle-view>\n{:else}</puzzle-view>\n<script></script>"
	_, err := Parse([]byte(src), "Home.pzl")
	pe, ok := err.(*ParseError)
	if !ok {
		t.Fatalf("expected *ParseError, got %T (%v)", err, err)
	}
	if pe.Line != 2 || pe.Col != 1 {
		t.Errorf("position: got %d:%d, want 2:1", pe.Line, pe.Col)
	}
	if pe.File != "Home.pzl" {
		t.Errorf("file: got %q", pe.File)
	}
}

// TestParseEventModifiers checks the `@event:mod:mod={…}` grammar: the bare
// event and the validated modifier list (written order).
func TestParseEventModifiers(t *testing.T) {
	tests := []struct {
		name     string
		content  string
		wantName string
		wantMods []string
	}{
		{
			name:     "key filter then prevent",
			content:  `<input @keydown:enter:prevent={ submit } />`,
			wantName: "keydown",
			wantMods: []string{"enter", "prevent"},
		},
		{
			name:     "no modifiers",
			content:  `<button @click={ go }>x</button>`,
			wantName: "click",
			wantMods: nil,
		},
		{
			name:     "generic modifiers preserve written order",
			content:  `<button @click:stop:once={ go }>x</button>`,
			wantName: "click",
			wantMods: []string{"stop", "once"},
		},
		{
			name:     "outside is event-generic (v1.52, D86)",
			content:  `<div @click:outside={ close }>x</div>`,
			wantName: "click",
			wantMods: []string{"outside"},
		},
		{
			name:     "outside composes with a key filter",
			content:  `<div @keydown:escape:outside={ close }>x</div>`,
			wantName: "keydown",
			wantMods: []string{"escape", "outside"},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			root := parseContent(t, tc.content)
			el := elementChildren(root.Children)[0].(*Element)
			ev, ok := el.Attrs[0].(*EventAttr)
			if !ok {
				t.Fatalf("attr0: got %#v, want *EventAttr", el.Attrs[0])
			}
			if ev.Name != tc.wantName {
				t.Errorf("name: got %q, want %q", ev.Name, tc.wantName)
			}
			if len(ev.Modifiers) != len(tc.wantMods) {
				t.Fatalf("modifiers: got %#v, want %#v", ev.Modifiers, tc.wantMods)
			}
			for i, m := range tc.wantMods {
				if ev.Modifiers[i] != m {
					t.Errorf("modifier %d: got %q, want %q", i, ev.Modifiers[i], m)
				}
			}
		})
	}
}

// TestParseEventKeyFiltersBackspaceDelete covers the v1.13 (D45) additions to
// the key-filter set: backspace/delete are accepted on keyboard events and
// rejected on non-keyboard events like every other key filter.
func TestParseEventKeyFiltersBackspaceDelete(t *testing.T) {
	accepted := []struct {
		name     string
		content  string
		wantName string
		wantMods []string
	}{
		{
			name:     "keydown backspace",
			content:  `<input @keydown:backspace={ onBksp } />`,
			wantName: "keydown",
			wantMods: []string{"backspace"},
		},
		{
			name:     "keyup delete with prevent",
			content:  `<input @keyup:delete:prevent={ onDel } />`,
			wantName: "keyup",
			wantMods: []string{"delete", "prevent"},
		},
	}
	for _, tc := range accepted {
		t.Run(tc.name, func(t *testing.T) {
			root := parseContent(t, tc.content)
			el := elementChildren(root.Children)[0].(*Element)
			ev, ok := el.Attrs[0].(*EventAttr)
			if !ok {
				t.Fatalf("attr0: got %#v, want *EventAttr", el.Attrs[0])
			}
			if ev.Name != tc.wantName {
				t.Errorf("name: got %q, want %q", ev.Name, tc.wantName)
			}
			if len(ev.Modifiers) != len(tc.wantMods) {
				t.Fatalf("modifiers: got %#v, want %#v", ev.Modifiers, tc.wantMods)
			}
			for i, m := range tc.wantMods {
				if ev.Modifiers[i] != m {
					t.Errorf("modifier %d: got %q, want %q", i, ev.Modifiers[i], m)
				}
			}
		})
	}

	rejected := []struct {
		name       string
		content    string
		wantSubstr string
	}{
		{
			name:       "backspace on click",
			content:    `<button @click:backspace={ go }>x</button>`,
			wantSubstr: "key filter :backspace is only valid on keyboard events",
		},
		{
			name:       "delete on click",
			content:    `<button @click:delete={ go }>x</button>`,
			wantSubstr: "key filter :delete is only valid on keyboard events",
		},
	}
	for _, tc := range rejected {
		t.Run(tc.name, func(t *testing.T) {
			src := "<puzzle-view>" + tc.content + "</puzzle-view>\n<script></script>"
			_, err := Parse([]byte(src), "test.pzl")
			if err == nil {
				t.Fatalf("expected error, got nil")
			}
			if !strings.Contains(err.Error(), tc.wantSubstr) {
				t.Fatalf("error %q does not contain %q", err.Error(), tc.wantSubstr)
			}
		})
	}
}

// TestParseIsland is the island happy path (v1.13, D44): a bare static `island`
// on a plain element with seed children parses to a StaticAttr and keeps its
// children.
func TestParseIsland(t *testing.T) {
	root := parseContent(t, `<div contenteditable="true" island class={ blockClass }>{ block.text }</div>`)
	el := elementChildren(root.Children)[0].(*Element)
	var found *StaticAttr
	for _, a := range el.Attrs {
		if sa, ok := a.(*StaticAttr); ok && sa.Name == "island" {
			found = sa
		}
	}
	if found == nil {
		t.Fatalf("island attr not found among %#v", el.Attrs)
	}
	if found.Value != "" {
		t.Errorf("island value: got %q, want \"\" (bare)", found.Value)
	}
	if !found.Valueless {
		t.Errorf("island Valueless: got false, want true (bare attr)")
	}
	if len(elementChildren(el.Children)) != 1 {
		t.Fatalf("island children: got %d, want 1 (seed interpolation)", len(elementChildren(el.Children)))
	}
	if _, ok := elementChildren(el.Children)[0].(*Interpolation); !ok {
		t.Errorf("island child0: got %#v, want *Interpolation", el.Children[0])
	}
}

// TestParseValuelessAttr pins the StaticAttr representation that separates a
// BARE attribute (autofocus → Value "", Valueless true) from an EXPLICIT empty
// value (value="" → Value "", Valueless false). Both leave Value empty — the
// field is the only distinction, and codegen keys `true` vs `”` emission on it,
// so this shape is load-bearing.
func TestParseValuelessAttr(t *testing.T) {
	root := parseContent(t, `<input value="" autofocus />`)
	el := elementChildren(root.Children)[0].(*Element)
	get := func(name string) *StaticAttr {
		t.Helper()
		for _, a := range el.Attrs {
			if sa, ok := a.(*StaticAttr); ok && sa.Name == name {
				return sa
			}
		}
		t.Fatalf("attr %q not found among %#v", name, el.Attrs)
		return nil
	}
	if v := get("value"); v.Value != "" || v.Valueless {
		t.Errorf(`value="": got Value %q Valueless %v, want "" false (explicit empty)`, v.Value, v.Valueless)
	}
	if a := get("autofocus"); a.Value != "" || !a.Valueless {
		t.Errorf("autofocus: got Value %q Valueless %v, want \"\" true (bare)", a.Value, a.Valueless)
	}
}

// TestParseIslandErrors covers the four positioned island validation errors.
func TestParseIslandErrors(t *testing.T) {
	tests := []struct {
		name       string
		src        string
		wantSubstr string
	}{
		{
			name:       "dynamic island",
			src:        `<puzzle-view><div island={ on }>x</div></puzzle-view>` + "\n<script></script>",
			wantSubstr: "island must be a static attribute",
		},
		{
			// island="false" still freezes at runtime (key presence, not value) —
			// D44 is bare-only, so a value is a compile error, not a silent island.
			name:       "valued island",
			src:        `<puzzle-view><div island="false">x</div></puzzle-view>` + "\n<script></script>",
			wantSubstr: "island must be a bare attribute",
		},
		{
			// island="" is VALUED too (Valueless=false), not bare — an explicit
			// empty value is still a value, and only the bare spelling is legal.
			name:       "empty-valued island",
			src:        `<puzzle-view><div island="">x</div></puzzle-view>` + "\n<script></script>",
			wantSubstr: "island must be a bare attribute",
		},
		{
			name:       "island on component tag",
			src:        `<puzzle-view><Editor island>x</Editor></puzzle-view>` + "\n<script></script>",
			wantSubstr: "island is not a component prop",
		},
		{
			name:       "component inside island subtree",
			src:        `<puzzle-view><div island><span><Editor/></span></div></puzzle-view>` + "\n<script></script>",
			wantSubstr: "<Editor> cannot appear inside an island element",
		},
		{
			name:       "component inside island block body",
			src:        `<puzzle-view><div island>{#if show}<Editor/>{/if}</div></puzzle-view>` + "\n<script></script>",
			wantSubstr: "<Editor> cannot appear inside an island element",
		},
		{
			name:       "Children marker inside island subtree",
			src:        `<puzzle-view><div island><Children/></div></puzzle-view>` + "\n<script></script>",
			wantSubstr: `a composition marker (<Children/>/<Slot/>/<Slot name="…"/>) cannot appear inside an island element`,
		},
		{
			name:       "named slot inside island subtree",
			src:        `<puzzle-view><div island><Slot name="x"/></div></puzzle-view>` + "\n<script></script>",
			wantSubstr: `a composition marker (<Children/>/<Slot/>/<Slot name="…"/>) cannot appear inside an island element`,
		},
		{
			name:       "dynamic island inside marker fallback",
			src:        `<puzzle-view><Slot name="x"><div island={ on }>x</div></Slot></puzzle-view>` + "\n<script></script>",
			wantSubstr: "island must be a static attribute",
		},
		{
			name:       "island on puzzle-view root",
			src:        `<puzzle-view island><div>x</div></puzzle-view>` + "\n<script></script>",
			wantSubstr: "the <puzzle-view> root cannot be an island",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Parse([]byte(tc.src), "test.pzl")
			if err == nil {
				t.Fatalf("expected error, got nil")
			}
			if !strings.Contains(err.Error(), tc.wantSubstr) {
				t.Fatalf("error %q does not contain %q", err.Error(), tc.wantSubstr)
			}
		})
	}
}

// TestParseEventNameValidation covers the event-name segment checks (before the
// first ':'): an empty name is rejected, a Vue-style dotted modifier
// (@click.prevent) is rejected with a did-you-mean, and a genuine custom event
// name that merely contains a dot (@my.custom-event) compiles unchanged.
func TestParseEventNameValidation(t *testing.T) {
	rejected := []struct {
		name       string
		content    string
		wantSubstr string
	}{
		{
			name:       "empty event name",
			content:    `<button @={ go }>x</button>`,
			wantSubstr: "event binding has no event name",
		},
		{
			name:       "empty name before modifier",
			content:    `<button @:prevent={ go }>x</button>`,
			wantSubstr: "event binding has no event name",
		},
		{
			name:       "dotted modifier (vue muscle memory)",
			content:    `<button @click.prevent={ go }>x</button>`,
			wantSubstr: "write @click:prevent instead of @click.prevent",
		},
	}
	for _, tc := range rejected {
		t.Run(tc.name, func(t *testing.T) {
			src := "<puzzle-view>" + tc.content + "</puzzle-view>\n<script></script>"
			_, err := Parse([]byte(src), "test.pzl")
			if err == nil {
				t.Fatalf("expected error, got nil")
			}
			if !strings.Contains(err.Error(), tc.wantSubstr) {
				t.Fatalf("error %q does not contain %q", err.Error(), tc.wantSubstr)
			}
		})
	}

	t.Run("dotted custom event name compiles", func(t *testing.T) {
		root := parseContent(t, `<Child @my.custom-event={ onCustom } />`)
		el := elementChildren(root.Children)[0].(*Component)
		ev, ok := el.Props[0].(*EventAttr)
		if !ok {
			t.Fatalf("prop0: got %#v, want *EventAttr", el.Props[0])
		}
		if ev.Name != "my.custom-event" {
			t.Errorf("name: got %q, want %q", ev.Name, "my.custom-event")
		}
		if len(ev.Modifiers) != 0 {
			t.Errorf("modifiers: got %#v, want none", ev.Modifiers)
		}
	})
}

// TestParseEventModifierErrors covers the four positioned parse errors.
func TestParseEventModifierErrors(t *testing.T) {
	tests := []struct {
		name       string
		content    string
		wantSubstr string
	}{
		{
			name:       "unknown modifier",
			content:    `<button @click:bogus={ go }>x</button>`,
			wantSubstr: "unknown event modifier :bogus",
		},
		{
			name:       "key filter on non-keyboard event",
			content:    `<button @click:enter={ go }>x</button>`,
			wantSubstr: "key filter :enter is only valid on keyboard events",
		},
		{
			name:       "duplicate modifier",
			content:    `<button @click:stop:stop={ go }>x</button>`,
			wantSubstr: "duplicate event modifier :stop",
		},
		{
			name:       "duplicate outside modifier (D86)",
			content:    `<div @click:outside:outside={ close }>x</div>`,
			wantSubstr: "duplicate event modifier :outside",
		},
		{
			name:       "more than one key filter",
			content:    `<input @keydown:enter:escape={ go } />`,
			wantSubstr: "only one key filter is allowed",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			src := "<puzzle-view>" + tc.content + "</puzzle-view>\n<script></script>"
			_, err := Parse([]byte(src), "test.pzl")
			if err == nil {
				t.Fatalf("expected error, got nil")
			}
			if !strings.Contains(err.Error(), tc.wantSubstr) {
				t.Fatalf("error %q does not contain %q", err.Error(), tc.wantSubstr)
			}
		})
	}
}
