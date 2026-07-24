package parser

import (
	"strconv"
	"strings"

	"github.com/magic-spells/puzzle/compiler/internal/textutil"
)

// sections.go is the .pzl section splitter (constellation/doc/DOC-COMPILER-DESIGN.md §b step 1).
// It carves a file into its <puzzle-view> (with attributes preserved for the
// root vnode), the optional <puzzle-skeleton> loading template (v1.8, D39),
// the opaque <script> body, and the optional <style> body. The
// <script>/<style> bodies are returned verbatim and are NEVER scanned for
// template syntax.

// Sections is the result of splitting a .pzl file.
type Sections struct {
	// TemplateContent is the inner content of <puzzle-view> (between '>' and
	// '</puzzle-view>').
	TemplateContent string
	// TemplateAttrs are the parsed attributes of the <puzzle-view> tag itself.
	TemplateAttrs []Attr
	// TemplatePos is where TemplateContent starts, so template parse errors
	// report file-accurate positions.
	TemplatePos Position
	// ViewTagPos is the position of the opening '<puzzle-view'.
	ViewTagPos Position

	// Skeleton is the inner content of the optional <puzzle-skeleton> section
	// (v1.8, D39), shown while the first data() is pending; HasSkeleton reports
	// whether one was present. The tag accepts exactly one OPTIONAL attribute,
	// `min-duration` (v1.20, D52) — every other attribute is a compile error.
	Skeleton       string
	HasSkeleton    bool
	SkeletonPos    Position
	SkeletonTagPos Position
	// SkeletonMinDuration is the anti-flash hold in ms parsed from
	// `<puzzle-skeleton min-duration="N">` (v1.20, D52); 0 when the attribute is
	// absent (or 0) — that case emits byte-identically to v1.8.
	SkeletonMinDuration int

	// Scripts is the opaque, byte-for-byte body of <script>.
	Scripts    string
	ScriptsPos Position
	// ScriptsLang is the normalized `lang` attribute of <script> (v1.22, D54):
	// "" for JavaScript (attribute absent, or lang="js") and "ts" for TypeScript
	// (lang="ts"). It only selects the esbuild loader for the generated module;
	// the Go compiler still treats the body as an opaque string and never parses
	// it. Any other lang value (or a second attribute) is a compile error.
	ScriptsLang string

	// Styles is the body of <style>; HasStyles reports whether one was present.
	Styles    string
	HasStyles bool
	StylesPos Position
	// StylesTagPos is the position of the opening '<style'.
	StylesTagPos Position
	// StylesScoped is the bare `scoped` attribute of <style> (v1.27, D59): true
	// opts the block into per-component scoping (the plugin wraps it in a native
	// @scope rule and codegen stamps the template root). It is the ONLY attribute
	// <style> accepts; absent → false, emitting global CSS byte-identically to
	// pre-v1.27. Any other attribute, a valued/dynamic scoped, or a duplicate is a
	// compile error.
	StylesScoped bool
}

var sectionNames = []string{"puzzle-view", "puzzle-skeleton", "script", "style"}

