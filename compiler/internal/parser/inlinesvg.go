package parser

import "strings"

// inlinesvg.go — the parser half of `{#svg 'icons/heart.svg'}` (v1.14, D46).
//
// {#svg} is the framework's first VOID block tag: self-contained, no {/svg}
// closer (parseBlock returns the node directly; a stray {/svg} is a dedicated
// error in checkCloser). It names ONE file, resolved at compile time, whose
// <svg> root is inlined with island semantics (D44) — the root vnode patches,
// its contents are a verbatim seed string set once. Two pieces live here:
//
//   - parseSvgHeader validates the header shape: exactly one required single-
//     or double-quoted STATIC string literal path, nothing after it. Everything
//     inline in the .pzl (no store expressions) — inlining happens at build time,
//     so a non-literal path is meaningless and rejected, mirroring the island
//     static-only rule.
//   - ScanSVGFile reads a resolved file's bytes and lifts the single <svg …>
//     root: it strips an optional XML prolog / DOCTYPE / leading comments, checks
//     the root is exactly one <svg> element, scans ONLY that open tag with a
//     literal-only attribute parser, and returns the inner markup verbatim. The
//     inner is NEVER template-parsed — a literal `{`, `{#svg}`, anything, is inert
//     text dropped in as-is (contract: paste an SVG directly if you want
//     reactivity). Its errors are *ParseError with File set to the svg filename so
//     the plugin can position them inside the offending file.
//
// Errors follow the D38/island house style: lowercase, positioned, with an
// em-dash explanation of the fix.

// parseSvgHeader parses a {#svg} header — exactly one required quoted static
// path. rest is the header text after the `svg` keyword (already trimmed); pos
// is the `{#svg}` opener. SrcPos points at the path literal so codegen's
// missing-file error lands on the header, not the whole tag.
func parseSvgHeader(rest string, pos Position, file string) (*InlineSVG, *ParseError) {
	// The header text after `{#svg ` begins here; rest is already whitespace-
	// trimmed, so the path literal starts at its head. Canonical single-space
	// spelling is assumed for the column (matches parseForHeader's looseness).
	srcPos := pos.advance("{#svg ")

	needPath := func() *ParseError {
		return errAt(file, pos, "{#svg} requires a quoted path, e.g. {#svg 'icons/heart.svg'} — the file is inlined at compile time")
	}

	rest = strings.TrimSpace(rest)
	if rest == "" {
		return nil, needPath()
	}
	q := rest[0]
	if q != '\'' && q != '"' {
		return nil, needPath()
	}
	closeIdx := strings.IndexByte(rest[1:], q)
	if closeIdx < 0 {
		return nil, needPath()
	}
	closeIdx++ // index of the closing quote within rest
	path := rest[1:closeIdx]
	if strings.TrimSpace(rest[closeIdx+1:]) != "" {
		return nil, errAt(file, pos, "{#svg} takes only a path — style the icon via its parent element")
	}
	if path == "" {
		return nil, needPath()
	}
	return &InlineSVG{Src: path, SrcPos: srcPos, Pos: pos}, nil
}

