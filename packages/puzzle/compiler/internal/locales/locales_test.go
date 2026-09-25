package locales

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/compiler/internal/config"
)

// writeLocales creates app/locales/<name> for each entry of files in a fresh root.
func writeLocales(t *testing.T, files map[string]string) string {
	t.Helper()
	root := t.TempDir()
	dir := filepath.Join(root, "app", "locales")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	for name, body := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

func cfg(def string, locales ...string) *config.I18n {
	return &config.I18n{Locales: locales, DefaultLocale: def}
}

// table decodes one emitted locale file.
func table(t *testing.T, res *Result, tag string) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal(res.Files[res.Manifest.Paths[tag]], &out); err != nil {
		t.Fatalf("emitted %s table is not JSON: %v", tag, err)
	}
	return out
}

func TestLoadFlattensNestingAndKeepsPlurals(t *testing.T) {
	root := writeLocales(t, map[string]string{
		"en.json": `{
  "cart": {
    "title": "Your cart",
    "empty": "Your cart is empty.",
    "item_count": { "one": "{count} item", "other": "{count} items" }
  },
  "greeting": "Hello, {name}!",
  "nav.home": "Home"
}`,
	})
	res, err := Load(root, cfg("en", "en"))
	if err != nil {
		t.Fatal(err)
	}
	got := table(t, res, "en")
	want := map[string]any{
		"cart.title":      "Your cart",
		"cart.empty":      "Your cart is empty.",
		"cart.item_count": map[string]any{"one": "{count} item", "other": "{count} items"},
		"greeting":        "Hello, {name}!",
		"nav.home":        "Home",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("table = %#v\nwant %#v", got, want)
	}
	if len(res.Warnings) != 0 {
		t.Fatalf("unexpected warnings: %v", res.Warnings)
	}
	if !res.DefaultKeys["cart.item_count"] || !res.DefaultKeys["nav.home"] {
		t.Fatalf("DefaultKeys = %v", res.DefaultKeys)
	}
}

func TestLoadEmitsMinifiedHashedFilesAndManifest(t *testing.T) {
	root := writeLocales(t, map[string]string{
		"en.json": `{ "a": "A", "b": "B" }`,
		"es.json": `{ "a": "Á", "b": "Bé" }`,
	})
	res, err := Load(root, cfg("en", "en", "es"))
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Files) != 2 {
		t.Fatalf("expected one file per locale, got %d", len(res.Files))
	}
	name := regexp.MustCompile(`^locales/(en|es)\.[A-Z2-7]{8}\.json$`)
	for _, tag := range []string{"en", "es"} {
		rel := res.Manifest.Paths[tag]
		if !name.MatchString(rel) || !strings.HasPrefix(rel, "locales/"+tag+".") {
			t.Fatalf("%s path %q is not locales/<tag>.<hash>.json", tag, rel)
		}
	}
	if got := string(res.Files[res.Manifest.Paths["en"]]); got != `{"a":"A","b":"B"}` {
		t.Fatalf("en file not minified/sorted: %s", got)
	}
	js := res.Manifest.JS()
	wantJS := `export default {"defaultLocale":"en","locales":{"en":"` + res.Manifest.Paths["en"] + `","es":"` + res.Manifest.Paths["es"] + `"}};` + "\n"
	if js != wantJS {
		t.Fatalf("manifest JS = %s\nwant %s", js, wantJS)
	}

	// Stable hashes: the same content always names the same file; a change moves it.
	again, err := Load(root, cfg("en", "en", "es"))
	if err != nil {
		t.Fatal(err)
	}
	if again.Manifest.Paths["en"] != res.Manifest.Paths["en"] {
		t.Fatal("hash is not stable across loads")
	}
	if err := os.WriteFile(filepath.Join(root, "app", "locales", "en.json"), []byte(`{ "a": "A!", "b": "B" }`), 0o644); err != nil {
		t.Fatal(err)
	}
	changed, err := Load(root, cfg("en", "en", "es"))
	if err != nil {
		t.Fatal(err)
	}
	if changed.Manifest.Paths["en"] == res.Manifest.Paths["en"] {
		t.Fatal("an edited file must get a new hash")
	}
	if changed.Manifest.Paths["es"] != res.Manifest.Paths["es"] {
		t.Fatal("an untouched locale must keep its hash")
	}
}

func TestLoadFillsFromDefaultAndWarns(t *testing.T) {
	root := writeLocales(t, map[string]string{
		"en.json": `{ "greeting": "Hello", "nav": { "home": "Home" }, "cart": { "empty": "Empty" } }`,
		"es.json": `{ "greeting": "Hola", "extra": "sobra" }`,
	})
	res, err := Load(root, cfg("en", "en", "es"))
	if err != nil {
		t.Fatal(err)
	}
	es := table(t, res, "es")
	if es["nav.home"] != "Home" || es["cart.empty"] != "Empty" || es["greeting"] != "Hola" {
		t.Fatalf("es not filled from en: %v", es)
	}
	want := []string{
		"es: 2 keys missing, filled from en (cart.empty, nav.home)",
		"es: 1 key not in en (extra) — usually a typo or a stale key",
	}
	if !reflect.DeepEqual(res.Warnings, want) {
		t.Fatalf("warnings = %q\nwant %q", res.Warnings, want)
	}
}

