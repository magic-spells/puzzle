// Package scaffold generates a new Puzzle application from an embedded template
// tree (see templates/). It backs `puzzle init`: it validates the requested app
// name (it becomes an npm package name) and template, refuses to write into a
// non-empty directory, and copies the template's files with the __APP_NAME__
// placeholder substituted.
//
// Templates are real files under templates/<name>/ embedded with go:embed
// (all: so dotfiles like .gitignore are included). Adding a template is a matter
// of dropping a new subtree in; no Go changes are needed beyond registering its
// name in Templates.
package scaffold

import (
	"embed"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/magic-spells/puzzle/compiler/internal/fsutil"
)

//go:embed all:templates
var templatesFS embed.FS

// placeholder is the literal token replaced by the app name on write. It is
// deliberately unlikely to appear in template source for any other reason, so a
// global string replace over each file is safe.
const placeholder = "__APP_NAME__"

// Templates lists the template names `puzzle init` accepts, in menu order. The
// first entry is the default.
var Templates = []string{"default", "todos"}

// DefaultTemplate is used when --template is not given.
const DefaultTemplate = "default"

// appNamePattern constrains the app name: it becomes an npm package name, so it
// is lowercase letters, digits and hyphens, and must start with a letter.
var appNamePattern = regexp.MustCompile(`^[a-z][a-z0-9-]*$`)

// Result reports what Create produced.
type Result struct {
	// Dir is the absolute path of the created app directory.
	Dir string
	// Files are the created files, as slash paths relative to Dir, sorted.
	Files []string
}

// ValidateName reports whether name is an acceptable app / npm package name.
func ValidateName(name string) error {
	if name == "" {
		return fmt.Errorf("app name is required")
	}
	if !appNamePattern.MatchString(name) {
		return fmt.Errorf(
			"invalid app name %q: use lowercase letters, digits and hyphens, starting with a letter (it becomes an npm package name)",
			name,
		)
	}
	return nil
}

// ValidTemplate reports whether name is a known template.
func ValidTemplate(name string) bool {
	for _, t := range Templates {
		if t == name {
			return true
		}
	}
	return false
}

// Create scaffolds template into parentDir/appName and returns what it wrote.
//
//   - parentDir defaults to the current directory when empty.
//   - The target dir may not exist, or exist and be empty; a non-empty target
//     is refused.
//   - appName is validated (npm package name); template must be known.
func Create(parentDir, appName, template string) (*Result, error) {
	if err := ValidateName(appName); err != nil {
		return nil, err
	}
	if template == "" {
		template = DefaultTemplate
	}
	if !ValidTemplate(template) {
		return nil, fmt.Errorf("unknown template %q (available: %s)", template, strings.Join(Templates, ", "))
	}

	if parentDir == "" {
		parentDir = "."
	}
	absParent, err := filepath.Abs(parentDir)
	if err != nil {
		return nil, fmt.Errorf("resolving parent directory: %w", err)
	}
	target := filepath.Join(absParent, appName)

	if err := ensureEmptyTarget(target); err != nil {
		return nil, err
	}

	sub, err := fs.Sub(templatesFS, "templates/"+template)
	if err != nil {
		return nil, fmt.Errorf("loading template %q: %w", template, err)
	}

	var written []string
	walkErr := fs.WalkDir(sub, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if p == "." {
			return nil
		}
		dest := filepath.Join(target, filepath.FromSlash(p))
		if d.IsDir() {
			return os.MkdirAll(dest, 0o755)
		}
		data, err := fs.ReadFile(sub, p)
		if err != nil {
			return err
		}
		data = []byte(strings.ReplaceAll(string(data), placeholder, appName))
		if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
			return err
		}
		if err := fsutil.WriteFileAtomic(dest, data, 0o644); err != nil {
			return err
		}
		written = append(written, filepath.ToSlash(p))
		return nil
	})
	if walkErr != nil {
		return nil, fmt.Errorf("scaffolding %q: %w", template, walkErr)
	}

	sort.Strings(written)
	return &Result{Dir: target, Files: written}, nil
}

