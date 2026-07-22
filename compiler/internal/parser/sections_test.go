package parser

import (
	"strings"
	"testing"
)

func TestSplitSectionsBasic(t *testing.T) {
	src := `<puzzle-view class="root" id="x">
  <p>hi</p>
</puzzle-view>

<scripts>
export default class Foo {}
</scripts>

<styles>
.root { color: red; }
</styles>
`
	sec, err := SplitSections(src, "Foo.pzl")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(sec.TemplateContent, "<p>hi</p>") {
		t.Errorf("template content missing markup: %q", sec.TemplateContent)
	}
	if strings.Contains(sec.TemplateContent, "puzzle-view") {
		t.Errorf("template content should not include the wrapper tag")
	}
	if !strings.Contains(sec.Scripts, "class Foo") {
		t.Errorf("scripts missing: %q", sec.Scripts)
	}
	if !sec.HasStyles || !strings.Contains(sec.Styles, "color: red") {
		t.Errorf("styles missing: %q", sec.Styles)
	}
	if len(sec.TemplateAttrs) != 2 {
		t.Fatalf("root attrs: got %d, want 2", len(sec.TemplateAttrs))
	}
	if s, ok := sec.TemplateAttrs[0].(*StaticAttr); !ok || s.Name != "class" || s.Value != "root" {
		t.Errorf("root attr0: got %#v", sec.TemplateAttrs[0])
	}
	// content starts on line 1 right after the '>' (a newline), so line 1.
	if sec.TemplatePos.Line != 1 {
		t.Errorf("template pos line: got %d, want 1", sec.TemplatePos.Line)
	}
}

func TestSplitSectionsScriptsOpaque(t *testing.T) {
	// The scripts body contains template-like syntax and '<' comparisons; none
	// of it must be interpreted.
	src := "<puzzle-view><p>x</p></puzzle-view><scripts>\nif (a < b) { c = `{#if}`; }\n</scripts>"
	sec, err := SplitSections(src, "F.pzl")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(sec.Scripts, "a < b") || !strings.Contains(sec.Scripts, "{#if}") {
		t.Errorf("scripts body not preserved verbatim: %q", sec.Scripts)
	}
}

// TestSplitSectionsScriptless asserts <scripts> is optional (DOC-SPEC.md §4): a
// template-only .pzl splits successfully and leaves Scripts == "". (Previously
// this errored with "missing <scripts>".)
func TestSplitSectionsScriptless(t *testing.T) {
	src := `<puzzle-view class="box"><p>hi</p></puzzle-view>`
	sec, err := SplitSections(src, "Box.pzl")
	if err != nil {
		t.Fatalf("scriptless .pzl should be allowed, got error: %v", err)
	}
	if sec.Scripts != "" {
		t.Errorf("expected empty Scripts for a scriptless .pzl, got %q", sec.Scripts)
	}
	if !strings.Contains(sec.TemplateContent, "<p>hi</p>") {
		t.Errorf("template content missing markup: %q", sec.TemplateContent)
	}
	if len(sec.TemplateAttrs) != 1 {
		t.Errorf("root attrs: got %d, want 1", len(sec.TemplateAttrs))
	}
}

// TestSplitSectionsRootAttrPosition asserts a root attribute reports its true
// starting column — the attribute char itself, not the whitespace after the tag
// name that scanOpenTag trims (previously positions were shifted left by it).
func TestSplitSectionsRootAttrPosition(t *testing.T) {
	src := `<puzzle-view class="root" id="x"></puzzle-view>`
	sec, err := SplitSections(src, "F.pzl")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(sec.TemplateAttrs) != 2 {
		t.Fatalf("root attrs: got %d, want 2", len(sec.TemplateAttrs))
	}
	class, ok := sec.TemplateAttrs[0].(*StaticAttr)
	if !ok || class.Name != "class" {
		t.Fatalf("attr0: got %#v", sec.TemplateAttrs[0])
	}
	// '<puzzle-view ' is 13 characters, so 'class' starts at column 14 on line 1.
	if class.Pos.Line != 1 || class.Pos.Col != 14 {
		t.Fatalf("class attr position = %d:%d, want 1:14", class.Pos.Line, class.Pos.Col)
	}
}

