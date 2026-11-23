// Package codemod is the 0.10 upgrade behind `puzzle check --fix` (D199). It
// rewrites the four spellings 0.10 renamed, in place and only where the new
// form means exactly what the old one did:
//
//   - the unnamed router <Slot/> becomes <Outlet/> in app/layouts and
//     app/views, and <Children/> everywhere else (a component's unnamed
//     <Slot/> was always its call-site content);
//   - this.setData( becomes this.setState( (D191);
//   - a positional data(params, props) / share(params, props) declaration
//     becomes the one-object form, data({ params, props }) (D197);
//   - the `formatters` config key becomes `functions`, and the conventional
//     static-mode module app/formatters.js becomes app/functions.js (D199).
//
// Anything it finds but cannot rewrite safely is reported as a note for a
// person to finish. The rewrites are idempotent: a second run over its own
// output finds nothing.
package codemod

import (
	"bytes"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"

	"github.com/magic-spells/puzzle/compiler/internal/codegen"
	"github.com/magic-spells/puzzle/compiler/internal/fsutil"
	"github.com/magic-spells/puzzle/packages/puzzle-lang/parser"
)

// Change is one rewrite the codemod made (or, in a dry run, would make), or a
// note: a site it left alone because the rewrite was not safe to make
// mechanically, so a person has to finish it.
type Change struct {
	// File is the app-relative, forward-slashed path of the file.
	File string
	// Line and Col are 1-based, at the start of the old spelling.
	Line int
	Col  int
	// Rule names the rewrite: "outlet", "children", "set-state",
	// "data-object", "functions-key", "functions-module" or "functions-import".
	// A note has none.
	Rule string
	// Message describes the site for a person: old spelling → new, or what to
	// finish by hand.
	Message string
}

// Result is what one run found.
type Result struct {
	Changes []Change
	Notes   []Change
	// Files is the number of distinct files the changes touch.
	Files int
}

// edit replaces src[start:end] with text. rule and message describe it.
type edit struct {
	start, end int
	text       string
	rule       string
	message    string
}

// errNotPuzzleApp is returned when root has no app/ directory.
var errNotPuzzleApp = errors.New("no app/ directory here — run puzzle check from a Puzzle project root")

// Run scans the app under root and returns every upgrade site. With apply
// true it also writes the rewrites to disk and renames app/formatters.js; with
// apply false nothing on disk changes (the dry run).
func Run(root string, apply bool) (*Result, error) {
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	if info, err := os.Stat(filepath.Join(abs, "app")); err != nil || !info.IsDir() {
		return nil, errNotPuzzleApp
	}
	res := &Result{}

	// 1. the conventional static-mode module is renamed first, so the import
	//    rewrite below can point at a file that exists.
	moduleRenamed, err := renameFunctionsModule(abs, apply, res)
	if err != nil {
		return nil, err
	}

	// 2. every source file under app/ and tests/, in a stable order.
	files, err := sourceFiles(abs)
	if err != nil {
		return nil, err
	}
	for _, rel := range files {
		full := filepath.Join(abs, filepath.FromSlash(rel))
		src, err := os.ReadFile(full)
		if err != nil {
			return nil, err
		}
		var edits []edit
		var notes []Change
		if strings.HasSuffix(rel, ".pzl") {
			edits, notes = pzlEdits(rel, string(src))
		} else {
			edits, notes = scriptFileEdits(rel, string(src), moduleRenamed)
		}
		res.Notes = append(res.Notes, notes...)
		if len(edits) == 0 {
			continue
		}
		out, changes := applyEdits(rel, string(src), edits)
		res.Changes = append(res.Changes, changes...)
		if apply {
			// the file exists (it was just read), so WriteFile keeps its mode.
			if err := os.WriteFile(full, []byte(out), 0o644); err != nil {
				return nil, err
			}
		}
	}
	seen := map[string]bool{}
	for _, c := range res.Changes {
		seen[c.File] = true
	}
	res.Files = len(seen)
	sortByPos(res.Changes)
	sortByPos(res.Notes)
	return res, nil
}

