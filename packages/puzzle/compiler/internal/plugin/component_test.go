package plugin

import (
	"os"
	"path/filepath"
	"testing"
)

func TestComponentSlotUsageTracksTemplatesSkeletonsAndMemo(t *testing.T) {
	for _, source := range []string{
		`<puzzle-view><Component is={current}/></puzzle-view>`,
		`<puzzle-view><div/></puzzle-view><puzzle-skeleton><Component is={cards['card']}/></puzzle-skeleton>`,
		`<puzzle-view><div><Component is={cards['card']}><Component is={current}/></Component></div></puzzle-view>`,
	} {
		root := t.TempDir()
		file := filepath.Join(root, "Home.pzl")
		if err := os.WriteFile(file, []byte(source), 0o644); err != nil {
			t.Fatal(err)
		}
		scanner := NewUsageScanner()
		for i := 0; i < 2; i++ {
			usage, err := scanner.Scan(root)
			if err != nil || !usage.HasComponentSlot || !usage.Features().ComponentSlot {
				t.Fatalf("scan %d = %+v, %v", i, usage, err)
			}
		}
		if err := os.WriteFile(file, []byte(`<puzzle-view><Card/></puzzle-view>`), 0o644); err != nil {
			t.Fatal(err)
		}
		usage, err := scanner.Scan(root)
		if err != nil || usage.HasComponentSlot || usage.Features().ComponentSlot {
			t.Fatalf("removed selector = %+v, %v", usage, err)
		}
	}
}

func TestSpreadPropLibraryCallsAreScanned(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "Home.pzl"), []byte(`<puzzle-view><Component is={current} {...props_for(currency(price))}/></puzzle-view>`), 0o644); err != nil {
		t.Fatal(err)
	}
	usage, err := ScanUsage(root)
	if err != nil || !usage.Formatters["currency"] || !usage.HasComponentSlot {
		t.Fatalf("usage = %+v, %v", usage, err)
	}
}
