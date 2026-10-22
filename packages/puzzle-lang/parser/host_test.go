package parser_test

import (
	"errors"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/magic-spells/puzzle/packages/puzzle-lang/parser"
)

// host_test.go proves the exported host surface (host.go) is enough for a
// host with its own file layout. liftBlocks below is a wrapper-less splitter
// written against the public API only — this file is package parser_test — in
// the shape Sites uses: a theme file is markup plus optional top-level
// <schema>, <script> and <style> blocks, each lifted and blanked to spaces so
// the markup keeps the file's coordinates, and the markup is then parsed with
// ParseMarkup. The tests are the Sites splitter's own, run against it.

type liftedBlock struct {
	Body    string
	BodyPos parser.Position
	TagPos  parser.Position
	Found   bool
}

type liftedFile struct {
	Markup      string
	Schema      liftedBlock
	Script      liftedBlock
	ScriptLang  string
	Style       liftedBlock
	StyleScoped bool
}

var hostWrapperTags = []string{"puzzle-view", "puzzle-layout", "puzzle-skeleton"}

func hostPosAt(src string, off int) parser.Position {
	return parser.Position{Line: 1, Col: 1}.Advance(src[:min(off, len(src))])
}

func hostErr(src, file string, off int, msg string) error {
	p := hostPosAt(src, off)
	return &parser.ParseError{File: file, Line: p.Line, Col: p.Col, Message: msg}
}

func hostWrapperName(name string) string {
	for _, w := range hostWrapperTags {
		if strings.EqualFold(name, w) {
			return w
		}
	}
	return ""
}

func hostWrapperErr(src, file string, off int, wrapper string) error {
	return hostErr(src, file, off, "<"+wrapper+"> is not part of a theme file — run the migration to remove the wrapper")
}

func liftBlocks(src, filename string) (liftedFile, error) {
	out := liftedFile{Markup: src}
	blank := func(from, to int) {
		b := []byte(out.Markup)
		for j := from; j < to; j++ {
			if b[j] != '\n' {
				b[j] = ' '
			}
		}
		out.Markup = string(b)
	}
	i := 0
	if strings.HasPrefix(src, "\xEF\xBB\xBF") {
		i = 3
		blank(0, i)
	}
	depth := 0
	for i < len(src) {
		switch {
		case src[i] == '\\' && i+1 < len(src) && (src[i+1] == '{' || src[i+1] == '}'):
			i += 2
		case src[i] == '{':
			next, err := parser.SkipBraceGroup(src, i, filename)
			if err != nil {
				// An unterminated group runs to the end of the file, so the
				// parse would fail here too: report it. Stepping one byte and
				// retrying would rescan the rest of the file per '{'.
				return out, err
			}
			i = next
		case src[i] != '<':
			i++
		case strings.HasPrefix(src[i:], "<!--"):
			end := strings.Index(src[i+4:], "-->")
			if end < 0 {
				return out, hostErr(src, filename, i, "unterminated comment")
			}
			i += 4 + end + 3
		case strings.HasPrefix(src[i:], "<!"):
			end := strings.IndexByte(src[i:], '>')
			if end < 0 {
				return out, hostErr(src, filename, i, "unterminated <! declaration")
			}
			i += end + 1
		case strings.HasPrefix(src[i:], "</"):
			name := parser.TagNameAt(src, i+2)
			if name == "" {
				i++
				continue
			}
			if w := hostWrapperName(name); w != "" {
				return out, hostWrapperErr(src, filename, i, w)
			}
			end := strings.IndexByte(src[i:], '>')
			if end < 0 {
				return out, hostErr(src, filename, i, "unterminated </"+name+"> tag")
			}
			if depth > 0 {
				depth--
			}
			i += end + 1
		default:
			name := parser.TagNameAt(src, i+1)
			if name == "" {
				i++
				continue
			}
			if w := hostWrapperName(name); w != "" {
				return out, hostWrapperErr(src, filename, i, w)
			}
			afterOpen, attrOffset, attrsRaw, err := parser.ScanOpenTag(src, i, name, filename)
			if err != nil {
				return out, err
			}
			lower := strings.ToLower(name)
			topLevel := lower == "schema" || lower == "script" || lower == "style"
			if depth > 0 || !topLevel || scriptIsMarkup(lower, attrsRaw) {
				if !strings.HasSuffix(attrsRaw, "/") {
					depth++
				}
				i = afterOpen
				continue
			}
			end, err := liftOne(&out, src, filename, lower, i, afterOpen, attrOffset, attrsRaw)
			if err != nil {
				return out, err
			}
			blank(i, end)
			i = end
		}
	}
	return out, nil
}

