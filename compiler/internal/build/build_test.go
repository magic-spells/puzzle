package build

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/compiler/internal/styles"
)

// fakeRunner is a styles.Runner that returns canned CSS instead of shelling out
// to the real Tailwind CLI, so build tests are deterministic and offline-safe.
type fakeRunner struct {
	css        string
	production bool // records the last opts.Production it saw
	called     bool
}

func (f *fakeRunner) Run(opts styles.RunOptions) (string, error) {
	f.called = true
	f.production = opts.Production
	return f.css, nil
}

// exampleRoot locates the in-repo examples/todos relative to this test file
// (compiler/internal/build → ../../../examples/todos).
func exampleRoot(t *testing.T) string {
	t.Helper()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	root := filepath.Clean(filepath.Join(wd, "..", "..", "..", "examples/todos"))
	if _, err := os.Stat(filepath.Join(root, "app", "app.js")); err != nil {
		t.Fatalf("examples/todos not found at %s: %v", root, err)
	}
	return root
}

// TestBuildExample builds the real in-repo examples/todos in development mode.
// Building in place (rather than a temp copy) is deliberate: the
// '@magic-spells/puzzle' alias resolves by walking up to the repo's
// client-runtime, which only exists inside the checkout.
func TestBuildExample(t *testing.T) {
	root := exampleRoot(t)

	// The example declares the Tailwind pipeline (puzzle.config.js), which is
	// unavailable in most CI/offline environments. Inject a fake runner so the
	// test exercises composition, not the real toolchain, and can assert the
	// Tailwind layer lands ahead of the collected <styles> blocks.
	fake := &fakeRunner{css: "/* TAILWIND-LAYER */\n.tw-marker{color:red}"}
	if err := Build(root, Options{Development: true, Runner: fake}); err != nil {
		t.Fatalf("Build failed: %v", err)
	}
	if !fake.called {
		t.Error("expected the Tailwind runner to be invoked (puzzle.config.js declares it)")
	}

	dist := filepath.Join(root, "dist")
	for _, f := range []string{"app.js", "styles.css", "index.html"} {
		if _, err := os.Stat(filepath.Join(dist, f)); err != nil {
			t.Errorf("expected dist/%s: %v", f, err)
		}
	}

	appJS, err := os.ReadFile(filepath.Join(dist, "app.js"))
	if err != nil {
		t.Fatal(err)
	}
	// Development mode leaves identifiers intact, so the render assignment reads
	// literally.
	if !strings.Contains(string(appJS), "TodoHome.prototype.render") {
		t.Errorf("development bundle missing readable 'TodoHome.prototype.render'")
	}

	css, err := os.ReadFile(filepath.Join(dist, "styles.css"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(css), "TAILWIND-LAYER") {
		t.Errorf("styles.css missing the Tailwind layer:\n%s", css)
	}
}

// TestBuildDevDefineDCE proves the __PUZZLE_DEV__ build define drives the
// state-preserving HMR machinery end to end (constellation/doc/DOC-SPEC.md §27, D57): a
// development build (define = true) retains the runtime's HMR sessionStorage key
// (__puzzleHMR); a production build (define = false) lets MinifySyntax dead-code-
// eliminate every DEV-guarded branch, so the key — and the whole devstate module
// — vanish from the bundle. Builds the real examples/todos (which imports the
// runtime, so the guarded code is actually reachable) with a fake Tailwind runner.
func TestBuildDevDefineDCE(t *testing.T) {
	root := exampleRoot(t)
	distApp := filepath.Join(root, "dist", "app.js")

	// Development: the guarded HMR code — and its sessionStorage key — survive.
	if err := Build(root, Options{Development: true, Runner: &fakeRunner{css: "/* tw */"}}); err != nil {
		t.Fatalf("dev Build failed: %v", err)
	}
	devJS, err := os.ReadFile(distApp)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(devJS), "__puzzleHMR") {
		t.Errorf("dev bundle should retain the HMR sessionStorage key (__PUZZLE_DEV__ define = true)")
	}
	if !strings.Contains(string(devJS), "__PUZZLE_APP__") {
		t.Errorf("dev bundle should publish window.__PUZZLE_APP__ (__PUZZLE_DEV__ define = true)")
	}

	// Production: DCE strips every DEV-guarded branch — no __puzzleHMR reaches
	// the bundle (zero production cost).
	if err := Build(root, Options{Development: false, Runner: &fakeRunner{css: "/* tw */"}}); err != nil {
		t.Fatalf("prod Build failed: %v", err)
	}
	prodJS, err := os.ReadFile(distApp)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(prodJS), "__puzzleHMR") {
		t.Errorf("production bundle must DCE the HMR machinery — found __puzzleHMR present")
	}
	// The window publish must fold away too — this specifically guards the
	// INLINE-probe idiom in app.js/PuzzleView.js: a shared `const DEV` does not
	// constant-propagate into class-method scopes and leaves dead `Z && …`
	// guards (with this string) in the bundle. Only the inert empty
	// __devSnapshot METHOD may remain (removing a method changes the class API).
	if strings.Contains(string(prodJS), "__PUZZLE_APP__") {
		t.Errorf("production bundle must DCE the window.__PUZZLE_APP__ publish — inline the __PUZZLE_DEV__ probe, do not hoist it into a const")
	}
}

