package build

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestWatchBuilderTemplateErrorFrame(t *testing.T) {
	root := writeSplitFixture(t, "")
	write(t, filepath.Join(root, "app", "app.js"), "import './Home.pzl';")
	write(t, filepath.Join(root, "app", "Home.pzl"), "<puzzle-view>\n\té🙂 {#if todos.length > }\n{/if}\n</puzzle-view>")
	b, err := NewWatchBuilder(root, WatchOptions{})
	if err != nil {
		t.Fatal(err)
	}
	defer b.Dispose()
	_, err = b.Rebuild(nil)
	if err == nil || !strings.Contains(err.Error(), "é🙂 {#if todos.length > }") || !strings.Contains(err.Error(), "╵") {
		t.Fatalf("dev template error lost its code frame: %v", err)
	}
}
