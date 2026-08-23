package build

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/evanw/esbuild/pkg/api"
	"github.com/magic-spells/puzzle/compiler/internal/plugin"
	"github.com/magic-spells/puzzle/compiler/internal/ui"
)

// WatchBuilder is the incremental esbuild driver for `puzzle dev` (D27). It
// holds a persistent api.Context so each Rebuild reuses esbuild's parse/resolve
// caches — only changed inputs are re-read — instead of the cold full pass that
// build.Build does for production. It owns ONLY the JS bundle and the static
// public/ copy; the dev loop composes dist/styles.css itself (Tailwind comes
// from the warm --watch child, not a one-shot per rebuild).
//
// The single Plugin instance lives for the context's lifetime, so its <style>
// collector is shared across rebuilds. That live collector is candidate state;
// CSS() exposes only the snapshot promoted after a complete successful rebuild,
// with set-or-delete and graph pruning keeping each candidate honest.
type WatchBuilder struct {
	root   string
	outdir string
	entry  string // app/app.js, or the generated --fixtures wrapper (D98)
	pl     *plugin.Plugin
	ctx    api.BuildContext

	// fixtures is the generated --fixtures wrapper, zero when the flag is off. Its
	// resolver plugin has to be re-registered every time a fresh esbuild context is
	// built (see refreshUsage).
	fixtures    fixturesWrapper
	useFixtures bool

	// prevPublic is the set of dist-relative paths copyPublic wrote on the
	// PREVIOUS Rebuild. Diffing it against the current pass lets the dev loop
	// mirror deletions: a public asset removed mid-session must not linger in
	// dist for the rest of the run (the one-shot build prunes via a full wipe;
	// the incremental path keeps dist warm, so it prunes explicitly). nil before
	// the first Rebuild — nothing is ever pruned on the first pass.
	prevPublic map[string]bool
	// publicSource is the source directory used by the last successful public
	// sync ("" when the project had no public tree). Keeping it separately from
	// publicDir(root)'s current answer is what lets a delete/rename of app/public
	// switch cleanly to the root fallback, and what makes a public tree that
	// APPEARS mid-session sync on the next rebuild: the two disagree, and no
	// changed path need touch either directory.
	publicSource string
	// landed becomes true only after a whole Rebuild succeeds. Until then every
	// attempt retains initial-build behavior, including a full public sync.
	landed bool
	// bundleInputs is the last successful esbuild graph. A public asset normally
	// needs only mirroring, but public/ is still ordinary source on disk and an
	// app may import from it. Only skip esbuild when none of the changed public
	// paths participated in that graph.
	bundleInputs     map[string]bool
	haveBundleInputs bool
	// pendingBundleCommit keeps the public-only shortcut closed when esbuild
	// succeeded but a later public sync failed. The candidate CSS from that pass
	// still needs a complete retry before it can become committed.
	pendingBundleCommit bool

	// splitting is WatchOptions.Splitting, held because it decides both how the
	// esbuild context is configured and whether rebuild writes and prunes the
	// outputs itself.
	splitting bool
	// prevOutputs is the set of dist-relative paths THIS builder wrote on the
	// previous rebuild (splitting only). A one-shot build prunes for free — it
	// stages a fresh tree and swaps it in — but dev keeps dist warm, so every
	// content edit to a lazily imported module re-hashes its chunk and would
	// leave the old file behind forever. Diffing the output set is the dev
	// equivalent of that wipe, and it is deliberately narrow: only paths esbuild
	// reported are candidates, so public-mirrored assets stay prevPublic's job.
	// nil before the first rebuild — nothing is ever pruned on the first pass.
	prevOutputs map[string]bool

	// scanner memoizes the project usage walk per file so an unchanged .pzl is
	// not re-parsed on every rebuild.
	scanner *plugin.UsageScanner

	// Esbuild contexts freeze Define values when they are created. Track the
	// usage bits baked into ctx so refreshUsage can replace the context only when a
	// source edit changes one of the feature defines.
	defined plugin.Features

	// The plugin collector is candidate state: esbuild can successfully run one
	// .pzl onLoad (and mutate that map) before another input fails the rebuild.
	// Tailwind composition must only observe the snapshot promoted after the
	// entire builder rebuild succeeds.
	cssMu                    sync.RWMutex
	committedCSS             string
	committedCSSRevision     uint64
	haveCommittedCSSSnapshot bool
}