// TestSplitSectionsBackslashInRootAttr asserts a trailing backslash in a root
// attribute value is NOT treated as a JS-style escape: the next quote still
// closes the value (matching HTML / the tag-mode lexer), so the tag closes and
// the value is preserved verbatim rather than reporting a spurious unterminated
// tag.
func TestSplitSectionsBackslashInRootAttr(t *testing.T) {
	src := `<puzzle-view class="C:\"><p>hi</p></puzzle-view>`
	sec, err := SplitSections(src, "F.pzl")
	if err != nil {
		t.Fatalf("trailing backslash in attr should parse, got error: %v", err)
	}
	if len(sec.TemplateAttrs) != 1 {
		t.Fatalf("root attrs: got %d, want 1", len(sec.TemplateAttrs))
	}
	s, ok := sec.TemplateAttrs[0].(*StaticAttr)
	if !ok || s.Name != "class" || s.Value != `C:\` {
		t.Fatalf("root attr: got %#v, want class=%q", sec.TemplateAttrs[0], `C:\`)
	}
	if !strings.Contains(sec.TemplateContent, "<p>hi</p>") {
		t.Fatalf("template content missing markup: %q", sec.TemplateContent)
	}
}

// TestSplitSectionsSkeleton covers the optional <puzzle-skeleton> section
// (v1.8, D39): parsed as its own body, template untouched, at most one, and
// no attributes on the tag itself.
func TestSplitSectionsSkeleton(t *testing.T) {
	src := `<puzzle-view class="root">
  <p>{ post.title }</p>
</puzzle-view>

<puzzle-skeleton>
  <div class="bg-skeleton h-4"></div>
</puzzle-skeleton>

<scripts>
export default class Foo {}
</scripts>
`
	sec, err := SplitSections(src, "Foo.pzl")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !sec.HasSkeleton || !strings.Contains(sec.Skeleton, "bg-skeleton") {
		t.Errorf("skeleton body missing: %q", sec.Skeleton)
	}
	if strings.Contains(sec.TemplateContent, "bg-skeleton") {
		t.Errorf("skeleton leaked into template content: %q", sec.TemplateContent)
	}
	if strings.Contains(sec.Skeleton, "post.title") {
		t.Errorf("template leaked into skeleton body: %q", sec.Skeleton)
	}
	// content position starts right after the '>' — line 5 in this source.
	if sec.SkeletonPos.Line != 5 {
		t.Errorf("skeleton pos line: got %d, want 5", sec.SkeletonPos.Line)
	}
}

func TestSplitSectionsSkeletonOptional(t *testing.T) {
	sec, err := SplitSections(`<puzzle-view><p>x</p></puzzle-view>`, "F.pzl")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if sec.HasSkeleton || sec.Skeleton != "" {
		t.Errorf("expected no skeleton, got %q", sec.Skeleton)
	}
}

// TestSplitSectionsSkeletonMinDuration covers the one optional skeleton attribute
// (v1.20, D52): min-duration accepted as a static unsigned integer, absent → 0.
func TestSplitSectionsSkeletonMinDuration(t *testing.T) {
	cases := []struct {
		name string
		tag  string
		want int
	}{
		{"absent", "<puzzle-skeleton>", 0},
		{"double-quoted", `<puzzle-skeleton min-duration="300">`, 300},
		{"single-quoted", `<puzzle-skeleton min-duration='250'>`, 250},
		{"zero", `<puzzle-skeleton min-duration="0">`, 0},
		{"leading zeros", `<puzzle-skeleton min-duration="007">`, 7},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			src := "<puzzle-view></puzzle-view>" + tc.tag + "<div></div></puzzle-skeleton>"
			sec, err := SplitSections(src, "F.pzl")
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if !sec.HasSkeleton {
				t.Fatalf("expected a skeleton")
			}
			if sec.SkeletonMinDuration != tc.want {
				t.Errorf("min-duration: got %d, want %d", sec.SkeletonMinDuration, tc.want)
			}
		})
	}
}

// TestSplitSectionsSkeletonMinDurationErrors covers every rejection (v1.20, D52).
func TestSplitSectionsSkeletonMinDurationErrors(t *testing.T) {
	cases := []struct {
		name       string
		tag        string
		wantSubstr string
	}{
		{"other attribute", `<puzzle-skeleton class="x">`, "the only attribute allowed on <puzzle-skeleton> is `min-duration`"},
		{"min-duration plus other", `<puzzle-skeleton min-duration="300" class="x">`, "the only attribute allowed on <puzzle-skeleton> is `min-duration`"},
		{"dynamic value", `<puzzle-skeleton min-duration={delay}>`, "must be a static integer, not a dynamic"},
		{"negative", `<puzzle-skeleton min-duration="-5">`, "must be a non-negative integer"},
		{"non-integer", `<puzzle-skeleton min-duration="3.5">`, "must be a non-negative integer"},
		{"non-numeric", `<puzzle-skeleton min-duration="fast">`, "must be a non-negative integer"},
		{"unit suffix", `<puzzle-skeleton min-duration="300ms">`, "must be a non-negative integer"},
		// A 40-digit value overflows int: the old hand-rolled accumulator wrapped
		// silently to a small/negative hold; strconv.Atoi now rejects it cleanly.
		{"overflow", `<puzzle-skeleton min-duration="9999999999999999999999999999999999999999">`, "must be a non-negative integer"},
		{"valueless", `<puzzle-skeleton min-duration>`, "requires an integer value"},
		// min-duration="" errors the same way min-duration (bare) does — the check
		// keys on the empty Value, which covers both spellings (Valueless or not).
		{"explicit empty value", `<puzzle-skeleton min-duration="">`, "requires an integer value"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			src := "<puzzle-view></puzzle-view>" + tc.tag + "</puzzle-skeleton>"
			_, err := SplitSections(src, "F.pzl")
			if err == nil {
				t.Fatalf("expected error")
			}
			if !strings.Contains(err.Error(), tc.wantSubstr) {
				t.Fatalf("error %q does not contain %q", err.Error(), tc.wantSubstr)
			}
		})
	}
}

// TestSplitSectionsScriptsLang covers the v1.22 (D54) `lang` attribute on
// <scripts>: absent → "" (JS), lang="js" → "" (explicit JS), lang="ts" → "ts".
func TestSplitSectionsScriptsLang(t *testing.T) {
	tests := []struct {
		name     string
		scripts  string
		wantLang string
	}{
		{"absent", "<scripts>export default class F {}</scripts>", ""},
		{"js", "<scripts lang=\"js\">export default class F {}</scripts>", ""},
		{"ts", "<scripts lang=\"ts\">export default class F {}</scripts>", "ts"},
		{"ts single quotes", "<scripts lang='ts'>export default class F {}</scripts>", "ts"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			src := "<puzzle-view><p>x</p></puzzle-view>" + tc.scripts
			sec, err := SplitSections(src, "F.pzl")
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if sec.ScriptsLang != tc.wantLang {
				t.Fatalf("ScriptsLang: got %q, want %q", sec.ScriptsLang, tc.wantLang)
			}
			// The body is still opaque and preserved verbatim regardless of lang.
			if !strings.Contains(sec.Scripts, "class F") {
				t.Fatalf("scripts body not preserved: %q", sec.Scripts)
			}
		})
	}
}

// TestSplitSectionsScriptsLangErrors covers the compile errors for a bad `lang`.
func TestSplitSectionsScriptsLangErrors(t *testing.T) {
	tests := []struct {
		name       string
		scripts    string
		wantSubstr string
	}{
		{"unknown lang", "<scripts lang=\"coffee\">x</scripts>", "unknown <scripts> lang"},
		{"did-you-mean ts", "<scripts lang=\"typescript\">x</scripts>", "did you mean \"ts\"?"},
		{"empty value", "<scripts lang=\"\">x</scripts>", "requires a value"},
		{"dynamic value", "<scripts lang={x}>x</scripts>", "must be a static"},
		{"other attr", "<scripts type=\"module\">x</scripts>", "the only attribute allowed on <scripts> is `lang`"},
		{"lang plus extra", "<scripts lang=\"ts\" foo=\"bar\">x</scripts>", "the only attribute allowed on <scripts> is `lang`"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			src := "<puzzle-view><p>x</p></puzzle-view>" + tc.scripts
			_, err := SplitSections(src, "F.pzl")
			if err == nil {
				t.Fatalf("expected error")
			}
			if !strings.Contains(err.Error(), tc.wantSubstr) {
				t.Fatalf("error %q does not contain %q", err.Error(), tc.wantSubstr)
			}
		})
	}
}

// TestSplitSectionsScriptsCloseAware asserts a literal </scripts> inside a JS
// comment or string does NOT truncate the script body — the close scan skips
// comments and string literals (FIX 1b) so the whole body is preserved.
func TestSplitSectionsScriptsCloseAware(t *testing.T) {
	cases := []struct {
		name    string
		scripts string
		// a marker that must survive AFTER the fake close tag inside the body.
		wantTail string
	}{
		{
			name:     "literal in line comment",
			scripts:  "// everything above the </scripts> tag\nexport default class Foo {}\n",
			wantTail: "class Foo",
		},
		{
			name:     "literal in string",
			scripts:  "const s = \"</scripts>\";\nexport default class Bar {}\n",
			wantTail: "class Bar",
		},
		{
			name:     "literal in block comment",
			scripts:  "/* close it </scripts> here */\nexport default class Baz {}\n",
			wantTail: "class Baz",
		},
		{
			name:     "literal in nested template interpolation",
			scripts:  "const x = `x ${`</scripts>`}`;\nexport default class Nested {}\n",
			wantTail: "class Nested",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			src := "<puzzle-view><p>x</p></puzzle-view>\n<scripts>" + tc.scripts + "</scripts>\n"
			sec, err := SplitSections(src, "F.pzl")
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if !strings.Contains(sec.Scripts, tc.wantTail) {
				t.Fatalf("script body truncated at fake close; got %q", sec.Scripts)
			}
			if !strings.Contains(sec.Scripts, "</scripts>") {
				t.Fatalf("the literal </scripts> should be preserved verbatim in the body; got %q", sec.Scripts)
			}
		})
	}
}

func TestSplitSectionsTemplateCloseAware(t *testing.T) {
	cases := []struct {
		name     string
		template string
		wantTail string
	}{
		{
			name:     "literal in interpolation string",
			template: "<p>{ x === '</puzzle-view>' }</p><span>after interpolation</span>",
			wantTail: "after interpolation",
		},
		{
			name:     "literal in HTML comment",
			template: "<!-- disabled </puzzle-view> --><span>after comment</span>",
			wantTail: "after comment",
		},
		{
			name:     "ordinary template",
			template: "<p>unchanged</p>",
			wantTail: "unchanged",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			src := "<puzzle-view>" + tc.template + "</puzzle-view>"
			sec, err := SplitSections(src, "F.pzl")
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if sec.TemplateContent != tc.template {
				t.Fatalf("template body changed or truncated:\n got %q\nwant %q", sec.TemplateContent, tc.template)
			}
			if !strings.Contains(sec.TemplateContent, tc.wantTail) {
				t.Fatalf("template body missing tail %q: %q", tc.wantTail, sec.TemplateContent)
			}
		})
	}
}

// TestSplitSectionsSkeletonCloseAware asserts the <puzzle-skeleton> body uses the
// full template scanner (SPEC §16), so a literal </puzzle-skeleton> inside a
// template comment, interpolation string, or HTML comment does NOT truncate the
// skeleton body — the same guarantee <puzzle-view> already has.
func TestSplitSectionsSkeletonCloseAware(t *testing.T) {
	cases := []struct {
		name     string
		skeleton string
	}{
		{
			name:     "literal in block comment",
			skeleton: `{#comment} </puzzle-skeleton> {/comment}<div class="bg-skeleton"></div>`,
		},
		{
			name:     "literal in interpolation string",
			skeleton: `<span>{ '</puzzle-skeleton>' }</span><div class="bg-skeleton"></div>`,
		},
		{
			name:     "literal in HTML comment",
			skeleton: `<!-- disabled </puzzle-skeleton> --><div class="bg-skeleton"></div>`,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			src := "<puzzle-view><p>x</p></puzzle-view>\n<puzzle-skeleton>" + tc.skeleton + "</puzzle-skeleton>"
			sec, err := SplitSections(src, "F.pzl")
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if !sec.HasSkeleton {
				t.Fatal("expected a skeleton section")
			}
			if sec.Skeleton != tc.skeleton {
				t.Fatalf("skeleton body changed or truncated:\n got %q\nwant %q", sec.Skeleton, tc.skeleton)
			}
			// The trailing marker proves the body was not cut at the embedded literal.
			if !strings.Contains(sec.Skeleton, "bg-skeleton") {
				t.Fatalf("skeleton tail missing (body truncated early): %q", sec.Skeleton)
			}
		})
	}
}

