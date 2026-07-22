package parser

// Position is a source location: 1-based line and column plus the 0-based byte
// offset into the ORIGINAL .pzl file. Positions are computed relative to the
// original file so that template parse errors report file-accurate coordinates
// even though the lexer only ever sees the <puzzle-view> content (see
// constellation/doc/DOC-COMPILER-DESIGN.md §c and §e).
//
// Position lives in one place; every token and AST node carries one.
type Position struct {
	Line   int
	Col    int
	Offset int
}

// advance returns the Position reached after consuming s, tracking newlines so
// that a position inside the extracted template content maps back to file
// coordinates. Columns are byte-based (adequate for error reporting).
func (p Position) advance(s string) Position {
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' {
			p.Line++
			p.Col = 1
		} else {
			p.Col++
		}
		p.Offset++
	}
	return p
}