// tsconfigJSON is the strict, noEmit tsconfig written by --typescript (v1.22,
// D54). It drives editor type-checking of the app's .ts/.js files only: the
// Puzzle build never runs tsc, and the `include` globs can't reach a .pzl's
// `<script>` body, so those bodies stay transpile-only (D54 never type-checks
// them). `include` picks up the package's shipped `puzzle-env.d.ts` shim so
// `import X from './views/X.pzl'` resolves to a PuzzleView subclass (typed .pzl
// imports), and `paths` mirrors the build's '@' app alias (SPEC §40, D75) so
// '@/models/user.js' type-checks. moduleResolution "bundler" resolves `paths`
// without a `baseUrl`.
const tsconfigJSON = `{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "allowJs": true,
    "esModuleInterop": true,
    "types": [],
    "paths": {
      "@/*": ["./app/*"]
    }
  },
  "include": [
    "app/**/*.ts",
    "app/**/*.js",
    "node_modules/@magic-spells/puzzle/puzzle-env.d.ts"
  ]
}
`

// jsconfigJSON is the editor-only project file written for plain-JS scaffolds. Its
// single job is teaching editors the build's '@' app alias (SPEC §40, D75) so
// '@/components/Card.pzl' resolves for go-to-definition and completion instead of
// showing as unresolved. The Puzzle build never reads it. It is mutually
// exclusive with tsconfig.json (a --typescript app gets that instead, with the
// same `paths` block), because a folder holding both makes editors ignore this
// one.
const jsconfigJSON = `{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "checkJs": false,
    "paths": {
      "@/*": ["./app/*"]
    }
  },
  "include": ["app/**/*.js"]
}
`

// WriteJSConfig writes the editor-only jsconfig.json into an already scaffolded
// app directory, wiring the '@' alias for JS apps (SPEC §40, D75). Like
// WriteTypeScriptConfig it only drops a config file — no user JS is rewritten
// (D3) — and it refuses to overwrite an existing jsconfig.json.
func WriteJSConfig(dir string) ([]string, error) {
	return writeConfigFile(dir, "jsconfig.json", jsconfigJSON)
}

// WriteTypeScriptConfig writes a strict/noEmit tsconfig.json into an already
// scaffolded app directory (v1.22, D54), backing `puzzle init --typescript`. It
// returns the created files as slash paths relative to dir, and is a no-op-safe
// add-on: it never rewrites user JS, only drops the config. It refuses to
// overwrite an existing tsconfig.json.
func WriteTypeScriptConfig(dir string) ([]string, error) {
	return writeConfigFile(dir, "tsconfig.json", tsconfigJSON)
}

// writeConfigFile drops one editor config file into an already scaffolded app,
// refusing to overwrite an existing file of that name. It returns the created
// file as a slash path relative to dir.
func writeConfigFile(dir, name, body string) ([]string, error) {
	dest := filepath.Join(dir, name)
	if _, err := os.Stat(dest); err == nil {
		return nil, fmt.Errorf("%s already exists in %s", name, dir)
	} else if !os.IsNotExist(err) {
		return nil, fmt.Errorf("checking %s: %w", name, err)
	}
	if err := fsutil.WriteFileAtomic(dest, []byte(body), 0o644); err != nil {
		return nil, fmt.Errorf("writing %s: %w", name, err)
	}
	return []string{name}, nil
}

// ensureEmptyTarget creates target if absent and verifies it is empty when it
// already exists. A file at the path, or a non-empty directory, is an error.
func ensureEmptyTarget(target string) error {
	info, err := os.Stat(target)
	if err != nil {
		if os.IsNotExist(err) {
			return os.MkdirAll(target, 0o755)
		}
		return fmt.Errorf("checking target directory: %w", err)
	}
	if !info.IsDir() {
		return fmt.Errorf("cannot create app: %s already exists and is not a directory", target)
	}
	entries, err := os.ReadDir(target)
	if err != nil {
		return fmt.Errorf("reading target directory: %w", err)
	}
	if len(entries) > 0 {
		return fmt.Errorf("cannot create app: directory %s already exists and is not empty", target)
	}
	return nil
}