// SplitSections splits src into its sections, tolerant of whitespace and order.
// A missing <puzzle-view>, or more than one of any section, is an error with a
// position (constellation/doc/DOC-COMPILER-DESIGN.md §b, §e). <script> is OPTIONAL
// (DOC-SPEC.md §4): a template-only .pzl leaves Scripts == "" and codegen
// synthesizes a PuzzleView subclass named from the filename.
func SplitSections(src, filename string) (*Sections, error) {
	sec := &Sections{}
	var nView, nSkeleton, nScripts, nStyles int

	i := 0
	// Backstop tracking (see the strayContentErr call after the loop): the first
	// byte of non-whitespace content that falls OUTSIDE every recognized section
	// (silently skipped before this guard), plus the section that most recently
	// closed before it — so a body truncated by a literal </script> inside a
	// comment/string surfaces loudly instead of dropping the rest of the file.
	strayOff := -1
	strayFollows := ""
	lastClosed := ""
	for i < len(src) {
		if src[i] != '<' {
			if strayOff < 0 && !isSpaceByte(src[i]) {
				strayOff, strayFollows = i, lastClosed
			}
			i++
			continue
		}
		if strings.HasPrefix(src[i:], "<!--") {
			idx := strings.Index(src[i+4:], "-->")
			if idx < 0 {
				return nil, posErr(src, filename, i, "unterminated comment")
			}
			i = i + 4 + idx + 3
			continue
		}
		if badName, goodName := misnamedSectionTagAt(src, i); badName != "" {
			return nil, posErr(src, filename, i,
				"<"+badName+"> should be named <"+goodName+">")
		}
		name, isClose := sectionTagAt(src, i)
		if name == "" || isClose {
			// A '<' opening neither a section nor a comment: stray markup, or an
			// orphan close tag (e.g. a literal </script> that escaped its body).
			// Record the first one for the backstop rather than silently skipping it.
			if strayOff < 0 {
				strayOff, strayFollows = i, lastClosed
			}
			i++
			continue
		}

		afterOpen, attrOffset, attrsRaw, err := scanOpenTag(src, i, name, filename)
		if err != nil {
			return nil, err
		}
		closeTag := "</" + name + ">"
		// Each section uses the close scan appropriate to its content. Scripts and
		// styles skip their language's comments/strings; <puzzle-view> and
		// <puzzle-skeleton> skip template brace groups and HTML comments so a
		// literal close tag inside either cannot truncate the body — a skeleton
		// body uses the full template grammar (SPEC §16), so it wants the template
		// scanner too. findTemplateClose keys off `name`'s own close tag.
		var rel int
		switch name {
		case "script":
			rel = findScriptClose(src, afterOpen)
		case "style":
			rel = findStyleClose(src, afterOpen)
		case "puzzle-view", "puzzle-skeleton":
			rel = findTemplateClose(src, afterOpen, closeTag)
		default:
			rel = strings.Index(src[afterOpen:], closeTag)
		}
		if rel < 0 {
			return nil, posErr(src, filename, i, "missing "+closeTag+" for <"+name+">")
		}
		contentStart := afterOpen
		contentEnd := afterOpen + rel
		inner := src[contentStart:contentEnd]

		switch name {
		case "puzzle-view":
			nView++
			if nView > 1 {
				return nil, posErr(src, filename, i, "multiple <puzzle-view> sections (only one allowed)")
			}
			sec.TemplateContent = inner
			sec.TemplatePos = posAt(src, contentStart)
			sec.ViewTagPos = posAt(src, i)
			attrs, aerr := parseAttrString(attrsRaw, posAt(src, attrOffset), filename, "puzzle-view")
			if aerr != nil {
				return nil, aerr
			}
			sec.TemplateAttrs = attrs
		case "puzzle-skeleton":
			nSkeleton++
			if nSkeleton > 1 {
				return nil, posErr(src, filename, i, "multiple <puzzle-skeleton> sections (only one allowed)")
			}
			// The skeleton tag is a section delimiter like a component-mode
			// <puzzle-view>: markup attributes belong on the skeleton's own body
			// (view mode reuses the <puzzle-view> root and its attributes). The one
			// exception is the anti-flash hold knob min-duration (v1.20, D52) — the
			// section's ONLY legal attribute; anything else stays a compile error.
			minDur, merr := parseSkeletonMinDuration(attrsRaw, posAt(src, attrOffset), filename)
			if merr != nil {
				return nil, merr
			}
			sec.SkeletonMinDuration = minDur
			sec.Skeleton = inner
			sec.HasSkeleton = true
			sec.SkeletonPos = posAt(src, contentStart)
			sec.SkeletonTagPos = posAt(src, i)
		case "script":
			nScripts++
			if nScripts > 1 {
				return nil, posErr(src, filename, i, "multiple <script> sections (only one allowed)")
			}
			// The only attribute <script> accepts is `lang` (v1.22, D54); it
			// selects the esbuild loader for the generated module. Absent → "" (JS).
			lang, lerr := parseScriptsLang(attrsRaw, posAt(src, attrOffset), filename)
			if lerr != nil {
				return nil, lerr
			}
			sec.ScriptsLang = lang
			sec.Scripts = inner
			sec.ScriptsPos = posAt(src, contentStart)
		case "style":
			nStyles++
			if nStyles > 1 {
				return nil, posErr(src, filename, i, "multiple <style> sections (only one allowed)")
			}
			// The only attribute <style> accepts is `scoped` (v1.27, D59); a bare
			// `scoped` opts the block into per-component scoping. Absent → false
			// (global CSS, byte-identical to pre-v1.27). Anything else is a compile
			// error — previously attrs on <style> were silently discarded.
			scoped, serr := parseStylesScoped(attrsRaw, posAt(src, attrOffset), filename)
			if serr != nil {
				return nil, serr
			}
			sec.StylesScoped = scoped
			sec.Styles = inner
			sec.HasStyles = true
			sec.StylesPos = posAt(src, contentStart)
			sec.StylesTagPos = posAt(src, i)
		}
		i = contentEnd + len(closeTag)
		lastClosed = name
	}

	if nView == 0 {
		return nil, &ParseError{File: filename, Line: 1, Col: 1, Message: "missing <puzzle-view> section"}
	}
	// Backstop: any non-whitespace content left outside a recognized section is an
	// error, not silently skipped. In practice this catches a <script>/<style>
	// body truncated by a literal close tag inside a comment/string (the rest of
	// the file then reads as stray content) and stray top-level markup.
	if strayOff >= 0 {
		return nil, strayContentErr(src, filename, strayOff, strayFollows)
	}
	// <script> is optional (DOC-SPEC.md §4): a scriptless .pzl is valid and
	// leaves Scripts == "".
	return sec, nil
}