// TestSplitSectionsStylesCloseAware asserts a literal </styles> inside a CSS
// comment or string does NOT truncate the styles body (FIX 1b, CSS scan).
func TestSplitSectionsStylesCloseAware(t *testing.T) {
	cases := []struct {
		name   string
		styles string
	}{
		{"literal in comment", "/* not a close </styles> */\n.root { color: red; }\n"},
		{"literal in string", ".x::after { content: \"</styles>\"; }\n.root { color: red; }\n"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			src := "<puzzle-view><p>x</p></puzzle-view>\n<styles>" + tc.styles + "</styles>\n"
			sec, err := SplitSections(src, "F.pzl")
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if !sec.HasStyles || !strings.Contains(sec.Styles, "color: red") {
				t.Fatalf("styles body truncated at fake close; got %q", sec.Styles)
			}
			if !strings.Contains(sec.Styles, "</styles>") {
				t.Fatalf("the literal </styles> should be preserved verbatim; got %q", sec.Styles)
			}
		})
	}
}

// TestSplitSectionsStrayContent covers the backstop (FIX 1a): non-whitespace
// content outside a recognized section is a positioned error, not silently
// skipped — including a body truncated by a literal close tag the scan could not
// see through (e.g. inside a nested template literal).
func TestSplitSectionsStrayContent(t *testing.T) {
	cases := []struct {
		name       string
		src        string
		wantSubstr string
	}{
		{
			name:       "stray markup between sections",
			src:        "<puzzle-view></puzzle-view>\n<div>oops</div>\n<scripts></scripts>",
			wantSubstr: "unexpected content outside a section",
		},
		{
			name:       "stray text before puzzle-view",
			src:        "garbage\n<puzzle-view></puzzle-view>\n<scripts></scripts>",
			wantSubstr: "unexpected content outside a section",
		},
		{
			name: "orphan close tag after scripts hints at the cause",
			// A stray </scripts> after the section: the same shape a
			// nested-template-literal truncation leaves behind. Points at the body.
			src:        "<puzzle-view></puzzle-view>\n<scripts>const x = 1;</scripts>\nleftover</scripts>",
			wantSubstr: "a literal </scripts> inside a comment or string",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := SplitSections(tc.src, "F.pzl")
			if err == nil {
				t.Fatalf("expected error")
			}
			if !strings.Contains(err.Error(), tc.wantSubstr) {
				t.Fatalf("error %q does not contain %q", err.Error(), tc.wantSubstr)
			}
		})
	}
}