// ScanSVGFile lifts the single <svg> root from a resolved SVG file's bytes. It
// returns the root element's attributes (all literal StaticAttrs)
// and the verbatim inner markup between the open tag and the matching final
// </svg> (empty for a self-closing <svg/>). The inner markup is inert — it is
// NOT template-parsed. Errors are *ParseError with File=filename, positioned
// inside the svg so the plugin can point at the real spot.
func ScanSVGFile(src []byte, filename string) (rootAttrs []Attr, inner string, err error) {
	s := string(src)

	// Strip an optional XML prolog, DOCTYPE, and leading comments/whitespace in
	// any order (real Illustrator/Figma exports carry them).
	i := 0
	for {
		for i < len(s) && isSpaceByte(s[i]) {
			i++
		}
		switch {
		case strings.HasPrefix(s[i:], "<?"):
			end := strings.Index(s[i:], "?>")
			if end < 0 {
				return nil, "", svgErrAt(filename, s, i, "unterminated <?xml …?> declaration")
			}
			i += end + 2
		case strings.HasPrefix(s[i:], "<!--"):
			end := strings.Index(s[i+4:], "-->")
			if end < 0 {
				return nil, "", svgErrAt(filename, s, i, "unterminated <!-- … --> comment")
			}
			i += 4 + end + 3
		case hasDoctypePrefix(s[i:]):
			end := strings.IndexByte(s[i:], '>')
			if end < 0 {
				return nil, "", svgErrAt(filename, s, i, "unterminated <!DOCTYPE …> declaration")
			}
			i += end + 1
		default:
			goto prologDone
		}
	}
prologDone:

	if i >= len(s) {
		return nil, "", svgErrAt(filename, s, i, "no root element — {#svg} expects a file with a single <svg …> root")
	}
	if s[i] != '<' || i+1 >= len(s) {
		return nil, "", svgErrAt(filename, s, i, "expected a <svg …> root element")
	}
	if s[i+1] == '/' {
		return nil, "", svgErrAt(filename, s, i, "expected a <svg …> root element, found a closing tag")
	}
	// Read the root tag name.
	j := i + 1
	if !isNameStart(s[j]) {
		return nil, "", svgErrAt(filename, s, i, "expected a <svg …> root element")
	}
	nameStart := j
	for j < len(s) && isNameChar(s[j]) {
		j++
	}
	name := s[nameStart:j]
	if name != "svg" {
		return nil, "", svgErrAt(filename, s, i, "root element is <%s>, not <svg> — {#svg} inlines a file whose single root is an <svg> element", name)
	}

	// Scan ONLY the root open tag. SVG files are inert (D46), including their
	// root attributes: braces are literal bytes, never template interpolation.
	openEnd, selfClose := scanTagEnd(s, i)
	if openEnd < 0 {
		return nil, "", svgErrAt(filename, s, i, "unterminated <svg …> root open tag")
	}
	attrs, perr := scanSVGRootAttrs(s, j, openEnd, selfClose, filename)
	if perr != nil {
		return nil, "", perr
	}
	contentStart := openEnd

	if selfClose {
		if strings.TrimSpace(s[contentStart:]) != "" {
			return nil, "", svgErrAt(filename, s, contentStart, "unexpected content after the self-closing <svg/> root — the file must contain a single <svg> root")
		}
		return attrs, "", nil
	}

	closeStart, closeEnd, ok := findRootClose(s, contentStart)
	if !ok {
		return nil, "", svgErrAt(filename, s, i, "unclosed <svg> root — the file must end with </svg>")
	}
	if strings.TrimSpace(s[closeEnd:]) != "" {
		return nil, "", svgErrAt(filename, s, closeEnd, "unexpected content after the root </svg> — the file must contain a single <svg> root")
	}
	return attrs, s[contentStart:closeStart], nil
}

// scanSVGRootAttrs parses the root open tag without the template attribute
// classifier. Every value is copied verbatim into a StaticAttr, so both
// attr="{foo}" and attr={foo} retain the braces and can never become a
// MixedAttr/DynamicAttr that references render data in a shared SVG module.
func scanSVGRootAttrs(s string, start, openEnd int, selfClose bool, filename string) ([]Attr, *ParseError) {
	end := openEnd - 1 // exclude '>'
	if selfClose {
		for end > start && isSpaceByte(s[end-1]) {
			end--
		}
		if end > start && s[end-1] == '/' {
			end--
		}
	}

	var attrs []Attr
	for i := start; i < end; {
		for i < end && isSpaceByte(s[i]) {
			i++
		}
		if i >= end {
			break
		}

		nameStart := i
		if s[i] == '@' {
			i++
		} else if !isNameStart(s[i]) {
			return nil, svgErrAt(filename, s, i, "unexpected character %q in <svg> root tag", string(rune(s[i])))
		}
		for i < end && isNameChar(s[i]) {
			i++
		}
		name := s[nameStart:i]
		if name == "@" {
			return nil, svgErrAt(filename, s, nameStart, "malformed attribute in <svg> root tag")
		}
		npos := (Position{Line: 1, Col: 1}).advance(s[:nameStart])

		for i < end && isSpaceByte(s[i]) {
			i++
		}
		if i >= end || s[i] != '=' {
			attrs = append(attrs, &StaticAttr{Name: name, Valueless: true, Pos: npos})
			continue
		}
		i++
		for i < end && isSpaceByte(s[i]) {
			i++
		}
		if i >= end {
			return nil, svgErrAt(filename, s, i, "missing value for attribute %q in <svg> root tag", name)
		}

		valueStart := i
		value := ""
		if q := s[i]; q == '\'' || q == '"' {
			i++
			valueStart = i
			for i < end && s[i] != q {
				i++
			}
			if i >= end {
				return nil, svgErrAt(filename, s, valueStart-1, "unclosed attribute value in <svg> root tag")
			}
			value = s[valueStart:i]
			i++
		} else {
			for i < end && !isSpaceByte(s[i]) {
				i++
			}
			value = s[valueStart:i]
		}
		attrs = append(attrs, &StaticAttr{Name: name, Value: value, Pos: npos})
	}
	return attrs, nil
}