// sortByPos orders sites by file, then line, then column.
func sortByPos(cs []Change) {
	sort.SliceStable(cs, func(i, j int) bool {
		a, b := cs[i], cs[j]
		if a.File != b.File {
			return a.File < b.File
		}
		if a.Line != b.Line {
			return a.Line < b.Line
		}
		return a.Col < b.Col
	})
}

// sourceFiles lists the files the codemod reads, app-relative and
// forward-slashed: every .pzl, .js, .mjs and .ts under app/ and tests/,
// skipping node_modules and anything dotted (.puzzle/ scratch, editor dirs).
func sourceFiles(abs string) ([]string, error) {
	var out []string
	for _, top := range []string{"app", "tests"} {
		dir := filepath.Join(abs, top)
		if _, err := os.Stat(dir); err != nil {
			continue
		}
		err := filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			name := d.Name()
			if d.IsDir() {
				if p != dir && (name == "node_modules" || strings.HasPrefix(name, ".")) {
					return filepath.SkipDir
				}
				return nil
			}
			switch filepath.Ext(name) {
			case ".pzl", ".js", ".mjs", ".ts":
			default:
				return nil
			}
			// a .d.ts declares types and holds no code to rewrite.
			if strings.HasSuffix(name, ".d.ts") {
				return nil
			}
			rel, err := filepath.Rel(abs, p)
			if err != nil {
				return err
			}
			out = append(out, filepath.ToSlash(rel))
			return nil
		})
		if err != nil {
			return nil, err
		}
	}
	sort.Strings(out)
	return out, nil
}

// applyEdits applies non-overlapping edits to src and returns the result plus
// one Change per edit, positioned in the ORIGINAL source. edits that overlap
// an earlier one are dropped (they cannot happen with the rules here, but a
// dropped edit is safer than a garbled file).
func applyEdits(rel, src string, edits []edit) (string, []Change) {
	sort.SliceStable(edits, func(i, j int) bool { return edits[i].start < edits[j].start })
	var b strings.Builder
	var changes []Change
	last := 0
	for _, e := range edits {
		if e.start < last || e.end < e.start || e.end > len(src) {
			continue
		}
		b.WriteString(src[last:e.start])
		b.WriteString(e.text)
		last = e.end
		line, col := lineCol(src, e.start)
		changes = append(changes, Change{File: rel, Line: line, Col: col, Rule: e.rule, Message: e.message})
	}
	b.WriteString(src[last:])
	return b.String(), changes
}

// lineCol converts a byte offset in src to a 1-based line and byte column.
func lineCol(src string, off int) (int, int) {
	if off > len(src) {
		off = len(src)
	}
	line := 1 + strings.Count(src[:off], "\n")
	col := off - strings.LastIndexByte(src[:off], '\n')
	return line, col
}

// ---------------------------------------------------------------------------
// .pzl files: the template markers and the <script> body
// ---------------------------------------------------------------------------

// pzlEdits returns the rewrites for one .pzl file. a file that does not split
// into sections is left alone — the type check reports why.
func pzlEdits(rel, src string) ([]edit, []Change) {
	sec, err := parser.SplitSections(src, rel)
	if err != nil {
		return nil, nil
	}
	var edits []edit
	var notes []Change
	edits = append(edits, markerEdits(rel, src, sec)...)
	se, sn := scriptEdits(rel, sec.Source, sec.Scripts, sec.ScriptsPos.Offset)
	edits = append(edits, se...)
	notes = append(notes, sn...)
	return edits, notes
}

// markerEdits finds every unnamed <Slot> in the template and the skeleton and
// rewrites its tag name (and a paired form's closing tag). The slot check is
// skipped so the parse succeeds on the very spelling it exists to find; any
// other parse error leaves that body alone.
func markerEdits(rel, src string, sec *parser.Sections) []edit {
	opts := parser.Options{SkipSlotCheck: true}
	// a layout or a view is filled by the router; anything else is a component
	// filled by its caller (the D20 directory convention the compiler uses).
	routed := codegen.ModeForPath(rel) == codegen.ModeView
	var slots []*parser.Slot
	if root, err := parser.ParseTemplate(sec, rel, opts); err == nil {
		slots = append(slots, bareSlots(root.Children)...)
	}
	if sec.HasSkeleton {
		if root, err := parser.ParseSkeleton(sec, rel, opts); err == nil && root != nil {
			slots = append(slots, bareSlots(root.Children)...)
		}
	}
	var edits []edit
	for _, s := range slots {
		// a marker that hands values over is call-site content whatever file it
		// sits in: the router never hands a snippet anything.
		target := "Children"
		if routed && len(s.Args) == 0 {
			target = "Outlet"
		}
		edits = append(edits, renameMarker(src, rel, s.Pos.Offset, target)...)
	}
	return edits
}

