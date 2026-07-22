package codegen

// inlinesvg.go — the codegen half of `{#svg 'icons/heart.svg'}` (v1.14, D46).
//
// The parser leaves a *parser.InlineSVG node wherever a {#svg} appeared. Before
// emit, resolveInlineSVG walks the template AST (and, separately, the skeleton
// AST) and replaces each InlineSVG with a plain <svg> Element carrying the
// resolved file's root attributes and its inner markup as a RawInner seed
// string. Emit then produces `new ViewNode('svg', {…fileAttrs}, "<inner>")` —
// island semantics (D44): the root vnode patches, its contents are a verbatim
// string set once via innerHTML at mount and never reconciled.
//
// The path is resolved against the app's assets dir at COMPILE time; the file is
// inert markup (never template-parsed). Every attempted absolute path is recorded
// in `inlined` — even on a read failure — so the plugin can pass them to esbuild
// as WatchFiles and invalidate a cached failure once a missing svg appears.

import (
	"fmt"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"

	"github.com/magic-spells/puzzle/compiler/internal/parser"
)

// pathShapeMsg is the single rejection message for a non-app/assets-relative
// {#svg} path (absolute, "./", "../", or a Clean that escapes the assets dir).
const pathShapeMsg = `src must be a plain app/assets-relative path like "icons/heart.svg" — "./" and "../" are not supported`

// resolveInlineSVG walks nodes in place, replacing every *parser.InlineSVG with a
// resolved <svg> Element (RawInner set). It recurses through element/component
// children, both {#if} branches (which also covers desugared {:else if} chains,
// nested in Else), the {#for} body, and every {#case} clause body + Else. Each
// resolved or attempted absolute file path is appended to *inlined. A validation,
// missing-file, or malformed-svg failure returns a positioned error; *inlined
// still holds whatever was recorded so far.
func (c *compiler) resolveInlineSVG(nodes []parser.Node, assetsDir string, inlined *[]string) error {
	for i := range nodes {
		switch n := nodes[i].(type) {
		case *parser.InlineSVG:
			el, err := c.resolveOneSVG(n, assetsDir, inlined)
			if err != nil {
				return err
			}
			nodes[i] = el
		case *parser.Element:
			if err := c.resolveInlineSVG(n.Children, assetsDir, inlined); err != nil {
				return err
			}
		case *parser.Component:
			if err := c.resolveInlineSVG(n.Children, assetsDir, inlined); err != nil {
				return err
			}
		case *parser.If:
			if err := c.resolveInlineSVG(n.Then, assetsDir, inlined); err != nil {
				return err
			}
			if err := c.resolveInlineSVG(n.Else, assetsDir, inlined); err != nil {
				return err
			}
		case *parser.For:
			if err := c.resolveInlineSVG(n.Body, assetsDir, inlined); err != nil {
				return err
			}
		case *parser.Case:
			for _, cl := range n.Clauses {
				if err := c.resolveInlineSVG(cl.Body, assetsDir, inlined); err != nil {
					return err
				}
			}
			if err := c.resolveInlineSVG(n.Else, assetsDir, inlined); err != nil {
				return err
			}
		}
	}
	return nil
}

// resolveOneSVG validates the path shape, reads the file (recording the attempted
// absolute path in *inlined even on failure), scans the single <svg> root, and
// returns the replacement Element. Positioned errors land at the header's path
// literal (SrcPos) except a malformed-file error, which is a *parser.ParseError
// positioned inside the svg file itself (File set) so the build points at the svg.
func (c *compiler) resolveOneSVG(n *parser.InlineSVG, assetsDir string, inlined *[]string) (*parser.Element, error) {
	src := n.Src
	if assetsDir == "" {
		return nil, c.cgErr(n.SrcPos, fmt.Sprintf("cannot inline %q — this project has no app/assets/ directory", src))
	}
	// A backslash is never a legal separator in the documented forward-slash-only
	// app/assets path. Rejecting it up front keeps the traversal posture platform-
	// independent — on Windows `\` IS a separator (so `..\x` would escape the
	// assets dir), and on POSIX it becomes a literal filename byte; neither is what
	// the author meant. Checked before validSVGPath because path.Clean/IsAbs treat
	// '\' as an ordinary character off Windows and would let it slip through.
	if strings.ContainsRune(src, '\\') {
		return nil, c.cgErr(n.SrcPos, `src must use forward slashes — backslashes are not allowed in an app/assets path (write "icons/heart.svg")`)
	}
	if !validSVGPath(src) {
		return nil, c.cgErr(n.SrcPos, pathShapeMsg)
	}

	full := filepath.Join(assetsDir, filepath.FromSlash(src))
	*inlined = append(*inlined, full)

	data, err := os.ReadFile(full)
	if err != nil {
		return nil, c.cgErr(n.SrcPos, fmt.Sprintf("cannot inline %q — no such file at %s ({#svg} paths resolve from app/assets/)", src, full))
	}

	// App-root-relative-looking name so a malformed-file ParseError reads well in
	// the build output (e.g. "app/assets/icons/heart.svg:1:1: …").
	name := "app/assets/" + path.Clean(src)
	attrs, inner, serr := parser.ScanSVGFile(data, name)
	if serr != nil {
		return nil, serr
	}

	seed := inner
	return &parser.Element{Tag: "svg", Attrs: attrs, RawInner: &seed, RawSrc: src, Pos: n.Pos}, nil
}

