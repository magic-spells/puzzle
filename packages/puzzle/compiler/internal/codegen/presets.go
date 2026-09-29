package codegen

import (
	"fmt"
	"regexp"

	"github.com/magic-spells/puzzle/packages/puzzle-lang/expr"
)

// presets.go checks the literal arguments the date functions select behavior
// with. At run time an unknown preset renders the default and an unknown zone
// renders the date un-shifted — a development warning at most, so a typo like
// `time(v, 'shrot')` would ship unnoticed. When the argument is a string
// literal the compiler knows the answer, so it is a positioned compile error.
// A dynamic argument stays the runtime's development error.

// datePresets are the presets `date`, `time` and `datetime` share
// (client-runtime/formatters/builtins.js DATE_PRESETS, plus `iso`).
var datePresets = map[string]bool{"short": true, "medium": true, "long": true, "iso": true}

// zoneShape is what a time zone id can look like: an IANA name (`UTC`,
// `America/New_York`, `Etc/GMT+5`, `EST5EDT`) or a UTC offset (`+05:30`).
// It rejects only what is obviously not one — a space, an empty string, a
// leading digit — and leaves real validation to Intl at run time.
var zoneShape = regexp.MustCompile(`^(?:[A-Za-z][A-Za-z0-9_+\-]*(?:/[A-Za-z0-9_+\-]+)*|[+\-]\d{2}(?::?\d{2})?)$`)

// checkLiteralArgs rejects a string-literal preset for date/time/datetime that
// the library does not know, and a string-literal zone for in_timezone that
// cannot be a time zone id.
func (c *compiler) checkLiteralArgs(name string, call *expr.Call) error {
	if len(call.Args) < 2 {
		return nil
	}
	lit, ok := call.Args[1].(*expr.Literal)
	if !ok || lit.Kind != expr.LitString {
		return nil
	}
	switch name {
	case "date", "time", "datetime":
		if datePresets[lit.Str] {
			return nil
		}
		msg := fmt.Sprintf("unknown %s preset '%s' — the presets are 'short', 'medium', 'long' and 'iso'", name, lit.Str)
		switch lit.Str {
		case "date", "time", "datetime":
			// The retired preset names are functions now.
			msg = fmt.Sprintf("'%s' is not a %s preset — call %s(value) for that; the presets are 'short', 'medium', 'long' and 'iso'", lit.Str, name, lit.Str)
		}
		return c.cgErr(exprPos(lit.Start), msg)
	case "in_timezone":
		if zoneShape.MatchString(lit.Str) {
			return nil
		}
		return c.cgErr(exprPos(lit.Start), fmt.Sprintf("'%s' is not a time zone id — in_timezone takes an IANA zone such as 'UTC' or 'America/New_York', or an offset such as '+05:30'", lit.Str))
	}
	return nil
}
