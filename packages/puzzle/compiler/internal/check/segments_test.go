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