// RebuildResult describes the expensive work an incremental pass actually
// performed. Besides driving stylesheet composition, the metadata gives tests
// and opt-in profiling deterministic evidence that unrelated walks were
// skipped without relying on wall-clock thresholds.
type RebuildResult struct {
	CSSChanged   bool
	UsageScanned bool
	PublicSynced bool
	BundleBuilt  bool
}

// WatchOptions configure the incremental dev builder.
type WatchOptions struct {
	// Splitting mirrors build.splitting (puzzle.config.js) into the dev loop, so
	// a developer sees the same lazy chunks the production build will emit. It
	// also switches this builder off esbuild's own writer — see the prevOutputs
	// field for why.
	Splitting bool
	// Fixtures bundles the generated `--fixtures` wrapper entry instead of
	// app/app.js (D98), installing the fixtures/mock module before the app boots.
	// The wrapper is generated ONCE here, at construction, and left in place for
	// the process lifetime — it lives under <root>/.puzzle/, which is outside every
	// watched directory and pruned from the usage scan, so writing it can never
	// trigger a rebuild.
	Fixtures bool
}

// NewWatchBuilder creates the incremental builder for the app rooted at root
// (the directory containing app/app.js). It validates the entry point and
// constructs (but does not yet run) the esbuild context. Always development
// mode: readable, unminified output.
func NewWatchBuilder(root string, opts WatchOptions) (*WatchBuilder, error) {
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return nil, fmt.Errorf("resolving app root: %w", err)
	}
	entry := filepath.Join(absRoot, "app", "app.js")
	if _, err := os.Stat(entry); err != nil {
		return nil, fmt.Errorf("entry point not found: %s (expected app/app.js under %s)", entry, absRoot)
	}
	var fixtures fixturesWrapper
	if opts.Fixtures {
		// `puzzle dev` has no prerender mode, so the only --fixtures precondition
		// left to check is the config file itself.
		fixtures, err = prepareFixtures(absRoot, "")
		if err != nil {
			return nil, err
		}
		entry = fixtures.Entry
	}
	outdir := filepath.Join(absRoot, "dist")
	if err := os.MkdirAll(outdir, 0o755); err != nil {
		return nil, fmt.Errorf("creating dist: %w", err)
	}

	pl := plugin.New(absRoot)
	// One scanner for the session: the usage walk parses every .pzl in the
	// project, and a dev rebuild changes one of them (plugin.UsageScanner).
	scanner := plugin.NewUsageScanner()
	if _, err := scanUsage(absRoot, pl, scanner); err != nil {
		return nil, err
	}

	// The watch builder is always development (§27, D57): __PUZZLE_DEV__ = true, so
	// the HMR snapshot/restore hooks are live for `puzzle dev`. __PUZZLE_TAKEOVER__
	// is true too — `puzzle dev` has no resolved output mode, and a dev bundle must
	// never be the thing that silently drops a code path.
	ctx, ctxErr := api.Context(watchBundleOptions(absRoot, entry, outdir, pl, opts.Splitting, opts.Fixtures, fixtures))
	if ctxErr != nil {
		return nil, fmt.Errorf("puzzle dev: creating esbuild context: %s", ctxErr.Error())
	}

	return &WatchBuilder{
		root:        absRoot,
		outdir:      outdir,
		entry:       entry,
		pl:          pl,
		ctx:         ctx,
		defined:     pl.Features(),
		scanner:     scanner,
		fixtures:    fixtures,
		useFixtures: opts.Fixtures,
		splitting:   opts.Splitting,
	}, nil
}