// writeConsoleFixture writes a minimal throwaway app whose entry contains a
// distinctive top-level console.log, so a production build's console-strip
// behavior can be asserted from dist/app.js. No runtime import (so the
// '@magic-spells/puzzle' alias need not resolve) and no styles.use (so the
// Tailwind runner is never touched). Returns the app root.
func writeConsoleFixture(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	appDir := filepath.Join(root, "app")
	if err := os.MkdirAll(filepath.Join(appDir, "public"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(appDir, "app.js"),
		[]byte("console.log(\"KEEP_ME_MARKER\");\nexport default 1;\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(appDir, "public", "index.html"),
		[]byte("<html><body></body></html>"), 0o644); err != nil {
		t.Fatal(err)
	}
	return root
}

// TestBuildDefaultStripsConsole confirms the unchanged default: a production
// build with no puzzle.config.js drops console.* (api.DropConsole), so the
// distinctive marker vanishes from the bundle.
func TestBuildDefaultStripsConsole(t *testing.T) {
	root := writeConsoleFixture(t)
	if err := Build(root, Options{Development: false}); err != nil {
		t.Fatalf("Build failed: %v", err)
	}
	appJS, err := os.ReadFile(filepath.Join(root, "dist", "app.js"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(appJS), "KEEP_ME_MARKER") {
		t.Errorf("default production build must strip console.* — found the marker present")
	}
}

// TestBuildDropConsoleFalseKeepsConsole proves build.dropConsole: false opts a
// production build out of the console strip: the marker survives. Needs node to
// evaluate puzzle.config.js.
func TestBuildDropConsoleFalseKeepsConsole(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node not on PATH")
	}
	root := writeConsoleFixture(t)
	if err := os.WriteFile(filepath.Join(root, "puzzle.config.js"),
		[]byte("export default { build: { dropConsole: false } };\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := Build(root, Options{Development: false}); err != nil {
		t.Fatalf("Build failed: %v", err)
	}
	appJS, err := os.ReadFile(filepath.Join(root, "dist", "app.js"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(appJS), "KEEP_ME_MARKER") {
		t.Errorf("build.dropConsole: false must keep console.* — the marker was stripped")
	}
}

// errRunner is a styles.Runner that always fails, simulating a declared-but-
// unavailable Tailwind toolchain.
type errRunner struct{ called bool }

func (e *errRunner) Run(styles.RunOptions) (string, error) {
	e.called = true
	return "", errTailwindUnavailable
}

var errTailwindUnavailable = &tailwindError{}

type tailwindError struct{}

func (*tailwindError) Error() string { return "Tailwind CLI could not be run (test)" }

// TestBuildTailwindRunnerErrorFailsBuild proves a declared pipeline is never
// silently skipped: when the runner fails, the whole build fails.
func TestBuildTailwindRunnerErrorFailsBuild(t *testing.T) {
	root := exampleRoot(t)
	fake := &errRunner{}
	err := Build(root, Options{Development: true, Runner: fake})
	if err == nil {
		t.Fatal("expected Build to fail when the Tailwind runner errors")
	}
	if !fake.called {
		t.Error("expected the runner to have been invoked")
	}
	if !strings.Contains(err.Error(), "could not be run") {
		t.Errorf("expected the runner's error to propagate, got: %v", err)
	}
}

// TestBuildProductionRunsTailwindMinified checks the production flag reaches the
// runner (which maps it to --minify).
func TestBuildProductionRunsTailwindMinified(t *testing.T) {
	root := exampleRoot(t)
	fake := &fakeRunner{css: "/* tw */"}
	if err := Build(root, Options{Development: false, Runner: fake}); err != nil {
		t.Fatalf("Build failed: %v", err)
	}
	if !fake.production {
		t.Error("expected production build to request minified Tailwind (opts.Production=true)")
	}
}

// TestBuildNoConfigSkipsRunner confirms an app with no puzzle.config.js never
// touches the runner (or node).
func TestBuildNoConfigSkipsRunner(t *testing.T) {
	// A minimal temp app inside the repo so the runtime alias still resolves:
	// copy the example's app/ shape is overkill — instead build the example
	// after asserting the runner is skipped requires no config. We use a fake
	// runner and assert it is NOT called only when there is no config, so build
	// a throwaway app with just an entry and public dir.
	root := t.TempDir()
	appDir := filepath.Join(root, "app")
	if err := os.MkdirAll(filepath.Join(appDir, "public"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(appDir, "app.js"), []byte("export default 1;\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(appDir, "public", "index.html"), []byte("<html><body></body></html>"), 0o644); err != nil {
		t.Fatal(err)
	}
	fake := &fakeRunner{css: "SHOULD-NOT-APPEAR"}
	if err := Build(root, Options{Development: true, Runner: fake}); err != nil {
		t.Fatalf("Build failed: %v", err)
	}
	if fake.called {
		t.Error("runner must not be invoked when there is no puzzle.config.js")
	}
	css, err := os.ReadFile(filepath.Join(root, "dist", "styles.css"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(css), "SHOULD-NOT-APPEAR") {
		t.Error("styles.css must not contain runner output when no config declares Tailwind")
	}
}

// TestBuildPrunesStaleDist proves a one-shot build starts from a clean dist: a
// file left by a previous build (e.g. a since-removed public asset) is gone
// after the next build, while the current outputs are present.
func TestBuildPrunesStaleDist(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "app")
	if err := os.MkdirAll(filepath.Join(appDir, "public"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(appDir, "app.js"), []byte("export default 1;\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(appDir, "public", "index.html"), []byte("<html><body></body></html>"), 0o644); err != nil {
		t.Fatal(err)
	}

	// First build produces dist/.
	if err := Build(root, Options{Development: true}); err != nil {
		t.Fatalf("first Build failed: %v", err)
	}
	dist := filepath.Join(root, "dist")

	// Simulate an artifact left by a previous build (a removed public asset).
	stale := filepath.Join(dist, "stale-asset.txt")
	if err := os.WriteFile(stale, []byte("stale"), 0o644); err != nil {
		t.Fatal(err)
	}

	// The second build must wipe dist before writing.
	if err := Build(root, Options{Development: true}); err != nil {
		t.Fatalf("second Build failed: %v", err)
	}
	if _, err := os.Stat(stale); !os.IsNotExist(err) {
		t.Errorf("stale file survived rebuild (err=%v)", err)
	}
	for _, f := range []string{"app.js", "styles.css", "index.html"} {
		if _, err := os.Stat(filepath.Join(dist, f)); err != nil {
			t.Errorf("expected dist/%s after rebuild: %v", f, err)
		}
	}
}

func TestSwapOutput(t *testing.T) {
	assertNoOldResidue := func(t *testing.T, root string) {
		t.Helper()
		entries, err := os.ReadDir(root)
		if err != nil {
			t.Fatal(err)
		}
		for _, entry := range entries {
			if strings.HasPrefix(entry.Name(), "dist.old-") {
				t.Errorf("leftover previous-dist directory: %s", entry.Name())
			}
		}
	}

	t.Run("replaces existing dist and removes old sibling", func(t *testing.T) {
		root := t.TempDir()
		dist := filepath.Join(root, "dist")
		staging := filepath.Join(root, ".dist-staging-test")
		if err := os.MkdirAll(dist, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.MkdirAll(staging, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dist, "old.txt"), []byte("old"), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(staging, "new.txt"), []byte("new"), 0o644); err != nil {
			t.Fatal(err)
		}

		if err := swapOutput(staging, dist); err != nil {
			t.Fatalf("swapOutput: %v", err)
		}
		if got, err := os.ReadFile(filepath.Join(dist, "new.txt")); err != nil || string(got) != "new" {
			t.Errorf("dist/new.txt = %q, err=%v", got, err)
		}
		if _, err := os.Stat(filepath.Join(dist, "old.txt")); !os.IsNotExist(err) {
			t.Errorf("old dist contents survived the swap (err=%v)", err)
		}
		assertNoOldResidue(t, root)
	})

	t.Run("first build installs without an old sibling", func(t *testing.T) {
		root := t.TempDir()
		dist := filepath.Join(root, "dist")
		staging := filepath.Join(root, ".dist-staging-test")
		if err := os.MkdirAll(staging, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(staging, "app.js"), []byte("first"), 0o644); err != nil {
			t.Fatal(err)
		}

		if err := swapOutput(staging, dist); err != nil {
			t.Fatalf("swapOutput: %v", err)
		}
		if got, err := os.ReadFile(filepath.Join(dist, "app.js")); err != nil || string(got) != "first" {
			t.Errorf("dist/app.js = %q, err=%v", got, err)
		}
		assertNoOldResidue(t, root)
	})

	t.Run("failed staging rename restores previous dist", func(t *testing.T) {
		root := t.TempDir()
		dist := filepath.Join(root, "dist")
		if err := os.MkdirAll(dist, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dist, "app.js"), []byte("last-good"), 0o644); err != nil {
			t.Fatal(err)
		}

		err := swapOutput(filepath.Join(root, "missing-staging"), dist)
		if err == nil {
			t.Fatal("expected the missing staging rename to fail")
		}
		if got, readErr := os.ReadFile(filepath.Join(dist, "app.js")); readErr != nil || string(got) != "last-good" {
			t.Errorf("previous dist was not restored: %q, err=%v", got, readErr)
		}
		assertNoOldResidue(t, root)
	})
}

// TestBuildFailedCompileLeavesDistIntact proves the staging-then-swap fix: a
// build that fails because a .pzl no longer compiles must leave the PREVIOUS
// good dist/ untouched (previously dist/ was wiped up front, so any compile error
// destroyed the last build and left an empty dist/). No runtime import is needed:
// the failing build fails at the broken .pzl's onLoad, before its generated
// `@magic-spells/puzzle` import is ever resolved.
func TestBuildFailedCompileLeavesDistIntact(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "app")
	if err := os.MkdirAll(filepath.Join(appDir, "public"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(appDir, "public", "index.html"), []byte("<html><body></body></html>"), 0o644); err != nil {
		t.Fatal(err)
	}

	// First build: a runtime-free entry that compiles cleanly and carries a
	// distinctive marker into dist/app.js.
	if err := os.WriteFile(filepath.Join(appDir, "app.js"),
		[]byte("export default \"GOOD_BUILD_MARKER\";\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := Build(root, Options{Development: true}); err != nil {
		t.Fatalf("first Build failed: %v", err)
	}
	dist := filepath.Join(root, "dist")
	before, err := os.ReadFile(filepath.Join(dist, "app.js"))
	if err != nil {
		t.Fatalf("first build produced no dist/app.js: %v", err)
	}
	if !strings.Contains(string(before), "GOOD_BUILD_MARKER") {
		t.Fatalf("first build's dist/app.js missing the marker:\n%s", before)
	}

	// Introduce a .pzl that does not compile (mismatched closing tag) and import
	// it from the entry, then rebuild: the build must FAIL...
	if err := os.WriteFile(filepath.Join(appDir, "Broken.pzl"),
		[]byte("<puzzle-view><div></span></puzzle-view>\n<scripts></scripts>"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(appDir, "app.js"),
		[]byte("import Broken from './Broken.pzl';\nexport default Broken;\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := Build(root, Options{Development: true}); err == nil {
		t.Fatal("expected the rebuild to fail on the broken .pzl")
	}

	// ...and the previous good dist/app.js must be exactly as it was.
	after, err := os.ReadFile(filepath.Join(dist, "app.js"))
	if err != nil {
		t.Fatalf("dist/app.js was destroyed by the failed build: %v", err)
	}
	if string(after) != string(before) {
		t.Errorf("dist/app.js changed despite the build failing:\nbefore=%q\nafter=%q", before, after)
	}

	// The staging dir must be cleaned up on failure (no .dist-staging-* leftovers).
	entries, err := os.ReadDir(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".dist-staging-") {
			t.Errorf("leftover staging dir after failed build: %s", e.Name())
		}
	}
}

// TestBuildRejectsReservedPublicNames proves a root-level public asset whose
// name collides with a compiler output (app.js / app.js.map / styles.css) fails
// the build — the copy would otherwise silently overwrite the bundle/stylesheet.
// Nested occurrences and other assets (index.html) stay allowed.
func TestBuildRejectsReservedPublicNames(t *testing.T) {
	for _, name := range []string{"app.js", "app.js.map", "styles.css"} {
		t.Run(name, func(t *testing.T) {
			root := t.TempDir()
			publicDir := filepath.Join(root, "app", "public")
			if err := os.MkdirAll(publicDir, 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(root, "app", "app.js"), []byte("export default 1;\n"), 0o644); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(publicDir, "index.html"), []byte("<html><body></body></html>"), 0o644); err != nil {
				t.Fatal(err)
			}
			// The offending collision.
			collision := filepath.Join(publicDir, name)
			if err := os.WriteFile(collision, []byte("USER ASSET"), 0o644); err != nil {
				t.Fatal(err)
			}

			err := Build(root, Options{Development: true})
			if err == nil {
				t.Fatalf("expected Build to fail for reserved public asset %q", name)
			}
			// Error must name both the source path and the reserved output path.
			if !strings.Contains(err.Error(), collision) {
				t.Errorf("error should name the offending source %q; got: %v", collision, err)
			}
			if !strings.Contains(err.Error(), "dist/"+name) {
				t.Errorf("error should name the reserved output dist/%s; got: %v", name, err)
			}
		})
	}
}

// TestBuildAllowsNestedReservedNames proves a reserved name NESTED under public/
// (public/vendor/app.js) is fine — only the root level of the public tree is
// reserved — and index.html copies normally.
func TestBuildAllowsNestedReservedNames(t *testing.T) {
	root := t.TempDir()
	publicDir := filepath.Join(root, "app", "public")
	vendor := filepath.Join(publicDir, "vendor")
	if err := os.MkdirAll(vendor, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "app", "app.js"), []byte("export default 1;\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(publicDir, "index.html"), []byte("<html><body></body></html>"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(vendor, "app.js"), []byte("nested vendor"), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := Build(root, Options{Development: true}); err != nil {
		t.Fatalf("nested reserved name should be allowed, got: %v", err)
	}
	dist := filepath.Join(root, "dist")
	// index.html copied, nested vendor/app.js copied verbatim, compiler app.js present.
	if _, err := os.Stat(filepath.Join(dist, "index.html")); err != nil {
		t.Errorf("index.html was not copied: %v", err)
	}
	nested, err := os.ReadFile(filepath.Join(dist, "vendor", "app.js"))
	if err != nil {
		t.Fatalf("nested vendor/app.js not copied: %v", err)
	}
	if string(nested) != "nested vendor" {
		t.Errorf("nested vendor/app.js corrupted: %q", nested)
	}
	if _, err := os.Stat(filepath.Join(dist, "app.js")); err != nil {
		t.Errorf("compiler dist/app.js missing: %v", err)
	}
}

// TestValidatePublicReservedNamesCaseInsensitive proves the reserved-name check
// folds case: on the case-insensitive filesystems macOS/Windows default to, a
// public/App.js or STYLES.CSS would still clobber the compiler's dist/app.js /
// dist/styles.css, so it must be rejected — while the message keeps the user's
// actual filename. ValidatePublic is exercised directly so the assertion holds on
// a case-sensitive CI filesystem too (the fold is in the lookup, not the FS).
func TestValidatePublicReservedNamesCaseInsensitive(t *testing.T) {
	for _, name := range []string{"App.js", "APP.JS", "Styles.css", "STYLES.CSS", "App.js.map"} {
		t.Run(name, func(t *testing.T) {
			root := t.TempDir()
			publicDir := filepath.Join(root, "app", "public")
			if err := os.MkdirAll(publicDir, 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(publicDir, name), []byte("USER ASSET"), 0o644); err != nil {
				t.Fatal(err)
			}
			err := ValidatePublic(root)
			if err == nil {
				t.Fatalf("expected %q to be rejected as a reserved output name", name)
			}
			// The message keeps the user's actual (original-case) filename.
			if !strings.Contains(err.Error(), name) {
				t.Errorf("error should name the user's file %q; got: %v", name, err)
			}
		})
	}
}

// TestBuildReservedCollisionLeavesDistIntact proves the validation runs BEFORE
// dist/ is pruned: a collision introduced after a good build must NOT destroy the
// last successful output.
func TestBuildReservedCollisionLeavesDistIntact(t *testing.T) {
	root := t.TempDir()
	publicDir := filepath.Join(root, "app", "public")
	if err := os.MkdirAll(publicDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "app", "app.js"), []byte("export default 1;\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(publicDir, "index.html"), []byte("<html><body></body></html>"), 0o644); err != nil {
		t.Fatal(err)
	}

	// First build succeeds and populates dist/.
	if err := Build(root, Options{Development: true}); err != nil {
		t.Fatalf("first Build failed: %v", err)
	}
	dist := filepath.Join(root, "dist")
	before, err := os.ReadFile(filepath.Join(dist, "app.js"))
	if err != nil {
		t.Fatalf("first build produced no dist/app.js: %v", err)
	}

	// Introduce a collision, then rebuild: it must fail WITHOUT wiping dist/.
	if err := os.WriteFile(filepath.Join(publicDir, "styles.css"), []byte(".user{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := Build(root, Options{Development: true}); err == nil {
		t.Fatal("expected the second Build to fail on the styles.css collision")
	}
	after, err := os.ReadFile(filepath.Join(dist, "app.js"))
	if err != nil {
		t.Fatalf("dist/app.js was destroyed by a failed build: %v", err)
	}
	if string(after) != string(before) {
		t.Errorf("dist/app.js changed despite the build failing:\nbefore=%q\nafter=%q", before, after)
	}
}

// TestPublicDir proves the exported resolver `puzzle dev` uses to decide which
// public tree to watch: app/public wins over a root-level public/, a root-level
// public/ is the fallback, and neither present yields "".
func TestPublicDir(t *testing.T) {
	// Both present: app/public wins.
	both := t.TempDir()
	if err := os.MkdirAll(filepath.Join(both, "app", "public"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(both, "public"), 0o755); err != nil {
		t.Fatal(err)
	}
	if got, want := PublicDir(both), filepath.Join(both, "app", "public"); got != want {
		t.Errorf("both present: PublicDir = %q, want %q", got, want)
	}

	// Only a root-level public/: the fallback.
	rootOnly := t.TempDir()
	if err := os.MkdirAll(filepath.Join(rootOnly, "public"), 0o755); err != nil {
		t.Fatal(err)
	}
	if got, want := PublicDir(rootOnly), filepath.Join(rootOnly, "public"); got != want {
		t.Errorf("root-level fallback: PublicDir = %q, want %q", got, want)
	}

	// Neither present: empty.
	if got := PublicDir(t.TempDir()); got != "" {
		t.Errorf("no public dir: PublicDir = %q, want \"\"", got)
	}
}

// TestBuildMissingEntry reports a clear error when app/app.js is absent.
func TestBuildMissingEntry(t *testing.T) {
	root := t.TempDir()
	if err := Build(root, Options{}); err == nil {
		t.Fatal("expected an error for a missing entry point")
	}
}

// TestCLIBuild is one exec-based smoke test of the actual command. Skipped when
// the go toolchain is not on PATH.
func TestCLIBuild(t *testing.T) {
	if _, err := exec.LookPath("go"); err != nil {
		t.Skip("go not on PATH")
	}
	// This goes through the real binary, hence the real Tailwind runner. The
	// example declares Tailwind, so without a working toolchain the build fails
	// by design ("never silently skip a declared pipeline"); skip rather than
	// flag that expected environment gap here.
	if _, err := (styles.NpxRunner{}).Run(styles.RunOptions{AppRoot: t.TempDir()}); err != nil {
		t.Skipf("Tailwind CLI not runnable in this environment: %v", err)
	}
	root := exampleRoot(t)

	// Module root is three levels up from compiler/internal/build.
	wd, _ := os.Getwd()
	moduleDir := filepath.Clean(filepath.Join(wd, "..", "..", ".."))

	cmd := exec.Command("go", "run", "./compiler/cmd/puzzle", "build", root, "--mode", "development")
	cmd.Dir = moduleDir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("puzzle build exited non-zero: %v\n%s", err, out)
	}
	if _, err := os.Stat(filepath.Join(root, "dist", "app.js")); err != nil {
		t.Errorf("CLI build produced no dist/app.js: %v", err)
	}
}
