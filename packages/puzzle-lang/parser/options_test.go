package parser

import (
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// options_test.go proves the host options only add: PuzzleKit passes none, and
// its parse is the zero Options parse; a file with no {#let} parses to the same
// tree, or the same error, with Let on; and with Let off every {#let}-shaped
// header is the unknown-block error PuzzleKit has always printed.

// parseBoth parses src's template and skeleton with opts, folding the result
// into one comparable value.
func parseBoth(src, path string, opts ...Options) (roots []*Element, err string) {
	sec, e := SplitSections(src, path)
	if e != nil {
		return nil, e.Error()
	}
	root, e := ParseTemplate(sec, path, opts...)
	if e != nil {
		return nil, e.Error()
	}
	skel, e := ParseSkeleton(sec, path, opts...)
	if e != nil {
		return nil, e.Error()
	}
	return []*Element{root, skel}, ""
}

// sameTree is reflect.DeepEqual, except a NaN number equals a NaN number: a
// `NaN` literal in a template parses to a float NaN, which DeepEqual never
// finds equal to itself.
func sameTree(a, b any) bool {
	return sameValue(reflect.ValueOf(a), reflect.ValueOf(b))
}

func sameValue(a, b reflect.Value) bool {
	if a.IsValid() != b.IsValid() {
		return false
	}
	if !a.IsValid() {
		return true
	}
	if a.Type() != b.Type() {
		return false
	}
	switch a.Kind() {
	case reflect.Float32, reflect.Float64:
		x, y := a.Float(), b.Float()
		return x == y || (x != x && y != y)
	case reflect.Pointer, reflect.Interface:
		if a.IsNil() || b.IsNil() {
			return a.IsNil() == b.IsNil()
		}
		return sameValue(a.Elem(), b.Elem())
	case reflect.Slice:
		if a.IsNil() != b.IsNil() || a.Len() != b.Len() {
			return false
		}
		for i := 0; i < a.Len(); i++ {
			if !sameValue(a.Index(i), b.Index(i)) {
				return false
			}
		}
		return true
	case reflect.Array:
		for i := 0; i < a.Len(); i++ {
			if !sameValue(a.Index(i), b.Index(i)) {
				return false
			}
		}
		return true
	case reflect.Struct:
		for i := 0; i < a.NumField(); i++ {
			if !sameValue(a.Field(i), b.Field(i)) {
				return false
			}
		}
		return true
	case reflect.Map:
		if a.Len() != b.Len() {
			return false
		}
		for _, k := range a.MapKeys() {
			if !sameValue(a.MapIndex(k), b.MapIndex(k)) {
				return false
			}
		}
		return true
	case reflect.Func, reflect.Chan, reflect.UnsafePointer:
		return a.Pointer() == b.Pointer()
	}
	// Unexported fields cannot be read with Interface; compare by kind.
	switch a.Kind() {
	case reflect.Bool:
		return a.Bool() == b.Bool()
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return a.Int() == b.Int()
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Uintptr:
		return a.Uint() == b.Uint()
	case reflect.String:
		return a.String() == b.String()
	case reflect.Complex64, reflect.Complex128:
		return a.Complex() == b.Complex()
	}
	return false
}

func TestOptionsDefaultIsPuzzleKit(t *testing.T) {
	roots := append([]string{"testdata/todos"}, corpusRoots...)
	files := 0
	for _, root := range roots {
		if _, err := os.Stat(root); err != nil {
			continue // outside the monorepo only the vendored todos copy exists
		}
		err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if d.IsDir() {
				switch d.Name() {
				case "node_modules", "dist", ".puzzle":
					return filepath.SkipDir
				}
				return nil
			}
			if !strings.HasSuffix(path, ".pzl") {
				return nil
			}
			raw, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			src := string(raw)
			files++
			none, noneErr := parseBoth(src, path)
			zero, zeroErr := parseBoth(src, path, Options{})
			if noneErr != zeroErr || !sameTree(none, zero) {
				t.Errorf("%s: no options and Options{} differ", path)
			}
			if strings.Contains(src, "{#let") {
				return nil
			}
			let, letErr := parseBoth(src, path, Options{Let: true})
			if noneErr != letErr || !sameTree(none, let) {
				t.Errorf("%s: Let changes a file without {#let}:\n  default %q\n  let     %q", path, noneErr, letErr)
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	if files == 0 {
		t.Fatal("no .pzl files found")
	}
}

func TestOptionsLetOffIsUnknownBlock(t *testing.T) {
	for _, kw := range []string{"let", "assign", "set", "var", "const", "while"} {
		src := fmt.Sprintf("<puzzle-view>\n  {#%s total = 1}\n</puzzle-view>", kw)
		_, err := Parse([]byte(src), "views/Home.pzl")
		want := fmt.Sprintf("views/Home.pzl:2:3: unknown block {#%s} (expected {#if}, {#unless}, {#for}, {#case}, or {#svg})", kw)
		if err == nil || err.Error() != want {
			t.Errorf("{#%s}: got %v, want %s", kw, err, want)
		}
	}
	// A {#let} body never reaches the expression parser with Let off, so its
	// names never become bindings.
	if _, err := Parse([]byte("<puzzle-view>{ t('k') }</puzzle-view>"), "f.pzl"); err != nil {
		t.Fatal(err)
	}
}
