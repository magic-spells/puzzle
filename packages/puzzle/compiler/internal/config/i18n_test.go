package config

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

// TestLoadConfigI18n reads a real i18n block through node (D175).
func TestLoadConfigI18n(t *testing.T) {
	requireNode(t)
	root := writeConfig(t, "export default { i18n: { locales: ['en', 'es', 'pt-BR'], defaultLocale: 'en' } };\n")
	cfg, err := LoadConfig(root)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !cfg.I18nEnabled() {
		t.Fatal("I18nEnabled() = false with an i18n block")
	}
	want := &I18n{Locales: []string{"en", "es", "pt-BR"}, DefaultLocale: "en"}
	if !reflect.DeepEqual(cfg.I18n, want) {
		t.Fatalf("I18n = %+v, want %+v", cfg.I18n, want)
	}
}

func TestI18nAbsentIsDisabled(t *testing.T) {
	cfg, err := validate(rawConfig{})
	if err != nil {
		t.Fatal(err)
	}
	if cfg.I18nEnabled() || cfg.I18n != nil {
		t.Fatal("no i18n block must leave I18n nil")
	}
	cfg, err = validate(rawConfig{I18n: json.RawMessage("null")})
	if err != nil {
		t.Fatal(err)
	}
	if cfg.I18n != nil {
		t.Fatal("i18n: null must read as unset")
	}
}

func TestI18nValidation(t *testing.T) {
	cases := []struct {
		name, raw, want string
	}{
		{"not an object", `"en"`, "i18n must be an object"},
		{"no locales", `{"defaultLocale":"en"}`, "i18n.locales is required"},
		{"locales not array", `{"locales":"en","defaultLocale":"en"}`, "must be an array"},
		{"empty locales", `{"locales":[],"defaultLocale":"en"}`, "at least one locale"},
		{"underscore tag", `{"locales":["en_US"],"defaultLocale":"en_US"}`, `use "en-US"`},
		{"malformed tag", `{"locales":["english!"],"defaultLocale":"en"}`, "not a BCP 47 locale tag"},
		{"duplicate by case", `{"locales":["pt-BR","pt-br"],"defaultLocale":"pt-BR"}`, "same locale"},
		{"no default", `{"locales":["en"]}`, "i18n.defaultLocale is required"},
		{"default key spelled default", `{"locales":["en"],"default":"en"}`, "not default"},
		{"default not string", `{"locales":["en"],"defaultLocale":1}`, "must be a string"},
		{"default not listed", `{"locales":["en","es"],"defaultLocale":"fr"}`, `"fr" is not in i18n.locales`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := validate(rawConfig{I18n: json.RawMessage(tc.raw)})
			if err == nil {
				t.Fatalf("expected an error for %s", tc.raw)
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("error %q should contain %q", err, tc.want)
			}
		})
	}
}

func TestValidLocaleTag(t *testing.T) {
	for _, tag := range []string{"en", "es", "pt-BR", "zh-Hant-TW", "yue", "sr-Latn", "zh-Hant", "es-419",
		"sr-Latn-RS", "de-DE-1996", "ca-ES-valencia", "sl-rozaj-biske", "EN-us", "de-1901", "es-ES", "en-1abc"} {
		if ok, msg := ValidLocaleTag(tag); !ok {
			t.Errorf("%q rejected: %s", tag, msg)
		}
	}
	// Each of these is shaped like a tag but is one Intl throws on — a RangeError
	// at render time in the browser, so the config must refuse it up front.
	for _, tag := range []string{"", "e", "english", "en-", "en--US", "en US", "../en", "en.json",
		"en-12", "en-a", "de-DE-1", "en-US-US", "fr-x", "en-Latn-Latn", "en-1996-1996", "sl-rozaj-ROZAJ",
		"abcd", "abcde", "i-klingon", "en-x-foo", "en-US-u-ca-gregory", "1en", "en-Latn-US-us"} {
		if ok, _ := ValidLocaleTag(tag); ok {
			t.Errorf("%q accepted", tag)
		}
	}
}

// TestValidLocaleTagNamesTheBadSubtag: the message points at the subtag that
// breaks the tag, not just the whole tag.
func TestValidLocaleTagNamesTheBadSubtag(t *testing.T) {
	cases := map[string]string{
		"en-12":        `"12"`,
		"en-US-US":     `"US" appears twice`,
		"de-DE-1":      `"1"`,
		"fr-x":         `"x"`,
		"abcd":         `"abcd"`,
		"en-1996-1996": `"1996" appears twice`,
	}
	for tag, want := range cases {
		ok, msg := ValidLocaleTag(tag)
		if ok || !strings.Contains(msg, want) || !strings.Contains(msg, "not a BCP 47 locale tag") {
			t.Errorf("ValidLocaleTag(%q) = %v, %q; want a message containing %s", tag, ok, msg, want)
		}
	}
}

