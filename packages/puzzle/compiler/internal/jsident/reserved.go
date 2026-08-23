// Package jsident owns JavaScript identifier rules shared by the parser and
// code generator.
package jsident

// reservedBindingIdentifiers contains every word that cannot be used as a
// BindingIdentifier in strict-mode module code. It includes JavaScript
// reserved words, strict-mode future reserved words, and the strict-mode
// restricted bindings eval and arguments. Contextual words such as async, get,
// set, and of intentionally remain legal.
var reservedBindingIdentifiers = map[string]struct{}{
	"arguments":  {},
	"await":      {},
	"break":      {},
	"case":       {},
	"catch":      {},
	"class":      {},
	"const":      {},
	"continue":   {},
	"debugger":   {},
	"default":    {},
	"delete":     {},
	"do":         {},
	"else":       {},
	"enum":       {},
	"eval":       {},
	"export":     {},
	"extends":    {},
	"false":      {},
	"finally":    {},
	"for":        {},
	"function":   {},
	"if":         {},
	"implements": {},
	"import":     {},
	"in":         {},
	"instanceof": {},
	"interface":  {},
	"let":        {},
	"new":        {},
	"null":       {},
	"package":    {},
	"private":    {},
	"protected":  {},
	"public":     {},
	"return":     {},
	"static":     {},
	"super":      {},
	"switch":     {},
	"this":       {},
	"throw":      {},
	"true":       {},
	"try":        {},
	"typeof":     {},
	"var":        {},
	"void":       {},
	"while":      {},
	"with":       {},
	"yield":      {},
}

// IsReservedBindingIdentifier reports whether name is forbidden as a binding
// in the strict-mode JavaScript modules emitted by the Puzzle compiler.
func IsReservedBindingIdentifier(name string) bool {
	_, reserved := reservedBindingIdentifiers[name]
	return reserved
}