// bareSlots collects every *parser.Slot spelled <Slot> with no name, at any
// depth (fallback bodies cannot hold markers, D141, but snippet bodies and
// component children can).
func bareSlots(nodes []parser.Node) []*parser.Slot {
	var out []*parser.Slot
	for _, n := range nodes {
		switch node := n.(type) {
		case *parser.Slot:
			if node.Marker == "Slot" && node.Name == "" {
				out = append(out, node)
			}
			out = append(out, bareSlots(node.Children)...)
		case *parser.Element:
			out = append(out, bareSlots(node.Children)...)
		case *parser.Component:
			out = append(out, bareSlots(node.Children)...)
		case *parser.Snippet:
			out = append(out, bareSlots(node.Body)...)
		case *parser.Portal:
			out = append(out, bareSlots(node.Children)...)
		case *parser.If:
			out = append(out, bareSlots(node.Then)...)
			out = append(out, bareSlots(node.Else)...)
		case *parser.For:
			out = append(out, bareSlots(node.Body)...)
		case *parser.Case:
			for i := range node.Clauses {
				out = append(out, bareSlots(node.Clauses[i].Body)...)
			}
			out = append(out, bareSlots(node.Else)...)
		}
	}
	return out
}

// renameMarker rewrites the <Slot …> open tag at src[off] to <target …> and,
// for a paired <Slot>…</Slot>, the matching closing tag. a fallback body holds
// no other marker (D141 rejects that), so the first </Slot> after the open tag
// is its own.
func renameMarker(src, rel string, off int, target string) []edit {
	if off < 0 || off+5 > len(src) || src[off:off+5] != "<Slot" {
		return nil
	}
	afterGT, _, _, err := parser.ScanOpenTag(src, off, "Slot", rel)
	if err != nil {
		return nil
	}
	// the open tag's text before its '>': a self-closing tag ends in '/'.
	selfClose := strings.HasSuffix(strings.TrimRight(src[off:afterGT-1], " \t\r\n"), "/")
	edits := []edit{{
		start:   off + 1,
		end:     off + 5,
		text:    target,
		rule:    strings.ToLower(target),
		message: "<Slot/> → <" + target + "/>",
	}}
	if selfClose {
		return edits
	}
	closeAt := findCloseTag(src, afterGT, "Slot")
	if closeAt < 0 {
		return nil
	}
	return append(edits, edit{
		start:   closeAt + 2,
		end:     closeAt + 6,
		text:    target,
		rule:    strings.ToLower(target),
		message: "</Slot> → </" + target + ">",
	})
}

// findCloseTag returns the offset of the first `</name` (followed by optional
// white space and '>') at or after from, or -1.
func findCloseTag(src string, from int, name string) int {
	for i := from; i < len(src); {
		j := strings.Index(src[i:], "</"+name)
		if j < 0 {
			return -1
		}
		at := i + j
		k := at + 2 + len(name)
		for k < len(src) && (src[k] == ' ' || src[k] == '\t' || src[k] == '\n' || src[k] == '\r') {
			k++
		}
		if k < len(src) && src[k] == '>' {
			return at
		}
		i = at + 2
	}
	return -1
}

// ---------------------------------------------------------------------------
// script bodies: setData, positional data(), the formatters key, imports
// ---------------------------------------------------------------------------

