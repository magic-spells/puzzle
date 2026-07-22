package parser

// slot.go — compile-time validation for the composition markers (named slots
// v1.21/D53; the <children/> default marker + role split v1.41/D74). See
// [[DOC-SPEC]] §24, [[DECISION-D53-NAMED-SLOTS]], and [[DECISION-D74-CHILDREN-MARKER]].
//
// The three spellings (D74), each with exactly one role:
//
//   <children/> — the DEFAULT marker (call-site content). No attributes; MAY
//   carry fallback children. Validated by childrenMarkerAttrs in parseElement.
//
//   <Slot/> — the same default marker capitalized, the ROUTER OUTLET (D30).
//   Bare only: no `name` (steer to lowercase), no children (no fallback on the
//   outlet). Validated by slotOutletAttrs in parseElement.
//
//   <slot name="x">…fallback…</slot> — a NAMED slot, and nothing else. `name`
//   is REQUIRED, static, non-empty, per-template-unique; "default" and
//   "children" are reserved (both steer to <children/>). A nameless <slot> is a
//   positioned error naming both replacements. Local shape checks run in
//   namedSlotFromAttrs during parseElement; the per-body uniqueness check runs
//   in the validateSlots post-pass (each template body — the <puzzle-view>
//   template and its <puzzle-skeleton> — is validated separately, so the same
//   name may appear once in each).
//
//   Call site (<Card><h2 slot="header">…</h2></Card>): the parser's job is
//   VALIDATION ONLY — a static `slot` attribute rides through codegen unchanged
//   inside the child vnode's attrs and is partitioned/stripped at runtime by the
//   ViewManager. On a DIRECT child of a component invocation: a dynamic
//   slot={expr} is an error, and a control-flow block ({#if}/{#unless}/{#case}/
//   {#for}) whose top-level nodes carry `slot` attributes is an error (silent
//   default-routing would misroute). Anywhere else `slot` is the ordinary HTML
//   global attribute and passes through untouched.

// childrenMarkerAttrs validates a <children/>'s attributes (D74): the default
// marker takes NO attributes. A `ref` gets the D72-style render-target message;
// any other attribute is the generic no-attributes error. Fallback children are
// handled by the caller, not here.
func childrenMarkerAttrs(attrs []Attr, file string) *ParseError {
	for _, a := range attrs {
		if attrNameOf(a) == "ref" {
			return errAt(file, attrPos(a), "ref cannot be placed on a <children> — a children marker is a render target, not a real element")
		}
		return errAt(file, attrPos(a), "<children> takes no attributes — call-site content needs no configuration")
	}
	return nil
}

// slotOutletAttrs validates a <Slot/>'s attributes (D74): the router outlet is
// bare only. A `ref` gets the render-target message (D72); a `name` steers to
// the lowercase named-slot spelling; any other attribute is rejected.
func slotOutletAttrs(attrs []Attr, file string) *ParseError {
	for _, a := range attrs {
		switch attrNameOf(a) {
		case "ref":
			return errAt(file, attrPos(a), "ref cannot be placed on a <Slot> — a slot is a render target, not a real element")
		case "name":
			return errAt(file, attrPos(a), `named slots are spelled lowercase — <slot name="…"> declares a named slot; <Slot/> is the router outlet`)
		default:
			return errAt(file, attrPos(a), "<Slot> is the router outlet and takes no attributes")
		}
	}
	return nil
}

