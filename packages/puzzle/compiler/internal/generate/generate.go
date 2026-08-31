// Package generate scaffolds Puzzle source files — components, views, layouts,
// and models — from frozen-grammar stub templates (constellation/doc/DOC-SPEC.md
// §6, §7, §11). It never parses or rewrites JavaScript (decision D3): the model
// registry (app/models/index.js) is left untouched and the caller prints a hint
// instead. All generated .pzl output is exercised by the repo's own
// parser+codegen in generate_test.go, so a scaffold is guaranteed to compile.
package generate

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// Kind selects which scaffold to emit.
type Kind string

const (
	KindComponent Kind = "component"
	KindView      Kind = "view"
	KindLayout    Kind = "layout"
	KindModel     Kind = "model"
)

// ParseKind maps a CLI type argument to a Kind, or errors with the valid set.
func ParseKind(s string) (Kind, error) {
	switch Kind(s) {
	case KindComponent, KindView, KindLayout, KindModel:
		return Kind(s), nil
	default:
		return "", fmt.Errorf("unknown type %q (expected component, view, layout, or model)", s)
	}
}

// defaultDir is the app-relative output directory for each kind (constellation/doc/DOC-SPEC.md §11).
func (k Kind) defaultDir() string {
	switch k {
	case KindComponent:
		return filepath.Join("app", "components")
	case KindView:
		return filepath.Join("app", "views")
	case KindLayout:
		return filepath.Join("app", "layouts")
	case KindModel:
		return filepath.Join("app", "models")
	default:
		return "app"
	}
}

var (
	pascalCase = regexp.MustCompile(`^[A-Z][A-Za-z0-9]*$`)
	modelName  = regexp.MustCompile(`^[a-z][a-z0-9]*$`)
)

// Options describe one scaffold request.
type Options struct {
	// Root is the project root (holds package.json / puzzle.config.js).
	Root string
	// Kind is the file type to generate.
	Kind Kind
	// Name is the component/view/layout PascalCase name, or the lower-case
	// singular model name.
	Name string
	// Dir overrides the output directory, relative to Root. Empty uses the
	// per-kind default.
	Dir string
	// Force allows overwriting an existing file.
	Force bool
	// Family, when non-empty, scaffolds a component FAMILY (D167): a directory
	// named after Name holding Name.pzl, one .pzl per member, and an index.js
	// barrel. Component kind only.
	Family []string
}

// Result reports what Generate produced.
type Result struct {
	// Path is the absolute path of the written file — the family DIRECTORY for a
	// family scaffold.
	Path string
	// Rel is Path relative to the project root (for display).
	Rel string
	// Files lists every written file relative to the project root, in write
	// order. A single-file scaffold writes exactly one; a family writes the root
	// .pzl, each member .pzl, then index.js.
	Files []string
	// Hint is a non-empty, multi-line instruction when the user must take a
	// manual follow-up step (model registration) or an invocation example (a
	// component family); empty otherwise.
	Hint string
}

// Generate validates opts, renders the stub, and writes the file. It refuses to
// clobber an existing file unless Force is set.
func Generate(opts Options) (*Result, error) {
	if opts.Root == "" {
		return nil, fmt.Errorf("no project root")
	}
	if len(opts.Family) > 0 {
		return generateFamily(opts)
	}

	content, filename, err := render(opts.Kind, opts.Name)
	if err != nil {
		return nil, err
	}

	dir := opts.Dir
	if dir == "" {
		dir = opts.Kind.defaultDir()
	}
	outDir := dir
	if !filepath.IsAbs(outDir) {
		outDir = filepath.Join(opts.Root, dir)
	}
	dest := filepath.Join(outDir, filename)

	// Containment: a relative --path that climbs out ("../../..") or an absolute
	// --path would write outside the project. The --path help text says it is
	// relative to the project root, and the rest of the toolchain (e.g. the dev
	// server's withinDir) keeps writes inside the root — mirror that here.
	if err := withinRoot(opts.Root, dest); err != nil {
		return nil, err
	}

	if !opts.Force {
		if _, err := os.Stat(dest); err == nil {
			rel := relOrAbs(opts.Root, dest)
			return nil, fmt.Errorf("%s already exists (use --force to overwrite)", rel)
		} else if !os.IsNotExist(err) {
			return nil, err
		}
	}

	if err := os.MkdirAll(outDir, 0o755); err != nil {
		return nil, err
	}
	if err := os.WriteFile(dest, []byte(content), 0o644); err != nil {
		return nil, err
	}

	rel := relOrAbs(opts.Root, dest)
	res := &Result{Path: dest, Rel: rel, Files: []string{rel}}
	if opts.Kind == KindModel {
		res.Hint = modelHint(opts.Name)
	}
	return res, nil
}

