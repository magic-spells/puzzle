package codegen

import "github.com/magic-spells/puzzle/packages/puzzle-lang/parser"

// outletwarn.go holds the one D199 compile warning: an <Outlet/> in a
// component. <Outlet/> and <Children/> fill the same default position and emit
// the same code, so the component still works — but the router only fills
// the outlets of layouts and views (app/layouts/**, app/views/**), and in a
// component the position is filled by whatever the caller writes between its
// tags, which is what <Children/> says.

// warnOutletInComponent walks a component template and warns once per
// <Outlet> marker it finds, at the marker's position.
func warnOutletInComponent(nodes []parser.Node, file string, warnings *[]Warning) {
	if warnings == nil {
		return
	}
	for _, n := range nodes {
		switch node := n.(type) {
		case *parser.Slot:
			if node.Marker == "Outlet" {
				*warnings = append(*warnings, Warning{
					File: file, Line: node.Pos.Line, Col: node.Pos.Col,
					Message: "<Outlet/> in a component: the router fills outlets in layouts and views only, so here it is filled by what the caller writes — spell it <Children/> (D199)",
				})
			}
			warnOutletInComponent(node.Children, file, warnings)
		case *parser.Element:
			warnOutletInComponent(node.Children, file, warnings)
		case *parser.Component:
			warnOutletInComponent(node.Children, file, warnings)
		case *parser.Snippet:
			warnOutletInComponent(node.Body, file, warnings)
		case *parser.Portal:
			warnOutletInComponent(node.Children, file, warnings)
		case *parser.If:
			warnOutletInComponent(node.Then, file, warnings)
			warnOutletInComponent(node.Else, file, warnings)
		case *parser.For:
			warnOutletInComponent(node.Body, file, warnings)
		case *parser.Case:
			for i := range node.Clauses {
				warnOutletInComponent(node.Clauses[i].Body, file, warnings)
			}
			warnOutletInComponent(node.Else, file, warnings)
		}
	}
}