func TestSplitSectionsErrors(t *testing.T) {
	tests := []struct {
		name       string
		src        string
		wantSubstr string
	}{
		{"missing puzzle-view", "<scripts>x</scripts>", "missing <puzzle-view>"},
		{"two puzzle-view", "<puzzle-view></puzzle-view><puzzle-view></puzzle-view><scripts></scripts>", "multiple <puzzle-view>"},
		{"two scripts", "<puzzle-view></puzzle-view><scripts></scripts><scripts></scripts>", "multiple <scripts>"},
		{"two styles", "<puzzle-view></puzzle-view><scripts></scripts><styles></styles><styles></styles>", "multiple <styles>"},
		{"unterminated puzzle-view tag", "<puzzle-view class=", "unterminated <puzzle-view> tag"},
		{"missing close", "<puzzle-view><p></p><scripts></scripts>", "missing </puzzle-view>"},
		{"two skeletons", "<puzzle-view></puzzle-view><puzzle-skeleton></puzzle-skeleton><puzzle-skeleton></puzzle-skeleton>", "multiple <puzzle-skeleton>"},
		{"attrs on skeleton", "<puzzle-view></puzzle-view><puzzle-skeleton class=\"x\"></puzzle-skeleton>", "the only attribute allowed on <puzzle-skeleton> is `min-duration`"},
		{"missing skeleton close", "<puzzle-view></puzzle-view><puzzle-skeleton><div></div>", "missing </puzzle-skeleton>"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := SplitSections(tc.src, "F.pzl")
			if err == nil {
				t.Fatalf("expected error")
			}
			if !strings.Contains(err.Error(), tc.wantSubstr) {
				t.Fatalf("error %q does not contain %q", err.Error(), tc.wantSubstr)
			}
		})
	}
}