// TestI18nRouting: routing accepts only 'prefix' (D177), detect is a tri-state
// boolean, and the temporary gate holds prefix routing to output: 'static'.
func TestI18nRouting(t *testing.T) {
	static := json.RawMessage(`"static"`)
	cfg, err := validate(rawConfig{Output: static, I18n: json.RawMessage(`{"locales":["en","es"],"defaultLocale":"en","routing":"prefix","detect":false}`)})
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.I18n.PrefixRouting() || cfg.I18n.Routing != RoutingPrefix {
		t.Fatalf("routing = %q, want prefix", cfg.I18n.Routing)
	}
	if cfg.I18n.Detect == nil || *cfg.I18n.Detect {
		t.Fatalf("detect = %v, want an explicit false", cfg.I18n.Detect)
	}

	cfg, err = validate(rawConfig{I18n: json.RawMessage(`{"locales":["en"],"defaultLocale":"en","routing":null}`)})
	if err != nil {
		t.Fatal(err)
	}
	if cfg.I18n.PrefixRouting() || cfg.I18n.Detect != nil {
		t.Fatalf("absent routing/detect = %+v, want both unset", cfg.I18n)
	}
	if (*I18n)(nil).PrefixRouting() {
		t.Fatal("a nil block must not report prefix routing")
	}

	cases := []struct {
		name, output, raw, want string
	}{
		{"typo", "static", `{"locales":["en"],"defaultLocale":"en","routing":"prefixed"}`, `i18n.routing accepts only 'prefix'; got "prefixed"`},
		{"not a string", "static", `{"locales":["en"],"defaultLocale":"en","routing":true}`, "i18n.routing accepts only 'prefix'; got true"},
		{"detect not boolean", "static", `{"locales":["en"],"defaultLocale":"en","routing":"prefix","detect":"no"}`, "i18n.detect must be a boolean"},
		{"spa gate", "", `{"locales":["en","es"],"defaultLocale":"en","routing":"prefix"}`, "requires output: 'static'"},
		{"hybrid gate", "hybrid", `{"locales":["en","es"],"defaultLocale":"en","routing":"prefix"}`, "not built yet"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			raw := rawConfig{I18n: json.RawMessage(tc.raw)}
			if tc.output != "" {
				raw.Output = json.RawMessage(`"` + tc.output + `"`)
			}
			_, err := validate(raw)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("error = %v, want it to contain %q", err, tc.want)
			}
		})
	}
}

// TestSiteValidation: site is an absolute http(s) origin, trailing slash
// dropped, and anything past the origin is an error (D177).
func TestSiteValidation(t *testing.T) {
	ok := map[string]string{
		`"https://example.com"`:   "https://example.com",
		`"https://example.com/"`:  "https://example.com",
		`"http://localhost:4173"`: "http://localhost:4173",
		`"HTTPS://Example.com"`:   "https://Example.com",
		`null`:                    "",
	}
	for raw, want := range ok {
		cfg, err := validate(rawConfig{Site: json.RawMessage(raw)})
		if err != nil {
			t.Errorf("site %s: unexpected error %v", raw, err)
			continue
		}
		if cfg.Site != want {
			t.Errorf("site %s = %q, want %q", raw, cfg.Site, want)
		}
	}
	bad := map[string]string{
		`1`:                           "site must be a string",
		`"example.com"`:               "absolute http or https origin",
		`"ftp://example.com"`:         "absolute http or https origin",
		`"https://"`:                  "absolute http or https origin",
		`"https://:80"`:               "absolute http or https origin",
		`"https://example.com:"`:      "absolute http or https origin",
		`"https://[]:443"`:            "absolute http or https origin",
		`"/docs"`:                     "absolute http or https origin",
		`"https://example.com/docs"`:  `origin only (got "https://example.com/docs") — write "https://example.com"`,
		`"https://example.com/docs/"`: "origin only",
		`"https://example.com?x=1"`:   "origin only",
		`"https://example.com#top"`:   "origin only",
		`"https://user@example.com"`:  "origin only",
	}
	for raw, want := range bad {
		_, err := validate(rawConfig{Site: json.RawMessage(raw)})
		if err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("site %s: error = %v, want it to contain %q", raw, err, want)
		}
	}
}
