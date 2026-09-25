package parser

import (
	"strings"
	"testing"
)

// TestPortalMarker covers the <Portal> grammar (D144): paired-only, no
// attributes, reserved `to`/`name`, the D134 lowercase steering error, and the
// D141 fallback-body rejection.
func TestPortalMarker(t *testing.T) {
	t.Run("paired portal parses with its children", func(t *testing.T) {
		root, err := Parse([]byte(`<puzzle-view><Portal><p>hi</p></Portal></puzzle-view>`+"\n<script></script>"), "test.pzl")
		if err != nil {
			t.Fatalf("parse: %v", err)
		}
		kids := elementChildren(root.Children)
		if len(kids) != 1 {
			t.Fatalf("root children: got %d, want 1", len(kids))
		}
		p, ok := kids[0].(*Portal)
		if !ok {
			t.Fatalf("child: got %T, want *Portal", kids[0])
		}
		if got := len(elementChildren(p.Children)); got != 1 {
			t.Fatalf("portal children: got %d, want 1", got)
		}
	})

	t.Run("portal nested inside a portal parses", func(t *testing.T) {
		if _, err := Parse([]byte(`<puzzle-view><Portal><Portal><p>hi</p></Portal></Portal></puzzle-view>`+"\n<script></script>"), "test.pzl"); err != nil {
			t.Fatalf("nested portals should parse, got %v", err)
		}
	})

	errs := []struct {
		name        string
		src         string
		wantMessage string
	}{
		{
			name:        "self-closing portal",
			src:         `<puzzle-view><Portal/></puzzle-view>`,
			wantMessage: "<Portal/> is paired-only",
		},
		{
			name:        "lowercase portal steers to the capitalized form",
			src:         `<puzzle-view><portal>x</portal></puzzle-view>`,
			wantMessage: "the portal marker is spelled <Portal>…</Portal> (D134/D144)",
		},
		{
			name:        "to attribute is reserved",
			src:         `<puzzle-view><Portal to="modals">x</Portal></puzzle-view>`,
			wantMessage: "named outlets are not supported yet",
		},
		{
			name:        "name attribute is reserved",
			src:         `<puzzle-view><Portal name="modals">x</Portal></puzzle-view>`,
			wantMessage: "named outlets are not supported yet",
		},
		{
			name:        "any other attribute is rejected",
			src:         `<puzzle-view><Portal class="x">y</Portal></puzzle-view>`,
			wantMessage: "<Portal> takes no attributes — every portal targets the app's single portal outlet",
		},
		{
			name:        "ref is rejected with the render-target message",
			src:         `<puzzle-view><Portal ref="x">y</Portal></puzzle-view>`,
			wantMessage: "ref cannot be placed on a <Portal>",
		},
		{
			name:        "portal inside a marker fallback body",
			src:         `<puzzle-view><Children><Portal>x</Portal></Children></puzzle-view>`,
			wantMessage: "<Portal> cannot appear inside a marker's fallback body (D141/D144)",
		},
		{
			name:        "portal nested deeper inside a fallback body",
			src:         `<puzzle-view><Slot name="a"><div><Portal>x</Portal></div></Slot></puzzle-view>`,
			wantMessage: "<Portal> cannot appear inside a marker's fallback body (D141/D144)",
		},
		{
			name:        "portal inside an island",
			src:         `<puzzle-view><div island><Portal>x</Portal></div></puzzle-view>`,
			wantMessage: "<Portal> cannot appear inside an island element",
		},
	}
	for _, c := range errs {
		t.Run(c.name, func(t *testing.T) {
			_, err := Parse([]byte(c.src+"\n<script></script>"), "test.pzl")
			if err == nil {
				t.Fatalf("expected an error, got none")
			}
			if !strings.Contains(err.Error(), c.wantMessage) {
				t.Fatalf("error %q should contain %q", err.Error(), c.wantMessage)
			}
		})
	}
}