// findTemplateClose scans a template body (a <puzzle-view> or, since it shares
// the full template grammar per SPEC §16, a <puzzle-skeleton>) from `from` for
// its real closing tag `closeTag`, skipping balanced template brace groups and
// HTML comments. Brace groups reuse scanBraceGroup/LexSkip, so strings, JS
// comments, regexes, and nested template literals inside an interpolation stay
// opaque. D70 template comments use their raw scanners for the same reason the
// lexer does. Returns the close tag's '<' index RELATIVE to `from`, or -1 when
// none is found.
func findTemplateClose(s string, from int, closeTag string) int {
	for i := from; i < len(s); {
		if strings.HasPrefix(s[i:], closeTag) {
			return i - from
		}
		switch {
		case strings.HasPrefix(s[i:], "<!--"):
			if end := strings.Index(s[i+4:], "-->"); end >= 0 {
				i += 4 + end + 3
				continue
			}
			// Leave an unterminated comment to the template lexer for its positioned
			// diagnostic while continuing to find the section's actual close.
			i += 4
		case s[i] == '\\' && i+1 < len(s) && (s[i+1] == '{' || s[i+1] == '}'):
			i += 2
		case s[i] == '{':
			var end int
			var err error
			switch {
			case strings.HasPrefix(s[i:], "{##"):
				end, err = scanInlineComment(s, i)
			case isBlockCommentOpen(s, i):
				end, err = scanBlockComment(s, i)
			default:
				_, end, err = scanBraceGroup(s, i)
			}
			if err != nil {
				i++ // let the template lexer report the malformed group later
				continue
			}
			i = end
		default:
			i++
		}
	}
	return -1
}

// strayContentErr reports non-whitespace content that fell outside every
// recognized section. When it directly follows a <script>/<style> section, the
// usual cause is a literal </script>/</style> inside a comment or string that
// closed the body early, so the message points there; otherwise it is stray
// top-level markup.
func strayContentErr(src, filename string, off int, follows string) *ParseError {
	if follows == "script" || follows == "style" {
		return posErr(src, filename, off,
			"unexpected content after the <"+follows+"> section — a literal </"+follows+"> inside a comment or string may have closed the body early")
	}
	return posErr(src, filename, off,
		"unexpected content outside a section — only <puzzle-view>, <puzzle-skeleton>, <script> and <style> may appear at the top level")
}