// scriptIsMarkup: a top-level <script> with any attribute but `lang` is page
// markup (a JSON data island), not the file's script.
func scriptIsMarkup(name, attrsRaw string) bool {
	if name != "script" || strings.TrimSpace(attrsRaw) == "" {
		return false
	}
	names, err := parser.AttrNames(strings.TrimSuffix(attrsRaw, "/"), parser.Position{Line: 1, Col: 1}, "")
	if err != nil {
		return false
	}
	for _, n := range names {
		if !strings.EqualFold(n.Name, "lang") {
			return true
		}
	}
	return false
}

func schemaTag(raw string, tagPos, attrPos parser.Position, filename string) error {
	if strings.TrimSuffix(raw, "/") == "" && strings.HasSuffix(raw, "/") {
		return &parser.ParseError{File: filename, Line: tagPos.Line, Col: tagPos.Col,
			Message: "a <schema> block cannot be self-closing — write <schema>{…}</schema>"}
	}
	names, err := parser.AttrNames(raw, attrPos, filename)
	if err != nil {
		return err
	}
	for _, n := range names {
		msg := "<schema> takes no attributes (got " + strconv.Quote(n.Name) + ") — a section's settings are the JSON inside <schema>…</schema>"
		if strings.EqualFold(n.Name, "src") {
			msg = "<schema src=…> is not supported — put the JSON inside <schema>"
		}
		return &parser.ParseError{File: filename, Line: n.Pos.Line, Col: n.Pos.Col, Message: msg}
	}
	return nil
}

func liftOne(f *liftedFile, src, filename, name string, tagStart, afterOpen, attrOffset int, attrsRaw string) (int, error) {
	block := map[string]*liftedBlock{"schema": &f.Schema, "script": &f.Script, "style": &f.Style}[name]
	if block.Found {
		return 0, hostErr(src, filename, tagStart, "multiple <"+name+"> blocks (only one allowed)")
	}
	if name != "schema" && strings.TrimSuffix(attrsRaw, "/") == "" && strings.HasSuffix(attrsRaw, "/") {
		return 0, hostErr(src, filename, tagStart, "a <"+name+"> block cannot be self-closing — write <"+name+">…</"+name+">")
	}
	attrPos := hostPosAt(src, attrOffset)
	var err error
	switch name {
	case "schema":
		err = schemaTag(attrsRaw, hostPosAt(src, tagStart), attrPos, filename)
	case "script":
		f.ScriptLang, err = parser.ParseScriptLang(attrsRaw, attrPos, filename)
	case "style":
		f.StyleScoped, err = parser.ParseStyleScoped(attrsRaw, attrPos, filename)
	}
	if err != nil {
		return 0, err
	}
	end := -1
	switch name {
	case "script":
		end, _ = parser.FindScriptClose(src, afterOpen)
	case "style":
		end = parser.FindStyleClose(src, afterOpen)
	default:
		if rel := strings.Index(src[afterOpen:], "</"+name+">"); rel >= 0 {
			end = afterOpen + rel
		}
	}
	if end < 0 {
		return 0, hostErr(src, filename, tagStart, "missing </"+name+"> for <"+name+">")
	}
	*block = liftedBlock{Body: src[afterOpen:end], BodyPos: hostPosAt(src, afterOpen), TagPos: hostPosAt(src, tagStart), Found: true}
	return end + len("</"+name+">"), nil
}

func parseHostMarkup(markup, filename string) (*parser.Element, error) {
	return parser.ParseMarkup(markup, parser.Position{}, filename, letOpts)
}

const liftMarkup = "<div><p>hello</p></div>"

func blanked(src string) string {
	out := []byte(src)
	for i := range out {
		if out[i] != '\n' {
			out[i] = ' '
		}
	}
	return string(out)
}

