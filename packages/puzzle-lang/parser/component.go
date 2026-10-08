package parser

import "github.com/magic-spells/puzzle/packages/puzzle-lang/expr"

// componentSelectorAttrs requires an authored is expression. All other
// attributes remain ordinary component props; a spread cannot supply is.
func componentSelectorAttrs(attrs []Attr, pos Position, file string) *ParseError {
	var selector Attr
	for _, attr := range attrs {
		if _, callback := attr.(*EventAttr); callback {
			continue
		}
		name := attrNameOf(attr)
		if name != "is" {
			continue
		}
		if selector != nil {
			return errAt(file, attrPos(attr), "duplicate %s attribute on <Component>", name)
		}
		if literal, ok := attr.(*StaticAttr); ok && literal.Valueless {
			return errAt(file, literal.Pos, "<Component %s> requires a value", name)
		}
		selector = attr
	}
	if selector == nil {
		return errAt(file, pos, "<Component> requires is={value} — Component is a reserved built-in tag; rename a user component or import named Component (for example, Card)")
	}
	dynamic, ok := selector.(*DynamicAttr)
	if !ok || invalidComponentSelectorLiteral(dynamic.ExprAST) {
		return errAt(file, attrPos(selector), "<Component is> requires a component value expression: is={Card}; string, number, boolean and template-literal selectors are not supported")
	}
	return nil
}

func invalidComponentSelectorLiteral(node expr.Node) bool {
	switch node := node.(type) {
	case *expr.Literal:
		return node.Kind != expr.LitNull && node.Kind != expr.LitUndefined
	case *expr.TemplateLiteral:
		return true
	case *expr.Unary:
		// A signed number is a Unary node rather than a Literal in the AST.
		literal, ok := node.Operand.(*expr.Literal)
		return ok && literal.Kind == expr.LitNumber
	}
	return false
}