// scriptEdits returns the setData and data() rewrites for one script body
// that starts at byte base of the file.
func scriptEdits(rel, file, script string, base int) ([]edit, []Change) {
	if strings.TrimSpace(script) == "" {
		return nil, nil
	}
	toks := codegen.TokenizeScript(script)
	edits, notes := setStateEdits(rel, file, toks, base)
	edits = append(edits, dataObjectEdits(rel, file, script, base, &notes)...)
	return edits, notes
}

// scriptFileEdits returns the rewrites for a plain .js / .mjs / .ts file:
// setData calls, the formatters config key, and (when the module was renamed)
// imports of app/formatters.
func scriptFileEdits(rel, src string, moduleRenamed bool) ([]edit, []Change) {
	toks := codegen.TokenizeScript(src)
	edits, notes := setStateEdits(rel, src, toks, 0)
	ke, kn := functionsKeyEdits(rel, src, toks)
	edits = append(edits, ke...)
	notes = append(notes, kn...)
	if moduleRenamed {
		edits = append(edits, importEdits(rel, src, toks)...)
	}
	return edits, notes
}

// domSetDataOwners are the DOM objects whose own setData() is not a view's:
// a drag event's dataTransfer and a clipboard event's clipboardData.
var domSetDataOwners = map[string]bool{"dataTransfer": true, "clipboardData": true}

// setStateEdits renames this.setData( (and super.setData() to setState(.
// a setData( call on any other receiver may be a view held in a variable or a
// DOM call the codemod cannot tell apart, so it becomes a note — except on
// dataTransfer / clipboardData, which are DOM and left alone silently.
func setStateEdits(rel, file string, toks []codegen.ScriptToken, base int) ([]edit, []Change) {
	var edits []edit
	var notes []Change
	// a file that defines a setData of its own (a method or a function, not a
	// call on something) has a setData that is not the view's — renaming its
	// calls would break them, so the whole file is left for a person.
	for i, t := range toks {
		if t.Ident == "setData" && (i == 0 || toks[i-1].Ch != '.') && i+1 < len(toks) && toks[i+1].Ch == '(' {
			line, col := lineCol(file, base+t.Off)
			return nil, []Change{{File: rel, Line: line, Col: col,
				Message: "this file defines its own setData — its setData( calls were left alone; rename the view ones to setState( by hand (D191)"}}
		}
	}
	for i, t := range toks {
		if t.Ident != "setData" || i < 2 || toks[i-1].Ch != '.' {
			continue
		}
		if i+1 >= len(toks) || toks[i+1].Ch != '(' {
			continue
		}
		recv := toks[i-2].Ident
		switch {
		case recv == "this" || recv == "super":
			edits = append(edits, edit{
				start:   base + t.Off,
				end:     base + t.Off + len("setData"),
				text:    "setState",
				rule:    "set-state",
				message: recv + ".setData( → " + recv + ".setState(",
			})
		case domSetDataOwners[recv]:
			// a DOM call, not a view's
		default:
			line, col := lineCol(file, base+t.Off)
			notes = append(notes, Change{File: rel, Line: line, Col: col,
				Message: "setData( on something other than this — if it is a view, rename it to setState( (D191)"})
		}
	}
	return edits, notes
}

// dataObjectEdits rewrites each positional data()/share() parameter list to
// the one-object form. a list the codemod cannot map (a rest parameter, more
// than two parameters) is left alone with a note.
func dataObjectEdits(rel, file, script string, base int, notes *[]Change) []edit {
	var edits []edit
	for _, d := range codegen.PositionalDataDecls(script) {
		inner := script[d.OpenOff+1 : d.CloseOff]
		text, ok := objectParams(inner)
		if !ok {
			line, col := lineCol(file, base+d.NameOff)
			*notes = append(*notes, Change{File: rel, Line: line, Col: col,
				Message: fmt.Sprintf("%s() still takes positional parameters — write %s({ params, props, shared }) by hand (D197)", d.Method, d.Method)})
			continue
		}
		edits = append(edits, edit{
			start:   base + d.OpenOff + 1,
			end:     base + d.CloseOff,
			text:    text,
			rule:    "data-object",
			message: fmt.Sprintf("%s(%s) → %s(%s)", d.Method, oneLine(inner), d.Method, oneLine(text)),
		})
	}
	return edits
}