func TestHostLiftSchema(t *testing.T) {
	const schema = "<schema>\n{\"name\":\"Café\"}\r\n</schema>"
	for _, tt := range []struct {
		name, source string
		found        bool
	}{
		{"top", schema + "\n" + liftMarkup, true},
		{"between blocks", liftMarkup + "\n" + schema + "\n<style>p { color: red }</style>", true},
		{"end", liftMarkup + "\n" + schema, true},
		{"none", liftMarkup, false},
		{"BOM and comments", "\xEF\xBB\xBF<!-- <schema>no</schema> -->\n" + schema + liftMarkup, true},
		{"script text", `<script>const text = "</schema><schema>"; const close = "</script>";</script>` + schema + liftMarkup, true},
		{"script only", `<script>const text = "</schema><schema>";</script>` + liftMarkup, false},
		{"style comment", `<style>/* <schema> </style> </schema> */ p { color: red }</style>` + schema + liftMarkup, true},
		{"nested is markup", "<div><schema>inside</schema></div>", false},
		{"raw is markup", "<div>{#raw}<schema>inside</schema>{/raw}</div>", false},
		{"top-level raw is markup", "{#raw}<schema>inside</schema>{/raw}" + liftMarkup, false},
		{"template comment is markup", "{#comment}<schema>no</schema>{/comment}{## <schema> }" + liftMarkup, false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			f, err := liftBlocks(tt.source, "sections/Hero.pzl")
			if err != nil || f.Schema.Found != tt.found {
				t.Fatalf("found=%v, err=%v; want found=%v", f.Schema.Found, err, tt.found)
			}
			if !tt.found {
				return
			}
			if f.Schema.Body != "\n{\"name\":\"Café\"}\r\n" {
				t.Fatalf("body=%q", f.Schema.Body)
			}
			start := strings.Index(tt.source, schema)
			wantTag := hostPosAt(tt.source, start)
			wantBody := hostPosAt(tt.source, start+len("<schema>"))
			if f.Schema.TagPos != wantTag || f.Schema.BodyPos != wantBody {
				t.Fatalf("positions=%+v, want tag %+v and body %+v", f.Schema, wantTag, wantBody)
			}
			if len(f.Markup) != len(tt.source) {
				t.Fatalf("markup length changed: %d to %d", len(tt.source), len(f.Markup))
			}
			if f.Markup[start:start+len(schema)] != blanked(schema) {
				t.Fatalf("schema was not blanked: %q", f.Markup[start:start+len(schema)])
			}
		})
	}
}

// A <script> or <style> inside the markup is markup; only a top-level block is
// the file's browser script or stylesheet.
func TestHostLiftNesting(t *testing.T) {
	const source = `<html>
  <head><style>.a { color: red }</style></head>
  <body><script type="application/json">{ json(data) }</script></body>
</html>
<script lang="ts">const n: number = 1;</script>
<style scoped>.b { color: blue }</style>`
	f, err := liftBlocks(source, "layouts/Default.pzl")
	if err != nil {
		t.Fatal(err)
	}
	if f.Script.Body != "const n: number = 1;" || f.ScriptLang != "ts" {
		t.Fatalf("script=%q lang=%q", f.Script.Body, f.ScriptLang)
	}
	if f.Style.Body != ".b { color: blue }" || !f.StyleScoped {
		t.Fatalf("style=%q scoped=%v", f.Style.Body, f.StyleScoped)
	}
	if !strings.Contains(f.Markup, ".a { color: red }") || !strings.Contains(f.Markup, "application/json") {
		t.Fatalf("nested blocks were lifted: %q", f.Markup)
	}
	if strings.Contains(f.Markup, "const n") || strings.Contains(f.Markup, ".b {") {
		t.Fatalf("top-level blocks stayed in the markup: %q", f.Markup)
	}
}

func TestHostLiftWrappers(t *testing.T) {
	for _, tt := range []struct {
		source, wrapper string
		line, col       int
	}{
		{"<puzzle-view>\n  <p>hi</p>\n</puzzle-view>", "puzzle-view", 1, 1},
		{"<div>\n  <puzzle-layout>x</puzzle-layout>\n</div>", "puzzle-layout", 2, 3},
		{"<div></div>\n<puzzle-skeleton></puzzle-skeleton>", "puzzle-skeleton", 2, 1},
		{"<PUZZLE-VIEW></PUZZLE-VIEW>", "puzzle-view", 1, 1},
	} {
		t.Run(tt.wrapper, func(t *testing.T) {
			_, err := liftBlocks(tt.source, "templates/Page.pzl")
			var pe *parser.ParseError
			if !errors.As(err, &pe) {
				t.Fatalf("want positioned error, got %v", err)
			}
			if !strings.HasPrefix(pe.Message, "<"+tt.wrapper+"> is not part of a theme file") || pe.Line != tt.line || pe.Col != tt.col {
				t.Fatalf("got %v, want %d:%d", pe, tt.line, tt.col)
			}
		})
	}
}

