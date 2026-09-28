package expr

import "strings"

// methods.go is the method table as data: the method NAMES each receiver type
// offers (design §3), the union the parser checks a method call against, the
// JavaScript globals a template may call, and the alternatives an error names
// for the methods and globals that are not available. The parser knows names
// only; each host implements the behavior (PuzzleKit as the same JavaScript
// method, Sites as a Go reimplementation with a conformance row per method).

// StringMethods are the methods on a string receiver.
var StringMethods = []string{
	"at", "charAt", "includes", "startsWith", "endsWith", "indexOf", "lastIndexOf",
	"slice", "substring", "split", "replace", "replaceAll", "trim", "trimStart",
	"trimEnd", "toUpperCase", "toLowerCase", "padStart", "padEnd", "repeat", "concat",
}

// ArrayMethods are the methods on an array receiver. None mutates it: the
// table has toSorted and toReversed, not sort and reverse.
var ArrayMethods = []string{
	"at", "includes", "indexOf", "lastIndexOf", "slice", "concat", "join", "flat",
	"find", "findIndex", "findLast", "filter", "map", "some", "every", "reduce",
	"toSorted", "toReversed",
}

// NumberMethods are the methods on a number receiver.
var NumberMethods = []string{"toFixed", "toString"}

// StringProperties and ArrayProperties are the properties the language defines
// on those receivers beyond plain data reads. `.length` counts UTF-16 code
// units on a string, as JavaScript does.
var (
	StringProperties = []string{"length"}
	ArrayProperties  = []string{"length"}
)

// GlobalFunctions are the JavaScript globals a template may call, by namespace;
// the "" namespace holds the bare global functions. A call to one parses to a
// Call whose callee is a Global.
var GlobalFunctions = map[string][]string{
	"":       {"Number", "String", "Boolean", "parseInt", "parseFloat", "isNaN", "isFinite"},
	"Math":   {"abs", "ceil", "floor", "round", "trunc", "max", "min", "sign", "pow", "sqrt"},
	"Object": {"keys", "values", "entries"},
	"Array":  {"isArray"},
}

var methodNames = func() map[string]bool {
	m := map[string]bool{}
	for _, list := range [][]string{StringMethods, ArrayMethods, NumberMethods} {
		for _, name := range list {
			m[name] = true
		}
	}
	return m
}()

// IsMethod reports whether name is a method of any receiver type — the union
// of StringMethods, ArrayMethods, and NumberMethods. The parser rejects a
// method call whose name is not in it; which receiver actually has the method
// is a runtime question for the host.
func IsMethod(name string) bool { return methodNames[name] }

// IsGlobalFunction reports whether namespace.name (or the bare name, for
// namespace "") is a global a template may call.
func IsGlobalFunction(namespace, name string) bool {
	for _, n := range GlobalFunctions[namespace] {
		if n == name {
			return true
		}
	}
	return false
}

// isGlobalNamespace reports whether name is a namespace object in
// GlobalFunctions (Math, Object, Array).
func isGlobalNamespace(name string) bool {
	_, ok := GlobalFunctions[name]
	return ok && name != ""
}

// MethodAlternatives names what to write instead of a method the table does
// not have, where the language has an equivalent.
var MethodAlternatives = map[string]string{
	// Mutating and legacy array methods.
	"sort":           "`toSorted()`",
	"reverse":        "`toReversed()`",
	"push":           "`concat()`",
	"unshift":        "`concat()`",
	"pop":            "`at(-1)`",
	"shift":          "`at(0)`",
	"splice":         "`slice()`",
	"flatMap":        "`map()` then `flat()`",
	"forEach":        "`map()`",
	"keys":           "`Object.keys(x)`",
	"values":         "`Object.values(x)`",
	"entries":        "`Object.entries(x)`",
	"hasOwnProperty": "`Object.keys(x).includes(key)`",
	// Strings.
	"substr":            "`slice()` or `substring()`",
	"trimLeft":          "`trimStart()`",
	"trimRight":         "`trimEnd()`",
	"toLocaleUpperCase": "`toUpperCase()`",
	"toLocaleLowerCase": "`toLowerCase()`",
	"match":             "`includes()`, `startsWith()`, or `indexOf()`",
	"matchAll":          "`includes()`, `startsWith()`, or `indexOf()`",
	"search":            "`indexOf()`",
	"test":              "`includes()`, `startsWith()`, or `indexOf()`",
	// Numbers.
	"toPrecision":    "`toFixed(digits)`",
	"toLocaleString": "number_with_delimiter(v) for a number, or datetime(v, preset) for a date",
	// Dates: the date/time functions, or a direct comparison.
	"getFullYear":        "date(v, preset)",
	"getMonth":           "date(v, preset)",
	"getDate":            "date(v, preset)",
	"getDay":             "date(v, preset)",
	"getHours":           "time(v, preset)",
	"getMinutes":         "time(v, preset)",
	"getSeconds":         "time(v, preset)",
	"toDateString":       "date(v, preset)",
	"toLocaleDateString": "date(v, preset)",
	"toTimeString":       "time(v, preset)",
	"toLocaleTimeString": "time(v, preset)",
	"toISOString":        "datetime(v, preset)",
	"toUTCString":        "datetime(v, preset)",
	"getTime":            "a direct comparison — dates compare with `<` and `>`",
	// JSON.
	"stringify": "json(v)",
	"toJSON":    "json(v)",
}

// globalAlternatives names what to write instead of a method call on a
// JavaScript global the language does not have (`Date.now()`,
// `JSON.stringify(v)`). A data field may share one of these names, so this
// only improves the message for a call the method table already rejects.
var globalAlternatives = map[string]string{
	"Date":           "date(v, preset), time(v, preset), or datetime(v, preset)",
	"JSON":           "json(v)",
	"Number":         "`Number(x)`, `parseInt(x)`, `parseFloat(x)`, `isNaN(x)`, or `isFinite(x)`",
	"String":         "`String(x)`",
	"Boolean":        "`Boolean(x)`",
	"Intl":           "the date, time, currency, and number functions",
	"console":        "",
	"window":         "",
	"document":       "",
	"globalThis":     "",
	"Map":            "",
	"Set":            "",
	"Promise":        "",
	"Reflect":        "",
	"Symbol":         "",
	"RegExp":         "",
	"localStorage":   "",
	"sessionStorage": "",
	"navigator":      "",
	"location":       "",
	"history":        "",
}

// methodMessage is the error for a method call whose name is not in the
// table: `.name()` on receiver, where receiverName is the receiver's name when
// it is a bare identifier.
func methodMessage(name, receiverName string) string {
	if alt, isGlobal := globalAlternatives[receiverName]; isGlobal {
		msg := "`" + receiverName + "." + name + "()` is not available in template expressions"
		if alt != "" {
			msg += " — use " + alt
		}
		return msg
	}
	msg := "`." + name + "()` is not available in template expressions"
	if alt := MethodAlternatives[name]; alt != "" {
		msg += " — use " + alt
	}
	return msg
}

// namespaceMessage is the error for a call to a namespace member that is not
// in GlobalFunctions, e.g. `Math.random()`.
func namespaceMessage(namespace, name string) string {
	fns := GlobalFunctions[namespace]
	var list string
	switch len(fns) {
	case 1:
		list = "the " + namespace + " function is " + fns[0]
	default:
		list = "the " + namespace + " functions are " + strings.Join(fns[:len(fns)-1], ", ") + ", and " + fns[len(fns)-1]
	}
	return "`" + namespace + "." + name + "()` is not available in template expressions — " + list
}
