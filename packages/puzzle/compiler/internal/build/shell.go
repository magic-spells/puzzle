package build

import (
	"encoding/json"
	"fmt"
	"html"
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
// may contain >, so a tag ends at the first unquoted >.
var shellTagRE = regexp.MustCompile(`(?i)<(script|link)(?:\s+(?:[^"'<>]|"[^"]*"|'[^']*')*)?/?>`)
var shellAttrRE = regexp.MustCompile("(\\s+)([^\\s=<>/]+)(?:\\s*=\\s*(\"[^\"]*\"|'[^']*'|[^\\s\"'=<>`]+))?")
var headEndRE = regexp.MustCompile(`(?i)</head\s*>`)

func attrValue(raw string) string {
	if len(raw) >= 2 && (raw[0] == '"' || raw[0] == '\'') {
		return raw[1 : len(raw)-1]
	}
	return raw
}

// shellReference recognizes just the three supported local spellings. A base
// path, vendor file or remote URL is never a reference to compiler output.
func shellReference(value string) (prefix, name, suffix string) {
	if i := strings.IndexAny(value, "?#"); i >= 0 {
		suffix, value = value[i:], value[:i]
	}
	if strings.HasPrefix(value, "./") {
		prefix, value = "./", value[2:]
	} else if strings.HasPrefix(value, "/") {
		prefix, value = "/", value[1:]
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
func rewriteShellHTML(source string, renames map[string]string, chunks []string) (string, bool, error) {
	entryFound := false
	var entryPrefix, crossorigin string
	rewritten := shellTagRE.ReplaceAllStringFunc(source, func(tag string) string {
		isScript := strings.EqualFold(shellTagRE.FindStringSubmatch(tag)[1], "script")
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
			prefix, name, suffix := shellReference(attrValue(raw))
			if isScript && strings.EqualFold(attr, "src") && name == "app.js" && !entryFound {
				entryFound, entryPrefix, crossorigin = true, prefix, tagCrossorigin
			}
			if replacement, ok := renames[name]; ok {
				value := prefix + replacement + suffix
				if raw[0] == '"' || raw[0] == '\'' {
					value = raw[:1] + value + raw[:1]
				}
				tag = tag[:a[6]] + value + tag[a[7]:]
			}
		}
		return tag
	})
	if !entryFound {
		chunks = nil
	}
	rewritten, err := insertModulepreloads(rewritten, entryPrefix, chunks, crossorigin)
	return rewritten, entryFound, err
}

func insertModulepreloads(source, prefix string, chunks []string, crossorigin string) (string, error) {
	end := headEndRE.FindStringIndex(source)
	if end == nil {
		return "", fmt.Errorf("inserting modulepreload links: missing </head>")
	}
	if len(chunks) == 0 {
		return source, nil
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

func rewriteShell(staging, metafile, stylesheet, entryPoint string, hashEntry, preload bool) error {
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
	rewritten, entryFound, err := rewriteShellHTML(string(source), renames, chunks)
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
