package build

import (
	"encoding/json"
	"fmt"
	"html"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

type bundleImport struct {
	Path     string `json:"path"`
	Kind     string `json:"kind"`
	External bool   `json:"external"`
}

type bundleOutput struct {
	EntryPoint string         `json:"entryPoint"`
	CSSBundle  string         `json:"cssBundle"`
	Imports    []bundleImport `json:"imports"`
}

// Output paths in a metafile use the pass's working directory, not the importing
// file's directory. Normalize them once so both browser passes walk the same
// staging-relative graph, including on macOS where /var aliases /private/var.
func bundleOutputs(metafile, base, staging string) (map[string]bundleOutput, error) {
	var mf struct {
		Outputs map[string]bundleOutput `json:"outputs"`
	}
	if err := json.Unmarshal([]byte(metafile), &mf); err != nil {
		return nil, fmt.Errorf("reading bundle metafile: %w", err)
	}
	staging = resolvePath(staging)
	relative := func(key string) (string, error) {
		if !filepath.IsAbs(key) {
			key = filepath.Join(base, filepath.FromSlash(key))
		}
		rel, err := filepath.Rel(staging, resolvePath(key))
		if err != nil {
			return "", err
		}
		return filepath.ToSlash(rel), nil
	}
	outputs := make(map[string]bundleOutput, len(mf.Outputs))
	for key, output := range mf.Outputs {
		name, err := relative(key)
		if err != nil {
			return nil, err
		}
		if output.CSSBundle != "" {
			output.CSSBundle, err = relative(output.CSSBundle)
			if err != nil {
				return nil, err
			}
		}
		for i := range output.Imports {
			imp := &output.Imports[i]
			if imp.External {
				continue
			}
			imp.Path, err = relative(imp.Path)
			if err != nil {
				return nil, err
			}
		}
		outputs[name] = output
	}
	return outputs, nil
}

// staticImportClosure keeps the import-array order from esbuild's metafile.
// Dynamic imports must stay lazy even when their target shares other chunks.
func staticImportClosure(outputs map[string]bundleOutput, entry string) []string {
	seen := map[string]bool{entry: true}
	queue := []string{entry}
	var chunks []string
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		for _, imp := range outputs[current].Imports {
			if imp.Kind != "import-statement" || imp.External || seen[imp.Path] {
				continue
			}
			seen[imp.Path] = true
			chunks = append(chunks, imp.Path)
			queue = append(queue, imp.Path)
		}
	}
	return chunks
}

// Only start tags participate in reference rewriting. Quoted attribute values
// may contain >, so a tag ends at the first unquoted >. The scan steps over a
// whole <script>…</script> (its body is not markup), then any start tag (its
// quoted values are not markup), then an HTML comment, to its end or the end of
// the shell when unterminated, so the tags inside a comment are left alone.
const shellTagTail = `(?:\s+(?:[^"'<>]|"[^"]*"|'[^']*')*)?/?>`

var shellOpenRE = regexp.MustCompile(`(?i)^<([a-z][^\s/>]*)` + shellTagTail)
var shellTagRE = regexp.MustCompile(`(?i)<script` + shellTagTail + `(?:[\s\S]*?</script\s*>|[\s\S]*$)|<[a-z][^\s/>]*` + shellTagTail + `|<!--[\s\S]*?(?:-->|$)`)
var shellAttrRE = regexp.MustCompile("(\\s+)([^\\s=<>/]+)(?:\\s*=\\s*(\"[^\"]*\"|'[^']*'|[^\\s\"'=<>`]+))?")
var headEndRE = regexp.MustCompile(`(?i)</head\s*>`)

func attrValue(raw string) string {
	if len(raw) >= 2 && (raw[0] == '"' || raw[0] == '\'') {
		return raw[1 : len(raw)-1]
	}
	return raw
}

// Local references may carry a deployment base. Copied public files take
// precedence over compiler filenames, including under that base.
func shellReference(value string, publicFiles map[string]bool) (prefix, name, suffix string) {
	if i := strings.IndexAny(value, "?#"); i >= 0 {
		suffix, value = value[i:], value[:i]
	}
	if strings.HasPrefix(value, "./") {
		prefix, value = "./", value[2:]
	} else if strings.HasPrefix(value, "/") {
		prefix, value = "/", value[1:]
	}
	if strings.HasPrefix(value, "/") || strings.Contains(value, ":") {
		return "", "", ""
	}
	for path := value; path != ""; {
		if publicFiles[path] {
			return "", "", ""
		}
		i := strings.IndexByte(path, '/')
		if i < 0 {
			break
		}
		path = path[i+1:]
	}
	if i := strings.LastIndexByte(value, '/'); i >= 0 {
		prefix, value = prefix+value[:i+1], value[i+1:]
	}
	return prefix, value, suffix
}

