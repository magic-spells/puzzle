package codegen

import (
	"sort"
	"strconv"
	"strings"

	"github.com/magic-spells/puzzle/packages/puzzle-lang/expr"
	"github.com/magic-spells/puzzle/packages/puzzle-lang/parser"
)

// ScriptValueBindings shares the opaque-script binding scan with puzzle check.
// Only Component's is expression may resolve these names (D180).
func ScriptValueBindings(scripts string) map[string]int {
	return scriptSelectorBindings(tokenizeJS(scripts))
}

// The reserved-name scan intentionally ignores later variable declarators;
// selectors also need the simple names after a top-level comma. Their
// initializers are never interpreted, and nested declaration names are skipped.
func scriptSelectorBindings(tokens []jsTok) map[string]int {
	bindings, _ := scriptSelectorBindingInfo(tokens)
	return bindings
}

func scriptSelectorBindingInfo(tokens []jsTok) (map[string]int, map[string]bool) {
	bindings := scriptTopLevelBindings(tokens)
	mutable := map[string]bool{}
	depth := 0
	inDeclaration := false
	declarationMutable := false
	bind := func(name string, off int) {
		bindings[name] = off
		if declarationMutable {
			mutable[name] = true
		}
	}
	previous := jsTok{ch: ';'}
	for i, token := range tokens {
		if token.comment {
			continue
		}
		if depth == 0 && previous.ch != '.' {
			switch token.ident {
			case "const", "let", "var":
				inDeclaration = previous.ident != "declare"
				declarationMutable = token.ident != "const"
				if inDeclaration {
					if next, ok := nextNonCommentToken(tokens, i+1); ok {
						bindDeclaredName(tokens, next, bind)
					}
				}
			case "import", "export", "return", "throw":
				inDeclaration = false
			case "function", "class":
				if startsDeclaration(previous) {
					inDeclaration = false
				}
			}
			if token.ch == ';' {
				inDeclaration = false
			}
			if inDeclaration && token.ch == ',' {
				name, ok := nextNonCommentToken(tokens, i+1)
				if ok && tokens[name].ident != "" {
					following, ok := nextNonCommentToken(tokens, name+1)
					if ok && (tokens[following].ch == '=' || tokens[following].ch == ':' || tokens[following].ch == ',' || tokens[following].ch == ';') {
						bind(tokens[name].ident, tokens[name].off)
					}
				}
			}
		}
		switch token.ch {
		case '(', '[', '{':
			depth++
		case ')', ']', '}':
			if depth > 0 {
				depth--
			}
		}
		if !token.opaque {
			previous = token
		}
	}
	return bindings, mutable
}