// <schema> takes no attributes, and an attribute is matched by name without its
// value ever being read as a template expression.
func TestHostSchemaAttributes(t *testing.T) {
	for _, tt := range []struct {
		attrs, got string
		col        int
	}{
		{` ignored data-note="src='other.json'"`, "ignored", 9},
		{` data-note="src='other.json'" ignored`, "data-note", 9},
		{` @unknown="ignored" arbitrary:namespace="ignored"`, "@unknown", 9},
		{` when={ a > b } title="a > b"`, "when", 9},
		{` note="{#not-template}"`, "note", 9},
		{"\n  NAME=\"Hero\"", "NAME", 3},
	} {
		t.Run(tt.got, func(t *testing.T) {
			_, err := liftBlocks("<schema"+tt.attrs+">{}</schema>"+liftMarkup, "test.pzl")
			var pe *parser.ParseError
			if !errors.As(err, &pe) {
				t.Fatalf("want positioned error, got %v", err)
			}
			want := "<schema> takes no attributes (got " + strconv.Quote(tt.got) + ") — a section's settings are the JSON inside <schema>…</schema>"
			if pe.Message != want || pe.Col != tt.col {
				t.Fatalf("got %v; want col %d: %s", pe, tt.col, want)
			}
		})
	}
}

func TestHostLiftErrors(t *testing.T) {
	for _, tt := range []struct {
		name, source, message string
		line, col             int
	}{
		{"duplicate schema", "<schema>{}</schema>\n  <schema>{}</schema>", "multiple <schema> blocks (only one allowed)", 2, 3},
		{"duplicate style", "<style>a{}</style>\n<style>b{}</style>", "multiple <style> blocks (only one allowed)", 2, 1},
		{"unterminated", liftMarkup + "\n  <schema>{}", "missing </schema> for <schema>", 2, 3},
		{"unterminated opener", liftMarkup + "\n  <schema", "unterminated <schema> tag", 2, 3},
		{"src quoted", "<schema\n  src=\"schema.json\">{}</schema>", "<schema src=…> is not supported — put the JSON inside <schema>", 2, 3},
		{"self-closing schema", liftMarkup + "\n  <schema/>", "a <schema> block cannot be self-closing — write <schema>{…}</schema>", 2, 3},
		{"self-closing style", "<style/>", "a <style> block cannot be self-closing — write <style>…</style>", 1, 1},
		{"comment", liftMarkup + "\n<!--", "unterminated comment", 2, 1},
		{"script close", liftMarkup + "\n<script>const x = '</schema>';", "missing </script> for <script>", 2, 1},
		{"style close", liftMarkup + "\n<style>/* <schema> */", "missing </style> for <style>", 2, 1},
		{"script lang", "<script lang=\"typescript\"></script>", "unknown <script> lang \"typescript\" — expected \"ts\" (TypeScript) or \"js\" (JavaScript, the default) — did you mean \"ts\"?", 1, 9},
		{"style attribute", "<style scopd></style>", "the only attribute allowed on <style> is `scoped` (got \"scopd\") — did you mean `scoped`?", 1, 8},
	} {
		t.Run(tt.name, func(t *testing.T) {
			_, err := liftBlocks(tt.source, "test.pzl")
			var pe *parser.ParseError
			if !errors.As(err, &pe) {
				t.Fatalf("want positioned error, got %v", err)
			}
			if pe.File != "test.pzl" || pe.Line != tt.line || pe.Col != tt.col || pe.Message != tt.message {
				t.Fatalf("got %v; want test.pzl:%d:%d: %s", pe, tt.line, tt.col, tt.message)
			}
		})
	}
}

// Lifting a block must not move anything after it: a file with a schema and an
// independently authored file with the same bytes blanked report the same
// position for the same mistake.
func TestHostLiftPositionStability(t *testing.T) {
	const suffix = " <div>\n  <div>\n  </span>\n</div>"
	const schema = "<schema>\n{\"name\":\"Hero\"}\n</schema>"
	const noSchema = "        \n               \n         "
	f, err := liftBlocks(schema+suffix, "sections/Hero.pzl")
	if err != nil {
		t.Fatal(err)
	}
	parseError := func(markup string) error {
		_, err := parseHostMarkup(markup, "sections/Hero.pzl")
		return err
	}
	got, want := parseError(f.Markup), parseError(noSchema+suffix)
	if got == nil || want == nil || got.Error() != want.Error() {
		t.Fatalf("position changed: got %v, want %v", got, want)
	}
	if got.Error() != "sections/Hero.pzl:5:3: closing tag </span> does not match <div> opened at 4:3" {
		t.Fatalf("unexpected error: %v", got)
	}
}

