package parser

// island.go — compile-time validation for the `island` directive (v1.13, D44).
//
// A static `island` on a plain element makes its children browser-/component-
// owned after mount: the template seeds them once, the ViewManager never
// reconciles them again. These checks enforce the four invariants the runtime
// relies on, as positioned errors in the D38 fail-fast style:
//
//  1. island={ expr } (a dynamic value) — must be a static attribute; toggling
//     island-ness mid-life would resume patching against DOM the browser has
//     restructured. A VALUED static island="…" (e.g. island="false") is likewise
//     rejected: it must be BARE, because the runtime freezes the subtree on the
//     attribute's mere presence, so island="false" silently freezes anyway.
//  2. island on a component tag — it is not a prop; put it on a plain element
//     inside the component.
//  3. a component tag or a composition marker (<children/>/<slot>/<Slot/>)
//     anywhere inside an island subtree — a live instance in browser-owned DOM
//     can be destroyed out from under the framework; a marker would splice
//     parent-owned nodes into an unreconciled subtree.
//  4. island on the <puzzle-view> section root — the root is the navigation/
//     animation boundary (D20/D28), not an ownable subtree.
//
// The check runs as a post-pass over the built AST so island errors surface
// alongside the other parse errors. Any one violation fails the parse.

// validateIslands walks a parsed template/skeleton root and returns the first
// island-directive violation (nil when clean).
func validateIslands(root *Element, file string) *ParseError {
	for _, a := range root.Attrs {
		if isIslandName(attrNameOf(a)) {
			return errAt(file, attrPos(a), "the <puzzle-view> root cannot be an island — the view root is the navigation/animation boundary, not an ownable subtree")
		}
	}
	return walkIslands(root.Children, file)
}

// walkIslands descends the node list validating island usage.
func walkIslands(nodes []Node, file string) *ParseError {
	for _, n := range nodes {
		switch node := n.(type) {
		case *Element:
			island, dynamic, valued, pos := findIslandAttr(node.Attrs)
			if dynamic {
				return errAt(file, pos, "island must be a static attribute, not island={ ... } — a dynamic island has no coherent semantics")
			}
			if valued {
				// island="false" (or any value) still freezes the subtree at runtime —
				// the ViewManager keys island-ness on presence, not truthiness — so a
				// valued attr is silent corruption. D44 is bare-static only.
				return errAt(file, pos, "island must be a bare attribute — remove the =\"…\" value (SPEC §17, D44)")
			}
			if island {
				if perr := rejectComponentsAndSlots(node.Children, pos, file); perr != nil {
					return perr
				}
			}
			if perr := walkIslands(node.Children, file); perr != nil {
				return perr
			}
		case *Component:
			for _, a := range node.Props {
				if isIslandName(attrNameOf(a)) {
					return errAt(file, attrPos(a), "island is not a component prop — put it on a plain element inside <%s>", node.Name)
				}
			}
			if perr := walkIslands(node.Children, file); perr != nil {
				return perr
			}
		case *If:
			if perr := walkIslands(node.Then, file); perr != nil {
				return perr
			}
			if perr := walkIslands(node.Else, file); perr != nil {
				return perr
			}
		case *For:
			if perr := walkIslands(node.Body, file); perr != nil {
				return perr
			}
		case *Case:
			for _, cl := range node.Clauses {
				if perr := walkIslands(cl.Body, file); perr != nil {
					return perr
				}
			}
			if perr := walkIslands(node.Else, file); perr != nil {
				return perr
			}
		}
	}
	return nil
}

// rejectComponentsAndSlots reports the first Component or Slot anywhere inside an
// island subtree (opened at islandPos). It descends through elements and block
// bodies; nested islands are still part of the outer island subtree, so it does
// not stop at them.
func rejectComponentsAndSlots(nodes []Node, islandPos Position, file string) *ParseError {
	for _, n := range nodes {
		switch node := n.(type) {
		case *Component:
			return errAt(file, node.Pos, "<%s> cannot appear inside an island element opened at %d:%d — a component in browser-owned DOM would be orphaned; move it outside the island", node.Name, islandPos.Line, islandPos.Col)
		case *Slot:
			return errAt(file, node.Pos, "a composition marker (<children/>/<slot>/<Slot/>) cannot appear inside an island element opened at %d:%d — it would splice parent-owned nodes into an unreconciled subtree", islandPos.Line, islandPos.Col)
		case *Element:
			if perr := rejectComponentsAndSlots(node.Children, islandPos, file); perr != nil {
				return perr
			}
		case *If:
			if perr := rejectComponentsAndSlots(node.Then, islandPos, file); perr != nil {
				return perr
			}
			if perr := rejectComponentsAndSlots(node.Else, islandPos, file); perr != nil {
				return perr
			}
		case *For:
			if perr := rejectComponentsAndSlots(node.Body, islandPos, file); perr != nil {
				return perr
			}
		case *Case:
			for _, cl := range node.Clauses {
				if perr := rejectComponentsAndSlots(cl.Body, islandPos, file); perr != nil {
					return perr
				}
			}
			if perr := rejectComponentsAndSlots(node.Else, islandPos, file); perr != nil {
				return perr
			}
		}
	}
	return nil
}

// findIslandAttr looks for an `island` attribute among an element's attrs. A
// BARE static `island` (Valueless) marks the element an island (island=true);
// a VALUED static `island="…"` — including island="" — is `valued=true` (D44 is
// bare-only: a value is rejected, since the runtime freezes on key presence
// regardless of the value); `island={expr}` (DynamicAttr) or an interpolated
// value (MixedAttr) is a dynamic island (dynamic=true). pos is the
// offending/marking attribute's position.
func findIslandAttr(attrs []Attr) (island bool, dynamic bool, valued bool, pos Position) {
	for _, a := range attrs {
		switch t := a.(type) {
		case *StaticAttr:
			if t.Name == "island" {
				if !t.Valueless {
					return false, false, true, t.Pos
				}
				return true, false, false, t.Pos
			}
		case *DynamicAttr:
			if t.Name == "island" {
				return false, true, false, t.Pos
			}
		case *MixedAttr:
			if t.Name == "island" {
				return false, true, false, t.Pos
			}
		}
	}
	return false, false, false, Position{}
}

func isIslandName(name string) bool { return name == "island" }

// attrNameOf returns an attribute's name regardless of concrete type.
func attrNameOf(a Attr) string {
	switch t := a.(type) {
	case *StaticAttr:
		return t.Name
	case *DynamicAttr:
		return t.Name
	case *EventAttr:
		return t.Name
	case *MixedAttr:
		return t.Name
	}
	return ""
}

// attrPos returns an attribute's opening position regardless of concrete type.
func attrPos(a Attr) Position {
	switch t := a.(type) {
	case *StaticAttr:
		return t.Pos
	case *DynamicAttr:
		return t.Pos
	case *EventAttr:
		return t.Pos
	case *MixedAttr:
		return t.Pos
	}
	return Position{}
}