// watchBundleOptions assembles the dev context's BuildOptions. Shared by
// construction and refreshUsage's context replacement so a rebuilt context can
// never drift from the original one.
func watchBundleOptions(absRoot, entry, outdir string, pl *plugin.Plugin, splitting, useFixtures bool, fixtures fixturesWrapper) api.BuildOptions {
	buildOpts := newBundleOptions(absRoot, entry, outdir, pl, bundleFlags{Dev: true, Takeover: true, Splitting: splitting})
	// Metafile carries the module graph's Inputs, used after each rebuild to prune
	// CSS from files no longer imported (see Rebuild → plugin.PruneCSS). It is
	// produced regardless of Write.
	buildOpts.Metafile = true
	if splitting {
		// Take over the writing (the same move StaticWatchBuilder.bundlePages
		// makes): esbuild's own writer only ever adds files to the warm dist, and
		// the pruning diff in rebuild needs the output set to compare against.
		buildOpts.Write = false
	}
	if useFixtures {
		buildOpts.Plugins = append(buildOpts.Plugins, fixtures.Plugin())
	}
	return buildOpts
}

// Rebuild runs one incremental esbuild pass (reusing caches). changed is the
// debounced watcher batch: it decides whether project usage and public assets
// can have changed, while esbuild remains responsible for graph invalidation.
//
// The JS bundle is written directly by esbuild (Write: true). Component CSS is
// promoted to the snapshot returned by CSS only after every required step
// succeeds; a failed pass can mutate the plugin's candidate collector, but can
// never expose those bytes to the Tailwind composition path.
func (b *WatchBuilder) Rebuild(changed []string) (RebuildResult, error) {
	return b.rebuild(changed, nil)
}

// RebuildProfile is Rebuild with timings folded into the caller's profile.
// The dev server uses it so startup has one table and each later save has one.
func (b *WatchBuilder) RebuildProfile(changed []string, prof *PhaseProfile) (RebuildResult, error) {
	return b.rebuild(changed, prof)
}

func (b *WatchBuilder) rebuild(changed []string, prof *PhaseProfile) (RebuildResult, error) {
	var out RebuildResult
	currentPublic := publicDir(b.root)
	syncPublic := !b.landed || currentPublic != b.publicSource ||
		pathsTouchDir(changed, currentPublic) || pathsTouchDir(changed, b.publicSource)
	publicOnly := b.landed && !b.pendingBundleCommit && b.haveBundleInputs && len(changed) > 0 &&
		pathsOnlyTouchPublic(changed, currentPublic, b.publicSource) &&
		!pathsTouchInputs(changed, b.bundleInputs)

	if !publicOnly && pathsHavePZL(changed) {
		endScan := prof.Phase("usage scan")
		out.UsageScanned = true
		if err := b.refreshUsage(); err != nil {
			endScan()
			return out, err
		}
		endScan()
	}

	var result api.BuildResult
	if !publicOnly {
		endBundle := prof.Phase("browser bundle")
		result = b.ctx.Rebuild()
		endBundle()
		out.BundleBuilt = true
	}
	if len(result.Errors) > 0 {
		// onLoad callbacks for otherwise-valid files may already have changed the
		// plugin's candidate CSS. Do not prune or promote it: CSS() continues to
		// return the last fully successful snapshot.
		lines := api.FormatMessages(result.Errors, api.FormatMessagesOptions{
			Kind:          api.ErrorMessage,
			Color:         ui.New(os.Stderr).Enabled(),
			TerminalWidth: 0,
		})
		return out, fmt.Errorf("puzzle build failed:\n%s", strings.Join(lines, "\n"))
	}
	if !publicOnly && b.splitting {
		// Write:false is on, so nothing has reached dist yet. Materialize this
		// pass's outputs, then delete whatever the previous pass wrote that this
		// one did not — the re-hashed chunk of an edited lazy module.
		if err := b.writeSplitOutputs(result); err != nil {
			return out, err
		}
	}
	if !publicOnly {
		b.pendingBundleCommit = true
		inputs, err := metafileAllInputs(result.Metafile)
		if err != nil {
			b.bundleInputs = nil
			b.haveBundleInputs = false
		} else {
			b.bundleInputs = inputs
			b.haveBundleInputs = true
		}
	}
	// Prune CSS by the current module graph BEFORE the caller composes
	// dist/styles.css: a since-un-imported (but still on-disk) .pzl's onLoad never
	// re-runs, so only the metafile reveals that its <style> must be dropped. A
	// malformed/absent metafile is non-fatal — fall back to the os.Stat prune in
	// CSS() rather than fail the rebuild.
	metafilePruned := false
	if !publicOnly && result.Metafile != "" {
		if keep, err := metafileInputs(result.Metafile); err == nil {
			b.pl.PruneCSS(keep)
			metafilePruned = true
		}
	}
	if syncPublic {
		endPublic := prof.Phase("public sync")
		copied, err := copyPublic(b.root, b.outdir, copyIntoLiveDist)
		if err != nil {
			endPublic()
			return out, fmt.Errorf("copying public assets: %w", err)
		}
		// Mirror deletions: remove from dist any public file this builder copied on a
		// previous pass but did not copy this pass (deleted or renamed). Only paths
		// copyPublic itself produced are ever candidates, so compiler outputs
		// (app.js, app.js.map, styles.css — never in the copied set) are untouched.
		for rel := range b.prevPublic {
			if copied[rel] {
				continue
			}
			_ = os.Remove(filepath.Join(b.outdir, filepath.FromSlash(rel)))
		}
		b.prevPublic = copied
		b.publicSource = publicDir(b.root)
		out.PublicSynced = true
		endPublic()
	}

	if !publicOnly {
		endCSS := prof.Phase("component css commit")
		out.CSSChanged = b.commitCSS(!metafilePruned)
		endCSS()
		b.pendingBundleCommit = false
	}
	b.landed = true
	return out, nil
}