func shellRenames(outputs map[string]bundleOutput, stylesheet, entryPoint string) (map[string]string, string) {
	renames := map[string]string{"styles.css": stylesheet}
	for name, output := range outputs {
		if output.EntryPoint == "" || filepath.Ext(name) != ".js" || resolvePath(output.EntryPoint) != resolvePath(entryPoint) {
			continue
		}
		renames["app.js"] = name
		if output.CSSBundle != "" {
			renames["app.css"] = output.CSSBundle
		}
		return renames, name
	}
	return renames, ""
}

// rewriteShellHTML follows emitted filenames and reads the entry tag before
// renaming it, so preload URLs and credentials match the app's own script.
func rewriteShellHTML(source string, renames map[string]string, chunks []string, publicFiles map[string]bool) (string, bool, error) {
	rewritten, entryFound, _, err := rewriteShellHTMLRefs(source, renames, chunks, publicFiles)
	return rewritten, entryFound, err
}

// rewriteShellHTMLRefs is rewriteShellHTML that also reports the compiler
// filenames (app.js, app.css, styles.css) the shell references from a script
// src or link href it can rewrite.
func rewriteShellHTMLRefs(source string, renames map[string]string, chunks []string, publicFiles map[string]bool) (string, bool, map[string]bool, error) {
	entryFound := false
	refs := map[string]bool{}
	var entryPrefix, crossorigin string
	var assetErr error
	rewritten := shellTagRE.ReplaceAllStringFunc(source, func(match string) string {
		open := shellOpenRE.FindStringSubmatchIndex(match)
		if open == nil {
			return match // a comment
		}
		name := match[open[2]:open[3]]
		isScript := strings.EqualFold(name, "script")
		if !isScript && !strings.EqualFold(name, "link") {
			return match
		}
		tag, body := match[:open[1]], match[open[1]:]
		attrs := shellAttrRE.FindAllStringSubmatchIndex(tag, -1)
		var tagCrossorigin string
		for _, a := range attrs {
			if strings.EqualFold(tag[a[4]:a[5]], "crossorigin") {
				tagCrossorigin = tag[a[4]:a[1]]
			}
		}
		// Walk back to front so replacements leave the remaining offsets intact.
		for i := len(attrs) - 1; i >= 0; i-- {
			a := attrs[i]
			attr := tag[a[4]:a[5]]
			if a[6] < 0 || (!strings.EqualFold(attr, "src") && !strings.EqualFold(attr, "href")) {
				continue
			}
			raw := tag[a[6]:a[7]]
			prefix, name, suffix := shellReference(attrValue(raw), publicFiles)
			if name == "app.js" || name == "app.css" || name == "styles.css" {
				refs[name] = true
			}
			if isScript && strings.EqualFold(attr, "src") && name == "app.js" && !entryFound {
				entryFound, entryPrefix, crossorigin = true, prefix, tagCrossorigin
			}
			if replacement, ok := renames[name]; ok {
				value := prefix + replacement + suffix
				if raw[0] == '"' || raw[0] == '\'' {
					value = raw[:1] + value + raw[:1]
				}
				tag = tag[:a[6]] + value + tag[a[7]:]
			} else if renames != nil && (name == "app.js" || name == "app.css" || name == "styles.css") {
				assetErr = fmt.Errorf("shell asset %q has no emitted output", attrValue(raw))
			}
		}
		return tag + body
	})
	if assetErr != nil {
		return "", entryFound, refs, assetErr
	}
	if !entryFound {
		chunks = nil
	}
	rewritten, err := insertModulepreloads(rewritten, entryPrefix, chunks, crossorigin)
	return rewritten, entryFound, refs, err
}

