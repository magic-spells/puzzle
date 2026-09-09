package build

import (
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
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

func findRouteHeadUsages(root string) []routeHeadUsage {
	appDir := filepath.Join(root, "app")
	var usages []routeHeadUsage
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
		offset, key, ok := managedMetaKeyOffset(src)
		if !ok {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			rel = path
		}
		line, column := lineColumn(src, offset)
		usages = append(usages, routeHeadUsage{
			file:   filepath.ToSlash(rel),
			key:    key,
			line:   line,
			column: column,
		})
		return nil
	})
	return usages
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
