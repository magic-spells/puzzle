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
}

// Result reports what Generate produced.
type Result struct {
	// Path is the absolute path of the written file.
	Path string
	// Rel is Path relative to the project root (for display).
	Rel string
	// Hint is a non-empty, multi-line instruction when the user must take a
	// manual follow-up step (model registration); empty otherwise.
	Hint string
}

// Generate validates opts, renders the stub, and writes the file. It refuses to
// clobber an existing file unless Force is set.
func Generate(opts Options) (*Result, error) {
	if opts.Root == "" {
		return nil, fmt.Errorf("no project root")
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

	res := &Result{Path: dest, Rel: relOrAbs(opts.Root, dest)}
	if opts.Kind == KindModel {
		res.Hint = modelHint(opts.Name)
	}
	return res, nil
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
// for --path (see Generate). Both sides are made absolute before comparison so an
// absolute --path is caught too; a Rel result of ".." (or "../…") means dest
// escapes the root.
func withinRoot(root, dest string) error {
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return err
	}
	absDest, err := filepath.Abs(dest)
	if err != nil {
		return err
	}
	rel, err := filepath.Rel(absRoot, absDest)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return fmt.Errorf("refusing to write outside the project root: %s (--path is relative to the project root)", dest)
	}
	return nil
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
