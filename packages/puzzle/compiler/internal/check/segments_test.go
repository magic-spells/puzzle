package check

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestSegmentRemapUTF8AndCRLF(t *testing.T) {
	source := []byte("α\r\nconst café = person.missing;\r\n")
	b := newMappedBuilder("app/views/Home.pzl", ".puzzle/check/src/views/Home.pzl.ts", source)
	b.WriteString("// 😺 generated\n")
	b.WriteMapped(string(source), 0)
	b.table.generatedBytes = []byte(b.String())
	b.table.sourceBytes = source

	generatedOffset := strings.Index(b.String(), "missing")
	line, column := utf16LineColumn([]byte(b.String()), generatedOffset)
	got, ok := b.table.Remap(line, column)
	if !ok {
		t.Fatal("expected remap")
	}
	want := positionAt(source, strings.Index(string(source), "missing"))
	if got != want {
		t.Fatalf("remap = %+v, want %+v", got, want)
	}
}

func TestResolvedPrefixSegmentsPreserveExpressionColumn(t *testing.T) {
	source := []byte(`<p>{ café.missing }</p>`)
	authored := "café.missing"
	sourceOffset := strings.Index(string(source), authored)
	b := newMappedBuilder("app/views/Home.pzl", ".puzzle/check/src/views/Home.pzl.ts", source)
	b.WriteString("void (")
	b.WriteResolved("__d.café.missing", authored, sourceOffset)
	b.WriteString(");\n")
	b.table.generatedBytes = []byte(b.String())
	b.table.sourceBytes = source

	generatedOffset := strings.Index(b.String(), "missing")
	line, column := utf16LineColumn([]byte(b.String()), generatedOffset)
	got, ok := b.table.Remap(line, column)
	if !ok {
		t.Fatal("expected remap")
	}
	want := positionAt(source, strings.Index(string(source), "missing"))
	if got != want {
		t.Fatalf("remap = %+v, want %+v", got, want)
	}
}

func utf16LineColumn(data []byte, offset int) (int, int) {
	line, column := 1, 1
	for i := 0; i < offset; {
		if data[i] == '\n' {
			line++
			column = 1
			i++
			continue
		}
		r, size := utf8.DecodeRune(data[i:])
		if r > 0xffff {
			column += 2
		} else {
			column++
		}
		i += size
	}
	return line, column
}

// An astral-plane character on the same line as the error costs TWO UTF-16 code
// units in a tsc column but four bytes in the source, so a naive column-as-byte
// conversion lands mid-identifier.
func TestRemapAstralCharBeforeErrorPosition(t *testing.T) {
	script := "\nimport { PuzzleView } from '@magic-spells/puzzle';\nconst label = '😺'; const x = broken;\nexport default class Home extends PuzzleView {}\n"
	source := []byte("<puzzle-view><p>{ a }</p></puzzle-view>\n<script lang=\"ts\">" + script + "</script>\n")
	assertRemapsToSourceOf(t, source, "broken")
}

// A script whose last line has no trailing newline: the mapped run ends at the
// final byte, and the diagnostic sits on that line.
func TestRemapLastLineWithoutTrailingNewline(t *testing.T) {
	source := []byte("<puzzle-view><p>{ a }</p></puzzle-view>\n<script lang=\"ts\">\n" +
		"import { PuzzleView } from '@magic-spells/puzzle';\n" +
		"export default class Home extends PuzzleView {}\n" +
		"const x = broken;</script>\n")
	assertRemapsToSourceOf(t, source, "broken")
}

// TypeScript anchors an error about a whole expression at the expression's
// first token, which for a template expression is generated scaffolding
// (`void (`, the inserted `__d.`). Those diagnostics must still land on the
// authored expression rather than printing a .puzzle/check path.
func TestRemapFromGeneratedScaffoldingOnTheSameLine(t *testing.T) {
	source := []byte("<puzzle-view><p>{ missing.deep }</p></puzzle-view>\n<script lang=\"ts\">\n" +
		"import { PuzzleView } from '@magic-spells/puzzle';\n" +
		"export default class Home extends PuzzleView {}\n</script>\n")
	files, err := emitFiles(source, "app/views/Home.pzl", ".puzzle/check/src/views/Home.pzl", "")
	if err != nil {
		t.Fatal(err)
	}
	v := files[0]
	v.Table.generatedBytes = v.Contents
	v.Table.sourceBytes = source

	// The `void` keyword of `  void __d.missing.deep;` — pure scaffolding.
	voidOffset := strings.Index(string(v.Contents), "void __d.")
	line, column := utf16LineColumn(v.Contents, voidOffset)
	got, ok := v.Table.Remap(line, column)
	if !ok {
		t.Fatalf("scaffolding position did not fall back to the line's expression:\n%s", v.Contents)
	}
	want := positionAt(source, strings.Index(string(source), "missing"))
	if got != want {
		t.Fatalf("remap = %+v, want %+v", got, want)
	}
}

func assertRemapsToSourceOf(t *testing.T, source []byte, needle string) {
	t.Helper()
	files, err := emitFiles(source, "app/views/Home.pzl", ".puzzle/check/src/views/Home.pzl", "")
	if err != nil {
		t.Fatal(err)
	}
	v := files[0]
	v.Table.generatedBytes = v.Contents
	v.Table.sourceBytes = source

	line, column := utf16LineColumn(v.Contents, strings.Index(string(v.Contents), needle))
	got, ok := v.Table.Remap(line, column)
	if !ok {
		t.Fatalf("expected remap of %q; generated:\n%s", needle, v.Contents)
	}
	want := positionAt(source, strings.Index(string(source), needle))
	if got != want {
		t.Fatalf("remap = %+v, want %+v", got, want)
	}
}