// TestSplitSectionsStylesScoped covers the v1.27 (D59) `scoped` attribute on
// <styles>: a bare `scoped` sets StylesScoped, and absence leaves it false with
// the block body preserved verbatim.
func TestSplitSectionsStylesScoped(t *testing.T) {
	tests := []struct {
		name       string
		styles     string
		wantScoped bool
	}{
		{"absent", "<styles>.a{color:red}</styles>", false},
		{"bare scoped", "<styles scoped>.a{color:red}</styles>", true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			src := "<puzzle-view><p>x</p></puzzle-view>" + tc.styles
			sec, err := SplitSections(src, "F.pzl")
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if sec.StylesScoped != tc.wantScoped {
				t.Fatalf("StylesScoped: got %v, want %v", sec.StylesScoped, tc.wantScoped)
			}
			if !sec.HasStyles || !strings.Contains(sec.Styles, ".a{color:red}") {
				t.Fatalf("styles body not preserved: %q", sec.Styles)
			}
		})
	}
}

// TestSplitSectionsStylesScopedErrors covers the compile errors for a bad
// <styles> attribute (v1.27, D59) — the first attribute ever validated on
// <styles> (previously silently discarded).
func TestSplitSectionsStylesScopedErrors(t *testing.T) {
	tests := []struct {
		name       string
		styles     string
		wantSubstr string
	}{
		{"valued scoped", "<styles scoped=\"true\">.a{}</styles>", "`scoped` on <styles> is a bare attribute"},
		{"empty valued scoped", "<styles scoped=\"\">.a{}</styles>", "`scoped` on <styles> is a bare attribute"},
		{"dynamic scoped", "<styles scoped={x}>.a{}</styles>", "not a dynamic {…} value"},
		{"unknown attr", "<styles lang=\"css\">.a{}</styles>", "the only attribute allowed on <styles> is `scoped`"},
		{"did-you-mean", "<styles scopped>.a{}</styles>", "did you mean `scoped`?"},
		{"duplicate scoped", "<styles scoped scoped>.a{}</styles>", "the only attribute allowed on <styles> is `scoped`"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			src := "<puzzle-view><p>x</p></puzzle-view>" + tc.styles
			_, err := SplitSections(src, "F.pzl")
			if err == nil {
				t.Fatalf("expected error")
			}
			if !strings.Contains(err.Error(), tc.wantSubstr) {
				t.Fatalf("error %q does not contain %q", err.Error(), tc.wantSubstr)
			}
		})
	}
}
