package check

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"
)

// Position is a one-based line/column plus a zero-based byte offset. Columns
// intentionally match the Puzzle parser's byte-column convention.
type Position struct {
	Offset int `json:"offset"`
	Line   int `json:"line"`
	Column int `json:"column"`
}

// Segment maps one byte-identical emitted range back to its .pzl source range.
// Ranges are half-open. Generated scaffolding and inserted __d. prefixes have
// no segment and therefore cannot be mistaken for authored source.
type Segment struct {
	GeneratedStart Position `json:"generatedStart"`
	GeneratedEnd   Position `json:"generatedEnd"`
	SourceStart    Position `json:"sourceStart"`
	SourceEnd      Position `json:"sourceEnd"`
}

// SegmentTable is the JSON sidecar written beside each virtual source file.
type SegmentTable struct {
	Version   int       `json:"version"`
	Source    string    `json:"source"`
	Generated string    `json:"generated"`
	Segments  []Segment `json:"segments"`

	generatedBytes []byte
	sourceBytes    []byte
}

type mappedBuilder struct {
	b       strings.Builder
	table   *SegmentTable
	source  []byte
	genLine int
	genCol  int
}

func newMappedBuilder(source, generated string, src []byte) *mappedBuilder {
	return &mappedBuilder{
		table:   &SegmentTable{Version: 1, Source: source, Generated: generated},
		source:  src,
		genLine: 1,
		genCol:  1,
	}
}

func (b *mappedBuilder) Len() int { return b.b.Len() }

func (b *mappedBuilder) String() string { return b.b.String() }

func (b *mappedBuilder) WriteString(s string) {
	b.b.WriteString(s)
	b.genLine, b.genCol = advanceLineCol(b.genLine, b.genCol, []byte(s))
}

func (b *mappedBuilder) WriteMapped(s string, sourceOffset int) {
	if s == "" {
		return
	}
	genStart := Position{Offset: b.Len(), Line: b.genLine, Column: b.genCol}
	srcStart := positionAt(b.source, sourceOffset)
	b.WriteString(s)
	genEnd := Position{Offset: b.Len(), Line: b.genLine, Column: b.genCol}
	srcEnd := positionAt(b.source, sourceOffset+len(s))

	n := len(b.table.Segments)
	if n > 0 {
		last := &b.table.Segments[n-1]
		if last.GeneratedEnd.Offset == genStart.Offset && last.SourceEnd.Offset == srcStart.Offset {
			last.GeneratedEnd = genEnd
			last.SourceEnd = srcEnd
			return
		}
	}
	b.table.Segments = append(b.table.Segments, Segment{
		GeneratedStart: genStart,
		GeneratedEnd:   genEnd,
		SourceStart:    srcStart,
		SourceEnd:      srcEnd,
	})
}

// WriteResolved writes a codegen-resolved expression while mapping every byte
// copied from the authored expression. ResolveCheckExpr only inserts __d.
// prefixes; it never deletes or rewrites source bytes.
func (b *mappedBuilder) WriteResolved(resolved, authored string, sourceOffset int) {
	si, gi := 0, 0
	for si < len(authored) && gi < len(resolved) {
		if authored[si] == resolved[gi] {
			startS, startG := si, gi
			for si < len(authored) && gi < len(resolved) && authored[si] == resolved[gi] {
				si++
				gi++
			}
			b.WriteMapped(resolved[startG:gi], sourceOffset+startS)
			continue
		}
		if strings.HasPrefix(resolved[gi:], "__d.") {
			b.WriteString("__d.")
			gi += len("__d.")
			continue
		}
		// ResolveCheckExpr's contract is insertion-only. Keep an unexpected byte
		// unmapped rather than manufacturing a false source position.
		b.WriteString(resolved[gi : gi+1])
		gi++
	}
	if gi < len(resolved) {
		b.WriteString(resolved[gi:])
	}
}