// misnamedSectionTagAt recognizes near-miss section names so the top-level
// scanner can point at the correct spelling instead of falling through to the
// generic stray-content error. A boundary is required so similarly prefixed
// custom markup is still diagnosed as ordinary stray content.
func misnamedSectionTagAt(src string, i int) (badName, goodName string) {
	for _, m := range []struct {
		bad  string
		good string
	}{
		{bad: "scripts", good: "script"},
		{bad: "styles", good: "style"},
	} {
		prefix := "<" + m.bad
		if !strings.HasPrefix(src[i:], prefix) {
			continue
		}
		after := i + len(prefix)
		if after >= len(src) || isBoundary(src[after]) {
			return m.bad, m.good
		}
	}
	return "", ""
}

// findScriptClose scans a <script> body from `from` for its real </script>
// close tag, skipping JS strings, template literals, regex literals, and line/
// block comments via the shared LexSkip scanner (lexskip.go — "one shared
// scanner", scan.go) so a literal "</script>" inside a comment or string does
// not truncate the body. Returns the close tag's '<' index RELATIVE to `from`, or
// -1 when none is found (the caller then reports a missing-close error).
//
// A '<' never begins a LexSkip lexical unit, so the prefix check at the top of
// the loop always gets a chance to fire before any byte is consumed. LexSkip
// recursively scans template-literal ${…} interiors, including nested
// backticks, so a close-tag literal anywhere inside the template stays opaque.
func findScriptClose(s string, from int) int {
	prevEndsExpr := false
	for i := from; i < len(s); {
		if strings.HasPrefix(s[i:], "</script>") {
			return i - from
		}
		if next, pee, consumed := LexSkip(s, i, prevEndsExpr); consumed {
			prevEndsExpr = pee
			i = next
			continue
		}
		prevEndsExpr = LexPlainEndsExpr(s[i], prevEndsExpr)
		i++
	}
	return -1
}

// findStyleClose scans a <style> body from `from` for its real </style> close
// tag, skipping CSS block comments (/* … */) and quoted strings ('…'/"…",
// escape-aware) — the two places a literal "</style>" can hide in CSS. CSS has
// no line comments or template literals, and its bare '/' (font: 12px/1.5,
// url(/img.png)) would fool LexSkip's regex/division heuristic, so this stays a
// small dedicated scan rather than reusing the JS path. Returns the close tag's
// '<' index RELATIVE to `from`, or -1 when none is found.
func findStyleClose(s string, from int) int {
	for i := from; i < len(s); {
		if strings.HasPrefix(s[i:], "</style>") {
			return i - from
		}
		switch {
		case strings.HasPrefix(s[i:], "/*"):
			end := strings.Index(s[i+2:], "*/")
			if end < 0 {
				return -1 // unterminated comment swallows the rest → no close
			}
			i += 2 + end + 2
		case s[i] == '"' || s[i] == '\'':
			i = skipCSSString(s, i)
		default:
			i++
		}
	}
	return -1
}

// skipCSSString returns the index just past a CSS string opened at s[i] (a '\'' or
// '"'), honoring backslash escapes; an unterminated string runs to EOF.
func skipCSSString(s string, i int) int {
	q := s[i]
	for j := i + 1; j < len(s); {
		if s[j] == '\\' {
			j += 2
			continue
		}
		if s[j] == q {
			return j + 1
		}
		j++
	}
	return len(s)
}

// sectionTagAt reports whether src at i begins a section open or close tag.
func sectionTagAt(src string, i int) (name string, isClose bool) {
	rest := src[i:]
	if strings.HasPrefix(rest, "</") {
		for _, n := range sectionNames {
			if strings.HasPrefix(rest, "</"+n) {
				return n, true
			}
		}
		return "", false
	}
	for _, n := range sectionNames {
		if strings.HasPrefix(rest, "<"+n) {
			after := i + 1 + len(n)
			if after >= len(src) || isBoundary(src[after]) {
				return n, false
			}
		}
	}
	return "", false
}

func isBoundary(b byte) bool {
	return isSpaceByte(b) || b == '>' || b == '/'
}