// shellHashSupport reports, before anything is bundled, whether the app's
// public/index.html can follow hashed names: entry when a <script src> loads
// app.js, styles when a <script>/<link> references styles.css. A missing or
// unreadable shell supports neither. Build uses it only when hashing is on by
// default (build.hashNames unset), to fall back to the fixed name for whatever
// the shell cannot follow instead of failing the build.
func shellHashSupport(root string) (entry, styles bool) {
	src := publicDir(root)
	if src == "" {
		return false, false
	}
	source, err := os.ReadFile(filepath.Join(src, "index.html"))
	if err != nil {
		return false, false
	}
	publicFiles := map[string]bool{}
	_ = filepath.WalkDir(src, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if rel, err := filepath.Rel(src, path); err == nil {
			publicFiles[filepath.ToSlash(rel)] = true
		}
		return nil
	})
	// nil renames: nothing is rewritten, only the references are read. The
	// error (a shell with no </head>) is irrelevant to which names it loads.
	_, entry, refs, _ := rewriteShellHTMLRefs(string(source), nil, nil, publicFiles)
	return entry, refs["styles.css"]
}

// hashFallbackWarning is the one-line notice printed when default-on hashing
// keeps a fixed name because the shell cannot reference the hashed one.
func hashFallbackWarning(file, reason string) string {
	return fmt.Sprintf("warning: build.hashNames: %s, so %s keeps its fixed name; set build.hashNames to true or false to choose explicitly\n", reason, file)
}

func insertModulepreloads(source, prefix string, chunks []string, crossorigin string) (string, error) {
	// Nothing to insert needs no </head>: a shell that omits the optional end
	// tag still builds whenever there are no preloads to place.
	if len(chunks) == 0 {
		return source, nil
	}
	end := headEndRE.FindStringIndex(source)
	if end == nil {
		return "", fmt.Errorf("inserting modulepreload links: missing </head>")
	}
	lineStart := strings.LastIndex(source[:end[0]], "\n") + 1
	indent := source[lineStart:end[0]]
	if strings.TrimSpace(indent) != "" {
		lineStart, indent = end[0], ""
	}
	var links strings.Builder
	if lineStart > 0 && source[lineStart-1] != '\n' {
		links.WriteByte('\n')
	}
	for _, chunk := range chunks {
		links.WriteString(indent + `<link rel="modulepreload" href="` + html.EscapeString(prefix+chunk) + `"`)
		if crossorigin != "" {
			links.WriteString(" " + crossorigin)
		}
		links.WriteString(">\n")
	}
	return source[:lineStart] + links.String() + source[lineStart:], nil
}

func rewriteShell(staging, metafile, stylesheet, entryPoint string, hashEntry, preload bool, publicFiles map[string]bool) error {
	shellPath := filepath.Join(staging, "index.html")
	source, err := os.ReadFile(shellPath)
	if os.IsNotExist(err) {
		if !hashEntry {
			return nil
		}
		return fmt.Errorf("reading public/index.html (set build.hashNames: false to keep fixed entry names): %w", err)
	}
	if err != nil {
		return fmt.Errorf("reading public/index.html: %w", err)
	}
	// The browser pass leaves AbsWorkingDir unset, so an empty base means cwd.
	outputs, err := bundleOutputs(metafile, "", staging)
	if err != nil {
		return err
	}
	renames, entry := shellRenames(outputs, stylesheet, entryPoint)
	var chunks []string
	if preload {
		chunks = staticImportClosure(outputs, entry)
	}
	rewritten, entryFound, err := rewriteShellHTML(string(source), renames, chunks, publicFiles)
	if hashEntry && !entryFound {
		return fmt.Errorf("public/index.html must load app.js when entry names are hashed; set build.hashNames: false to keep fixed names")
	}
	if err != nil {
		return fmt.Errorf("rewriting public/index.html: %w", err)
	}
	if err := os.WriteFile(shellPath, []byte(rewritten), 0o644); err != nil {
		return fmt.Errorf("writing rewritten public/index.html: %w", err)
	}
	return nil
}

// The static tag is generated by the prerenderer, so exactly one must exist.
// The base is read from that tag; locale pages can share an entry and still
// carry their own URL prefix.
func rewriteStaticPage(source, entry, output string, chunks []string) (string, error) {
	tagRE := regexp.MustCompile(`<script type="module" src="([^"]*)/` + regexp.QuoteMeta(entry) + `"></script>`)
	matches := tagRE.FindAllStringSubmatchIndex(source, -1)
	if len(matches) != 1 {
		return "", fmt.Errorf("static page entry %s: expected exactly one generated module tag, found %d", entry, len(matches))
	}
	m := matches[0]
	base := source[m[2]:m[3]]
	tag := `<script type="module" src="` + base + "/" + output + `"></script>`
	source = source[:m[0]] + tag + source[m[1]:]
	return insertModulepreloads(source, base+"/", chunks, "")
}