// ParseMarkup is the grammar ParseTemplate parses; only the root container
// differs.
func TestParseMarkupSharesGrammar(t *testing.T) {
	for _, markup := range []string{
		`<p title="hello {name}">{#if show}{name}{:else}hidden{/if}</p>`,
		`{#raw}<p ref="literal">{text}</p>{/raw}`,
		`<div></span>`,
		`{`,
	} {
		sec, err := parser.SplitSections("<puzzle-view>"+markup+"</puzzle-view>", "test.pzl")
		if err != nil {
			t.Fatal(err)
		}
		want, wantErr := parser.ParseTemplate(sec, "test.pzl")
		got, gotErr := parser.ParseMarkup(markup, parser.Position{}, "test.pzl")
		if gotErr != nil || wantErr != nil {
			if (gotErr == nil) != (wantErr == nil) {
				t.Errorf("error mismatch for %q: %v vs %v", markup, gotErr, wantErr)
			}
			continue
		}
		if got.Tag != "" || got.Pos != (parser.Position{Line: 1, Col: 1}) {
			t.Errorf("root = %q at %+v", got.Tag, got.Pos)
		}
		got.Tag, got.Pos, want.Pos = want.Tag, parser.Position{}, parser.Position{}
		got.Children, want.Children = nil, nil // child positions differ by the wrapper's width
		if !reflect.DeepEqual(got, want) {
			t.Errorf("root mismatch for %q: got %+v, want %+v", markup, got, want)
		}
	}
}

// ParseMarkup reports in the coordinates it is given: a fragment that starts
// mid-file has mid-file positions.
func TestParseMarkupAt(t *testing.T) {
	at := parser.Position{Line: 7, Col: 5, Offset: 120}
	root, err := parser.ParseMarkup("<p>{ a }</p>", at, "f.pzl")
	if err != nil {
		t.Fatal(err)
	}
	p := root.Children[0].(*parser.Element)
	interp := p.Children[0].(*parser.Interpolation)
	if root.Pos != at || p.Pos != at || interp.Pos != (parser.Position{Line: 7, Col: 8, Offset: 123}) {
		t.Fatalf("positions: root %+v, p %+v, interp %+v", root.Pos, p.Pos, interp.Pos)
	}
	_, err = parser.ParseMarkup("<p>\n</div>", at, "f.pzl")
	if err == nil || err.Error() != "f.pzl:8:1: closing tag </div> does not match <p> opened at 7:5" {
		t.Fatalf("err = %v", err)
	}
}

// The checks a host turns off are off one by one; the ones it leaves on run.
func TestOptionsSkipChecks(t *testing.T) {
	for _, tt := range []struct {
		name, markup, message string
		skip                  parser.Options
	}{
		{"island", `<p island={x}></p>`, "island must be a static attribute", parser.Options{SkipIslandCheck: true}},
		{"slot", `<Children/><Children/>`, "duplicate default marker", parser.Options{SkipSlotCheck: true}},
		{"ref", `<p ref="a"></p><p ref="a"></p>`, "duplicate ref name", parser.Options{SkipRefCheck: true}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := parser.ParseMarkup(tt.markup, parser.Position{}, "f.pzl"); err == nil || !strings.Contains(err.Error(), tt.message) {
				t.Fatalf("default options: want %q, got %v", tt.message, err)
			}
			if _, err := parser.ParseMarkup(tt.markup, parser.Position{}, "f.pzl", tt.skip); err != nil {
				t.Fatalf("skipped: %v", err)
			}
			for _, other := range []parser.Options{{SkipIslandCheck: true}, {SkipSlotCheck: true}, {SkipRefCheck: true}} {
				if other == tt.skip {
					continue
				}
				if _, err := parser.ParseMarkup(tt.markup, parser.Position{}, "f.pzl", other); err == nil {
					t.Fatalf("%+v skipped the %s check", other, tt.name)
				}
			}
			wrapped := []byte("<puzzle-view>" + tt.markup + "</puzzle-view>")
			if _, err := parser.Parse(wrapped, "f.pzl", tt.skip); err != nil {
				t.Fatalf("Parse with %+v: %v", tt.skip, err)
			}
		})
	}
}

