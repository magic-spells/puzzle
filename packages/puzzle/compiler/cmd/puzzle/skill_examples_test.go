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

// compileSkillTemplate compiles one template the skill shows, as a view.
func compileSkillTemplate(t *testing.T, template string) error {
	t.Helper()
	src := template
	if !strings.Contains(src, "<puzzle-view") {
		src = "<puzzle-view>" + src + "</puzzle-view>"
	}
	if !strings.Contains(src, "<script") {
		src += "\n<script>\nimport { PuzzleView } from '@magic-spells/puzzle';\n" +
			"export default class Example extends PuzzleView {}\n</script>\n"
	}
	sec, err := parser.SplitSections(src, "Example.pzl")
	if err != nil {
		return err
	}
	_, err = codegen.Compile(sec, codegen.Options{Filename: "Example.pzl", Mode: codegen.ModeView})
	return err
}

// Every template example the skill states as working compiles in the
// expression language (D176): each ```html block, and each inline template
// span — an interpolation `{ … }`, a {#for}/{#if} header, or an attribute or
// handler binding. The spans the skill shows as compile errors must fail, so a
// "this is an error" example can never quietly start compiling either.
func TestSkillTemplateExamplesCompile(t *testing.T) {
	skill := readSkill(t)

	var blocks []string
	var cur []string
	in := false
	for _, line := range strings.Split(skill, "\n") {
		switch {
		case !in && strings.HasPrefix(line, "```html"):
			in, cur = true, nil
		case in && strings.HasPrefix(line, "```"):
			in = false
			blocks = append(blocks, strings.Join(cur, "\n"))
		case in:
			cur = append(cur, line)
		}
	}
	if len(blocks) < 3 {
		t.Fatalf("expected the skill's html examples, found %d", len(blocks))
	}
	for _, block := range blocks {
		// The skeleton outline stands in `…real template…` for a view's body.
		block = strings.ReplaceAll(block, "…real template…", "<p>x</p>")
		if err := compileSkillTemplate(t, block); err != nil {
			t.Errorf("SKILL.md html example does not compile: %v\n%s", err, block)
		}
	}

	// The examples written to show a compile error.
	mustFail := map[string]bool{
		"{ price | currency }": true,
		"{ raw(x).trim() }":    true,
		"{ escape(raw(x)) }":   true,
		"{ raw(x) + 'a' }":     true,
		"title={ raw(x) }":     true,
		"{ raw(x) }":           false, // shown inside a raw-text element; alone it compiles
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
	}
	span := regexp.MustCompile("`([^`]*\\{[ #@][^`]*\\})`")
	checked := 0
	for _, m := range span.FindAllStringSubmatch(skill, -1) {
		code := m[1]
		var template string
		switch {
		case notTemplate[code]:
			continue
		case strings.HasPrefix(code, "{ "):
			template = "<p>" + code + "</p>"
		case strings.HasPrefix(code, "{#for ") && strings.HasSuffix(code, "}"):
			template = "<ul>" + code + "<li>x</li>{/for}</ul>"
		case strings.HasPrefix(code, "{#if ") && strings.HasSuffix(code, "}") && !strings.Contains(code, "{/if}"):
			template = code + "<p>x</p>{/if}"
		case regexp.MustCompile(`^[@a-z][\w:-]*=[{"]`).MatchString(code):
			template = "<input " + code + " />"
		default:
			continue // a grammar outline such as `{#if}/{:else}` or `{#raw}…{/raw}`
		}
		checked++
		err := compileSkillTemplate(t, template)
		if mustFail[code] {
			if err == nil {
				t.Errorf("SKILL.md shows %s as a compile error, but it compiles", code)
			}
			continue
		}
		if err != nil {
			t.Errorf("SKILL.md template example %s does not compile: %v", code, err)
		}
	}
	if checked < 20 {
		t.Fatalf("checked only %d inline template examples; the extraction is broken", checked)
	}
}
