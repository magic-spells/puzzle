package main

import (
	"io/fs"
	"regexp"
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/compiler/internal/codegen"
	"github.com/magic-spells/puzzle/packages/puzzle-lang/parser"
	embeddedskills "github.com/magic-spells/puzzle/skills"
)

// The embedded skill is what an agent copies from, so the examples it states as
// working have to be true.

func readSkill(t *testing.T) string {
	t.Helper()
	data, err := fs.ReadFile(embeddedskills.FS, "puzzle/SKILL.md")
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

// The snippet-stamp example ("one marker in the loop produces N stamps") put the
// <Slot> straight into the {#for} body, which the compiler rejects: a loop body's
// root must be an element or a component.
func TestSkillSnippetStampExampleCompiles(t *testing.T) {
	var loop string
	for _, line := range strings.Split(readSkill(t), "\n") {
		if strings.Contains(line, "{#for user in users}") && strings.Contains(line, `<Slot name="row"`) {
			loop = strings.TrimSpace(line)
		}
	}
	if loop == "" {
		t.Fatal(`SKILL.md no longer has the {#for user in users}…<Slot name="row"…> stamp example`)
	}
	src := "<puzzle-view><ul>" + loop + "</ul></puzzle-view>\n" +
		"<script>\nimport { PuzzleView } from '@magic-spells/puzzle';\n" +
		"export default class UserList extends PuzzleView {}\n</script>\n"
	sec, err := parser.SplitSections(src, "UserList.pzl")
	if err != nil {
		t.Fatalf("SKILL.md's snippet-stamp example does not parse: %v\n%s", err, loop)
	}
	if _, err := codegen.Compile(sec, codegen.Options{Filename: "UserList.pzl", Mode: codegen.ModeComponent}); err != nil {
		t.Fatalf("SKILL.md's snippet-stamp example does not compile: %v\n%s", err, loop)
	}
}

// `add piece` and `add theme default` copy the default palette to
// app/styles/pieces.css; theme/pieces.css is only its path inside the registry.
func TestSkillNamesTheCopiedPiecesCssPath(t *testing.T) {
	skill := readSkill(t)
	if strings.Contains(skill, "copied `theme/pieces.css`") {
		t.Error("SKILL.md points at the registry path theme/pieces.css for the copied palette")
	}
	if !strings.Contains(skill, "copied `app/styles/pieces.css`") {
		t.Error("SKILL.md should name the copied palette app/styles/pieces.css")
	}
}

// compileSkillTemplate compiles one template the skill shows. Every capitalized
// tag's root is imported from a sibling .pzl, as the skill's own examples
// assume; a template holding a named composition marker compiles as a
// component.
func compileSkillTemplate(t *testing.T, template string) error {
	t.Helper()
	src := template
	if !strings.Contains(src, "<puzzle-view") {
		src = "<puzzle-view>" + src + "</puzzle-view>"
	}
	if !strings.Contains(src, "<script") {
		var imports strings.Builder
		seen := map[string]bool{}
		for _, m := range regexp.MustCompile(`<([A-Z][A-Za-z0-9]*)[\s./>]`).FindAllStringSubmatch(src, -1) {
			name := m[1]
			switch name {
			case "Children", "Slot", "Snippet", "Portal":
				continue
			}
			if !seen[name] {
				seen[name] = true
				imports.WriteString("import " + name + " from './" + name + ".pzl';\n")
			}
		}
		src += "\n<script>\nimport { PuzzleView } from '@magic-spells/puzzle';\n" + imports.String() +
			"export default class Example extends PuzzleView {}\n</script>\n"
	}
	mode := codegen.ModeView
	if strings.Contains(src, "<Slot name=") || strings.Contains(src, "<Children") {
		mode = codegen.ModeComponent
	}
	sec, err := parser.SplitSections(src, "Example.pzl")
	if err != nil {
		return err
	}
	_, err = codegen.Compile(sec, codegen.Options{Filename: "Example.pzl", Mode: mode})
	return err
}

// skillFences returns the skill's ```html blocks, indented ones (inside a
// list item) included, dedented.
func skillFences(skill string) []string {
	var blocks []string
	var cur []string
	in, indent := false, ""
	for _, line := range strings.Split(skill, "\n") {
		trimmed := strings.TrimLeft(line, " ")
		switch {
		case !in && strings.HasPrefix(trimmed, "```html"):
			in, cur, indent = true, nil, line[:len(line)-len(trimmed)]
		case in && strings.HasPrefix(trimmed, "```"):
			in = false
			blocks = append(blocks, strings.Join(cur, "\n"))
		case in:
			cur = append(cur, strings.TrimPrefix(line, indent))
		}
	}
	return blocks
}

// Every template example the skill states as working compiles in the
// expression language (D176): each ```html block (indented ones included),
// and each inline template span — an interpolation `{ … }`, a {#for}/{#if}
// header, an attribute or handler binding (brace or quoted), an element, and
// a bare expression in the template-expression sections. The spans the skill
// shows as compile errors must fail, so a "this is an error" example can
// never quietly start compiling either.
func TestSkillTemplateExamplesCompile(t *testing.T) {
	skill := readSkill(t)

	blocks := skillFences(skill)
	if len(blocks) < 5 {
		t.Fatalf("expected the skill's html examples, found %d", len(blocks))
	}
	for _, block := range blocks {
		// The skeleton outline stands in `…real template…` for a view's body.
		block = strings.ReplaceAll(block, "…real template…", "<p>x</p>")
		// The snippet example shows a caller and, after a comment, the
		// component's own loop: compile each half on its own.
		parts := strings.SplitN(block, "<!-- inside ", 2)
		if len(parts) == 2 {
			// A component template's root is an element: the loop sits in a list.
			parts[1] = "<ul>" + parts[1][strings.Index(parts[1], "-->")+3:] + "</ul>"
		}
		for _, part := range parts {
			if err := compileSkillTemplate(t, part); err != nil {
				t.Errorf("SKILL.md html example does not compile: %v\n%s", err, part)
			}
		}
	}

	// The examples written to show a compile error.
	mustFail := map[string]bool{
		"{ price | currency }":       true,
		"{ raw(x).trim() }":          true,
		"{ escape(raw(x)) }":         true,
		"{ raw(x) + 'a' }":           true,
		"title={ raw(x) }":           true,
		"<Card body={ raw(x) } />":   true,
		"raw(a, b)":                  true,
		"items.sort()":               true,
		"new Date()":                 true,
		"Date.now()":                 true,
		"JSON.stringify(x)":          true,
		"this.refresh()":             true,
		"event.target.value":         true, // outside a handler
		"event.target.closest('li')": true,
		"event.preventDefault()":     true,
	}
	// Spans that are JavaScript object shapes in prose, not template expressions.
	notTemplate := map[string]bool{
		"{ error, info, retry }":                              true,
		"{ path, name, view, layout, guard, meta, children }": true,
		"{ q: 'x', tag: ['a','b'] }":                          true,
		`{ "cart": { "title": "…" } }`:                        true,
		"{ type, endpoint }":                                  true,
		"{ valid, errors }":                                   true,
		"{ endpoint: '/api/todos' }":                          true,
		"type={ }":                                            true, // prose: "a dynamic type"
		"style={}":                                            true, // prose: an empty binding
		"window.name":                                         true, // JavaScript in the raw() security notes
		"window.CONFIG":                                       true,
	}
	check := func(code, template string) {
		t.Helper()
		err := compileSkillTemplate(t, template)
		if mustFail[code] {
			if err == nil {
				t.Errorf("SKILL.md shows %s as a compile error, but it compiles", code)
			}
			return
		}
		if err != nil {
			t.Errorf("SKILL.md template example %s does not compile: %v", code, err)
		}
	}

	span := regexp.MustCompile("`([^`\n]+)`")
	attr := regexp.MustCompile(`^[@a-z][\w:-]*=[{"]`)
	checked := 0
	for _, m := range span.FindAllStringSubmatch(skill, -1) {
		code := m[1]
		if notTemplate[code] || !strings.Contains(code, "{") {
			continue
		}
		switch {
		case strings.HasPrefix(code, "{ ") && strings.HasSuffix(code, "}"):
			check(code, "<p>"+code+"</p>")
		case strings.HasPrefix(code, "{#for ") && strings.HasSuffix(code, "}") && !strings.Contains(code, "{/for}"):
			check(code, "<ul>"+code+"<li>x</li>{/for}</ul>")
		case strings.HasPrefix(code, "{#if ") && strings.HasSuffix(code, "}") && !strings.Contains(code, "{/if}"):
			check(code, code+"<p>x</p>{/if}")
		case attr.MatchString(code):
			check(code, "<input "+code+" />")
		case strings.HasPrefix(code, "<") && strings.Contains(code, "={"):
			check(code, code)
		default:
			continue // a grammar outline such as `{#if}/{:else}` or `{#raw}…{/raw}`
		}
		checked++
	}
	if checked < 25 {
		t.Fatalf("checked only %d inline template spans; the extraction is broken", checked)
	}

	// Bare expressions in the template-expression sections: from "Template
	// syntax:" through the `puzzle check` bullet, and the translations section.
	sections := []struct{ from, to string }{
		{"Template syntax:", "- **Three marker tags"},
		{"## Translations", "- Script: `this.ctx.i18n"},
	}
	bare := 0
	for _, sec := range sections {
		a := strings.Index(skill, sec.from)
		b := strings.Index(skill[a:], sec.to)
		if a < 0 || b < 0 {
			t.Fatalf("SKILL.md section %q…%q not found", sec.from, sec.to)
		}
		for _, m := range span.FindAllStringSubmatch(skill[a:a+b], -1) {
			code := m[1]
			if notTemplate[code] || !bareExpression(code) {
				continue
			}
			check(code, "<p>{ "+code+" }</p>")
			bare++
		}
	}
	if bare < 20 {
		t.Fatalf("checked only %d bare expressions; the extraction is broken", bare)
	}
}

// bareExpression reports whether an inline code span in the expression
// sections is a whole expression worth compiling: a call or a member read,
// not a method name (`.trim()`), an outline with `…`, a template construct,
// or prose such as `x => expr`.
func bareExpression(code string) bool {
	first := code[0]
	isStart := first == '_' || first == '$' || first == '(' || first == '\'' ||
		first >= 'a' && first <= 'z' || first >= 'A' && first <= 'Z'
	switch {
	case !isStart, strings.ContainsAny(code, "{}<>…`|*"),
		strings.Contains(code, "=>") && !strings.Contains(code, "("),
		!strings.ContainsAny(code, "(."):
		return false
	}
	// Lists of names (`Math.abs/ceil/floor`) and prose shapes are not
	// expressions.
	if strings.Contains(code, "/") && !strings.ContainsAny(code, "'\"") {
		return false
	}
	return true
}
