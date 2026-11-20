package codegen

import (
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/magic-spells/puzzle/packages/puzzle-lang/parser"
)

// sharekey.go backs share() (D197). a view that declares share() passes values
// down to nested views, grouped in their `shared` object under the sharing
// component's name in camelcase (Filter → shared.filter). the runtime would
// derive that name from the class, but a production build minifies class names,
// so the compiler stamps it: `Filter.__share = "filter";`. the stamp is emitted
// only for a script that declares share(), so a view without one pays nothing.

// declaresShare reports whether the opaque <script> declares a share member: an
// identifier `share` followed by `(` (a method, `share() {`) or `=` (a class
// field, `share = () => …`) that is not a property access (`x.share(`). go never
// parses the script (D3), so this is a token scan and errs on the side of
// stamping: a stray module-level `share(` only adds one harmless assignment.
func declaresShare(toks []jsTok) bool {
	for i, t := range toks {
		if t.ident != "share" || i+1 >= len(toks) {
			continue
		}
		// skip comments when looking at the neighbors
		prev := i - 1
		for prev >= 0 && toks[prev].comment {
			prev--
		}
		if prev >= 0 && toks[prev].ch == '.' {
			continue
		}
		next := i + 1
		for next < len(toks) && toks[next].comment {
			next++
		}
		if next < len(toks) && (toks[next].ch == '(' || toks[next].ch == '=') {
			// `share == x` and `share => …` are not declarations
			if toks[next].ch == '=' && next+1 < len(toks) && (toks[next+1].ch == '=' || toks[next+1].ch == '>') && toks[next+1].off == toks[next].off+1 {
				continue
			}
			return true
		}
	}
	return false
}

// shareKey is the camelcase form of a component name, the same rule as the
// runtime's shareKey (client-runtime/views/PuzzleView.js): a leading run of
// capitals is lowercased up to the last one before a lowercase letter, so
// Filter → filter, FilterPanel → filterPanel, URLFilter → urlFilter and UI → ui;
// any other name has its first character lowercased.
func shareKey(name string) string {
	if name == "" {
		return name
	}
	n := 0
	for n < len(name) && name[n] >= 'A' && name[n] <= 'Z' {
		n++
	}
	switch {
	case n == len(name):
		return strings.ToLower(name)
	case n >= 2 && name[n] >= 'a' && name[n] <= 'z':
		return strings.ToLower(name[:n-1]) + name[n-1:]
	}
	r, size := utf8.DecodeRuneInString(name)
	return string(unicode.ToLower(r)) + name[size:]
}

// reservedShareNames are the keys of the one object data() and share() take
// (D197). a component whose camelcase name is one of them would sit in `shared`
// under a word that reads like the other two arguments, so it draws a warning.
var reservedShareNames = map[string]bool{"params": true, "props": true, "shared": true}

// warnReservedComponentName warns when the component is named Params, Props or
// Shared. pos is the class name's position (or the file start for a scriptless
// component, whose class is named from the filename).
func warnReservedComponentName(className, file string, pos parser.Position, warnings *[]Warning) {
	if warnings == nil || !reservedShareNames[shareKey(className)] {
		return
	}
	*warnings = append(*warnings, Warning{
		File: file, Line: pos.Line, Col: pos.Col,
		Message: fmt.Sprintf(
			"component name %q reads like a built-in: params, props and shared are the reserved keys of the object data() and share() receive (D197) — rename the component (for example, %sPanel)",
			className, className),
	})
}

// positionalDataParams finds a data() or share() declaration still written in
// the pre-0.10 positional form, `data(params, props) {`, and returns the byte
// offset of its name (ok false when there is none). the runtime passes one
// object now (D197), so such a method gets the whole object as `params` and
// `undefined` as `props`. the first declaration is the one the warning names;
// positionalDataDecls finds them all.
func positionalDataParams(toks []jsTok) (name string, off int, ok bool) {
	decls := positionalDataDecls(toks)
	if len(decls) == 0 {
		return "", 0, false
	}
	return decls[0].Method, decls[0].NameOff, true
}

