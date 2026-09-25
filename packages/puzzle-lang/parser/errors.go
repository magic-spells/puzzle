package parser

import (
	"fmt"
	"strings"
)

// ParseError is the structured error type for the template parser
// (constellation/doc/DOC-COMPILER-DESIGN.md §e). It carries the file and 1-based line/column of
// the offending construct and implements error, so the esbuild plugin (Step 3)
// can surface it directly as an api.Message.
type ParseError struct {
	File    string
	Line    int
	Col     int
	Message string
	// Note is optional supplementary guidance (e.g. a corrected-code example)
	// surfaced by the esbuild plugin as an api.Note under the error message.
	Note string
}

func (e *ParseError) Error() string {
	return fmt.Sprintf("%s:%d:%d: %s", e.File, e.Line, e.Col, e.Message)
}

// ErrorList is a batch of parse errors. The parser may collect more than one
// error per file to improve reporting, but any error means the parse failed —
// there is never a best-effort AST (constellation/doc/DOC-COMPILER-DESIGN.md §e).
type ErrorList []*ParseError

func (l ErrorList) Error() string {
	switch len(l) {
	case 0:
		return "no errors"
	case 1:
		return l[0].Error()
	default:
		var b strings.Builder
		for i, e := range l {
			if i > 0 {
				b.WriteByte('\n')
			}
			b.WriteString(e.Error())
		}
		return b.String()
	}
}

// errAt builds a positioned ParseError.
func errAt(file string, pos Position, format string, args ...any) *ParseError {
	return &ParseError{
		File:    file,
		Line:    pos.Line,
		Col:     pos.Col,
		Message: fmt.Sprintf(format, args...),
	}
}

// toPE coerces an arbitrary error (in practice always a *ParseError coming out
// of the lexer) into a *ParseError.
func toPE(err error) *ParseError {
	if pe, ok := err.(*ParseError); ok {
		return pe
	}
	return &ParseError{Message: err.Error()}
}
