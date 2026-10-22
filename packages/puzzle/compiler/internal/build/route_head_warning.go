package build

import (
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/magic-spells/puzzle/compiler/internal/config"
)

type routeHeadUsage struct {
	file   string
	key    string
	line   int
	column int
}

// warnDeadSPARouteMeta reports managed route-head fields that cannot produce
// tags in plain SPA output. Go never sees the runtime route objects, so this
// intentionally inspects only conventionally named route modules and only
// literal direct keys inside meta: { ... } objects.
func warnDeadSPARouteMeta(root, mode string, w io.Writer) {
	if mode != "" {
		return
	}
	for _, usage := range findRouteHeadUsages(root) {
		fmt.Fprintf(
			w,
			"%s:%d:%d: warning: route meta.%s has no effect with SPA output; set output: 'hybrid' or 'static' to emit managed head tags at build time\n",
			usage.file,
			usage.line,
			usage.column,
			usage.key,
		)
	}
}

// warnUntranslatedRouteMeta reports a route meta.title or meta.description
// written as translated head text, `{ t: 'key' }` (D177), in a project with no
// i18n block: nothing resolves the key, so the page prerenders without that
// field and the browser leaves the tab title alone, silently. Same literal-only
// lexing as warnDeadSPARouteMeta; it applies in every output mode.
func warnUntranslatedRouteMeta(root string, i18n *config.I18n, w io.Writer) {
	if i18n != nil {
		return
	}
	for _, usage := range findTranslatedRouteMeta(root) {
		value := "{ t: … }"
		if usage.tKey != "" {
			value = "{ t: " + jsQuote(usage.tKey) + " }"
		}
		fmt.Fprintf(
			w,
			"%s:%d:%d: warning: route meta.%s is %s, but %s configures no i18n, so the page gets no %s — add i18n: { locales: ['en'], defaultLocale: 'en' } with app/locales/en.json, or write a plain string\n",
			usage.file,
			usage.line,
			usage.column,
			usage.key,
			value,
			config.ConfigFileName,
			usage.key,
		)
	}
}

// translatedMetaUsage is one `title: { t: … }` / `description: { t: … }` inside
// a route's literal meta object; tKey is the key when it is a plain string.
type translatedMetaUsage struct {
	routeHeadUsage
	tKey string
}

func findTranslatedRouteMeta(root string) []translatedMetaUsage {
	var usages []translatedMetaUsage
	eachRouteModule(root, func(rel string, src []byte) {
		for _, found := range translatedMetaOffsets(src) {
			line, column := lineColumn(src, found.offset)
			usages = append(usages, translatedMetaUsage{
				routeHeadUsage: routeHeadUsage{file: rel, key: found.key, line: line, column: column},
				tKey:           found.tKey,
			})
		}
	})
	return usages
}

type translatedMetaOffset struct {
	offset int
	key    string
	tKey   string
}

// translatedMetaOffsets finds every direct `title` or `description` key of a
// literal meta object whose value is an object literal with a direct `t` key.
func translatedMetaOffsets(src []byte) []translatedMetaOffset {
	tokens := tokenizeRouteModule(src)
	var found []translatedMetaOffset
	for i := 0; i+2 < len(tokens); i++ {
		if !isNamedToken(tokens[i], "meta") || tokens[i+1].text != ":" || tokens[i+2].text != "{" {
			continue
		}
		depth := 1
		for j := i + 3; j < len(tokens) && depth > 0; j++ {
			switch tokens[j].text {
			case "{":
				depth++
				continue
			case "}":
				depth--
				continue
			}
			if depth != 1 || j+2 >= len(tokens) || tokens[j+1].text != ":" || tokens[j+2].text != "{" {
				continue
			}
			key := ""
			for _, name := range []string{"title", "description"} {
				if isNamedToken(tokens[j], name) {
					key = name
				}
			}
			if key == "" {
				continue
			}
			// Inside the value object: a `t` key at its own top level.
			inner := 1
			for k := j + 3; k < len(tokens) && inner > 0; k++ {
				switch tokens[k].text {
				case "{":
					inner++
					continue
				case "}":
					inner--
					continue
				}
				if inner == 1 && isNamedToken(tokens[k], "t") && k+1 < len(tokens) && tokens[k+1].text == ":" {
					tKey := ""
					if k+2 < len(tokens) && tokens[k+2].kind == routeTokenString && k+3 < len(tokens) &&
						(tokens[k+3].text == "}" || tokens[k+3].text == ",") {
						tKey = tokens[k+2].text
					}
					found = append(found, translatedMetaOffset{offset: tokens[j].offset, key: key, tKey: tKey})
					break
				}
			}
		}
	}
	return found
}

func findRouteHeadUsages(root string) []routeHeadUsage {
	var usages []routeHeadUsage
	eachRouteModule(root, func(rel string, src []byte) {
		offset, key, ok := managedMetaKeyOffset(src)
		if !ok {
			return
		}
		line, column := lineColumn(src, offset)
		usages = append(usages, routeHeadUsage{
			file:   rel,
			key:    key,
			line:   line,
			column: column,
		})
	})
	return usages
}

