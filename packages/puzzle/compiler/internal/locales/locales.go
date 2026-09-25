// Package locales owns an app's translation files end to end (D175): it reads
// app/locales/<tag>.json for every locale puzzle.config.js configures, validates
// the value rules, flattens nesting to dotted keys, fills each locale's missing
// keys from the default locale, and produces one minified, content-hashed file
// per locale plus the manifest the runtime reads through the virtual module
// `@magic-spells/puzzle/i18n/manifest`.
//
// The browser never parses a nested file and never merges two locales: the table
// it downloads is flat, complete, and already filled. Plural entries — objects
// whose keys are all CLDR plural categories — are the one value that stays an
// object in the emitted table.
package locales

import (
	"bytes"
	"crypto/sha256"
	"encoding/base32"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/magic-spells/puzzle/compiler/internal/config"
	"github.com/magic-spells/puzzle/compiler/internal/fsutil"
)

// DirName is the app-relative source directory, and OutDirName the dist-relative
// output directory. The output name is reserved while i18n is configured.
const (
	DirName    = "app/locales"
	OutDirName = "locales"
)

// pluralCategories are the CLDR plural category names. An object whose keys are
// ALL drawn from this set is a plural entry; any other object is a namespace.
var pluralCategories = map[string]bool{
	"zero": true, "one": true, "two": true, "few": true, "many": true, "other": true,
}

// Manifest is what the runtime needs to find each locale's file.
type Manifest struct {
	DefaultLocale string
	// Order is the configured locale list, in config order.
	Order []string
	// Paths maps each configured tag to its dist-relative file,
	// "locales/<tag>.<hash>.json".
	Paths map[string]string
}

// JS renders the manifest as the virtual module's source. Keys are emitted in
// config order (the runtime's base-language fallback picks the FIRST configured
// tag with a matching base).
func (m Manifest) JS() string {
	var b strings.Builder
	def, _ := json.Marshal(m.DefaultLocale)
	b.WriteString("export default {\"defaultLocale\":")
	b.Write(def)
	b.WriteString(",\"locales\":{")
	for i, tag := range m.Order {
		if i > 0 {
			b.WriteByte(',')
		}
		k, _ := json.Marshal(tag)
		v, _ := json.Marshal(m.Paths[tag])
		b.Write(k)
		b.WriteByte(':')
		b.Write(v)
	}
	b.WriteString("}};\n")
	return b.String()
}

// Result is one successful load.
type Result struct {
	Manifest Manifest
	// Files maps each dist-relative output path to its bytes.
	Files map[string][]byte
	// Warnings are build warnings, one line each, in a stable order.
	Warnings []string
	// DefaultKeys is the default locale's flattened key set, for the build's
	// literal-key check.
	DefaultKeys map[string]bool
}

// SourceDir is the absolute app/locales directory for appRoot.
func SourceDir(appRoot string) string {
	return filepath.Join(appRoot, filepath.FromSlash(DirName))
}

// HasSourceDir reports whether appRoot has an app/locales directory — the
// "locale files without i18n" warning's test.
func HasSourceDir(appRoot string) bool {
	info, err := os.Stat(SourceDir(appRoot))
	return err == nil && info.IsDir()
}

