package codegen

import (
	"fmt"
	"strings"

	"github.com/magic-spells/puzzle/packages/puzzle-lang/parser"
)

// urlAttr wraps a dynamic DOM URL attribute value in the runtime guard (D186).
// Only dynamic DOM attributes reach it: static source is trusted, and component
// props and marker args keep their types — a component's own URL binding checks
// the forwarded value. parts is a mixed value's parts (nil for brace-only); a
// mixed value whose literal head already fixes the scheme needs no guard.
func (c *compiler) urlAttr(tag, name, value string, parts []parser.Part, isComponent bool) string {
	if isComponent || tag == "" {
		return value
	}
	name = strings.ToLower(name)
	switch name {
	case "href", "src", "action", "formaction", "xlink:href", "poster", "background",
		"cite", "data", "codebase", "manifest", "longdesc", "profile", "usemap",
		"srcset", "imagesrcset", "ping", "archive":
	default:
		return value
	}
	mode := 0
	if name == "poster" || name == "background" ||
		(tag == "img" || tag == "input") && name == "src" ||
		(tag == "img" || tag == "source" || tag == "link") && (name == "srcset" || name == "imagesrcset") ||
		tag == "image" && (name == "href" || name == "xlink:href") {
		mode = 1
	}
	if name == "srcset" || name == "imagesrcset" || name == "ping" || name == "archive" {
		// A candidate list: every candidate carries its own scheme.
		mode |= 2
	} else if schemeFixed(parts) {
		return value
	}
	c.usesURL = true
	if mode == 0 {
		return "__u(" + value + ")"
	}
	return fmt.Sprintf("__u(%s, %d)", value, mode)
}

// schemeFixed reports whether a mixed value's literal head decides its scheme
// before any interpolation: past the spaces and controls a browser strips (and
// the tabs/newlines it drops anywhere), a character that cannot continue a
// scheme name — `:` closing an author-written scheme, or `/`, `?`, `#` and the
// like making the URL relative. `&` may begin an entity, so it decides nothing.
func schemeFixed(parts []parser.Part) bool {
	if len(parts) == 0 {
		return false
	}
	head, ok := parts[0].(*parser.StaticPart)
	if !ok {
		return false
	}
	for _, r := range strings.TrimLeft(head.Text, "\x00\x01\x02\x03\x04\x05\x06\x07\x08\t\n\x0b\x0c\r\x0e\x0f\x10\x11\x12\x13\x14\x15\x16\x17\x18\x19\x1a\x1b\x1c\x1d\x1e\x1f ") {
		switch {
		case r == '\t' || r == '\n' || r == '\r':
		case r == '&':
			return false
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '+', r == '-', r == '.':
		default:
			return true
		}
	}
	return false
}
