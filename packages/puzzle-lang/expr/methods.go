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
	"": {
		"Number", "String", "Boolean", "parseInt", "parseFloat", "isNaN", "isFinite",
		"encodeURIComponent", "decodeURIComponent", "encodeURI", "decodeURI",
	},
	"Math":   {"abs", "ceil", "floor", "round", "trunc", "max", "min", "sign", "pow", "sqrt"},
	"Object": {"keys", "values", "entries"},
	"Array":  {"isArray"},
}

// GlobalConstants are the namespace members a template may read without a
// call. A read parses to a Global node.
var GlobalConstants = map[string][]string{
	"Math": {"PI", "E"},
}

// IsGlobalConstant reports whether namespace.name is a readable constant.
func IsGlobalConstant(namespace, name string) bool {
	for _, n := range GlobalConstants[namespace] {
		if n == name {
			return true
		}
	}
	return false
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
// of StringMethods, ArrayMethods, and NumberMethods. The parser checks every
// method call's name against it. When the receiver's type is certain from the
// syntax alone (receiverType: a literal, or a global call whose result type
// is fixed), the parser checks the call against that type's list instead.
// Every other receiver is checked by name only here: its type is a runtime
// fact, which PuzzleKit's lowering checks through TypeScript and Sites'
// evaluator checks when it runs.
func IsMethod(name string) bool { return methodNames[name] }

// receiverType names the type of n when the syntax alone fixes it — "a
// string", "a number", "an array", "a boolean", "an object", "null", or
// "undefined" — and returns "" for any receiver whose type is known only at
// run time (a name, a path, a method's result, an operator).
func receiverType(n Node) string {
	switch n := n.(type) {
	case *Literal:
		switch n.Kind {
		case LitString:
			return "a string"
		case LitNumber:
			return "a number"
		case LitBool:
			return "a boolean"
		case LitNull:
			return "null"
		case LitUndefined:
			return "undefined"
		}
	case *TemplateLiteral:
		return "a string"
	case *Array:
		return "an array"
	case *Object:
		return "an object"
	case *Global:
		if IsGlobalConstant(n.Namespace, n.Name) {
			return "a number"
		}
	case *Call:
		if g, ok := n.Callee.(*Global); ok {
			return globalResultTypes[g.Namespace+"."+g.Name]
		}
	}
	return ""
}

// globalResultTypes is the fixed result type of each global function, keyed
// "namespace.name" ("" namespace for the bare functions). Every Math function
// returns a number.
var globalResultTypes = func() map[string]string {
	m := map[string]string{
		".String": "a string", ".Number": "a number", ".parseInt": "a number", ".parseFloat": "a number",
		".Boolean": "a boolean", ".isNaN": "a boolean", ".isFinite": "a boolean",
		".encodeURIComponent": "a string", ".decodeURIComponent": "a string",
		".encodeURI": "a string", ".decodeURI": "a string",
		"Object.keys": "an array", "Object.values": "an array", "Object.entries": "an array",
		"Array.isArray": "a boolean",
	}
	for _, fn := range GlobalFunctions["Math"] {
		m["Math."+fn] = "a number"
	}
	return m
}()

// typeHasMethod reports whether a receiver of type typ (a receiverType
// result) has the method name. Booleans, objects, null, and undefined have
// none.
func typeHasMethod(typ, name string) bool {
	var list []string
	switch typ {
	case "a string":
		list = StringMethods
	case "a number":
		list = NumberMethods
	case "an array":
		list = ArrayMethods
	}
	for _, m := range list {
		if m == name {
			return true
		}
	}
	return false
}

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

// namespaceMessage is the error for a namespace member the language does not
// have, e.g. `Math.random()` (called) or `Math.LN2` (read): it lists what the
// namespace does have.
func namespaceMessage(namespace, name string, called bool) string {
	what := "`" + namespace + "." + name + "`"
	if called {
		what = "`" + namespace + "." + name + "()`"
	}
	list := "the " + namespace + " " + plural("function", GlobalFunctions[namespace])
	if consts := GlobalConstants[namespace]; len(consts) > 0 {
		list += ", and the " + namespace + " " + plural("constant", consts)
	}
	return what + " is not available in template expressions — " + list
}

// plural renders "function is abs" / "functions are abs, ceil, and floor".
func plural(noun string, names []string) string {
	switch len(names) {
	case 1:
		return noun + " is " + names[0]
	case 2:
		return noun + "s are " + names[0] + " and " + names[1]
	}
	return noun + "s are " + strings.Join(names[:len(names)-1], ", ") + ", and " + names[len(names)-1]
}

// namespaceValueMessage is the error for a namespace object used as a value:
// `Math` alone, `(Math)`, `Math?.round(x)`. A data field named after a
// namespace is unreachable by design.
func namespaceValueMessage(namespace string) string {
	use := map[string]string{
		"Math":   "call a Math function, e.g. `Math.round(x)`, or read `Math.PI` or `Math.E`",
		"Object": "call `Object.keys(x)`, `Object.values(x)`, or `Object.entries(x)`",
		"Array":  "call `Array.isArray(x)`",
	}[namespace]
	return "`" + namespace + "` is not a value in template expressions — " + use
}

// callOnlyMessage is the error for a global function used as a value instead
// of being called: `items.filter(Boolean)`, `items.map(Math.round)`. There
// are no function values; an arrow wraps the call.
func callOnlyMessage(global string) string {
	return "`" + global + "` can only be called — write `x => " + global + "(x)`"
}

// globalMemberMessage is the error for a member of a bare global function,
// e.g. `Number.isInteger(x)`.
func globalMemberMessage(global, name string, called bool) string {
	what := "`" + global + "." + name + "`"
	if called {
		what = "`" + global + "." + name + "()`"
	}
	msg := what + " is not available in template expressions"
	if alt := globalAlternatives[global]; alt != "" {
		msg += " — use " + alt
	}
	return msg
}

// globalValueMessage is the error for a global's name used where a value or a
// binding is read — a namespace or a global function — or "" for any other
// name.
func globalValueMessage(name string) string {
	switch {
	case isGlobalNamespace(name):
		return namespaceValueMessage(name)
	case IsGlobalFunction("", name):
		return callOnlyMessage(name)
	}
	return ""
}
