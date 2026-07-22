package parser

import "strings"

// attr.go implements the attribute-value mini-grammar (constellation/doc/DOC-COMPILER-DESIGN.md
// §c), the trickiest part of the parser:
//
//	attr-value := (static-text | interpolation | inline-if)*
//	inline-if  := '{#if' expr '}' (static|interp)* ('{:else}' (static|interp)*)? '{/if}'
//
// The '{' switches to the shared brace scan (scanBraceGroup) exactly as text
// mode does, so quotes inside an expression are fine. Inline {#if} may contain
// only text and interpolations — a nested element or {#for} is a parse error.

type attrCursor struct {
	s    string
	i    int
	base Position
	file string
}

func (c *attrCursor) posAt(i int) Position {
	return c.base.advance(c.s[:i])
}

// parseAttrParts parses a quoted/bareword attribute value into its parts.
func parseAttrParts(raw string, base Position, file string) ([]Part, *ParseError) {
	c := &attrCursor{s: raw, base: base, file: file}
	parts, _, perr := c.parseSequence(true)
	return parts, perr
}

// parseSequence parses static text, interpolations, and inline-ifs. topLevel
// distinguishes the outermost value (where {:else}/{/if} are orphan errors)
// from an inline-if body (which terminates on {:else} or {/if}). The returned
// term is "" (end of input), "else", or "endif".
func (c *attrCursor) parseSequence(topLevel bool) (parts []Part, term string, perr *ParseError) {
	var sb strings.Builder
	flush := func() {
		if sb.Len() > 0 {
			parts = append(parts, &StaticPart{Text: sb.String()})
			sb.Reset()
		}
	}

	for c.i < len(c.s) {
		ch := c.s[c.i]
		if ch == '\\' && c.i+1 < len(c.s) && (c.s[c.i+1] == '{' || c.s[c.i+1] == '}') {
			sb.WriteByte(c.s[c.i+1])
			c.i += 2
			continue
		}
		if ch != '{' {
			sb.WriteByte(ch)
			c.i++
			continue
		}

		pos := c.posAt(c.i)
		var nb byte
		if c.i+1 < len(c.s) {
			nb = c.s[c.i+1]
		}
		switch nb {
		case '#':
			// Template comments (D70) are not template structure — reject either
			// spelling here, BEFORE scanBraceGroup runs (it is string-aware and can
			// choke on comment prose like `{## don't }`). The sniff reads raw bytes.
			if strings.HasPrefix(c.s[c.i:], "{##") || isBlockCommentOpen(c.s, c.i) {
				return nil, "", errAt(c.file, pos, "template comments are not allowed in attribute values")
			}
			inner, end, err := scanBraceGroup(c.s, c.i)
			if err != nil {
				return nil, "", errAt(c.file, pos, "unclosed '{' in attribute value")
			}
			hdr := strings.TrimSpace(inner[1:])
			kw := firstWord(hdr)
			if kw == "for" {
				return nil, "", errAt(c.file, pos, "{#for} is not allowed in attribute values")
			}
			if kw != "if" {
				return nil, "", errAt(c.file, pos, "only {#if} is allowed in attribute values (got {#%s})", kw)
			}
			cond := strings.TrimSpace(hdr[len(kw):])
			if cond == "" {
				return nil, "", errAt(c.file, pos, "{#if} requires a condition")
			}
			flush()
			c.i = end
			thenParts, t, e := c.parseSequence(false)
			if e != nil {
				return nil, "", e
			}
			var elseParts []Part
			if t == "else" {
				elseParts, t, e = c.parseSequence(false)
				if e != nil {
					return nil, "", e
				}
			}
			if t != "endif" {
				return nil, "", errAt(c.file, pos, "unclosed {#if} in attribute value")
			}
			parts = append(parts, &InlineIfPart{Cond: cond, Then: thenParts, Else: elseParts, Pos: pos})

		case ':':
			inner, end, err := scanBraceGroup(c.s, c.i)
			if err != nil {
				return nil, "", errAt(c.file, pos, "unclosed '{' in attribute value")
			}
			branch := strings.TrimSpace(inner[1:])
			if branch != "else" {
				// The attribute mini-grammar deliberately stays small: only a
				// single {#if}…{:else}…{/if}. Chained {:else if} is rejected here.
				if len(branch) > 4 && branch[:4] == "else" && isSpaceByte(branch[4]) {
					return nil, "", errAt(c.file, pos, "{:else if} is not allowed in attribute values — only {#if}…{:else}…{/if}")
				}
				return nil, "", errAt(c.file, pos, "unknown branch {:%s} in attribute value", branch)
			}
			if topLevel {
				return nil, "", errAt(c.file, pos, "{:else} outside of {#if} block")
			}
			flush()
			c.i = end
			return parts, "else", nil

		case '/':
			inner, end, err := scanBraceGroup(c.s, c.i)
			if err != nil {
				return nil, "", errAt(c.file, pos, "unclosed '{' in attribute value")
			}
			kw := strings.TrimSpace(inner[1:])
			if kw != "if" {
				return nil, "", errAt(c.file, pos, "unexpected {/%s} in attribute value", kw)
			}
			if topLevel {
				return nil, "", errAt(c.file, pos, "unexpected {/if} in attribute value")
			}
			flush()
			c.i = end
			return parts, "endif", nil

		default:
			inner, end, err := scanBraceGroup(c.s, c.i)
			if err != nil {
				return nil, "", errAt(c.file, pos, "unclosed '{' in attribute value")
			}
			interp, e := parseInterpolationExpr(inner, pos, c.file)
			if e != nil {
				return nil, "", e
			}
			flush()
			parts = append(parts, &InterpPart{Interp: interp})
			c.i = end
		}
	}

	flush()
	return parts, "", nil
}
