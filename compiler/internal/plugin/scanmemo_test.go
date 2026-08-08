package plugin

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func writePZL(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	// Push mtime forward so a same-size rewrite is still a distinct stamp on
	// filesystems with coarse timestamps.
	now := time.Now()
	_ = os.Chtimes(path, now, now)
}

const flipView = `<puzzle-view>
  <ul><li flip>{ item }</li></ul>
</puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class V extends PuzzleView {}
</script>
`

const currencyView = `<puzzle-view>
  <p>{ total | currency }</p>
</puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class V extends PuzzleView {}
</script>
`

const plainView = `<puzzle-view>
  <p>plain</p>
</puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class V extends PuzzleView {}
</script>
`

// TestUsageScannerMatchesColdScan is the equivalence statement: whatever the
// tree looks like, an incremental Scan must answer exactly what a cold
// ScanUsage answers — through edits, additions, and deletions.
func TestUsageScannerMatchesColdScan(t *testing.T) {
	root := t.TempDir()
	a := filepath.Join(root, "app", "views", "A.pzl")
	b := filepath.Join(root, "app", "views", "B.pzl")
	writePZL(t, a, currencyView)
	writePZL(t, b, plainView)

	s := NewUsageScanner()
	assertSame := func(step string) Usage {
		t.Helper()
		cold, err := NewUsageScanner().Scan(root)
		if err != nil {
			t.Fatalf("%s: cold scan: %v", step, err)
		}
		warm, err := s.Scan(root)
		if err != nil {
			t.Fatalf("%s: warm scan: %v", step, err)
		}
		if warm.HasFlip != cold.HasFlip {
			t.Errorf("%s: HasFlip warm=%v cold=%v", step, warm.HasFlip, cold.HasFlip)
		}
		if len(warm.Formatters) != len(cold.Formatters) {
			t.Errorf("%s: formatters warm=%v cold=%v", step, warm.Formatters, cold.Formatters)
		}
		for name := range cold.Formatters {
			if !warm.Formatters[name] {
				t.Errorf("%s: warm scan missed formatter %q", step, name)
			}
		}
		return warm
	}

	u := assertSame("initial")
	if !u.Formatters["currency"] || u.HasFlip {
		t.Fatalf("initial usage wrong: %+v", u)
	}

	// An edit that ADDS a feature must be picked up.
	writePZL(t, b, flipView)
	u = assertSame("edit adds flip")
	if !u.HasFlip {
		t.Fatal("flip added by an edit was not seen")
	}

	// An edit that REMOVES a feature must be picked up.
	writePZL(t, b, plainView)
	u = assertSame("edit removes flip")
	if u.HasFlip {
		t.Fatal("flip removed by an edit was still reported")
	}

	// A brand new file contributes.
	c := filepath.Join(root, "app", "views", "C.pzl")
	writePZL(t, c, flipView)
	u = assertSame("file added")
	if !u.HasFlip {
		t.Fatal("flip in a new file was not seen")
	}

	// Deleting the only user of a feature drops it — the memo must not keep a
	// gone file's contribution alive.
	if err := os.Remove(c); err != nil {
		t.Fatal(err)
	}
	u = assertSame("file deleted")
	if u.HasFlip {
		t.Fatal("deleted file still contributed flip")
	}

	// Removing the last formatter user drops it too.
	if err := os.Remove(a); err != nil {
		t.Fatal(err)
	}
	u = assertSame("formatter user deleted")
	if u.Formatters["currency"] {
		t.Fatal("deleted file still contributed a formatter")
	}
}

// TestUsageScannerReusesUnchangedFiles proves the memo actually memoizes: a
// second Scan over an untouched tree must not re-read a single .pzl.
func TestUsageScannerReusesUnchangedFiles(t *testing.T) {
	root := t.TempDir()
	a := filepath.Join(root, "app", "views", "A.pzl")
	writePZL(t, a, currencyView)

	s := NewUsageScanner()
	if _, err := s.Scan(root); err != nil {
		t.Fatal(err)
	}
	// Make the file unreadable content-wise by replacing it with bytes that would
	// parse differently — but keep the stamp identical, which is only possible by
	// restoring mtime and size. A same-size body with the mtime put back is
	// exactly the collision the memo accepts by design; seeing the OLD answer is
	// therefore proof the parse was skipped.
	info, err := os.Stat(a)
	if err != nil {
		t.Fatal(err)
	}
	replacement := []byte(currencyView)
	copy(replacement[len(replacement)-len(plainView):], plainView)
	if err := os.WriteFile(a, replacement, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(a, info.ModTime(), info.ModTime()); err != nil {
		t.Fatal(err)
	}
	if next, err := os.Stat(a); err != nil || next.Size() != info.Size() {
		t.Skip("could not construct an identical stamp on this filesystem")
	}

	got, err := s.Scan(root)
	if err != nil {
		t.Fatal(err)
	}
	if !got.Formatters["currency"] {
		t.Fatal("an unchanged stamp should have served the memoized parse")
	}
}