func TestHostScanners(t *testing.T) {
	for _, tt := range []struct {
		s    string
		i    int
		want string
	}{
		{"<div class=x>", 1, "div"},
		{"</div>", 2, "div"},
		{"<schema>", 1, "schema"},
		{"<script/>", 1, "script"},
		{"<Frame.Übersicht>", 1, "Frame.Übersicht"},
		{"<p", 1, "p"},
		{"<$50", 1, ""},
		{"< p>", 1, ""},
		{"<div{x}>", 1, ""},
	} {
		if got := parser.TagNameAt(tt.s, tt.i); got != tt.want {
			t.Errorf("TagNameAt(%q, %d) = %q, want %q", tt.s, tt.i, got, tt.want)
		}
	}

	for _, tt := range []struct {
		s    string
		end  int
		fail bool
	}{
		{"{ a }x", 5, false},
		{"{ '}' }x", 7, false},
		{"{## don't }x", 11, false},
		{"{#comment}{ ' }{/comment}x", 25, false},
		{"{#raw}{ ' }{/raw}x", 17, false},
		{"{#raw}{ x }", 0, true},
		{"{ a", 0, true},
		{"x", 0, true},
	} {
		end, err := parser.SkipBraceGroup(tt.s, 0, "f.pzl")
		if (err != nil) != tt.fail || end != tt.end {
			t.Errorf("SkipBraceGroup(%q) = %d, %v; want %d (fail %v)", tt.s, end, err, tt.end, tt.fail)
		}
	}

	inner, end, err := parser.ScanBraceGroup("{ a | b }", 0, "f.pzl")
	if err != nil || inner != " a | b " || end != 9 {
		t.Errorf("ScanBraceGroup = %q, %d, %v", inner, end, err)
	}

	src := "<puzzle-view>{ '</puzzle-view>' }<!-- </puzzle-view> -->{#raw}</puzzle-view>{/raw}</puzzle-view>"
	if at := parser.FindTemplateClose(src, 13, "</puzzle-view>"); at != len(src)-len("</puzzle-view>") {
		t.Errorf("FindTemplateClose = %d", at)
	}

	attrs, err := parser.ParseAttrString(`page title="Home" count={ n }`, parser.Position{Line: 1, Col: 14, Offset: 13}, "f.pzl", "puzzle-view")
	if err != nil || len(attrs) != 3 {
		t.Fatalf("ParseAttrString = %+v, %v", attrs, err)
	}
	if a, ok := attrs[0].(*parser.StaticAttr); !ok || !a.Valueless || a.Name != "page" || a.Pos.Col != 14 {
		t.Errorf("first attribute = %+v", attrs[0])
	}
	if _, ok := attrs[2].(*parser.DynamicAttr); !ok {
		t.Errorf("third attribute = %+v", attrs[2])
	}
	if attrs, err := parser.ParseAttrString("", parser.Position{}, "f.pzl", "x"); attrs != nil || err != nil {
		t.Errorf("empty ParseAttrString = %v, %v", attrs, err)
	}

	names, err := parser.AttrNames(`a b="x > y" c={ 1 }`, parser.Position{Line: 2, Col: 3, Offset: 10}, "f.pzl")
	if err != nil || len(names) != 3 || names[1].Name != "b" || names[2].Pos != (parser.Position{Line: 2, Col: 15, Offset: 22}) {
		t.Errorf("AttrNames = %+v, %v", names, err)
	}

	if lang, err := parser.ParseScriptLang(`lang="js"`, parser.Position{Line: 1, Col: 1}, "f.pzl"); lang != "" || err != nil {
		t.Errorf("ParseScriptLang(js) = %q, %v", lang, err)
	}
	if scoped, err := parser.ParseStyleScoped("", parser.Position{Line: 1, Col: 1}, "f.pzl"); scoped || err != nil {
		t.Errorf("ParseStyleScoped(\"\") = %v, %v", scoped, err)
	}
}