// scanOpenTag finds the end of a section's open tag (the '>'), quote- and
// brace-aware so a '>' inside an attribute value or a {#if x > 0} does not
// terminate it early. It returns the index just past '>', the byte offset of the
// first attribute char (leading whitespace skipped, so a caller Position lands on
// the attribute, not the space after the tag name), and the trimmed raw attribute
// text.
func scanOpenTag(src string, i int, name, filename string) (afterGT, attrOffset int, attrsRaw string, err error) {
	j := i + 1 + len(name)
	attrStart := j
	var quote byte
	for j < len(src) {
		c := src[j]
		if quote != 0 {
			// HTML attribute values have no backslash escapes (matching the tag-mode
			// lexer, lexQuotedValue): the next matching quote always closes the value.
			if c == quote {
				quote = 0
			}
			j++
			continue
		}
		switch c {
		case '"', '\'':
			quote = c
			j++
		case '{':
			_, end, e := scanBraceGroup(src, j)
			if e != nil {
				return 0, 0, "", posErr(src, filename, j, "unclosed '{' in <"+name+"> tag")
			}
			j = end
		case '>':
			raw := src[attrStart:j]
			trimmed := strings.TrimSpace(raw)
			off := attrStart
			if trimmed != "" {
				// Skip the leading whitespace TrimSpace removed so a Position derived
				// from off points at the first real attribute char, not the space.
				off += strings.Index(raw, trimmed)
			}
			return j + 1, off, trimmed, nil
		default:
			j++
		}
	}
	return 0, 0, "", posErr(src, filename, i, "unterminated <"+name+"> tag")
}

// parseAttrString parses the standalone attribute text of a section open tag
// (`section` names it for error messages), reusing the tag-mode lexer and
// buildAttr.
func parseAttrString(attrsRaw string, base Position, file, section string) ([]Attr, *ParseError) {
	if strings.TrimSpace(attrsRaw) == "" {
		return nil, nil
	}
	p := &parser{lex: newAttrLexer(attrsRaw, base, file), file: file}
	if err := p.advance(); err != nil {
		return nil, toPE(err)
	}
	var attrs []Attr
	for p.cur.Type != TokEOF {
		t := p.cur
		if t.Type != TokAttrName {
			return nil, errAt(file, tokPos(t), "malformed attribute in <%s> tag", section)
		}
		name := t.Value
		npos := tokPos(t)
		if err := p.advance(); err != nil {
			return nil, toPE(err)
		}
		if p.cur.Type == TokEquals {
			if err := p.advance(); err != nil {
				return nil, toPE(err)
			}
			a, e := buildAttr(name, npos, p.cur, file)
			if e != nil {
				return nil, e
			}
			if err := p.advance(); err != nil {
				return nil, toPE(err)
			}
			attrs = append(attrs, a)
		} else {
			attrs = append(attrs, &StaticAttr{Name: name, Value: "", Valueless: true, Pos: npos})
		}
	}
	return attrs, nil
}

// parseSkeletonMinDuration validates the ONLY attribute <puzzle-skeleton> accepts
// (v1.20, D52): min-duration="<unsigned int ms>", the anti-flash hold. Empty
// attrs → 0 (absent, v1.8 byte-identical). Any other attribute, a
// dynamic/interpolated value, or a malformed number is a compile error. It reuses
// the tag-mode attr lexer (parseAttrString) so multi-attribute and quoting cases
// tokenize the same way the <puzzle-view> root does.
func parseSkeletonMinDuration(attrsRaw string, base Position, file string) (int, *ParseError) {
	if strings.TrimSpace(attrsRaw) == "" {
		return 0, nil
	}
	attrs, perr := parseAttrString(attrsRaw, base, file, "puzzle-skeleton")
	if perr != nil {
		return 0, perr
	}
	if len(attrs) != 1 {
		return 0, errAt(file, base, "the only attribute allowed on <puzzle-skeleton> is `min-duration`")
	}
	switch a := attrs[0].(type) {
	case *StaticAttr:
		if a.Name != "min-duration" {
			return 0, errAt(file, a.Pos, "the only attribute allowed on <puzzle-skeleton> is `min-duration` (got %q)", a.Name)
		}
		if a.Value == "" {
			return 0, errAt(file, a.Pos, "`min-duration` on <puzzle-skeleton> requires an integer value, e.g. min-duration=\"300\"")
		}
		n, ok := parseUnsignedIntStr(a.Value)
		if !ok {
			return 0, errAt(file, a.Pos, "`min-duration` on <puzzle-skeleton> must be a non-negative integer in ms (got %q)", a.Value)
		}
		return n, nil
	case *DynamicAttr:
		if a.Name != "min-duration" {
			return 0, errAt(file, a.Pos, "the only attribute allowed on <puzzle-skeleton> is `min-duration` (got %q)", a.Name)
		}
		return 0, errAt(file, a.Pos, "`min-duration` on <puzzle-skeleton> must be a static integer, not a dynamic {…} value")
	case *MixedAttr:
		if a.Name != "min-duration" {
			return 0, errAt(file, a.Pos, "the only attribute allowed on <puzzle-skeleton> is `min-duration` (got %q)", a.Name)
		}
		return 0, errAt(file, a.Pos, "`min-duration` on <puzzle-skeleton> must be a static integer, not an interpolated value")
	default: // EventAttr etc. — never a valid skeleton attribute
		return 0, errAt(file, base, "the only attribute allowed on <puzzle-skeleton> is `min-duration`")
	}
}

