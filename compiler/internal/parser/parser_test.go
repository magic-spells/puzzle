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
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			src := "<puzzle-view>" + tc.content + "</puzzle-view>\n<script></script>"
			_, err := Parse([]byte(src), "test.pzl")
			if err == nil {
				t.Fatal("expected a reserved loop identifier error")
			}
			want := `loop variable "` + tc.ident + `" uses a reserved name (identifiers starting with "__" and "ViewNode" are reserved by the compiler)`
			if !strings.Contains(err.Error(), want) {
				t.Errorf("error %q should contain %q", err, want)
			}
			if !strings.Contains(err.Error(), "test.pzl:1:") {
				t.Errorf("error should be positioned at test.pzl:1, got %v", err)
			}
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

// TestParseNamedSlots covers the child-side named-slot declaration forms (v1.21,
// D53): a named slot carries its static name and optional fallback children, and
// a self-closing named slot has no fallback. (The default marker is now
// <children/>/<Slot/> — see TestParseChildrenMarkerD74.)
func TestParseNamedSlots(t *testing.T) {
	t.Run("named slot with fallback", func(t *testing.T) {
		root := parseContent(t, `<slot name="header">Untitled</slot>`)
		s := elementChildren(root.Children)[0].(*Slot)
		if s.Name != "header" {
			t.Errorf("name: got %q, want header", s.Name)
		}
		if len(elementChildren(s.Children)) != 1 {
			t.Fatalf("fallback children: got %d, want 1", len(elementChildren(s.Children)))
		}
		if txt, ok := elementChildren(s.Children)[0].(*Text); !ok || strings.TrimSpace(txt.Value) != "Untitled" {
			t.Errorf("fallback: got %#v, want Text \"Untitled\"", elementChildren(s.Children)[0])
		}
	})

	t.Run("self-closing named slot has empty fallback", func(t *testing.T) {
		root := parseContent(t, `<slot name="footer"/>`)
		s := elementChildren(root.Children)[0].(*Slot)
		if s.Name != "footer" {
			t.Errorf("name: got %q, want footer", s.Name)
		}
		if len(s.Children) != 0 {
			t.Errorf("children: got %d, want 0", len(s.Children))
		}
	})

	t.Run("named slot with element fallback (full grammar)", func(t *testing.T) {
		root := parseContent(t, `<slot name="body"><p>{ fallbackText }</p></slot>`)
		s := elementChildren(root.Children)[0].(*Slot)
		if s.Name != "body" {
			t.Errorf("name: got %q, want body", s.Name)
		}
		if _, ok := elementChildren(s.Children)[0].(*Element); !ok {
			t.Errorf("fallback child0: got %T, want *Element", elementChildren(s.Children)[0])
		}
	})
}