// ParseMarkup rejects nesting past its limit before it parses, so an
// untrusted file cannot run the recursive parser out of stack (a fatal error
// recover() cannot catch). Each source here is megabytes deep.
func TestParseMarkupDepthGuard(t *testing.T) {
	limitMsg := "template nesting exceeds the limit of 200 levels"
	for _, tt := range []struct {
		name, src string
		line, col int
	}{
		{"elements", strings.Repeat("<div>", 1_000_000), 1, 1 + 5*200},
		{"components", strings.Repeat("<Card>", 1_000_000), 1, 1 + 6*200},
		{"blocks", strings.Repeat("{#if a}", 1_000_000), 1, 1 + 7*200},
		{"attribute inline ifs", `<p title="` + strings.Repeat("{#if a}", 1_000_000) + `"></p>`, 1, 11 + 7*200},
	} {
		t.Run(tt.name, func(t *testing.T) {
			_, err := parser.ParseMarkup(tt.src, parser.Position{}, "deep.pzl", letOpts)
			var pe *parser.ParseError
			if !errors.As(err, &pe) || pe.Message != limitMsg || pe.Line != tt.line || pe.Col != tt.col {
				t.Fatalf("got %v, want deep.pzl:%d:%d: %s", err, tt.line, tt.col, limitMsg)
			}
		})
	}

	nested := func(n int) string { return strings.Repeat("<i>", n) + strings.Repeat("</i>", n) }
	if _, err := parser.ParseMarkup(nested(200), parser.Position{}, "f.pzl"); err != nil {
		t.Fatalf("200 levels: %v", err)
	}
	if _, err := parser.ParseMarkup(nested(201), parser.Position{}, "f.pzl"); err == nil {
		t.Fatal("201 levels passed the default limit")
	}
	if _, err := parser.ParseMarkup(nested(6), parser.Position{}, "f.pzl", parser.Options{MaxDepth: 5}); err == nil || !strings.Contains(err.Error(), "limit of 5 levels") {
		t.Fatalf("MaxDepth 5: %v", err)
	}
	if _, err := parser.ParseMarkup(nested(500), parser.Position{}, "f.pzl", parser.Options{MaxDepth: -1}); err != nil {
		t.Fatalf("MaxDepth -1: %v", err)
	}
	// The wrapped entry points are PuzzleKit's and keep no limit of their own.
	if _, err := parser.Parse([]byte("<puzzle-view>"+nested(500)+"</puzzle-view>"), "f.pzl"); err != nil {
		t.Fatalf("Parse: %v", err)
	}
}

// {#let} is a void block: a flat row of them nests nothing, for ParseMarkup's
// guard and for OverNestingDepth alike.
func TestLetIsVoidForDepth(t *testing.T) {
	flat := strings.Repeat("{#let a = 1}\n", 300) + "<p>{ a }</p>"
	if _, err := parser.ParseMarkup(flat, parser.Position{}, "f.pzl", letOpts); err != nil {
		t.Fatalf("300 flat lets: %v", err)
	}
	sec, err := parser.SplitSections("<puzzle-view>"+flat+"</puzzle-view>", "f.pzl")
	if err != nil {
		t.Fatal(err)
	}
	if pos, over := parser.OverNestingDepth(sec, "f.pzl", 256); over {
		t.Fatalf("300 flat lets read as nesting at %+v", pos)
	}
}

// A host splitter that reports SkipBraceGroup's error stays linear on a file
// of unclosed braces (retrying one byte later was quadratic: 23 s here).
func TestHostLiftUnclosedBracesIsLinear(t *testing.T) {
	src := strings.Repeat("{", 100_000)
	start := time.Now()
	_, err := liftBlocks(src, "f.pzl")
	var pe *parser.ParseError
	if !errors.As(err, &pe) || pe.Line != 1 || pe.Col != 1 || pe.Message != "unclosed '{' (interpolation or block directive)" {
		t.Fatalf("err = %v", err)
	}
	if d := time.Since(start); d > time.Second {
		t.Fatalf("lifting 100k unclosed braces took %v", d)
	}
}