// parseScriptsLang validates the ONLY attribute <script> accepts (v1.22, D54):
// lang="ts" (TypeScript) or lang="js" (the explicit JS default). Empty attrs → ""
// (JS, byte-identical to pre-v1.22). Any other attribute, a dynamic/interpolated
// value, an empty value, or an unknown lang is a compile error (with a
// did-you-mean where it helps). It reuses the tag-mode attr lexer
// (parseAttrString) so multi-attribute and quoting cases tokenize exactly like
// the <puzzle-view> root and <puzzle-skeleton> do.
func parseScriptsLang(attrsRaw string, base Position, file string) (string, *ParseError) {
	if strings.TrimSpace(attrsRaw) == "" {
		return "", nil
	}
	attrs, perr := parseAttrString(attrsRaw, base, file, "script")
	if perr != nil {
		return "", perr
	}
	if len(attrs) != 1 {
		return "", errAt(file, base, "the only attribute allowed on <script> is `lang`")
	}
	switch a := attrs[0].(type) {
	case *StaticAttr:
		if a.Name != "lang" {
			return "", errAt(file, a.Pos, "the only attribute allowed on <script> is `lang` (got %q)", a.Name)
		}
		switch a.Value {
		case "ts":
			return "ts", nil
		case "js":
			return "", nil
		case "":
			return "", errAt(file, a.Pos, "`lang` on <script> requires a value — use lang=\"ts\" (TypeScript) or lang=\"js\" (JavaScript)")
		default:
			return "", errAt(file, a.Pos, "unknown <script> lang %q — expected \"ts\" (TypeScript) or \"js\" (JavaScript, the default)%s", a.Value, scriptsLangHint(a.Value))
		}
	case *DynamicAttr:
		if a.Name != "lang" {
			return "", errAt(file, a.Pos, "the only attribute allowed on <script> is `lang` (got %q)", a.Name)
		}
		return "", errAt(file, a.Pos, "`lang` on <script> must be a static \"ts\" or \"js\", not a dynamic {…} value")
	case *MixedAttr:
		if a.Name != "lang" {
			return "", errAt(file, a.Pos, "the only attribute allowed on <script> is `lang` (got %q)", a.Name)
		}
		return "", errAt(file, a.Pos, "`lang` on <script> must be a static \"ts\" or \"js\", not an interpolated value")
	default: // EventAttr etc. — never a valid scripts attribute
		return "", errAt(file, base, "the only attribute allowed on <script> is `lang`")
	}
}

// scriptsLangHint suggests the intended lang for a near-miss value, e.g.
// lang="typescript" → did you mean "ts". Empty when no obvious match.
func scriptsLangHint(v string) string {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "typescript", "tsx", "type-script", "t", "tsc":
		return " — did you mean \"ts\"?"
	case "javascript", "jsx", "ecmascript", "es", "mjs", "j":
		return " — did you mean \"js\"?"
	}
	return ""
}