// eachRouteModule calls fn with every conventionally named route module under
// app/ (routes.js / routes.ts), its root-relative slash path, and its source.
func eachRouteModule(root string, fn func(rel string, src []byte)) {
	appDir := filepath.Join(root, "app")
	_ = filepath.WalkDir(appDir, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil
		}
		if entry.IsDir() {
			if path != appDir && (entry.Name() == "node_modules" || strings.HasPrefix(entry.Name(), ".")) {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.Name() != "routes.js" && entry.Name() != "routes.ts" {
			return nil
		}

		src, err := os.ReadFile(path)
		if err != nil {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			rel = path
		}
		fn(filepath.ToSlash(rel), src)
		return nil
	})
}

type routeTokenKind uint8

const (
	routeTokenPunct routeTokenKind = iota
	routeTokenIdentifier
	routeTokenString
)

type routeToken struct {
	text   string
	kind   routeTokenKind
	offset int
}

func managedMetaKeyOffset(src []byte) (int, string, bool) {
	tokens := tokenizeRouteModule(src)
	for i := 0; i+2 < len(tokens); i++ {
		if !isNamedToken(tokens[i], "meta") || tokens[i+1].text != ":" || tokens[i+2].text != "{" {
			continue
		}

		depth := 1
		for j := i + 3; j < len(tokens) && depth > 0; j++ {
			switch tokens[j].text {
			case "{":
				depth++
				continue
			case "}":
				depth--
				continue
			}
			if depth != 1 || j+1 >= len(tokens) || tokens[j+1].text != ":" {
				continue
			}
			for _, key := range []string{"description", "canonical", "socialImage"} {
				if isNamedToken(tokens[j], key) {
					return tokens[j].offset, key, true
				}
			}
		}
	}
	return 0, "", false
}

func isNamedToken(token routeToken, name string) bool {
	return (token.kind == routeTokenIdentifier || token.kind == routeTokenString) && token.text == name
}

func tokenizeRouteModule(src []byte) []routeToken {
	var tokens []routeToken
	for i := 0; i < len(src); {
		switch {
		case isRouteSpace(src[i]):
			i++
		case i+1 < len(src) && src[i] == '/' && src[i+1] == '/':
			i += 2
			for i < len(src) && src[i] != '\n' {
				i++
			}
		case i+1 < len(src) && src[i] == '/' && src[i+1] == '*':
			i += 2
			for i+1 < len(src) && !(src[i] == '*' && src[i+1] == '/') {
				i++
			}
			if i+1 < len(src) {
				i += 2
			}
		case src[i] == '\'' || src[i] == '"':
			start, quote := i, src[i]
			i++
			escaped := false
			for i < len(src) {
				if src[i] == '\\' {
					escaped = true
					i += 2
					continue
				}
				if src[i] == quote {
					break
				}
				i++
			}
			end := i
			if i < len(src) {
				i++
			}
			text := ""
			if !escaped {
				text = string(src[start+1 : end])
			}
			tokens = append(tokens, routeToken{text: text, kind: routeTokenString, offset: start})
		case src[i] == '`':
			i = skipTemplateLiteral(src, i)
			tokens = append(tokens, routeToken{kind: routeTokenString, offset: i})
		case src[i] == '/' && canStartRouteRegex(tokens):
			i = skipRegexLiteral(src, i)
		case isRouteIdentifierStart(src[i]):
			start := i
			i++
			for i < len(src) && isRouteIdentifierContinue(src[i]) {
				i++
			}
			tokens = append(tokens, routeToken{
				text:   string(src[start:i]),
				kind:   routeTokenIdentifier,
				offset: start,
			})
		default:
			tokens = append(tokens, routeToken{
				text:   string(src[i]),
				kind:   routeTokenPunct,
				offset: i,
			})
			i++
		}
	}
	return tokens
}

func skipTemplateLiteral(src []byte, start int) int {
	for i := start + 1; i < len(src); i++ {
		if src[i] == '\\' {
			i++
			continue
		}
		if src[i] == '`' {
			return i + 1
		}
	}
	return len(src)
}

func canStartRouteRegex(tokens []routeToken) bool {
	if len(tokens) == 0 {
		return true
	}
	prev := tokens[len(tokens)-1].text
	switch prev {
	case "(", "[", "{", ",", ":", ";", "=", "!", "?", "=>":
		return true
	case "return", "case", "throw", "typeof", "void", "delete", "in", "of":
		return true
	default:
		return false
	}
}

func skipRegexLiteral(src []byte, start int) int {
	inClass := false
	for i := start + 1; i < len(src); i++ {
		switch src[i] {
		case '\\':
			i++
		case '[':
			inClass = true
		case ']':
			inClass = false
		case '/':
			if !inClass {
				i++
				for i < len(src) && isRouteIdentifierContinue(src[i]) {
					i++
				}
				return i
			}
		}
	}
	return len(src)
}

func isRouteSpace(ch byte) bool {
	switch ch {
	case ' ', '\t', '\r', '\n':
		return true
	default:
		return false
	}
}

func isRouteIdentifierStart(ch byte) bool {
	return ch == '_' || ch == '$' || ch >= 'a' && ch <= 'z' || ch >= 'A' && ch <= 'Z'
}

func isRouteIdentifierContinue(ch byte) bool {
	return isRouteIdentifierStart(ch) || ch >= '0' && ch <= '9'
}

func lineColumn(src []byte, offset int) (line, column int) {
	line, column = 1, 1
	for i := 0; i < offset && i < len(src); i++ {
		if src[i] == '\n' {
			line, column = line+1, 1
		} else {
			column++
		}
	}
	return line, column
}