// Load reads, validates, flattens, and fills every configured locale. Every
// problem it can find is reported together, one line per problem, so a
// translator fixing a file sees all of it at once.
func Load(appRoot string, cfg *config.I18n) (*Result, error) {
	if cfg == nil {
		return nil, errors.New("locales.Load: i18n is not configured")
	}
	dir := SourceDir(appRoot)
	var problems []string
	var warnings []string

	// Every *.json file on disk, by exact file stem.
	onDisk := map[string]string{}
	if entries, err := os.ReadDir(dir); err == nil {
		for _, e := range entries {
			if e.IsDir() || filepath.Ext(e.Name()) != ".json" {
				continue
			}
			onDisk[strings.TrimSuffix(e.Name(), ".json")] = filepath.Join(dir, e.Name())
		}
	} else if !os.IsNotExist(err) {
		return nil, fmt.Errorf("reading %s: %w", DirName, err)
	}

	configured := map[string]bool{}
	for _, tag := range cfg.Locales {
		configured[tag] = true
	}
	stems := make([]string, 0, len(onDisk))
	for stem := range onDisk {
		stems = append(stems, stem)
	}
	sort.Strings(stems)
	for _, stem := range stems {
		if configured[stem] {
			continue
		}
		if ok, msg := config.ValidLocaleTag(stem); !ok {
			problems = append(problems, fmt.Sprintf("%s/%s.json: the file name must be a locale tag — %s", DirName, stem, msg))
			continue
		}
		warnings = append(warnings, fmt.Sprintf("%s/%s.json is not listed in i18n.locales, so it is not emitted", DirName, stem))
	}

	tables := map[string]map[string]any{}
	for _, tag := range cfg.Locales {
		path, ok := onDisk[tag]
		if !ok {
			hint := ""
			for stem := range onDisk {
				if strings.EqualFold(stem, tag) {
					hint = fmt.Sprintf(" (found %s/%s.json — rename it to %s.json)", DirName, stem, tag)
				}
			}
			problems = append(problems, fmt.Sprintf("i18n.locales lists %q, but %s/%s.json does not exist%s", tag, DirName, tag, hint))
			continue
		}
		table, errs := parseFile(path, DirName+"/"+tag+".json")
		problems = append(problems, errs...)
		if len(errs) == 0 {
			tables[tag] = table
		}
	}
	if len(problems) > 0 {
		return nil, fmt.Errorf("translations:\n  %s", strings.Join(problems, "\n  "))
	}

	def := cfg.DefaultLocale
	defTable := tables[def]
	res := &Result{
		Manifest:    Manifest{DefaultLocale: def, Order: append([]string(nil), cfg.Locales...), Paths: map[string]string{}},
		Files:       map[string][]byte{},
		DefaultKeys: make(map[string]bool, len(defTable)),
	}
	for key := range defTable {
		res.DefaultKeys[key] = true
	}

	for _, tag := range cfg.Locales {
		table := tables[tag]
		if tag != def {
			var filled, extra []string
			for key, value := range defTable {
				if _, ok := table[key]; !ok {
					table[key] = value
					filled = append(filled, key)
				}
			}
			for key := range table {
				if !res.DefaultKeys[key] {
					extra = append(extra, key)
				}
			}
			if len(filled) > 0 {
				warnings = append(warnings, fmt.Sprintf("%s: %d %s missing, filled from %s (%s)", tag, len(filled), plural(len(filled), "key"), def, keyList(filled)))
			}
			if len(extra) > 0 {
				warnings = append(warnings, fmt.Sprintf("%s: %d %s not in %s (%s) — usually a typo or a stale key", tag, len(extra), plural(len(extra), "key"), def, keyList(extra)))
			}
		}
		data, err := encode(table)
		if err != nil {
			return nil, fmt.Errorf("encoding the %s table: %w", tag, err)
		}
		rel := OutDirName + "/" + tag + "." + contentHash(data) + ".json"
		res.Manifest.Paths[tag] = rel
		res.Files[rel] = data
	}
	res.Warnings = warnings
	return res, nil
}

// WriteTo writes every locale file under dir (a staging tree or the warm dist/).
// atomic selects the temp-file + rename write, for a directory being served. A
// file that already exists is skipped: its name carries its content hash.
func (r *Result) WriteTo(dir string, atomic bool) error {
	if err := os.MkdirAll(filepath.Join(dir, OutDirName), 0o755); err != nil {
		return fmt.Errorf("creating %s: %w", OutDirName, err)
	}
	for rel, data := range r.Files {
		target := filepath.Join(dir, filepath.FromSlash(rel))
		if atomic {
			if fsutil.FileExists(target) {
				continue
			}
			if err := fsutil.WriteFileAtomic(target, data, 0o644); err != nil {
				return fmt.Errorf("writing %s: %w", rel, err)
			}
			continue
		}
		if err := os.WriteFile(target, data, 0o644); err != nil {
			return fmt.Errorf("writing %s: %w", rel, err)
		}
	}
	return nil
}

// ReadDefault returns the default locale's emitted table bytes.
func (r *Result) ReadDefault() []byte {
	return r.Files[r.Manifest.Paths[r.Manifest.DefaultLocale]]
}

// encode writes a flat table as minified JSON with sorted keys (json.Marshal
// sorts map keys), so the bytes — and therefore the hash — depend only on the
// content. HTML escaping is off: the file is fetched as JSON, and the prerender
// escapes the island copy itself (D113).
func encode(table map[string]any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(table); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}

// contentHash is 8 base32 characters of the content's SHA-256 — the same shape
// as esbuild's [hash] in the D160 chunk names.
func contentHash(data []byte) string {
	sum := sha256.Sum256(data)
	return base32.StdEncoding.EncodeToString(sum[:])[:8]
}

func plural(n int, word string) string {
	if n == 1 {
		return word
	}
	return word + "s"
}

// keyList renders a sorted, bounded list of keys for a warning line.
func keyList(keys []string) string {
	sort.Strings(keys)
	const max = 8
	if len(keys) > max {
		return strings.Join(keys[:max], ", ") + fmt.Sprintf(", … %d more", len(keys)-max)
	}
	return strings.Join(keys, ", ")
}

// ---- parsing ----------------------------------------------------------------

// node is one decoded JSON value, keeping object key order and the line each
// key was written on so problems can be positioned by key path and line.
type node struct {
	kind  string // "string", "object", or the JSON type name of anything else
	str   string
	keys  []string
	items map[string]*node
	lines map[string]int
	dup   []string // keys written twice in this object
}

type lineDecoder struct {
	*json.Decoder
	src []byte
}

func (d *lineDecoder) line() int {
	off := int(d.InputOffset())
	if off > len(d.src) {
		off = len(d.src)
	}
	return bytes.Count(d.src[:off], []byte("\n")) + 1
}