// parseStylesScoped validates the ONLY attribute <style> accepts (v1.27, D59):
// a bare `scoped` that opts the block into per-component scoping. Empty attrs →
// false (global emission, byte-identical to pre-v1.27). A valued scoped=…, a
// dynamic/interpolated scoped, any other attribute, or a duplicate is a compile
// error (with a did-you-mean where the attribute name is close). It reuses the
// tag-mode attr lexer (parseAttrString) so multi-attribute and quoting cases
// tokenize exactly like the <puzzle-view> root, <puzzle-skeleton>, and <script>
// do — this is the first attribute ever parsed on <style> (attrs were silently
// discarded before v1.27).
func parseStylesScoped(attrsRaw string, base Position, file string) (bool, *ParseError) {
	if strings.TrimSpace(attrsRaw) == "" {
		return false, nil
	}
	attrs, perr := parseAttrString(attrsRaw, base, file, "style")
	if perr != nil {
		return false, perr
	}
	if len(attrs) != 1 {
		return false, errAt(file, base, "the only attribute allowed on <style> is `scoped`")
	}
	switch a := attrs[0].(type) {
	case *StaticAttr:
		if a.Name != "scoped" {
			return false, errAt(file, a.Pos, "the only attribute allowed on <style> is `scoped` (got %q)%s", a.Name, stylesScopedHint(a.Name))
		}
		if !a.Valueless {
			// scoped="", scoped="true", etc. — the attribute is bare-only (like
			// `island`, D44), so any value is a mistake, not an on/off switch.
			return false, errAt(file, a.Pos, "`scoped` on <style> is a bare attribute — write <style scoped>, not scoped=\"…\"")
		}
		return true, nil
	case *DynamicAttr:
		if a.Name != "scoped" {
			return false, errAt(file, a.Pos, "the only attribute allowed on <style> is `scoped` (got %q)%s", a.Name, stylesScopedHint(a.Name))
		}
		return false, errAt(file, a.Pos, "`scoped` on <style> is a bare attribute, not a dynamic {…} value — write <style scoped>")
	case *MixedAttr:
		if a.Name != "scoped" {
			return false, errAt(file, a.Pos, "the only attribute allowed on <style> is `scoped` (got %q)%s", a.Name, stylesScopedHint(a.Name))
		}
		return false, errAt(file, a.Pos, "`scoped` on <style> is a bare attribute, not an interpolated value — write <style scoped>")
	default: // EventAttr etc. — never a valid styles attribute
		return false, errAt(file, base, "the only attribute allowed on <style> is `scoped`")
	}
}

// stylesScopedHint suggests `scoped` for a near-miss attribute name (edit
// distance ≤ 2, e.g. scopped/scopd/scope), empty otherwise.
func stylesScopedHint(name string) string {
	n := strings.ToLower(strings.TrimSpace(name))
	if n != "scoped" && textutil.EditDistance(n, "scoped") <= 2 {
		return " — did you mean `scoped`?"
	}
	return ""
}

// parseUnsignedIntStr accepts a non-empty run of ASCII digits only ("300", "0"),
// rejecting signs, decimals, whitespace, and unit suffixes so a malformed
// min-duration is a compile error rather than a silent 0. Conversion goes through
// strconv.Atoi so an out-of-range value (e.g. a 40-digit min-duration) is a clean
// false — the old hand-rolled `n = n*10 + …` accumulator wrapped silently to a
// small or negative hold instead.
func parseUnsignedIntStr(s string) (int, bool) {
	if s == "" {
		return 0, false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c < '0' || c > '9' {
			return 0, false
		}
	}
	n, err := strconv.Atoi(s)
	if err != nil { // strconv.ErrRange: the digit run overflows int
		return 0, false
	}
	return n, true
}

// posAt computes the file Position of a byte offset.
func posAt(src string, off int) Position {
	if off > len(src) {
		off = len(src)
	}
	return Position{Line: 1, Col: 1, Offset: 0}.advance(src[:off])
}

func posErr(src, filename string, off int, msg string) *ParseError {
	p := posAt(src, off)
	return &ParseError{File: filename, Line: p.Line, Col: p.Col, Message: msg}
}