// Out-of-range indexes are answers, never panics, and every Find*Close index
// is absolute.
func TestHostScannerEdges(t *testing.T) {
	const s = "<script>a</script>{ x"
	for _, i := range []int{-5, -1, len(s), len(s) + 3} {
		if _, _, _, err := parser.ScanOpenTag(s, i, "script", "f.pzl"); err == nil {
			t.Errorf("ScanOpenTag(%d) = nil error", i)
		}
		if _, _, err := parser.ScanBraceGroup(s, i, "f.pzl"); err == nil {
			t.Errorf("ScanBraceGroup(%d) = nil error", i)
		}
		if _, err := parser.SkipBraceGroup(s, i, "f.pzl"); err == nil {
			t.Errorf("SkipBraceGroup(%d) = nil error", i)
		}
		if parser.TagNameAt(s, i) != "" {
			t.Errorf("TagNameAt(%d) found a name", i)
		}
	}
	for _, i := range []int{-5, -1, len(s) + 1} {
		if at, sw := parser.FindScriptClose(s, i); at != -1 || sw != -1 {
			t.Errorf("FindScriptClose(%d) = %d, %d", i, at, sw)
		}
		if at := parser.FindStyleClose(s, i); at != -1 {
			t.Errorf("FindStyleClose(%d) = %d", i, at)
		}
		if at := parser.FindTemplateClose(s, i, "</script>"); at != -1 {
			t.Errorf("FindTemplateClose(%d) = %d", i, at)
		}
	}
	if _, _, _, err := parser.ScanOpenTag(s, 0, "style", "f.pzl"); err == nil {
		t.Error("ScanOpenTag accepted a name that is not at i")
	}
	if at, _ := parser.FindScriptClose(s, 8); at != 9 {
		t.Errorf("FindScriptClose = %d, want 9", at)
	}
	if at := parser.FindStyleClose("<style>p{}</style>", 7); at != 10 {
		t.Errorf("FindStyleClose = %d, want 10", at)
	}
	if at, sw := parser.FindScriptClose("<script>'</script>", 8); at != -1 || sw != 8 {
		t.Errorf("FindScriptClose swallowed = %d, %d; want -1, 8", at, sw)
	}
	_, _, err := parser.ScanBraceGroup("\n  { a", 3, "f.pzl")
	var pe *parser.ParseError
	if !errors.As(err, &pe) || pe.File != "f.pzl" || pe.Line != 2 || pe.Col != 3 {
		t.Errorf("ScanBraceGroup error = %v, want f.pzl:2:3", err)
	}
	for _, tt := range []struct{ s, msg string }{
		{"x\n{## open", "f.pzl:2:1: unclosed {## comment"},
		{"x\n{#comment} open", "f.pzl:2:1: unterminated {#comment} — expected {/comment}"},
		{"x\n{#raw} open", "f.pzl:2:1: unterminated {#raw} — expected {/raw}"},
		{"x\n{ open", "f.pzl:2:1: unclosed '{' (interpolation or block directive)"},
	} {
		if _, err := parser.SkipBraceGroup(tt.s, 2, "f.pzl"); err == nil || err.Error() != tt.msg {
			t.Errorf("SkipBraceGroup(%q) = %v, want %s", tt.s, err, tt.msg)
		}
	}
}

// FuzzHostScanners runs every exported scanner, and ParseMarkup with {#let}
// on, over arbitrary input at arbitrary indexes: no panic, and every index
// returned lies inside the input. The seeds run in plain `go test`; fuzz by
// hand with `go test -run '^$' -fuzz=FuzzHostScanners -fuzztime=60s ./parser`.
func FuzzHostScanners(f *testing.F) {
	for _, seed := range []string{
		"", "<", "{", "<script>", "<style>/*", "<schema a={ b > c }>{}</schema>",
		"{## don't }", "{#comment}{#comment}{/comment}", "{#raw}{/raw", "<p title=\"{#if a}x{/if}\">",
		"{#let\n a = [1,\n2]\n b = a\n}", "<script>`${'</script>'}`</script>", "\\{ <a b='{'>",
		"<style>'</style>' p{}</style>", "<x\n  y=\"{ '>' }\"\n/>", "{/}", "{#let a == b}",
	} {
		f.Add(seed, 0)
		f.Add(seed, 1)
	}
	f.Fuzz(func(t *testing.T, s string, i int) {
		if len(s) > 4096 {
			return
		}
		check := func(name string, at int) {
			if at < -1 || at > len(s) {
				t.Fatalf("%s returned %d for a %d-byte input", name, at, len(s))
			}
		}
		name := parser.TagNameAt(s, i)
		if name != "" {
			check("TagNameAt", i+len(name))
		}
		if i > 0 && i <= len(s) && s[i-1] == '<' && name != "" {
			if after, attrAt, _, err := parser.ScanOpenTag(s, i-1, name, "f.pzl"); err == nil {
				check("ScanOpenTag", after)
				check("ScanOpenTag attrs", attrAt)
			}
		}
		at, sw := parser.FindScriptClose(s, i)
		check("FindScriptClose", at)
		check("FindScriptClose swallowed", sw)
		check("FindStyleClose", parser.FindStyleClose(s, i))
		check("FindTemplateClose", parser.FindTemplateClose(s, i, "</puzzle-view>"))
		if _, end, err := parser.ScanBraceGroup(s, i, "f.pzl"); err == nil {
			check("ScanBraceGroup", end)
		}
		if end, err := parser.SkipBraceGroup(s, i, "f.pzl"); err == nil {
			check("SkipBraceGroup", end)
		}
		parser.AttrNames(s, parser.Position{Line: 1, Col: 1}, "f.pzl")
		parser.ParseAttrString(s, parser.Position{Line: 1, Col: 1}, "f.pzl", "x")
		parser.ParseScriptLang(s, parser.Position{Line: 1, Col: 1}, "f.pzl")
		parser.ParseStyleScoped(s, parser.Position{Line: 1, Col: 1}, "f.pzl")
		parser.ParseMarkup(s, parser.Position{}, "f.pzl", letOpts)
		liftBlocks(s, "f.pzl")
	})
}