// markerNames are the reserved capitalized composition markers (D134/D167). A
// family cannot be rooted at one and cannot carry one as a member: the compiler
// resolves those tags itself, so <Slot.Foo> and <Frame.Slot> are compile errors,
// not components.
var markerNames = []string{"Children", "Slot", "Snippet", "Portal"}

func isMarkerName(s string) bool {
	for _, m := range markerNames {
		if s == m {
			return true
		}
	}
	return false
}

// generateFamily scaffolds a component family (D167): a directory named after
// the root component holding Root.pzl, one .pzl per member, and an index.js
// barrel that re-exports the members and hangs them off the root as properties,
// so `import Frame from '@/components/Frame'` makes `<Frame.Wrapper>` resolve.
//
// It is all-or-nothing: every destination is checked for collisions BEFORE the
// first byte is written, so a refused family leaves nothing behind. --force
// overwrites the family's OWN files and never removes anything else already in
// the directory (a hand-written Frame.css or a second family member survives a
// re-scaffold).
func generateFamily(opts Options) (*Result, error) {
	if opts.Kind != KindComponent {
		return nil, fmt.Errorf("--family is only valid for a component (got %s)", opts.Kind)
	}
	if !pascalCase.MatchString(opts.Name) {
		return nil, fmt.Errorf("component name %q must be PascalCase (e.g. UserCard)", opts.Name)
	}
	if isMarkerName(opts.Name) {
		return nil, fmt.Errorf("component family root %q is a reserved composition marker (Children, Slot, Snippet, Portal)", opts.Name)
	}

	seen := map[string]bool{opts.Name: true}
	for _, member := range opts.Family {
		switch {
		case member == "":
			return nil, fmt.Errorf("empty family member name (--family takes a comma-separated list, e.g. --family Wrapper,Content)")
		case !pascalCase.MatchString(member):
			return nil, fmt.Errorf("family member %q must be PascalCase (e.g. Wrapper)", member)
		case isMarkerName(member):
			return nil, fmt.Errorf("family member %q is a reserved composition marker (Children, Slot, Snippet, Portal)", member)
		case member == opts.Name:
			return nil, fmt.Errorf("family member %q collides with the family root", member)
		case seen[member]:
			return nil, fmt.Errorf("duplicate family member %q", member)
		}
		seen[member] = true
	}

	dir := opts.Dir
	if dir == "" {
		dir = opts.Kind.defaultDir()
	}
	outDir := dir
	if !filepath.IsAbs(outDir) {
		outDir = filepath.Join(opts.Root, dir)
	}
	familyDir := filepath.Join(outDir, opts.Name)
	if err := withinRoot(opts.Root, familyDir); err != nil {
		return nil, err
	}

	type pending struct {
		path    string
		content string
	}
	files := []pending{{filepath.Join(familyDir, opts.Name+".pzl"), fill(familyTemplate, opts.Name, "")}}
	for _, member := range opts.Family {
		files = append(files, pending{filepath.Join(familyDir, member+".pzl"), fill(familyTemplate, member, "")})
	}
	files = append(files, pending{filepath.Join(familyDir, "index.js"), familyBarrel(opts.Name, opts.Family)})

	// Pre-flight: containment and collisions for EVERY destination before any
	// write, so a refusal never leaves a half-scaffolded family behind.
	for _, f := range files {
		if err := withinRoot(opts.Root, f.path); err != nil {
			return nil, err
		}
		if opts.Force {
			continue
		}
		if _, err := os.Stat(f.path); err == nil {
			return nil, fmt.Errorf("%s already exists (use --force to overwrite)", relOrAbs(opts.Root, f.path))
		} else if !os.IsNotExist(err) {
			return nil, err
		}
	}

	if err := os.MkdirAll(familyDir, 0o755); err != nil {
		return nil, err
	}
	written := make([]string, 0, len(files))
	for _, f := range files {
		if err := os.WriteFile(f.path, []byte(f.content), 0o644); err != nil {
			return nil, err
		}
		written = append(written, relOrAbs(opts.Root, f.path))
	}

	return &Result{
		Path:  familyDir,
		Rel:   relOrAbs(opts.Root, familyDir),
		Files: written,
		Hint:  familyHint(opts.Name, opts.Family),
	}, nil
}

// familyBarrel renders the plain-JS index.js that makes the family one import
// (D167). It is ordinary JavaScript the bundler resolves with no framework
// opinions — no registry, no compiler magic.
func familyBarrel(root string, members []string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "import %s from './%s.pzl';\n", root, root)
	for _, m := range members {
		fmt.Fprintf(&b, "import %s from './%s.pzl';\n", m, m)
	}
	b.WriteString("\n")
	fmt.Fprintf(&b, "export { %s };\n", strings.Join(append([]string{root}, members...), ", "))
	fmt.Fprintf(&b, "export default Object.assign(%s, { %s });\n", root, strings.Join(members, ", "))
	return b.String()
}