// parseFile decodes one locale file and flattens it. It returns every problem
// it found rather than stopping at the first.
func parseFile(path, rel string) (map[string]any, []string) {
	src, err := os.ReadFile(path)
	if err != nil {
		return nil, []string{fmt.Sprintf("%s: %v", rel, err)}
	}
	dec := &lineDecoder{Decoder: json.NewDecoder(bytes.NewReader(src)), src: src}
	root, err := readValue(dec)
	if err == nil {
		if _, extra := dec.Token(); extra != io.EOF {
			err = errors.New("unexpected content after the top-level object")
		}
	}
	if err != nil {
		return nil, []string{fmt.Sprintf("%s:%d: invalid JSON: %v", rel, dec.line(), err)}
	}
	if root.kind != "object" {
		return nil, []string{fmt.Sprintf("%s: a locale file must be a JSON object of keys to strings; got %s", rel, article(root.kind))}
	}
	table := map[string]any{}
	origin := map[string]string{}
	var problems []string
	flatten(rel, root, "", "", table, origin, &problems)
	return table, problems
}

func readValue(dec *lineDecoder) (*node, error) {
	tok, err := dec.Token()
	if err != nil {
		return nil, err
	}
	switch v := tok.(type) {
	case json.Delim:
		switch v {
		case '{':
			n := &node{kind: "object", items: map[string]*node{}, lines: map[string]int{}}
			for dec.More() {
				keyTok, err := dec.Token()
				if err != nil {
					return nil, err
				}
				key, _ := keyTok.(string)
				line := dec.line()
				child, err := readValue(dec)
				if err != nil {
					return nil, err
				}
				if _, seen := n.items[key]; seen {
					n.dup = append(n.dup, key)
					continue
				}
				n.keys = append(n.keys, key)
				n.items[key] = child
				n.lines[key] = line
			}
			if _, err := dec.Token(); err != nil { // '}'
				return nil, err
			}
			return n, nil
		case '[':
			for dec.More() {
				if _, err := readValue(dec); err != nil {
					return nil, err
				}
			}
			if _, err := dec.Token(); err != nil { // ']'
				return nil, err
			}
			return &node{kind: "array"}, nil
		}
		return nil, fmt.Errorf("unexpected %v", v)
	case string:
		return &node{kind: "string", str: v}, nil
	case float64, json.Number:
		return &node{kind: "number"}, nil
	case bool:
		return &node{kind: "boolean"}, nil
	case nil:
		return &node{kind: "null"}, nil
	}
	return nil, fmt.Errorf("unexpected token %v", tok)
}

// flatten walks one object, writing dotted keys into table. origin remembers how
// each flat key was spelled, so a collision can name both spellings.
func flatten(rel string, obj *node, prefix, spelled string, table map[string]any, origin map[string]string, problems *[]string) {
	for _, key := range obj.dup {
		*problems = append(*problems, fmt.Sprintf("%s: %q is defined twice in the same object", rel, join(prefix, key)))
	}
	for _, key := range obj.keys {
		child := obj.items[key]
		flat := join(prefix, key)
		spelling := key
		if spelled != "" {
			spelling = spelled + " → " + key
		}
		where := fmt.Sprintf("%s:%d: %q", rel, obj.lines[key], flat)
		if key == "" {
			*problems = append(*problems, fmt.Sprintf("%s:%d: an empty key is not allowed (under %q)", rel, obj.lines[key], prefix))
			continue
		}
		switch child.kind {
		case "string":
			record(where, flat, spelling, child.str, table, origin, problems)
		case "object":
			if isPluralEntry(child) {
				entry := map[string]string{}
				ok := true
				for _, cat := range child.keys {
					v := child.items[cat]
					if v.kind != "string" {
						*problems = append(*problems, fmt.Sprintf("%s: the plural category %q must be a string; got %s", where, cat, article(v.kind)))
						ok = false
						continue
					}
					entry[cat] = v.str
				}
				if _, has := entry["other"]; !has && ok {
					*problems = append(*problems, fmt.Sprintf("%s: a plural entry must have an \"other\" category (it is the fallback for every count)", where))
					ok = false
				}
				if ok {
					record(where, flat, spelling, entry, table, origin, problems)
				}
				continue
			}
			flatten(rel, child, flat, spelling, table, origin, problems)
		default:
			*problems = append(*problems, fmt.Sprintf("%s: a translation must be a string, a nested object, or a plural entry; got %s", where, article(child.kind)))
		}
	}
}

func record(where, flat, spelling string, value any, table map[string]any, origin map[string]string, problems *[]string) {
	if prev, taken := origin[flat]; taken {
		*problems = append(*problems, fmt.Sprintf("%s is defined twice (as %q and as %q)", where, prev, spelling))
		return
	}
	origin[flat] = spelling
	table[flat] = value
}

// isPluralEntry: a non-empty object whose keys are all CLDR category names.
func isPluralEntry(n *node) bool {
	if len(n.keys) == 0 {
		return false
	}
	for _, key := range n.keys {
		if !pluralCategories[key] {
			return false
		}
	}
	return true
}

func join(prefix, key string) string {
	if prefix == "" {
		return key
	}
	return prefix + "." + key
}

func article(kind string) string {
	switch kind {
	case "array", "object":
		return "an " + kind
	}
	return "a " + kind
}