// oneLine collapses white space runs so a message fits on one line.
func oneLine(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

// param is one parsed positional parameter: its binding (a name or a
// destructuring pattern), its typescript type annotation and its default.
type param struct {
	binding  string
	optional bool
	typ      string
	def      string
}

// objectParams maps a positional `params, props` list onto the one object
// data() receives: the first parameter is the `params` key and the second the
// `props` key (D197). a typescript annotation moves onto the object as an
// inline type. ok is false when the list cannot be mapped.
func objectParams(inner string) (string, bool) {
	parts := splitTopLevel(inner)
	// a trailing comma leaves an empty last part
	if n := len(parts); n > 0 && strings.TrimSpace(parts[n-1]) == "" {
		parts = parts[:n-1]
	}
	if len(parts) == 0 || len(parts) > 2 {
		return "", false
	}
	keys := []string{"params", "props"}
	var fields, types []string
	typed := false
	for i, raw := range parts {
		p, ok := parseParam(strings.TrimSpace(raw))
		if !ok {
			return "", false
		}
		key := keys[i]
		field := key
		if p.binding != key {
			field = key + ": " + p.binding
		}
		if p.def != "" {
			field += " = " + p.def
		}
		fields = append(fields, field)
		t := p.typ
		if t != "" {
			typed = true
		} else {
			t = "any"
		}
		opt := ""
		if p.optional || p.def != "" {
			opt = "?"
		}
		types = append(types, key+opt+": "+t)
	}
	out := "{ " + strings.Join(fields, ", ") + " }"
	if typed {
		out += ": { " + strings.Join(types, "; ") + " }"
	}
	return out, true
}

// parseParam splits one parameter into binding, `?`, type and default. a rest
// parameter is refused.
func parseParam(s string) (param, bool) {
	if s == "" || strings.HasPrefix(s, "...") {
		return param{}, false
	}
	var p param
	// the default: the first top-level '=' that is not part of '=>' / '==' / '>='.
	if eq := topLevelIndex(s, '='); eq >= 0 {
		p.def = strings.TrimSpace(s[eq+1:])
		s = strings.TrimSpace(s[:eq])
	}
	// the type: the first top-level ':' (a destructuring pattern's own colons
	// sit inside its braces).
	if colon := topLevelIndex(s, ':'); colon >= 0 {
		p.typ = strings.TrimSpace(s[colon+1:])
		s = strings.TrimSpace(s[:colon])
	}
	if strings.HasSuffix(s, "?") {
		p.optional = true
		s = strings.TrimSpace(strings.TrimSuffix(s, "?"))
	}
	if s == "" {
		return param{}, false
	}
	p.binding = s
	return p, true
}

// splitTopLevel splits s on commas outside brackets, braces, parens, angle
// brackets of a type, strings and comments.
func splitTopLevel(s string) []string {
	toks := codegen.TokenizeScript(s)
	var parts []string
	depth, last := 0, 0
	for i, t := range toks {
		switch t.Ch {
		case '(', '[', '{', '<':
			depth++
		case ')', ']', '}':
			depth--
		case '>':
			// an arrow '=>' closes nothing
			if !(i > 0 && toks[i-1].Ch == '=' && toks[i-1].Off == t.Off-1) {
				depth--
			}
		case ',':
			if depth == 0 {
				parts = append(parts, s[last:t.Off])
				last = t.Off + 1
			}
		}
	}
	return append(parts, s[last:])
}

// topLevelIndex returns the offset of the first top-level ch in s (outside
// brackets, strings and comments), or -1. for '=' it skips '==' and '=>'.
func topLevelIndex(s string, ch byte) int {
	toks := codegen.TokenizeScript(s)
	depth := 0
	for i, t := range toks {
		switch t.Ch {
		case '(', '[', '{', '<':
			depth++
			continue
		case ')', ']', '}':
			depth--
			continue
		case '>':
			if !(i > 0 && toks[i-1].Ch == '=' && toks[i-1].Off == t.Off-1) {
				depth--
			}
			continue
		}
		if depth != 0 || t.Ch != ch {
			continue
		}
		if ch == '=' {
			next := i + 1
			if next < len(toks) && toks[next].Off == t.Off+1 && (toks[next].Ch == '=' || toks[next].Ch == '>') {
				continue
			}
			if i > 0 && toks[i-1].Off == t.Off-1 && strings.ContainsRune("=!<>", rune(toks[i-1].Ch)) && toks[i-1].Ch != 0 {
				continue
			}
		}
		return t.Off
	}
	return -1
}

// configCalls names the calls whose object argument is an app config (or a
// test's ctx options) and the index of that argument.
var configCalls = map[string]int{"PuzzleApp": 0, "createTestApp": 0, "mountView": 1}

// functionsKeyEdits renames the `formatters` key of the config object passed
// to new PuzzleApp(…), createTestApp(…) or mountView(view, …): `formatters:`
// becomes `functions:`, and the shorthand `formatters` becomes
// `functions: formatters`. a config built elsewhere and passed by name is a
// note, because the codemod cannot see which object reaches the call.
func functionsKeyEdits(rel, src string, toks []codegen.ScriptToken) ([]edit, []Change) {
	var edits []edit
	var notes []Change
	for i, t := range toks {
		argIndex, ok := configCalls[t.Ident]
		if !ok || i+1 >= len(toks) || toks[i+1].Ch != '(' {
			continue
		}
		// a property access (`x.mountView(`) is still the call; a definition
		// (`function mountView(`) is not.
		if i > 0 && toks[i-1].Ident == "function" {
			continue
		}
		start := argStart(toks, i+1, argIndex)
		if start < 0 {
			continue
		}
		if toks[start].Ch != '{' {
			if toks[start].Ident != "" && fileMentionsFormattersKey(toks) {
				line, col := lineCol(src, toks[start].Off)
				notes = append(notes, Change{File: rel, Line: line, Col: col,
					Message: "this config is built elsewhere — if it has a formatters key, rename it to functions (D199)"})
			}
			continue
		}
		edits = append(edits, objectKeyEdits(toks, start)...)
	}
	return edits, notes
}

// fileMentionsFormattersKey reports whether any `formatters` identifier sits
// in an object-key position in the file, so a config passed by name only
// draws a note when there is something to check.
func fileMentionsFormattersKey(toks []codegen.ScriptToken) bool {
	for i, t := range toks {
		if t.Ident != "formatters" || i == 0 {
			continue
		}
		if p := toks[i-1].Ch; p == '{' || p == ',' {
			return true
		}
	}
	return false
}

// argStart returns the index of the first token of argument n of the call
// whose '(' is toks[open], or -1 when the call has fewer arguments.
func argStart(toks []codegen.ScriptToken, open, n int) int {
	depth, arg := 0, 0
	// expect is true when the next token begins an argument
	expect := true
	for j := open + 1; j < len(toks); j++ {
		t := toks[j]
		if t.Comment {
			continue
		}
		if expect && depth == 0 {
			if t.Ch == ')' {
				return -1
			}
			if arg == n {
				return j
			}
			expect = false
		}
		switch t.Ch {
		case '(', '[', '{':
			depth++
		case ')', ']', '}':
			if depth == 0 {
				return -1
			}
			depth--
		case ',':
			if depth == 0 {
				arg++
				expect = true
			}
		}
	}
	return -1
}

// objectKeyEdits renames a top-level `formatters` key of the object literal
// whose '{' is toks[open].
func objectKeyEdits(toks []codegen.ScriptToken, open int) []edit {
	var edits []edit
	depth := 0
	for j := open; j < len(toks); j++ {
		c := toks[j].Ch
		switch c {
		case '(', '[', '{':
			depth++
			continue
		case ')', ']', '}':
			depth--
			if depth == 0 {
				return edits
			}
			continue
		}
		if depth != 1 || toks[j].Ident != "formatters" {
			continue
		}
		prev := j - 1
		for prev > open && toks[prev].Comment {
			prev--
		}
		if toks[prev].Ch != '{' && toks[prev].Ch != ',' {
			continue
		}
		if j+1 >= len(toks) {
			continue
		}
		switch toks[j+1].Ch {
		case ':':
			edits = append(edits, edit{start: toks[j].Off, end: toks[j].Off + len("formatters"),
				text: "functions", rule: "functions-key", message: "formatters: → functions:"})
		case ',', '}':
			edits = append(edits, edit{start: toks[j].Off, end: toks[j].Off + len("formatters"),
				text: "functions: formatters", rule: "functions-key", message: "formatters → functions: formatters"})
		case '(':
			// a method `formatters() { … }` returning the map
			edits = append(edits, edit{start: toks[j].Off, end: toks[j].Off + len("formatters"),
				text: "functions", rule: "functions-key", message: "formatters() → functions()"})
		}
	}
	return edits
}

// renameFunctionsModule renames app/formatters.js (or .ts) to app/functions.js
// when no app/functions.* exists yet. moved reports whether a rename happened
// (or would, in a dry run).
func renameFunctionsModule(abs string, apply bool, res *Result) (moved bool, err error) {
	for _, ext := range []string{".js", ".ts"} {
		if fsutil.FileExists(filepath.Join(abs, "app", "functions"+ext)) {
			return false, nil
		}
	}
	for _, ext := range []string{".js", ".ts"} {
		from := filepath.Join(abs, "app", "formatters"+ext)
		if !fsutil.FileExists(from) {
			continue
		}
		rel := "app/formatters" + ext
		res.Changes = append(res.Changes, Change{File: rel, Line: 1, Col: 1, Rule: "functions-module",
			Message: rel + " → app/functions" + ext})
		if apply {
			if err := os.Rename(from, filepath.Join(abs, "app", "functions"+ext)); err != nil {
				return false, err
			}
		}
		return true, nil
	}
	return false, nil
}

// importEdits rewrites import specifiers that name the renamed module:
// './formatters.js' in app/app.js, '../app/formatters.js' in a test, or the
// '@/formatters.js' alias, each keeping its quotes and extension.
func importEdits(rel, src string, toks []codegen.ScriptToken) []edit {
	var edits []edit
	dir := path.Dir(rel)
	for i, t := range toks {
		if !t.Opaque || t.Comment || i == 0 {
			continue
		}
		prev := toks[i-1]
		isSpec := prev.Ident == "from" || prev.Ident == "import" ||
			(prev.Ch == '(' && i >= 2 && toks[i-2].Ident == "import")
		if !isSpec {
			continue
		}
		end := len(src)
		if i+1 < len(toks) {
			end = toks[i+1].Off
		}
		lit := strings.TrimRight(src[t.Off:end], " \t\r\n;")
		if len(lit) < 2 || (lit[0] != '\'' && lit[0] != '"') || lit[len(lit)-1] != lit[0] {
			continue
		}
		spec := lit[1 : len(lit)-1]
		if resolveSpecifier(dir, spec) != "app/formatters" {
			continue
		}
		idx := strings.LastIndex(spec, "formatters")
		newSpec := spec[:idx] + "functions" + spec[idx+len("formatters"):]
		edits = append(edits, edit{
			start: t.Off + 1, end: t.Off + 1 + len(spec), text: newSpec,
			rule: "functions-import", message: "'" + spec + "' → '" + newSpec + "'",
		})
	}
	return edits
}

// resolveSpecifier maps an import specifier written in a file under dir to an
// app-relative module path without extension, or "" for a package import.
func resolveSpecifier(dir, spec string) string {
	var p string
	switch {
	case strings.HasPrefix(spec, "@/"):
		p = path.Join("app", spec[2:])
	case strings.HasPrefix(spec, "./") || strings.HasPrefix(spec, "../"):
		p = path.Join(dir, spec)
	default:
		return ""
	}
	for _, ext := range []string{".js", ".ts", ".mjs"} {
		if strings.HasSuffix(p, ext) {
			return strings.TrimSuffix(p, ext)
		}
	}
	return p
}

// Format renders changes (or notes) for the terminal, one per line as
// `file:line:col  message`.
func Format(cs []Change) string {
	var b bytes.Buffer
	for _, c := range cs {
		fmt.Fprintf(&b, "  %s:%d:%d  %s\n", c.File, c.Line, c.Col, c.Message)
	}
	return b.String()
}