// validSVGPath reports whether src is a plain, app/assets-relative forward-slash
// path: not absolute, no "./"/"../" prefix, and a Clean that stays inside the
// assets dir.
func validSVGPath(src string) bool {
	if src == "" {
		return false
	}
	if path.IsAbs(src) || filepath.IsAbs(src) {
		return false
	}
	if src == "." || src == ".." {
		return false
	}
	if len(src) >= 2 && src[0] == '.' && (src[1] == '/' || (src[1] == '.' && len(src) >= 3 && src[2] == '/')) {
		return false // "./…" or "../…"
	}
	cleaned := path.Clean(src)
	if cleaned == ".." || len(cleaned) >= 3 && cleaned[:3] == "../" {
		return false
	}
	return true
}

// emitRawSVG emits a resolved {#svg} element. Two emission strategies (v1.14
// D46, dedup amendment):
//
//   - Inline (default; pzlc standalone, no bundler): `new ViewNode('svg',
//     {…attrs}, '<inner>')` — the file's root attrs as the attribute object and
//     its verbatim inner markup as a single JS string literal (island seed). The
//     children argument is a string, not an array — the runtime treats string
//     children as an innerHTML seed that is never reconciled.
//
//   - Dedup (Options.SVGDedup, the esbuild plugin path): the use site becomes a
//     call `__svg_N([key])` to a per-asset shared factory imported once per file
//     from a virtual module keyed by the resolved asset path. esbuild dedups that
//     module across the whole bundle, so each unique icon's markup is stored ONCE
//     instead of at every use site. The factory produces the SAME vnode shape as
//     the inline path (same tag/attrs, same string children, same island freeze);
//     an optional loop `key` is threaded through as the factory argument so
//     `{#svg}` as a `{#for}` body root still reconciles by key.
func (c *compiler) emitRawSVG(el *parser.Element, ind, startCol int, scope map[string]bool) (string, error) {
	if c.svgDedup && el.RawSrc != "" {
		return c.emitSVGRef(el, scope)
	}
	tagStr := "'" + el.Tag + "'"
	multiline, err := c.attrsMultiline(el.Attrs, tagStr, startCol, false, scope, false)
	if err != nil {
		return "", err
	}
	attrsSeg, err := c.emitAttrs(el.Attrs, ind, multiline, scope, false)
	if err != nil {
		return "", err
	}
	return "new ViewNode(" + tagStr + ", " + attrsSeg + ", " + jsString(*el.RawInner) + ")", nil
}

// emitSVGRef emits the dedup use site `__svg_N([key])`. It registers the asset's
// src → local import identifier (first-seen order, later emitted as a module-top
// import), and threads any injected loop `key` DynamicAttr through as the factory
// argument. The file's own (static) attrs live in the shared module, not here, so
// they are stored once regardless of use count.
func (c *compiler) emitSVGRef(el *parser.Element, scope map[string]bool) (string, error) {
	ident := c.svgImportIdent(el.RawSrc)

	// The only dynamic attr a resolved {#svg} element can carry is the synthetic
	// loop `key` prepended by forBody; the file's own attrs are all static and
	// belong to the shared module. Pull the key out as the factory argument.
	keyArg := ""
	for _, a := range el.Attrs {
		if d, ok := a.(*parser.DynamicAttr); ok && d.Name == "key" {
			keyArg = resolveExpr(d.Expr, scope)
			break
		}
	}
	return ident + "(" + keyArg + ")", nil
}