// WriteSubsequence is used for codegen's event expression, whose wrapper adds
// arrows and this.events. It conservatively maps matching authored byte runs in
// order and leaves all generated event scaffolding unmapped.
func (b *mappedBuilder) WriteSubsequence(generated, authored string, sourceOffset int) {
	gi, si := 0, 0
	for si < len(authored) && gi < len(generated) {
		idx := strings.IndexByte(generated[gi:], authored[si])
		if idx < 0 {
			break
		}
		if idx > 0 {
			b.WriteString(generated[gi : gi+idx])
			gi += idx
		}
		startG, startS := gi, si
		for gi < len(generated) && si < len(authored) && generated[gi] == authored[si] {
			gi++
			si++
		}
		b.WriteMapped(generated[startG:gi], sourceOffset+startS)
	}
	if gi < len(generated) {
		b.WriteString(generated[gi:])
	}
}

func advanceLineCol(line, col int, data []byte) (int, int) {
	for _, c := range data {
		if c == '\n' {
			line++
			col = 1
		} else {
			col++
		}
	}
	return line, col
}

func positionAt(data []byte, offset int) Position {
	if offset < 0 {
		offset = 0
	}
	if offset > len(data) {
		offset = len(data)
	}
	line, col := advanceLineCol(1, 1, data[:offset])
	return Position{Offset: offset, Line: line, Column: col}
}

func writeSegmentTable(path string, table *SegmentTable) error {
	data, err := json.MarshalIndent(table, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	return os.WriteFile(path, data, 0o644)
}

// LoadSegmentTables reads all generated sidecars and attaches the source and
// virtual file bytes needed for line/column remapping.
func LoadSegmentTables(appRoot, checkDir string) (map[string]*SegmentTable, error) {
	var sidecars []string
	err := filepath.WalkDir(filepath.Join(checkDir, "src"), func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !entry.IsDir() && strings.HasSuffix(path, ".segments.json") {
			sidecars = append(sidecars, path)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Strings(sidecars)
	tables := make(map[string]*SegmentTable, len(sidecars))
	for _, path := range sidecars {
		data, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		var table SegmentTable
		if err := json.Unmarshal(data, &table); err != nil {
			return nil, fmt.Errorf("read segment table %s: %w", path, err)
		}
		generatedPath := filepath.Join(appRoot, filepath.FromSlash(table.Generated))
		table.generatedBytes, err = os.ReadFile(generatedPath)
		if err != nil {
			return nil, err
		}
		table.sourceBytes, err = os.ReadFile(filepath.Join(appRoot, filepath.FromSlash(table.Source)))
		if err != nil {
			return nil, err
		}
		tables[filepath.Clean(generatedPath)] = &table
	}
	return tables, nil
}

// Remap maps a one-based TypeScript line/column to the authored .pzl position.
// TypeScript columns count UTF-16 code units; Puzzle columns count source bytes.
func (t *SegmentTable) Remap(line, column int) (Position, bool) {
	offset, ok := offsetAtUTF16Column(t.generatedBytes, line, column)
	if !ok {
		return Position{}, false
	}
	i := sort.Search(len(t.Segments), func(i int) bool {
		return t.Segments[i].GeneratedEnd.Offset > offset
	})
	if i >= len(t.Segments) {
		return Position{}, false
	}
	seg := t.Segments[i]
	if offset < seg.GeneratedStart.Offset || offset >= seg.GeneratedEnd.Offset {
		return Position{}, false
	}
	sourceOffset := seg.SourceStart.Offset + offset - seg.GeneratedStart.Offset
	return positionAt(t.sourceBytes, sourceOffset), true
}

func offsetAtUTF16Column(data []byte, line, column int) (int, bool) {
	if line < 1 || column < 1 {
		return 0, false
	}
	start := 0
	for current := 1; current < line; current++ {
		i := strings.IndexByte(string(data[start:]), '\n')
		if i < 0 {
			return 0, false
		}
		start += i + 1
	}
	targetUnits := column - 1
	units := 0
	for i := start; i < len(data) && data[i] != '\n'; {
		if units == targetUnits {
			return i, true
		}
		r, size := utf8.DecodeRune(data[i:])
		if r == utf8.RuneError && size == 0 {
			return 0, false
		}
		step := 1
		if r > 0xffff {
			step = 2
		}
		if units+step > targetUnits {
			return 0, false
		}
		units += step
		i += size
	}
	if units == targetUnits {
		end := start
		for end < len(data) && data[end] != '\n' {
			end++
		}
		return end, true
	}
	return 0, false
}
