package parser

// depth.go answers one question for an untrusted source: how deep does this
// template nest? (D164). It exists for the playground's WASM compiler, whose
// process cannot survive a fatal runtime error — codegen's indentation grows
// O(N²) with nesting and reaches an uncatchable out-of-memory a few thousand
// levels down, and the recursive-descent parser itself exhausts the stack
// before that. So the check has to answer WITHOUT parsing: it is a token scan
// with an explicit counter, allocating nothing per level and recursing only
// once per {#raw} span.
//
// Nothing in a native build calls it — a real build reads files the developer
// wrote, not a paste from a stranger.

// OverNestingDepth reports the position of the first structural node in sec
// (elements, components, markers, and block bodies each count as one level)
// nested deeper than limit, and true. It returns false when the file stays
// within the limit — and also when the token stream is malformed, because a
// lexical error is the real parse's story to tell, with its own position and
// message.
//
// For a well-formed template the count is exact: every AST container is one
// non-self-closing tag or one block opener. For a malformed one it is an upper
// bound, which is the safe direction — the source is already an error either
// way.
func OverNestingDepth(sec *Sections, filename string, limit int) (Position, bool) {
	if pos, over := scanNesting(newLexer(sec.TemplateContent, sec.TemplatePos, filename), filename, limit, 0, rawScanBudget); over {
		return pos, true
	}
	if sec.HasSkeleton {
		if pos, over := scanNesting(newLexer(sec.Skeleton, sec.SkeletonPos, filename), filename, limit, 0, rawScanBudget); over {
			return pos, true
		}
	}
	return Position{}, false
}

// rawScanBudget caps how far scanNesting will follow nested {#raw} bodies. A
// raw lexer has brace grammar disabled, so a body cannot open another {#raw}
// and one level is already enough; the budget only exists so this function's
// own recursion is bounded by construction rather than by that argument.
const rawScanBudget = 4

func scanNesting(lx *lexer, file string, limit, depth, budget int) (Position, bool) {
	// openTags mirrors the parser's element stack, purely so a {#raw} token
	// inside <script>/<style> is skipped the way parseRaw skips it: that body is
	// opaque text, and markup quoted in a string is not template nesting.
	var openTags []string
	var pendingOpen Token
	for {
		t, err := lx.Next()
		if err != nil {
			return Position{}, false
		}
		switch t.Type {
		case TokEOF:
			return Position{}, false
		case TokTagOpen:
			pendingOpen = t
		case TokTagEnd:
			openTags = append(openTags, pendingOpen.Value)
			depth++
			if depth > limit {
				return tokPos(pendingOpen), true
			}
		case TokTagClose:
			if len(openTags) > 0 {
				openTags = openTags[:len(openTags)-1]
			}
			if depth > 0 {
				depth--
			}
		case TokBlockOpen:
			depth++
			if depth > limit {
				return tokPos(t), true
			}
		case TokBlockClose:
			if depth > 0 {
				depth--
			}
		case TokRaw:
			if budget <= 0 {
				continue
			}
			if n := len(openTags); n > 0 && (openTags[n-1] == "script" || openTags[n-1] == "style") {
				continue
			}
			if pos, over := scanNesting(newRawLexer(t.Value, tokPos(t), file), file, limit, depth, budget-1); over {
				return pos, true
			}
		}
	}
}
