package main

import (
	"io/fs"
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
