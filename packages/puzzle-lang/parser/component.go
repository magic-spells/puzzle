package parser

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
	if _, ok := selector.(*DynamicAttr); !ok {
		return errAt(file, attrPos(selector), "<Component is> requires a component value expression: is={Card}; string component resolution is not supported")
	}
	return nil
}
