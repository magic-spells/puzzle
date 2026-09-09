package codegen

import (
	"strings"
	"testing"
)

// portal_root_test.go — a component whose entire template is a <Portal> has no
// local root element for call-site attributes or the scoped-style stamp, so it
// is rejected with a steering error naming the wrapper idiom (D144). Views are
// unaffected: their <puzzle-view> root stays, so a portal-only view is legal.

func TestPortalAsComponentRootRejected(t *testing.T) {
	const src = "<puzzle-view>\n  <Portal><p>hi</p></Portal>\n</puzzle-view>\n<script></script>"

	_, err := compileSrcOpts(t, src, Options{Mode: ModeComponent})
	if err == nil {
		t.Fatal("expected a compile error for <Portal> as a component root")
	}
	if !strings.Contains(err.Error(), "cannot be <Portal>") || !strings.Contains(err.Error(), "display: contents") {
		t.Fatalf("error should steer to the wrapper idiom, got: %v", err)
	}
}

func TestPortalAsViewRootAllowed(t *testing.T) {
	const src = "<puzzle-view>\n  <Portal><p>hi</p></Portal>\n</puzzle-view>\n<script></script>"

	if _, err := compileSrcOpts(t, src, Options{Mode: ModeView}); err != nil {
		t.Fatalf("portal-only view should compile, got: %v", err)
	}
}

func TestPortalUnderWrapperComponentRootAllowed(t *testing.T) {
	const src = "<puzzle-view>\n  <div style=\"display: contents\"><Portal><p>hi</p></Portal></div>\n</puzzle-view>\n<script></script>"

	if _, err := compileSrcOpts(t, src, Options{Mode: ModeComponent}); err != nil {
		t.Fatalf("wrapped portal component should compile, got: %v", err)
	}
}