// ComponentSelectorBindings returns module names that selectors read, so a JS
// check mirror can expose them to its separate TypeScript template wrapper.
func ComponentSelectorBindings(scripts string, roots ...*parser.Element) []string {
	bindings := ScriptValueBindings(scripts)
	used := map[string]bool{}
	for _, root := range roots {
		if root == nil {
			continue
		}
		walkComponentSlots(root.Children, func(component *parser.Component) {
			for _, prop := range component.Props {
				if attr, ok := prop.(*parser.DynamicAttr); ok && attr.Name == "is" {
					collectSelectorBindings(attr.ExprAST, bindings, used)
				}
			}
		})
	}
	names := make([]string, 0, len(used))
	for name := range used {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

func collectSelectorBindings(tree expr.Node, bindings map[string]int, used map[string]bool) {
	expr.Walk(tree, func(node expr.Node) bool {
		if arrow, ok := node.(*expr.Arrow); ok {
			visible := make(map[string]int, len(bindings))
			for name, offset := range bindings {
				visible[name] = offset
			}
			for _, param := range arrow.Params {
				delete(visible, param.Name)
			}
			collectSelectorBindings(arrow.Body, visible, used)
			return false
		}
		if id, ok := node.(*expr.Identifier); ok {
			if _, module := bindings[id.Name]; module {
				used[id.Name] = true
			}
		}
		return true
	})
}

type componentSelectorGetter struct {
	name, alias string
}

// A getter reads the live module binding outside render's generated lexical
// scopes. A copied value would freeze a mutable module selector at import time.
func (c *compiler) componentSelectorRef(name string) string {
	for _, getter := range c.componentSelectorGetters {
		if getter.name == name {
			return getter.alias + "()"
		}
	}
	collision := strings.HasPrefix(name, "__")
	for _, site := range c.loops {
		collision = collision || name == site.scope
	}
	if !collision {
		return ""
	}
	next := len(c.componentSelectorGetters)
	var alias string
	for {
		alias = "__pzlComponentSelector" + strconv.Itoa(next)
		next++
		available := !strings.Contains(c.componentSelectorSource, alias)
		for _, getter := range c.componentSelectorGetters {
			available = available && alias != getter.alias
		}
		if available {
			break
		}
	}
	c.componentSelectorGetters = append(c.componentSelectorGetters, componentSelectorGetter{name: name, alias: alias})
	return alias + "()"
}

func (c *compiler) componentSelectionScope(scope scopeMap, used map[string]bool) scopeMap {
	selection := cloneScope(scope)
	names := make([]string, 0, len(used))
	for name := range used {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		if _, local := selection[name]; !local {
			selection[name] = c.componentSelectorRef(name)
		}
	}
	return selection
}

func (c *compiler) componentSelectorValue(attr *parser.DynamicAttr, scope scopeMap) (string, error) {
	used := map[string]bool{}
	collectSelectorBindings(attr.ExprAST, c.moduleBindings, used)
	// Only reassigned let/var bindings invalidate cached rows. Imports and const
	// maps are stable; mutating a const map's entries is not observed by the cache.
	if len(c.loops) > 0 && c.analyzing == 0 {
		for name := range used {
			if _, local := scope[name]; !local && c.mutableModuleBindings[name] {
				for _, site := range c.loops {
					site.volatile = true
				}
				break
			}
		}
	}
	if startsWithObjectLiteral(attr.Expr) {
		return "", c.cgErr(attr.Pos, objectLiteralMsg)
	}
	return c.value(attr.ExprAST, c.componentSelectionScope(scope, used)), nil
}

func (c *compiler) emitComponentSlot(node *parser.Component, ind int, scope scopeMap) (string, error) {
	if _, reserved := c.moduleBindings["Component"]; reserved {
		return "", c.cgErr(node.Pos, "Component is a reserved built-in tag — rename the user component or import named Component (for example, Card)")
	}
	var selector string
	props := make([]parser.Attr, 0, len(node.Props))
	for _, attr := range node.Props {
		if selectorAttr, ok := attr.(*parser.DynamicAttr); ok && selectorAttr.Name == "is" {
			value, err := c.componentSelectorValue(selectorAttr, scope)
			if err != nil {
				return "", err
			}
			selector = value
		} else {
			props = append(props, attr)
		}
	}
	attrs, err := c.emitAttrs("", props, ind, len(props) > 1 || anyMixed(props), scope, true)
	if err != nil {
		return "", err
	}
	children, err := c.processChildren(node.Children, scope)
	if err != nil {
		return "", err
	}
	array, err := c.emitArray(children, ind+2, scope)
	if err != nil {
		return "", err
	}
	c.usesDynamicComponent = true
	return "__dc(" + selector + ", " + attrs + ", " + array + ")", nil
}

func hasComponentSlot(nodes []parser.Node) bool {
	found := false
	walkComponentSlots(nodes, func(*parser.Component) { found = true })
	return found
}

func walkComponentSlots(nodes []parser.Node, visit func(*parser.Component)) {
	for _, node := range nodes {
		switch node := node.(type) {
		case *parser.Component:
			if node.Name == "Component" {
				visit(node)
			}
			walkComponentSlots(node.Children, visit)
		case *parser.Element:
			walkComponentSlots(node.Children, visit)
		case *parser.Slot:
			walkComponentSlots(node.Children, visit)
		case *parser.Snippet:
			walkComponentSlots(node.Body, visit)
		case *parser.Portal:
			walkComponentSlots(node.Children, visit)
		case *parser.If:
			walkComponentSlots(node.Then, visit)
			walkComponentSlots(node.Else, visit)
		case *parser.Case:
			for _, clause := range node.Clauses {
				walkComponentSlots(clause.Body, visit)
			}
			walkComponentSlots(node.Else, visit)
		case *parser.For:
			walkComponentSlots(node.Body, visit)
		}
	}
}