// svgImportIdent returns the stable local identifier for an asset src, allocating
// one (and recording the src in first-seen order) on first use so compile() can
// emit exactly one import per unique asset per module.
func (c *compiler) svgImportIdent(src string) string {
	if id, ok := c.svgIdent[src]; ok {
		return id
	}
	if c.svgIdent == nil {
		c.svgIdent = map[string]string{}
	}
	id := fmt.Sprintf("__svg_%d", len(c.svgOrder))
	c.svgIdent[src] = id
	c.svgOrder = append(c.svgOrder, src)
	return id
}

// SVGAssetSpecifierPrefix is the import-specifier prefix for a {#svg} shared
// asset module: the use-site import is `<prefix><app/assets-relative src>` (e.g.
// "@magic-spells/puzzle/svg-asset/icons/heart.svg"). The esbuild plugin owns
// resolving it to the file on disk and serving the factory module (dedup mode);
// pzlc standalone never emits it (it inlines).
const SVGAssetSpecifierPrefix = "@magic-spells/puzzle/svg-asset/"

// emitSVGImports returns the module-top import lines for every asset referenced
// in dedup mode, in first-seen order (empty when none / inline mode).
func (c *compiler) emitSVGImports() string {
	if len(c.svgOrder) == 0 {
		return ""
	}
	var b strings.Builder
	for _, src := range c.svgOrder {
		b.WriteString("import ")
		b.WriteString(c.svgIdent[src])
		b.WriteString(" from '")
		b.WriteString(SVGAssetSpecifierPrefix)
		b.WriteString(src)
		b.WriteString("';\n")
	}
	return b.String()
}

// SVGAssetModule builds the JS source of a shared {#svg} asset module from a
// resolved SVG file's bytes: it scans the single <svg> root (same ScanSVGFile the
// inline path uses, so the vnode is identical) and emits a factory that returns a
// fresh island-frozen `<svg>` vnode on each call. viewNodeImport is the module
// specifier to import ViewNode from (the runtime's index). filename positions any
// malformed-file error inside the svg. The factory takes an optional `key` so a
// dedup use site inside a {#for} still reconciles by key.
func SVGAssetModule(data []byte, filename, viewNodeImport string) (string, error) {
	attrs, inner, err := parser.ScanSVGFile(data, filename)
	if err != nil {
		return "", err
	}
	c := &compiler{file: filename}
	attrsLit, err := c.svgAttrsLiteral(attrs)
	if err != nil {
		return "", err
	}
	var b strings.Builder
	b.WriteString("import { ViewNode } from ")
	b.WriteString(jsString(viewNodeImport))
	b.WriteString(";\n")
	b.WriteString("const __a = ")
	b.WriteString(attrsLit)
	b.WriteString(";\n")
	b.WriteString("const __s = ")
	b.WriteString(jsString(inner))
	b.WriteString(";\n")
	b.WriteString("export default function (key) {\n")
	b.WriteString("  return new ViewNode('svg', key === undefined ? __a : { ...__a, key }, __s);\n")
	b.WriteString("}\n")
	return b.String(), nil
}

// svgAttrsLiteral renders a resolved SVG root's attributes as a single-line JS
// object literal for the shared module. SVG file attrs are all static, but attrKV
// handles every attr kind (with an empty scope, since no expressions occur).
func (c *compiler) svgAttrsLiteral(attrs []parser.Attr) (string, error) {
	if len(attrs) == 0 {
		return "{}", nil
	}
	scope := map[string]bool{}
	parts := make([]string, 0, len(attrs))
	for _, a := range attrs {
		kv, err := c.attrKV(a, scope, false, true)
		if err != nil {
			return "", err
		}
		parts = append(parts, kv)
	}
	return "{ " + strings.Join(parts, ", ") + " }", nil
}

// uniqueSorted dedupes and sorts absolute inlined-file paths for the Result.
func uniqueSorted(in []string) []string {
	if len(in) == 0 {
		return nil
	}
	seen := make(map[string]bool, len(in))
	out := make([]string, 0, len(in))
	for _, s := range in {
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	sort.Strings(out)
	return out
}