// namedSlotFromAttrs validates a lowercase <slot>'s attributes and returns its
// name (D74: `name` is REQUIRED). The only permitted attribute is a static
// `name`; a nameless <slot>, a dynamic/interpolated name, an empty name, the
// reserved "default"/"children", or any other attribute is a positioned compile
// error.
func namedSlotFromAttrs(attrs []Attr, pos Position, file string) (name string, perr *ParseError) {
	hasName := false
	for _, a := range attrs {
		if attrNameOf(a) == "ref" {
			// ref on a <slot> (v1.39, D72): a slot is a render target, not a real
			// element — reject with a ref-specific message before the generic one.
			return "", errAt(file, attrPos(a), "ref cannot be placed on a <slot> — a slot is a render target, not a real element")
		}
		switch at := a.(type) {
		case *StaticAttr:
			if at.Name != "name" {
				return "", errAt(file, at.Pos, "<slot> only takes a static name attribute")
			}
			hasName = true
			name = at.Value
		case *DynamicAttr:
			if at.Name == "name" {
				return "", errAt(file, at.Pos, "<slot> name must be a static string, not name={ ... }")
			}
			return "", errAt(file, at.Pos, "<slot> only takes a static name attribute")
		case *MixedAttr:
			if at.Name == "name" {
				return "", errAt(file, at.Pos, "<slot> name must be a static string, not an interpolated value")
			}
			return "", errAt(file, at.Pos, "<slot> only takes a static name attribute")
		case *EventAttr:
			return "", errAt(file, at.Pos, "<slot> does not take event handlers")
		}
	}
	if !hasName {
		return "", errAt(file, pos, "bare <slot/> was replaced in v1.41 (D74) — use <children/> for call-site children, or <Slot/> for the router outlet in a routed view/layout")
	}
	if name == "" {
		return "", errAt(file, pos, "<slot name> cannot be empty")
	}
	if name == "default" {
		return "", errAt(file, pos, `<slot name="default"> is reserved — use <children/>`)
	}
	if name == "children" {
		return "", errAt(file, pos, `<slot name="children"> is reserved — use <children/>`)
	}
	return name, nil
}

// validateSlots runs the per-body named-slot post-pass over a parsed template or
// skeleton root: it rejects duplicate slot names within the body and validates
// the call-site `slot` rules on every component invocation. Called once per body
// (template and skeleton separately) so the same slot name is legal in each.
func validateSlots(root *Element, file string) *ParseError {
	return walkSlots(root.Children, file, map[string]Position{}, false)
}

// walkSlots descends the node list collecting named-slot declarations (rejecting
// duplicates via seen) and validating each component's direct-child slot usage.
// inCallSite is true while walking a component invocation's subtree (call-site
// content): only the default marker (<children/>/<Slot/>) may forward through a
// component (v1.38, D71) — a NAMED slot there has no defined fill source (the
// router fills the default slot only, and named forwarding semantics are
// deliberately unspecified), so it is a positioned compile error instead of a
// silent literal-<slot>-element render.
func walkSlots(nodes []Node, file string, seen map[string]Position, inCallSite bool) *ParseError {
	for _, n := range nodes {
		switch node := n.(type) {
		case *Slot:
			if node.Name != "" {
				if inCallSite {
					return errAt(file, node.Pos, "<slot name=%q> inside a component invocation is not supported — only the bare default <slot/> forwards through a component", node.Name)
				}
				if prev, dup := seen[node.Name]; dup {
					return errAt(file, node.Pos, "duplicate slot name %q — already declared at %d:%d", node.Name, prev.Line, prev.Col)
				}
				seen[node.Name] = node.Pos
			} else {
				// The default marker (<children/> or <Slot/>, D74) is unique per
				// body too: two of them would splice the SAME slotChildren vnodes
				// into both markers at runtime, corrupting the DOM. Both spellings
				// produce a Name-less *Slot and key under "default" (a reserved,
				// unreachable name — namedSlotFromAttrs rejects name="default").
				if prev, dup := seen["default"]; dup {
					return errAt(file, node.Pos, "duplicate default marker (<children/>/<Slot/>) — already declared at %d:%d", prev.Line, prev.Col)
				}
				seen["default"] = node.Pos
			}
			if perr := walkSlots(node.Children, file, seen, inCallSite); perr != nil {
				return perr
			}
		case *Element:
			if perr := walkSlots(node.Children, file, seen, inCallSite); perr != nil {
				return perr
			}
		case *Component:
			if perr := validateCallSiteSlots(node, file); perr != nil {
				return perr
			}
			// Everything under a component invocation is call-site content — the
			// D71 named-forwarding rejection applies through nested elements,
			// control flow, and deeper component invocations alike. `seen` still
			// flows through: a default <slot/> inside AND outside the invocation
			// would splice the same default bucket twice, so the per-body
			// uniqueness check must keep counting in here.
			if perr := walkSlots(node.Children, file, seen, true); perr != nil {
				return perr
			}
		case *If:
			if perr := walkSlots(node.Then, file, seen, inCallSite); perr != nil {
				return perr
			}
			if perr := walkSlots(node.Else, file, seen, inCallSite); perr != nil {
				return perr
			}
		case *For:
			if perr := walkSlots(node.Body, file, seen, inCallSite); perr != nil {
				return perr
			}
		case *Case:
			for _, cl := range node.Clauses {
				if perr := walkSlots(cl.Body, file, seen, inCallSite); perr != nil {
					return perr
				}
			}
			if perr := walkSlots(node.Else, file, seen, inCallSite); perr != nil {
				return perr
			}
		}
	}
	return nil
}

