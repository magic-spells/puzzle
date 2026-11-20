package plugin

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestConditionalSlotUsage(t *testing.T) {
	for source, want := range map[string]bool{
		`<puzzle-view><Outlet/></puzzle-view>`:                                                             false,
		`<puzzle-view><main><Children/></main><Slot name="side"/></puzzle-view>`:                           false,
		`<puzzle-view>{#if user}<Outlet/>{:else}<p>Sign in</p>{/if}</puzzle-view>`:                         true,
		`<puzzle-view>{#if user}<p>hi</p>{:else}<Children/>{/if}</puzzle-view>`:                            true,
		`<puzzle-view>{#case mode}{:when 'a'}<section><Outlet/></section>{/case}</puzzle-view>`:            true,
		`<puzzle-view>{#for row in rows}<Slot name="row"/>{/for}</puzzle-view>`:                            true,
		`<puzzle-view><Frame key={id}><Outlet/></Frame></puzzle-view>`:                                     true,
		`<puzzle-view><Component is={current}><Outlet/></Component></puzzle-view>`:                         true,
		`<puzzle-view><Frame {...props}><Outlet/></Frame></puzzle-view>`:                                   true,
		`<puzzle-view><ul>{#for item in items}<li><Children item={ item }/></li>{/for}</ul></puzzle-view>`: false,
		`<puzzle-view><Outlet/></puzzle-view><puzzle-skeleton><Outlet/></puzzle-skeleton>`:                 true,
	} {
		root := t.TempDir()
		if err := os.WriteFile(filepath.Join(root, "Layout.pzl"), []byte(source), 0o644); err != nil {
			t.Fatal(err)
		}
		usage, err := ScanUsage(root)
		if err != nil || usage.HasConditionalSlot != want || usage.Features().ConditionalSlot != want {
			t.Errorf("%s: HasConditionalSlot = %v, want %v (%v)", source, usage.HasConditionalSlot, want, err)
		}
	}
}

// The package safety net names a conditional outlet the scan never read.
func TestUndeclaredPackageConditionalSlotFailsTheBuild(t *testing.T) {
	root := writeApp(t, map[string]string{
		"app/app.js":                    kitAppJS,
		"app/views/Home.pzl":            plainHome,
		"node_modules/kit/package.json": `{"name":"kit"}`,
		"node_modules/kit/Message.pzl":  `<puzzle-view><div>{#if open}<Children/>{/if}</div></puzzle-view>`,
	})
	res := scannedBuild(t, root)
	if len(res.Errors) != 1 || !strings.Contains(res.Errors[0].Text, "a conditional <Outlet/>") {
		t.Fatalf("errors = %+v", res.Errors)
	}
}