// findRootClose scans from just after the root <svg> open tag for its matching
// </svg>, counting nested <svg>…</svg> (legal in SVG) and skipping comments and
// CDATA sections. It returns the byte range [closeStart,closeEnd) of the matching
// </svg> tag.
func findRootClose(s string, from int) (closeStart, closeEnd int, ok bool) {
	depth := 1
	i := from
	for i < len(s) {
		lt := strings.IndexByte(s[i:], '<')
		if lt < 0 {
			return 0, 0, false
		}
		i += lt
		if strings.HasPrefix(s[i:], "<!--") {
			end := strings.Index(s[i+4:], "-->")
			if end < 0 {
				return 0, 0, false
			}
			i += 4 + end + 3
			continue
		}
		if strings.HasPrefix(s[i:], "<![CDATA[") {
			// A CDATA section is verbatim character data — a </svg> (or <svg) inside
			// it is inert text, not markup, so skip the whole section like a comment.
			end := strings.Index(s[i+9:], "]]>")
			if end < 0 {
				return 0, 0, false
			}
			i += 9 + end + 3
			continue
		}
		if isSvgOpenAt(s, i) {
			end, selfClose := scanTagEnd(s, i)
			if end < 0 {
				return 0, 0, false
			}
			if !selfClose {
				depth++
			}
			i = end
			continue
		}
		if cs, ce, isClose := svgCloseAt(s, i); isClose {
			depth--
			if depth == 0 {
				return cs, ce, true
			}
			i = ce
			continue
		}
		if isTagStart(s, i) {
			// Any OTHER tag (<rect …>, </rect>, <?pi?>, <!decl>): skip the WHOLE tag
			// via the quote-aware scan so a '<svg' or '</svg>' sitting inside one of
			// its attribute values (e.g. <rect aria-label="<svg icon>"/>) is never
			// re-scanned and miscounted for depth.
			end, _ := scanTagEnd(s, i)
			if end < 0 {
				return 0, 0, false
			}
			i = end
			continue
		}
		i++ // a bare '<' that opens no tag (stray in text) — advance one byte
	}
	return 0, 0, false
}

// isTagStart reports whether the '<' at s[i] begins markup — an element open/
// close tag, processing instruction, or declaration — rather than a stray '<' in
// text. findRootClose uses it to skip a whole foreign tag (past its attribute
// values) instead of re-scanning it byte by byte.
func isTagStart(s string, i int) bool {
	b := byteAt(s, i+1)
	return isNameStart(b) || b == '/' || b == '!' || b == '?'
}

// isSvgOpenAt reports whether s[i:] begins an <svg …> open tag (name followed by
// a boundary), not a closing tag.
func isSvgOpenAt(s string, i int) bool {
	if !strings.HasPrefix(s[i:], "<svg") {
		return false
	}
	b := byteAt(s, i+4)
	return isSpaceByte(b) || b == '>' || b == '/'
}

// svgCloseAt reports whether s[i:] is a </svg> closing tag (optional whitespace
// before '>'), returning its [start,end) byte range.
func svgCloseAt(s string, i int) (start, end int, ok bool) {
	if !strings.HasPrefix(s[i:], "</svg") {
		return 0, 0, false
	}
	j := i + 5
	for j < len(s) && isSpaceByte(s[j]) {
		j++
	}
	if j < len(s) && s[j] == '>' {
		return i, j + 1, true
	}
	return 0, 0, false
}

// scanTagEnd scans a tag starting at s[i]=='<' to its terminating '>', respecting
// quoted attribute values. It returns the index just past '>' and whether the
// tag self-closed ("/>").
func scanTagEnd(s string, i int) (end int, selfClose bool) {
	var quote byte
	for j := i; j < len(s); j++ {
		c := s[j]
		if quote != 0 {
			if c == quote {
				quote = 0
			}
			continue
		}
		switch c {
		case '"', '\'':
			quote = c
		case '>':
			k := j - 1
			for k > i && isSpaceByte(s[k]) {
				k--
			}
			return j + 1, s[k] == '/'
		}
	}
	return -1, false
}

// hasDoctypePrefix reports whether s begins with a (case-insensitive) DOCTYPE
// declaration opener.
func hasDoctypePrefix(s string) bool {
	return len(s) >= 9 && s[:2] == "<!" && strings.EqualFold(s[2:9], "doctype")
}

func byteAt(s string, i int) byte {
	if i >= 0 && i < len(s) {
		return s[i]
	}
	return 0
}

// svgErrAt builds a *ParseError positioned at byte index idx within the svg
// file's own coordinates (File=file), so the plugin can point inside the file.
func svgErrAt(file, s string, idx int, format string, args ...any) *ParseError {
	if idx > len(s) {
		idx = len(s)
	}
	pos := (Position{Line: 1, Col: 1}).advance(s[:idx])
	return errAt(file, pos, format, args...)
}