func TestLoadRejections(t *testing.T) {
	cases := []struct {
		name  string
		files map[string]string
		conf  *config.I18n
		want  string
	}{
		{"missing file", map[string]string{"en.json": `{}`}, cfg("en", "en", "es"), `lists "es", but app/locales/es.json does not exist`},
		{"case mismatch hint", map[string]string{"en.json": `{}`, "pt-br.json": `{}`}, cfg("en", "en", "pt-BR"), "rename it to pt-BR.json"},
		{"invalid JSON", map[string]string{"en.json": "{\n  \"a\": \"x\",\n}"}, cfg("en", "en"), "app/locales/en.json:3: invalid JSON"},
		{"not an object", map[string]string{"en.json": `["a"]`}, cfg("en", "en"), "must be a JSON object"},
		{"number value", map[string]string{"en.json": "{\n\"cart\": { \"count\": 3 }\n}"}, cfg("en", "en"), `app/locales/en.json:2: "cart.count": a translation must be a string`},
		{"boolean value", map[string]string{"en.json": `{"a": true}`}, cfg("en", "en"), "got a boolean"},
		{"null value", map[string]string{"en.json": `{"a": null}`}, cfg("en", "en"), "got a null"},
		{"array value", map[string]string{"en.json": `{"a": ["x"]}`}, cfg("en", "en"), "got an array"},
		{"plural without other", map[string]string{"en.json": `{"n": {"one": "1", "few": "f"}}`}, cfg("en", "en"), `"n": a plural entry must have an "other"`},
		{"plural non-string", map[string]string{"en.json": `{"n": {"one": 1, "other": "x"}}`}, cfg("en", "en"), `plural category "one" must be a string`},
		{"flatten collision", map[string]string{"en.json": `{"a.b": "x", "a": {"b": "y"}}`}, cfg("en", "en"), `"a.b" is defined twice (as "a.b" and as "a → b")`},
		{"duplicate key", map[string]string{"en.json": `{"a": "x", "a": "y"}`}, cfg("en", "en"), `"a" is defined twice in the same object`},
		{"underscore file", map[string]string{"en.json": `{}`, "en_US.json": `{}`}, cfg("en", "en"), `use "en-US"`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Load(writeLocales(t, tc.files), tc.conf)
			if err == nil {
				t.Fatal("expected an error")
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("error:\n%s\nshould contain %q", err, tc.want)
			}
		})
	}
}

func TestLoadReportsEveryProblem(t *testing.T) {
	root := writeLocales(t, map[string]string{
		"en.json": `{"a": 1, "b": {"one": "x"}}`,
		"es.json": `{"c": false}`,
	})
	_, err := Load(root, cfg("en", "en", "es"))
	if err == nil {
		t.Fatal("expected an error")
	}
	for _, want := range []string{`"a"`, `"b"`, `"c"`} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error should report %s:\n%s", want, err)
		}
	}
}

func TestLoadPluralRecognition(t *testing.T) {
	// A namespace whose keys are NOT all category names stays a namespace, even if
	// some of its keys are category names.
	root := writeLocales(t, map[string]string{
		"en.json": `{"items": {"one": "an item", "title": "Items"}, "n": {"other": "only other"}}`,
	})
	res, err := Load(root, cfg("en", "en"))
	if err != nil {
		t.Fatal(err)
	}
	got := table(t, res, "en")
	if got["items.one"] != "an item" || got["items.title"] != "Items" {
		t.Fatalf("mixed object must be a namespace: %v", got)
	}
	if !reflect.DeepEqual(got["n"], map[string]any{"other": "only other"}) {
		t.Fatalf("an other-only object is a plural entry: %v", got["n"])
	}
}

func TestLoadWarnsOnUnlistedFile(t *testing.T) {
	root := writeLocales(t, map[string]string{"en.json": `{"a": "b"}`, "fr.json": `{}`, "README.md": "notes"})
	res, err := Load(root, cfg("en", "en"))
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"app/locales/fr.json is not listed in i18n.locales, so it is not emitted"}
	if !reflect.DeepEqual(res.Warnings, want) {
		t.Fatalf("warnings = %q", res.Warnings)
	}
	if len(res.Files) != 1 {
		t.Fatalf("an unlisted locale must not be emitted: %v", res.Manifest.Paths)
	}
}

func TestWriteTo(t *testing.T) {
	root := writeLocales(t, map[string]string{"en.json": `{"a":"A"}`, "es.json": `{"a":"B"}`})
	res, err := Load(root, cfg("en", "en", "es"))
	if err != nil {
		t.Fatal(err)
	}
	for _, atomic := range []bool{false, true} {
		out := t.TempDir()
		if err := res.WriteTo(out, atomic); err != nil {
			t.Fatal(err)
		}
		entries, err := os.ReadDir(filepath.Join(out, "locales"))
		if err != nil {
			t.Fatal(err)
		}
		if len(entries) != 2 {
			t.Fatalf("expected exactly one file per locale, got %d", len(entries))
		}
		data, err := os.ReadFile(filepath.Join(out, filepath.FromSlash(res.Manifest.Paths["en"])))
		if err != nil || string(data) != `{"a":"A"}` {
			t.Fatalf("en file = %q, %v", data, err)
		}
	}
}

func TestLoadWarnsOnEmptyObjects(t *testing.T) {
	root := writeLocales(t, map[string]string{
		"en.json": "{\n  \"cart\": {},\n  \"title\": \"Hi\"\n}",
		"es.json": `{}`,
	})
	res, err := Load(root, cfg("en", "en", "es"))
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(res.Warnings, "\n")
	for _, want := range []string{
		`app/locales/en.json:2: "cart" is an empty object — it defines no keys`,
		`app/locales/es.json is an empty object — it defines no translations`,
	} {
		if !strings.Contains(joined, want) {
			t.Errorf("missing warning %q in:\n%s", want, joined)
		}
	}
	if _, ok := table(t, res, "en")["cart"]; ok {
		t.Fatal("an empty namespace must not become a key")
	}
}
