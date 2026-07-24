package build

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

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
// collector is shared across rebuilds — that is what makes CSS() reflect the
// current graph (with the plugin's set-or-delete + deleted-file pruning keeping
// it honest as files change; see plugin.CSS).
type WatchBuilder struct {
	root   string
	outdir string
	pl     *plugin.Plugin
	ctx    api.BuildContext

	// prevPublic is the set of dist-relative paths copyPublic wrote on the
	// PREVIOUS Rebuild. Diffing it against the current pass lets the dev loop
	// mirror deletions: a public asset removed mid-session must not linger in
	// dist for the rest of the run (the one-shot build prunes via a full wipe;
	// the incremental path keeps dist warm, so it prunes explicitly). nil before
	// the first Rebuild — nothing is ever pruned on the first pass.
	prevPublic map[string]bool

	// Esbuild contexts freeze Define values when they are created. Track the
	// usage bits baked into ctx so ScanUsage can replace the context only when a
	// source edit changes one of the feature defines.
	definedFlip     bool
	definedHeadTags bool
}

// NewWatchBuilder creates the incremental builder for the app rooted at root
// (the directory containing app/app.js). It validates the entry point and
// constructs (but does not yet run) the esbuild context. Always development
// mode: readable, unminified output.
func NewWatchBuilder(root string) (*WatchBuilder, error) {
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return nil, fmt.Errorf("resolving app root: %w", err)
	}
	entry := filepath.Join(absRoot, "app", "app.js")
	if _, err := os.Stat(entry); err != nil {
		return nil, fmt.Errorf("entry point not found: %s (expected app/app.js under %s)", entry, absRoot)
	}
	outdir := filepath.Join(absRoot, "dist")
	if err := os.MkdirAll(outdir, 0o755); err != nil {
		return nil, fmt.Errorf("creating dist: %w", err)
	}

	pl := plugin.New(absRoot)
	if err := scanUsage(absRoot, pl); err != nil {
		return nil, err
	}
	hasFlip, hasHeadTags := pl.Features()

	// The watch builder is always development (§27, D57): __PUZZLE_DEV__ = true, so
	// the HMR snapshot/restore hooks are live for `puzzle dev`.
	buildOpts := newBundleOptions(absRoot, entry, outdir, pl, true)
	// Metafile carries the module graph's Inputs, used after each rebuild to prune
	// CSS from files no longer imported (see Rebuild → plugin.PruneCSS).
	buildOpts.Metafile = true

	ctx, ctxErr := api.Context(buildOpts)
	if ctxErr != nil {
		return nil, fmt.Errorf("puzzle dev: creating esbuild context: %s", ctxErr.Error())
	}

	return &WatchBuilder{
		root:            absRoot,
		outdir:          outdir,
		pl:              pl,
		ctx:             ctx,
		definedFlip:     hasFlip,
		definedHeadTags: hasHeadTags,
	}, nil
}

// Rebuild runs one incremental esbuild pass (reusing caches) and re-copies the
// static public/ assets. It returns a formatted error if esbuild reports any —
// the JS bundle is written by esbuild directly (Write: true). Styles are NOT
// touched here; the caller composes dist/styles.css from CSS() plus the Tailwind
// layer.
func (b *WatchBuilder) Rebuild() error {
	result := b.ctx.Rebuild()
	if len(result.Errors) > 0 {
		// Failed rebuild: leave the css map untouched so the last-good styles keep
		// being served. Do NOT prune here.
		lines := api.FormatMessages(result.Errors, api.FormatMessagesOptions{
			Kind:          api.ErrorMessage,
			Color:         ui.New(os.Stderr).Enabled(),
			TerminalWidth: 0,
		})
		return fmt.Errorf("puzzle build failed:\n%s", strings.Join(lines, "\n"))
	}
	// Prune CSS by the current module graph BEFORE the caller composes
	// dist/styles.css: a since-un-imported (but still on-disk) .pzl's onLoad never
	// re-runs, so only the metafile reveals that its <style> must be dropped. A
	// malformed/absent metafile is non-fatal — fall back to the os.Stat prune in
	// CSS() rather than fail the rebuild.
	if result.Metafile != "" {
		if keep, err := metafileInputs(result.Metafile); err == nil {
			b.pl.PruneCSS(keep)
		}
	}
	copied, err := copyPublic(b.root, b.outdir)
	if err != nil {
		return fmt.Errorf("copying public assets: %w", err)
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
	return nil
}

// metafileInputs parses an esbuild metafile and returns the set of absolute .pzl
// source paths in the module graph, normalized to match the plugin's css map
// keys (esbuild's resolved args.Path). Metafile input keys are working-directory
// relative; namespaced virtual inputs (the formatter manifest) never end in
// .pzl, so filtering on that suffix drops them. filepath.Abs resolves the
// cwd-relative key against the same working directory esbuild used; PruneCSS
// applies the final symlink normalization on both sides.
func metafileInputs(metafileJSON string) (map[string]bool, error) {
	var mf struct {
		Inputs map[string]json.RawMessage `json:"inputs"`
	}
	if err := json.Unmarshal([]byte(metafileJSON), &mf); err != nil {
		return nil, err
	}
	out := make(map[string]bool, len(mf.Inputs))
	for key := range mf.Inputs {
		if !strings.HasSuffix(key, ".pzl") {
			continue
		}
		abs, err := filepath.Abs(key)
		if err != nil {
			continue
		}
		out[abs] = true
	}
	return out, nil
}

// ScanUsage refreshes the virtual formatter manifest and feature defines. The
// formatter manifest reads plugin state during each Rebuild. Defines are frozen
// into an esbuild context, so replace that context only when either boolean
// changes; ordinary rebuilds keep the incremental graph warm.
func (b *WatchBuilder) ScanUsage() error {
	if err := scanUsage(b.root, b.pl); err != nil {
		return err
	}
	hasFlip, hasHeadTags := b.pl.Features()
	if hasFlip == b.definedFlip && hasHeadTags == b.definedHeadTags {
		return nil
	}

	buildOpts := newBundleOptions(b.root, filepath.Join(b.root, "app", "app.js"), b.outdir, b.pl, true)
	buildOpts.Metafile = true
	next, err := api.Context(buildOpts)
	if err != nil {
		return fmt.Errorf("puzzle dev: refreshing esbuild context: %s", err.Error())
	}
	if b.ctx != nil {
		b.ctx.Dispose()
	}
	b.ctx = next
	b.definedFlip = hasFlip
	b.definedHeadTags = hasHeadTags
	return nil
}

// CSS returns the collected <style> blocks from the most recent rebuild.
func (b *WatchBuilder) CSS() string { return b.pl.CSS() }

// Dispose releases the esbuild context. After Dispose the builder must not be
// used.
func (b *WatchBuilder) Dispose() {
	if b.ctx != nil {
		b.ctx.Dispose()
	}
}