// familyHint is the invocation example printed after a family is scaffolded:
// one import, dotted tags.
func familyHint(root string, members []string) string {
	inner := root
	if len(members) > 0 {
		inner = root + "." + members[0]
	}
	return "Import the family as one unit:\n" +
		fmt.Sprintf("    import %s from '@/components/%s';\n", root, root) +
		"    // then invoke members with dot notation:\n" +
		fmt.Sprintf("    <%s><%s>…</%s></%s>", root, inner, inner, root)
}

// render returns the file body and base filename for a kind+name, validating the
// name shape for that kind.
func render(kind Kind, name string) (content, filename string, err error) {
	switch kind {
	case KindComponent, KindView, KindLayout:
		if !pascalCase.MatchString(name) {
			return "", "", fmt.Errorf("%s name %q must be PascalCase (e.g. UserCard)", kind, name)
		}
		tmpl := map[Kind]string{
			KindComponent: componentTemplate,
			KindView:      viewTemplate,
			KindLayout:    layoutTemplate,
		}[kind]
		return fill(tmpl, name, ""), name + ".pzl", nil
	case KindModel:
		if !modelName.MatchString(name) {
			return "", "", fmt.Errorf("model name %q must be lower-case and start with a letter (e.g. user)", name)
		}
		return fill(modelTemplate, pascal(name), name), name + ".js", nil
	default:
		return "", "", fmt.Errorf("unknown type %q", kind)
	}
}

// fill substitutes the two placeholders: __NAME__ (the class/component name) and
// __MODEL__ (the lower-case model name, only used by the model template).
func fill(tmpl, name, model string) string {
	s := strings.ReplaceAll(tmpl, "__NAME__", name)
	return strings.ReplaceAll(s, "__MODEL__", model)
}

// pascal upper-cases the first letter of a lower-case model name → its class
// name (user → User).
func pascal(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

// modelHint is the follow-up instruction printed after a model is scaffolded:
// the Go side never edits app/models/index.js (D3), so the user wires it up.
func modelHint(name string) string {
	cls := pascal(name)
	return "Register it in app/models/index.js:\n" +
		fmt.Sprintf("    import %s from './%s.js';\n", cls, name) +
		"    // then add to the registry object:\n" +
		fmt.Sprintf("    %s: %s", name, cls)
}

// withinRoot rejects dest when it resolves outside root — the containment guard
// for --path (see Generate). Both sides are made absolute and symlink-resolved
// before comparison so an absolute --path and an in-project symlink that points
// outside are both caught.
func withinRoot(root, dest string) error {
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return err
	}
	absRoot, err = filepath.EvalSymlinks(absRoot)
	if err != nil {
		return err
	}
	absDest, err := filepath.Abs(dest)
	if err != nil {
		return err
	}
	absDest, err = evalSymlinksAllowMissing(absDest)
	if err != nil {
		return err
	}
	rel, err := filepath.Rel(absRoot, absDest)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return fmt.Errorf("refusing to write outside the project root: %s (--path is relative to the project root)", dest)
	}
	return nil
}

// evalSymlinksAllowMissing resolves the nearest existing ancestor before
// appending a destination's missing tail. Keep this in lockstep with the sibling
// containment helper in internal/pieces, which protects piece destinations and
// registry reads with the same fail-closed behavior for dangling symlinks.
func evalSymlinksAllowMissing(name string) (string, error) {
	current := name
	var missing []string
	for {
		resolved, err := filepath.EvalSymlinks(current)
		if err == nil {
			for i := len(missing) - 1; i >= 0; i-- {
				resolved = filepath.Join(resolved, missing[i])
			}
			return resolved, nil
		}
		if !os.IsNotExist(err) {
			return "", err
		}
		if _, lerr := os.Lstat(current); lerr == nil {
			return "", err
		} else if !os.IsNotExist(lerr) {
			return "", lerr
		}
		parent := filepath.Dir(current)
		if parent == current {
			return "", err
		}
		missing = append(missing, filepath.Base(current))
		current = parent
	}
}

func relOrAbs(root, p string) string {
	if rel, err := filepath.Rel(root, p); err == nil {
		return filepath.ToSlash(rel)
	}
	return p
}

// FindProjectRoot walks up from start (inclusive) until it finds a directory
// holding package.json or puzzle.config.js, stopping at the filesystem root.
func FindProjectRoot(start string) (string, error) {
	dir, err := filepath.Abs(start)
	if err != nil {
		return "", err
	}
	for {
		for _, marker := range []string{"package.json", "puzzle.config.js"} {
			if _, err := os.Stat(filepath.Join(dir, marker)); err == nil {
				return dir, nil
			}
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf("not a Puzzle project (no package.json/puzzle.config.js found)")
		}
		dir = parent
	}
}