// validateCallSiteSlots enforces the call-site slot rules on the DIRECT children
// of a component invocation: a dynamic slot={expr} target is rejected, and a
// control-flow block carrying top-level slot-attributed nodes is rejected. A
// static `slot` on a direct child is legal and rides through untouched.
func validateCallSiteSlots(comp *Component, file string) *ParseError {
	for _, child := range comp.Children {
		switch c := child.(type) {
		case *Element:
			if perr := checkStaticSlotAttr(c.Attrs, file); perr != nil {
				return perr
			}
		case *Component:
			if perr := checkStaticSlotAttr(c.Props, file); perr != nil {
				return perr
			}
		case *If, *For, *Case:
			if perr := rejectSlotInControlFlow(c, file); perr != nil {
				return perr
			}
		}
	}
	return nil
}

// checkStaticSlotAttr rejects a non-static `slot` target (slot={expr} or an
// interpolated slot="a{b}") on a direct component child; a static slot passes.
func checkStaticSlotAttr(attrs []Attr, file string) *ParseError {
	for _, a := range attrs {
		switch at := a.(type) {
		case *DynamicAttr:
			if at.Name == "slot" {
				return errAt(file, at.Pos, "slot target must be a static string, not slot={ ... }")
			}
		case *MixedAttr:
			if at.Name == "slot" {
				return errAt(file, at.Pos, "slot target must be a static string, not an interpolated value")
			}
		}
	}
	return nil
}

// rejectSlotInControlFlow reports a `slot`-attributed top-level node inside a
// control-flow block sitting at a component's direct-child level. Routing such a
// node silently would misroute (the block, not the element, is the direct child),
// so the fix is to move the condition INSIDE the slotted element.
func rejectSlotInControlFlow(n Node, file string) *ParseError {
	for _, branch := range controlFlowBranches(n) {
		for _, child := range branch {
			if pos, has := topLevelSlotAttr(child); has {
				pe := errAt(file, pos, "a slot target inside a {#if}/{#unless}/{#for}/{#case} block at a component's direct-child level is ambiguous — move the control-flow block inside the slotted element instead")
				pe.Note = slotInControlFlowNote
				return pe
			}
		}
	}
	return nil
}

// slotInControlFlowNote shows the two correct shapes for conditional slot
// content. Slot routing reads only a component's DIRECT children at compile
// time, so the element carrying `slot=` must sit immediately inside the
// component tag — the condition goes inside it, or around the whole component.
const slotInControlFlowNote = `slot routing reads only the component's DIRECT children, so the slot= element must sit immediately inside the component tag. Two correct shapes:

    (1) condition INSIDE the slotted element:

        <Card>
          <div slot="footer">
            {#if saved}<Badge>Saved</Badge>{/if}
          </div>
        </Card>

    (2) or branch the WHOLE component call:

        {#if saved}
          <Card><Badge slot="footer">Saved</Badge></Card>
        {:else}
          <Card/>
        {/if}`

// controlFlowBranches returns the child-node lists of a control-flow node's
// branches ({#if}/{#unless} then+else, {#for} body, {#case} clauses+else).
func controlFlowBranches(n Node) [][]Node {
	switch node := n.(type) {
	case *If:
		return [][]Node{node.Then, node.Else}
	case *For:
		return [][]Node{node.Body}
	case *Case:
		branches := make([][]Node, 0, len(node.Clauses)+1)
		for _, cl := range node.Clauses {
			branches = append(branches, cl.Body)
		}
		return append(branches, node.Else)
	}
	return nil
}

// topLevelSlotAttr returns the position of a `slot` attribute on an element or
// component node (any kind — static/dynamic/interpolated), and whether one exists.
func topLevelSlotAttr(n Node) (Position, bool) {
	switch node := n.(type) {
	case *Element:
		return slotAttrPos(node.Attrs)
	case *Component:
		return slotAttrPos(node.Props)
	}
	return Position{}, false
}

// slotAttrPos returns the position of a `slot` attribute among attrs, if present.
func slotAttrPos(attrs []Attr) (Position, bool) {
	for _, a := range attrs {
		if attrNameOf(a) == "slot" {
			return attrPos(a), true
		}
	}
	return Position{}, false
}