// writeSplitOutputs materializes a splitting rebuild's outputs into the warm
// dist and prunes the outputs the previous rebuild wrote that this one did not.
// It clones StaticWatchBuilder.bundlePages' write loop, including its refusal to
// write outside the configured outdir.
//
// The prune only ever considers paths THIS builder wrote (prevOutputs), so
// dist/app.js — rewritten every pass — and the public mirror are both safe by
// construction; the only files that can disappear are stale chunks.
func (b *WatchBuilder) writeSplitOutputs(result api.BuildResult) error {
	written := make(map[string]bool, len(result.OutputFiles))
	for _, out := range result.OutputFiles {
		rel, err := filepath.Rel(b.outdir, out.Path)
		if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return fmt.Errorf("puzzle dev: unexpected bundle output path %s", out.Path)
		}
		target := filepath.Join(b.outdir, rel)
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return fmt.Errorf("puzzle dev: creating %s: %w", filepath.Dir(rel), err)
		}
		if err := os.WriteFile(target, out.Contents, 0o644); err != nil {
			return fmt.Errorf("puzzle dev: writing %s: %w", rel, err)
		}
		written[filepath.ToSlash(rel)] = true
	}
	for rel := range b.prevOutputs {
		if written[rel] {
			continue
		}
		_ = os.Remove(filepath.Join(b.outdir, filepath.FromSlash(rel)))
	}
	b.prevOutputs = written
	return nil
}

func pathsHavePZL(changed []string) bool {
	for _, path := range changed {
		if filepath.Ext(path) == ".pzl" {
			return true
		}
	}
	return false
}

func pathsTouchDir(changed []string, dir string) bool {
	for _, path := range changed {
		if pathTouchesDir(path, dir) {
			return true
		}
	}
	return false
}

func pathsOnlyTouchPublic(changed []string, current, previous string) bool {
	for _, path := range changed {
		if !pathTouchesDir(path, current) && !pathTouchesDir(path, previous) {
			return false
		}
	}
	return true
}