// TestParseChildrenMarkerD74 covers the v1.41 (D74) marker-role split: the
// <children/> default marker (bare + fallback), <Slot/> the bare-only router
// outlet, lowercase <slot> requiring a name, and the newly-reserved
// name="children".
func TestParseChildrenMarkerD74(t *testing.T) {
	t.Run("happy paths", func(t *testing.T) {
		// (i) <children/> bare, <children> with fallback, <Slot/> bare, named slot.
		cases := []struct {
			name string
			src  string
		}{
			{"children bare", "<children/>"},
			{"children with element+interpolation fallback", `<children><p>{ empty }</p></children>`},
			{"Slot bare outlet", "<Slot/>"},
			{"named slot", `<slot name="header">Untitled</slot>`},
		}
		for _, c := range cases {
			t.Run(c.name, func(t *testing.T) {
				root := parseContent(t, c.src)
				if _, ok := elementChildren(root.Children)[0].(*Slot); !ok {
					t.Fatalf("expected *Slot, got %T", elementChildren(root.Children)[0])
				}
			})
		}
	})

	t.Run("children marker keeps its fallback children", func(t *testing.T) {
		root := parseContent(t, `<children><p class="empty">{ msg }</p></children>`)
		s := elementChildren(root.Children)[0].(*Slot)
		if s.Name != "" {
			t.Errorf("children marker name: got %q, want empty", s.Name)
		}
		if len(elementChildren(s.Children)) != 1 {
			t.Fatalf("fallback children: got %d, want 1", len(elementChildren(s.Children)))
		}
		if _, ok := elementChildren(s.Children)[0].(*Element); !ok {
			t.Errorf("fallback child0: got %T, want *Element", elementChildren(s.Children)[0])
		}
	})

	t.Run("children marker forwards inside a component invocation", func(t *testing.T) {
		if _, err := Parse([]byte(`<puzzle-view><Card><children/></Card></puzzle-view>`+"\n<script></script>"), "test.pzl"); err != nil {
			t.Fatalf("<children/> inside an invocation should forward, got %v", err)
		}
	})

	errs := []struct {
		name       string
		src        string
		wantSubstr string
	}{
		{ // (a) bare lowercase slot
			name:       "bare lowercase slot is retired",
			src:        `<puzzle-view><slot/></puzzle-view>` + "\n<script></script>",
			wantSubstr: "bare <slot/> was replaced in v1.41 (D74)",
		},
		{ // (b) bare lowercase slot with a body
			name:       "bare lowercase slot with body is retired",
			src:        `<puzzle-view><slot>fallback</slot></puzzle-view>` + "\n<script></script>",
			wantSubstr: "bare <slot/> was replaced in v1.41 (D74)",
		},
		{ // (c) name on capitalized Slot
			name:       "name attribute on capitalized Slot",
			src:        `<puzzle-view><Slot name="x"/></puzzle-view>` + "\n<script></script>",
			wantSubstr: "named slots are spelled lowercase",
		},
		{ // Slot with children keeps the cannot-have-children error
			name:       "capitalized Slot cannot have children",
			src:        `<puzzle-view><Slot>fallback</Slot></puzzle-view>` + "\n<script></script>",
			wantSubstr: "<Slot> cannot have children",
		},
		{ // (d) attribute on children marker
			name:       "class attribute on children marker",
			src:        `<puzzle-view><children class="x"/></puzzle-view>` + "\n<script></script>",
			wantSubstr: "<children> takes no attributes — call-site content needs no configuration",
		},
		{ // (e) name attribute on children marker
			name:       "name attribute on children marker",
			src:        `<puzzle-view><children name="x"/></puzzle-view>` + "\n<script></script>",
			wantSubstr: "<children> takes no attributes — call-site content needs no configuration",
		},
		{ // (f) reserved name="children" on a lowercase slot
			name:       "reserved name children on lowercase slot",
			src:        `<puzzle-view><slot name="children"/></puzzle-view>` + "\n<script></script>",
			wantSubstr: `<slot name="children"> is reserved — use <children/>`,
		},
		{ // (g) ref on children marker
			name:       "ref on children marker",
			src:        `<puzzle-view><children ref="x"/></puzzle-view>` + "\n<script></script>",
			wantSubstr: "ref cannot be placed on a <children> — a children marker is a render target, not a real element",
		},
		{ // (h) duplicate default markers spelled <children/> + <Slot/>
			name:       "duplicate default markers across spellings",
			src:        `<puzzle-view><children/><Slot/></puzzle-view>` + "\n<script></script>",
			wantSubstr: "duplicate default marker (<children/>/<Slot/>)",
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

// TestParseNamedSlotErrors covers the positioned child-side declaration errors
// (v1.21, D53).
func TestParseNamedSlotErrors(t *testing.T) {
	tests := []struct {
		name       string
		src        string
		wantSubstr string
	}{
		{
			name:       "dynamic name",
			src:        `<puzzle-view><slot name={ x }/></puzzle-view>` + "\n<script></script>",
			wantSubstr: "name must be a static string",
		},
		{
			name:       "interpolated name",
			src:        `<puzzle-view><slot name="a{ b }"/></puzzle-view>` + "\n<script></script>",
			wantSubstr: "name must be a static string",
		},
		{
			name:       "empty name",
			src:        `<puzzle-view><slot name=""/></puzzle-view>` + "\n<script></script>",
			wantSubstr: "cannot be empty",
		},
		{
			name:       "reserved default name",
			src:        `<puzzle-view><slot name="default"/></puzzle-view>` + "\n<script></script>",
			wantSubstr: `reserved`,
		},
		{
			name:       "foreign attribute on slot",
			src:        `<puzzle-view><slot class="x"/></puzzle-view>` + "\n<script></script>",
			wantSubstr: "only takes a static name attribute",
		},
		{
			name:       "duplicate slot name in one template",
			src:        `<puzzle-view><slot name="a"/><slot name="a"/></puzzle-view>` + "\n<script></script>",
			wantSubstr: "duplicate slot name",
		},
		{
			name:       "duplicate default marker in one template",
			src:        `<puzzle-view><children/><Slot/></puzzle-view>` + "\n<script></script>",
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

// TestParseDefaultAndNamedSlotOK asserts one default marker <children/> plus one
// named slot in the same template is legal — the duplicate-default guard keys on
// "default" only, so it never collides with a named slot.
func TestParseDefaultAndNamedSlotOK(t *testing.T) {
	if _, err := Parse([]byte(`<puzzle-view><children/><slot name="header"/></puzzle-view>`+"\n<script></script>"), "test.pzl"); err != nil {
		t.Fatalf("one default marker + one named slot should be legal, got %v", err)
	}
}

// TestParseSlotForwarding covers the D71 call-site forwarding rules (v1.38,
// respelled by v1.41/D74): the default marker <children/> (or <Slot/>) may sit
// inside a component invocation (it forwards through the component at runtime),
// but a NAMED marker there is a positioned compile error — named forwarding
// semantics are deliberately unspecified.
func TestParseSlotForwarding(t *testing.T) {
	ok := []struct {
		name string
		src  string
	}{
		{
			name: "children marker inside a component invocation",
			src:  `<puzzle-view><Card><children/></Card></puzzle-view>` + "\n<script></script>",
		},
		{
			name: "children marker nested deeper inside call-site markup",
			src:  `<puzzle-view><Card><div class="wrap"><children/></div></Card></puzzle-view>` + "\n<script></script>",
		},
		{
			name: "named declaration outside plus default forwarding inside",
			src:  `<puzzle-view><slot name="header"/><Card><children/></Card></puzzle-view>` + "\n<script></script>",
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
			src:        `<puzzle-view><Card><slot name="header"/></Card></puzzle-view>` + "\n<script></script>",
			wantSubstr: "inside a component invocation is not supported",
		},
		{
			name:       "named slot nested in an element inside an invocation",
			src:        `<puzzle-view><Card><div><slot name="header"/></div></Card></puzzle-view>` + "\n<script></script>",
			wantSubstr: "inside a component invocation is not supported",
		},
		{
			name:       "named slot inside control flow inside an invocation",
			src:        `<puzzle-view><Card>{#if a}<slot name="header"/>{/if}</Card></puzzle-view>` + "\n<script></script>",
			wantSubstr: "inside a component invocation is not supported",
		},
		{
			name:       "named slot inside a nested component invocation",
			src:        `<puzzle-view><Card><Panel><slot name="header"/></Panel></Card></puzzle-view>` + "\n<script></script>",
			wantSubstr: "inside a component invocation is not supported",
		},
		{
			name:       "default marker both inside and outside an invocation is still a duplicate",
			src:        `<puzzle-view><children/><Card><children/></Card></puzzle-view>` + "\n<script></script>",
			wantSubstr: "duplicate default marker",
		},
		{
			name:       "bare lowercase slot inside an invocation is the retired-spelling error",
			src:        `<puzzle-view><Card><slot/></Card></puzzle-view>` + "\n<script></script>",
			wantSubstr: "bare <slot/> was replaced in v1.41 (D74)",
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
			name:       "children marker inside island subtree",
			src:        `<puzzle-view><div island><children/></div></puzzle-view>` + "\n<script></script>",
			wantSubstr: "a composition marker (<children/>/<slot>/<Slot/>) cannot appear inside an island element",
		},
		{
			name:       "named slot inside island subtree",
			src:        `<puzzle-view><div island><slot name="x"/></div></puzzle-view>` + "\n<script></script>",
			wantSubstr: "a composition marker (<children/>/<slot>/<Slot/>) cannot appear inside an island element",
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