// DataDecl is one pre-0.10 positional data() or share() declaration: the
// method name and the byte offsets (into the scanned script body) of the name
// and of the parameter list's '(' and ')'. the upgrade codemod (D199) rewrites
// the text between OpenOff and CloseOff.
type DataDecl struct {
	Method   string
	NameOff  int
	OpenOff  int
	CloseOff int
}

// PositionalDataDecls returns every positional data()/share() declaration in a
// script body, in source order — the same rule as the D197 warning, exported
// for `puzzle check --fix`.
func PositionalDataDecls(script string) []DataDecl {
	return positionalDataDecls(tokenizeJS(script))
}

// positionalDataDecls lists every data() or share() declaration in the
// positional form. a declaration counts when the name is not a property
// access or a `function` name, and its parameter list is followed by `{` (or
// `:` for a typescript return type). it is positional when the list has a
// top-level comma, or its first name is `params` / `_params`; `data(input)`
// with one other name is the object form, just not destructured.
func positionalDataDecls(toks []jsTok) []DataDecl {
	var decls []DataDecl
	// skip comment tokens in either direction
	nextTok := func(i int) int {
		for i < len(toks) && toks[i].comment {
			i++
		}
		return i
	}
	for i, t := range toks {
		if t.ident != "data" && t.ident != "share" {
			continue
		}
		prev := i - 1
		for prev >= 0 && toks[prev].comment {
			prev--
		}
		if prev >= 0 && (toks[prev].ch == '.' || toks[prev].ident == "function") {
			continue
		}
		open := nextTok(i + 1)
		if open >= len(toks) || toks[open].ch != '(' {
			continue
		}
		// walk to the matching ')' and note top-level commas and names. after a
		// top-level ':' the scan is in a typescript type, where '<' and '>' are
		// generic brackets, so `DataInput<A, B>` has no top-level comma; '=' or
		// a real top-level comma leaves the type again.
		depth, angle, typeCtx, comma, first := 0, 0, false, false, ""
		end := -1
		for j := open; j < len(toks); j++ {
			c := toks[j].ch
			arrow := c == '>' && j > 0 && toks[j-1].ch == '=' && toks[j-1].off == toks[j].off-1
			switch {
			case c == '(' || c == '{' || c == '[':
				depth++
			case c == ')' || c == '}' || c == ']':
				depth--
			case depth == 1 && typeCtx && c == '<':
				angle++
			case depth == 1 && typeCtx && c == '>' && !arrow && angle > 0:
				angle--
			case depth == 1 && angle == 0 && c == ':':
				typeCtx = true
			case depth == 1 && angle == 0 && c == '=' && !(j+1 < len(toks) && toks[j+1].ch == '>'):
				typeCtx = false
			case depth == 1 && angle == 0 && c == ',':
				comma, typeCtx = true, false
			}
			if depth == 1 && first == "" && toks[j].ident != "" {
				first = toks[j].ident
			}
			if depth == 0 {
				end = j
				break
			}
		}
		if end < 0 {
			continue
		}
		after := nextTok(end + 1)
		if after >= len(toks) || (toks[after].ch != '{' && toks[after].ch != ':') {
			continue
		}
		if comma || first == "params" || first == "_params" {
			decls = append(decls, DataDecl{Method: t.ident, NameOff: t.off, OpenOff: toks[open].off, CloseOff: toks[end].off})
		}
	}
	return decls
}

// warnPositionalData warns about a data() or share() declaration in the old
// positional form (see positionalDataParams). pos is the method name's
// position.
func warnPositionalData(method, file string, pos parser.Position, warnings *[]Warning) {
	if warnings == nil {
		return
	}
	*warnings = append(*warnings, Warning{
		File: file, Line: pos.Line, Col: pos.Col,
		Message: fmt.Sprintf(
			"%s() takes one object since 0.10.0 (D197): write %s({ params, props, shared }), destructuring only what you use — the positional form receives the whole object as its first argument",
			method, method),
	})
}