func pathTouchesDir(path, dir string) bool {
	if dir == "" {
		return false
	}
	rel, err := filepath.Rel(dir, path)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

func pathsTouchInputs(changed []string, inputs map[string]bool) bool {
	// Both sides go through resolvePath: inputs carry esbuild's spelling of a
	// path (symlinks resolved) and changed carries the watcher's, so a bare
	// filepath.Abs comparison misses under a symlinked root and wrongly skips
	// esbuild for an imported public file.
	for _, path := range changed {
		resolved := resolvePath(path)
		if inputs[resolved] {
			return true
		}
		for input := range inputs {
			if pathTouchesDir(input, resolved) {
				return true
			}
		}
	}
	return false
}

// commitCSS promotes the plugin's candidate CSS to the snapshot safe for
// concurrent Tailwind composition. force covers the malformed/absent metafile
// fallback: CSSSnapshot performs the collector's missing-file prune itself.
func (b *WatchBuilder) commitCSS(force bool) bool {
	revision := b.pl.CSSRevision()
	b.cssMu.RLock()
	have := b.haveCommittedCSSSnapshot
	previousRevision := b.committedCSSRevision
	b.cssMu.RUnlock()
	if have && !force && revision == previousRevision {
		return false
	}

	css, revision := b.pl.CSSSnapshot()
	b.cssMu.Lock()
	changed := !b.haveCommittedCSSSnapshot || css != b.committedCSS
	b.committedCSS = css
	b.committedCSSRevision = revision
	b.haveCommittedCSSSnapshot = true
	b.cssMu.Unlock()
	return changed
}

// metafileInputs parses an esbuild metafile and returns the set of absolute .pzl
// source paths in the module graph, normalized to match the plugin's css map
// keys (esbuild's resolved args.Path). Metafile input keys are working-directory
// relative; namespaced virtual inputs (the formatter manifest) never end in
// .pzl, so filtering on that suffix drops them. metafileAllInputs resolves the
// cwd-relative key against the same working directory esbuild used and
// normalizes symlinks; PruneCSS's own normalization is idempotent over that.
func metafileInputs(metafileJSON string) (map[string]bool, error) {
	all, err := metafileAllInputs(metafileJSON)
	if err != nil {
		return nil, err
	}
	out := make(map[string]bool, len(all))
	for path := range all {
		if strings.HasSuffix(path, ".pzl") {
			out[path] = true
		}
	}
	return out, nil
}

func metafileAllInputs(metafileJSON string) (map[string]bool, error) {
	var mf struct {
		Inputs map[string]json.RawMessage `json:"inputs"`
	}
	if err := json.Unmarshal([]byte(metafileJSON), &mf); err != nil {
		return nil, err
	}
	out := make(map[string]bool, len(mf.Inputs))
	for key := range mf.Inputs {
		out[resolvePath(key)] = true
	}
	return out, nil
}

// refreshUsage refreshes the virtual formatter manifest and feature defines. The
// formatter manifest reads plugin state during each Rebuild. Defines are frozen
// into an esbuild context, so replace that context only when one of the booleans
// changes; ordinary rebuilds keep the incremental graph warm.
func (b *WatchBuilder) refreshUsage() error {
	if _, err := scanUsage(b.root, b.pl, b.scanner); err != nil {
		return err
	}
	features := b.pl.Features()
	if features == b.defined {
		return nil
	}

	next, err := api.Context(watchBundleOptions(b.root, b.entry, b.outdir, b.pl, b.splitting, b.useFixtures, b.fixtures))
	if err != nil {
		return fmt.Errorf("puzzle dev: refreshing esbuild context: %s", err.Error())
	}
	if b.ctx != nil {
		b.ctx.Dispose()
	}
	b.ctx = next
	b.defined = features
	return nil
}

// CSS returns the collected <style> blocks from the most recent fully
// successful rebuild. It is safe to call concurrently with Rebuild from the
// Tailwind output poll; candidate CSS from a failed pass is never observable.
func (b *WatchBuilder) CSS() string {
	b.cssMu.RLock()
	defer b.cssMu.RUnlock()
	return b.committedCSS
}

// Dispose releases the esbuild context. After Dispose the builder must not be
// used.
func (b *WatchBuilder) Dispose() {
	if b.ctx != nil {
		b.ctx.Dispose()
	}
}
