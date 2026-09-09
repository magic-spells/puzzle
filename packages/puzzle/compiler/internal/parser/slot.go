package parser

import "strings"

// slot.go — compile-time validation for the composition markers (named slots
// v1.21/D53; capitalized grammar v1.64/D134; fallback bodies D141). See
// [[DOC-SPEC]] §24 and [[DECISION-D141-MARKER-FALLBACK-BODIES]].
//
// Two reserved tags have three roles:
//
//   <Children item={ item }>…fallback…</Children> — the DEFAULT marker
//   (call-site content), optionally handing named values to a Snippet.
//
//   <Slot>…fallback…</Slot> — the same unnamed marker used as the ROUTER OUTLET
//   (D30).
//
//   <Slot name="x" item={ item }>…fallback…</Slot> — a NAMED slot. `name` is
//   static, non-empty, and per-template-unique; "default" and "children" are
//   reserved and steer to <Children/>. Other valued attrs hand data to a scoped
//   Snippet. Local shape checks run in slotMarkerFromAttrs; the per-body
//   uniqueness check runs in validateSlots.
//
//   Call site (<Card><h2 slot="header">…</h2></Card>): the parser's job is
//   VALIDATION ONLY — a static `slot` attribute rides through codegen unchanged
//   inside the child vnode's attrs and is partitioned/stripped at runtime by the
//   ViewManager. On a DIRECT child of a component invocation: a dynamic
//   slot={expr} is an error, and a control-flow block ({#if}/{#unless}/{#case}/
//   {#for}) whose top-level nodes carry `slot` attributes is an error (silent
//   default-routing would misroute). Anywhere else `slot` is the ordinary HTML
//   global attribute and passes through untouched.

// childrenMarkerAttrs validates <Children>'s handed-data attributes. Every
// attribute must carry a value; bare names declare Snippet parameters instead.
func childrenMarkerAttrs(attrs []Attr, file string) ([]Attr, *ParseError) {
	var args []Attr
	for _, a := range attrs {
		if attrNameOf(a) == "ref" {
			return nil, errAt(file, attrPos(a), "ref cannot be placed on a <Children> — a children marker is a render target, not a real element")
		}
		if _, ok := a.(*EventAttr); ok {
			return nil, errAt(file, attrPos(a), "<Children> does not take event handlers")
		}
		if at, ok := a.(*StaticAttr); ok && at.Valueless {
			return nil, errAt(file, at.Pos, "bare attributes belong on <Snippet> as parameters — hand values over here with %s={ … }", at.Name)
		}
		args = append(args, a)
	}
	return args, nil
}

// portalMarkerAttrs validates a <Portal>'s attributes: v1 takes NONE. `to`/
// `name` are reserved with a specific message so user-placed named outlets can
// land later without breaking apps written against this grammar; `ref` gets the
// D72-style render-target message.
func portalMarkerAttrs(attrs []Attr, pos Position, file string) *ParseError {
	for _, a := range attrs {
		switch attrNameOf(a) {
		case "to", "name":
			return errAt(file, attrPos(a), "<Portal> takes no attributes — named outlets are not supported yet")
		case "ref":
			return errAt(file, attrPos(a), "ref cannot be placed on a <Portal> — a portal is a render target, not a real element")
		default:
			return errAt(file, attrPos(a), "<Portal> takes no attributes — every portal targets the app's single portal outlet")
		}
	}
	return nil
}

// slotMarkerFromAttrs resolves <Slot/>'s role by attributes. No attrs means the
// unnamed router outlet/default marker; one static name declares a named slot.
// Every other shape is a positioned compile error.
func slotMarkerFromAttrs(attrs []Attr, pos Position, file string) (name string, args []Attr, perr *ParseError) {
	hasName := false
	for _, a := range attrs {
		if attrNameOf(a) == "ref" {
			// ref on a <Slot> (v1.39, D72): a slot is a render target, not a real
			// element — reject with a ref-specific message before the generic one.
			return "", nil, errAt(file, attrPos(a), "ref cannot be placed on a <Slot> — a slot is a render target, not a real element")
		}
		switch at := a.(type) {
		case *StaticAttr:
			if at.Name == "name" {
				hasName = true
				name = at.Value
				continue
			}
			if at.Valueless {
				return "", nil, errAt(file, at.Pos, "bare attributes belong on <Snippet> as parameters — hand values over here with %s={ … }", at.Name)
			}
			args = append(args, a)
		case *DynamicAttr:
			if at.Name == "name" {
				return "", nil, errAt(file, at.Pos, "<Slot> name must be a static string, not name={ ... }")
			}
			args = append(args, a)
		case *MixedAttr:
			if at.Name == "name" {
				return "", nil, errAt(file, at.Pos, "<Slot> name must be a static string, not an interpolated value")
			}
			args = append(args, a)
		case *EventAttr:
			return "", nil, errAt(file, at.Pos, "<Slot> does not take event handlers")
		}
	}
	if !hasName {
		return "", args, nil
	}
	if name == "" {
		return "", nil, errAt(file, pos, "<Slot name> cannot be empty")
	}
	if name == "default" {
		return "", nil, errAt(file, pos, `<Slot name="default"> is reserved — use <Children/>`)
	}
	if name == "children" {
		return "", nil, errAt(file, pos, `<Slot name="children"> is reserved — use <Children/>`)
	}
	return name, args, nil
}

// snippetMarkerAttrs validates the caller-side <Snippet> declaration.
// `fits` is the sole valued attribute; every other attribute is a bare
// parameter declaration, preserved in source order for emitted metadata.
func snippetMarkerAttrs(attrs []Attr, file string) (fits string, params []string, perr *ParseError) {
	hasFits := false
	seen := map[string]Position{}
	for _, a := range attrs {
		name := attrNameOf(a)
		switch at := a.(type) {
		case *StaticAttr:
			if name == "fits" {
				if at.Valueless {
					return "", nil, errAt(file, at.Pos, `"fits" routes a <Snippet> — write fits="row"; it cannot be a parameter`)
				}
				if hasFits {
					return "", nil, errAt(file, at.Pos, "duplicate fits attribute on <Snippet>")
				}
				if at.Value == "" {
					return "", nil, errAt(file, at.Pos, "<Snippet fits> cannot be empty")
				}
				hasFits = true
				fits = at.Value
				continue
			}
			if !at.Valueless {
				return "", nil, errAt(file, at.Pos, "parameters on <Snippet> are bare — write %s, not %s={ … }", name, name)
			}
		case *DynamicAttr:
			if name == "fits" {
				return "", nil, errAt(file, at.Pos, "snippet target must be a static string, not fits={ ... }")
			}
			return "", nil, errAt(file, at.Pos, "parameters on <Snippet> are bare — write %s, not %s={ … }", name, name)
		case *MixedAttr:
			if name == "fits" {
				return "", nil, errAt(file, at.Pos, "snippet target must be a static string, not an interpolated value")
			}
			return "", nil, errAt(file, at.Pos, "parameters on <Snippet> are bare — write %s, not %s={ … }", name, name)
		case *EventAttr:
			return "", nil, errAt(file, at.Pos, "parameters on <Snippet> are bare — write %s, not %s={ … }", name, name)
		}
		if name == "fits" {
			return "", nil, errAt(file, attrPos(a), `"fits" routes a <Snippet> — write fits="row"; it cannot be a parameter`)
		}
		if !isBareIdent(name) {
			return "", nil, errAt(file, attrPos(a), "snippet parameter %q must be a valid identifier", name)
		}
		if identErr := snippetParamIdentError(name, attrPos(a), file); identErr != nil {
			return "", nil, identErr
		}
		if prev, dup := seen[name]; dup {
			return "", nil, errAt(file, attrPos(a), "duplicate snippet parameter %q — already declared at %d:%d", name, prev.Line, prev.Col)
		}
		seen[name] = attrPos(a)
		params = append(params, name)
	}
	return fits, params, nil
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
// content): only the default marker (<Children/>/<Slot/>) may forward through a
// component (v1.38, D71) — a NAMED slot there has no defined fill source (the
// router fills the default slot only, and named forwarding semantics are
// deliberately unspecified), so it is a positioned compile error instead of a
// silent marker render.
func walkSlots(nodes []Node, file string, seen map[string]Position, inCallSite bool) *ParseError {
	for _, n := range nodes {
		switch node := n.(type) {
		case *Slot:
			if node.Name != "" {
				if inCallSite {
					return errAt(file, node.Pos, "<Slot name=%q> inside a component invocation is not supported — only the bare default <Children/> or <Slot/> forwards through a component", node.Name)
				}
				if prev, dup := seen[node.Name]; dup {
					return errAt(file, node.Pos, "duplicate slot name %q — already declared at %d:%d", node.Name, prev.Line, prev.Col)
				}
				seen[node.Name] = node.Pos
			} else {
				// The default marker (<Children/> or <Slot/>, D134) is unique per
				// body too: distinct AST declarations share one reconciliation
				// namespace even when they hand args to a snippet. One marker
				// declaration inside a {#for} remains legal because this walk visits
				// that AST site once; runtime stamping supplies the N instances. Both
				// spellings produce a Name-less *Slot and key under "default" (a
				// reserved, unreachable name — slotMarkerFromAttrs rejects it).
				if prev, dup := seen["default"]; dup {
					return errAt(file, node.Pos, "duplicate default marker (<Children/>/<Slot/>) — already declared at %d:%d", prev.Line, prev.Col)
				}
				seen["default"] = node.Pos
			}
			if nested := nestedFallbackMarker(node.Children); nested != nil {
				return fallbackMarkerErr(nested, file)
			}
			if perr := walkSlots(node.Children, file, seen, inCallSite); perr != nil {
				return perr
			}
		case *Portal:
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
			// flows through: a default marker inside AND outside the invocation
			// would splice the same default bucket twice, so the per-body
			// uniqueness check must keep counting in here.
			for _, child := range node.Children {
				if snippet, ok := child.(*Snippet); ok {
					// A Snippet body is stamped output, not another composition owner.
					// Component invocations remain legal in it, but any marker anywhere
					// below them would survive stamping unexpanded. Reject that marker at
					// its own position, matching D141's fallback-body strictness.
					if nested := nestedSnippetBodyMarker(snippet.Body); nested != nil {
						return snippetBodyMarkerErr(nested, file)
					}
					// The body is still a separate validation scope: uniqueness does not
					// leak into or out of the enclosing template.
					if perr := walkSlots(snippet.Body, file, map[string]Position{}, true); perr != nil {
						return perr
					}
					continue
				}
				if perr := walkSlots([]Node{child}, file, seen, true); perr != nil {
					return perr
				}
			}
		case *Snippet:
			return errAt(file, node.Pos, "<Snippet> is only allowed as a direct child of a component invocation")
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

// nestedFallbackMarker returns the first marker anywhere inside a fallback
// body. D141 deliberately rejects recursive marker expansion; the error belongs
// to the inner marker, even when it is nested through elements, components, or
// control-flow branches.
func fallbackMarkerErr(n Node, file string) *ParseError {
	if p, ok := n.(*Portal); ok {
		return errAt(file, p.Pos, "<Portal> cannot appear inside a marker's fallback body (D141/D144)")
	}
	return errAt(file, nodePos(n), "a composition marker cannot appear inside another marker's fallback body (D141)")
}

func nestedFallbackMarker(nodes []Node) Node {
	for _, n := range nodes {
		switch node := n.(type) {
		case *Slot:
			return node
		case *Portal:
			return node
		case *Snippet:
			// A snippet body is a separate caller-owned render body. Markers
			// inside it are not nested in the surrounding marker fallback.
			continue
		case *Element:
			if found := nestedFallbackMarker(node.Children); found != nil {
				return found
			}
		case *Component:
			if found := nestedFallbackMarker(node.Children); found != nil {
				return found
			}
		case *If:
			if found := nestedFallbackMarker(node.Then); found != nil {
				return found
			}
			if found := nestedFallbackMarker(node.Else); found != nil {
				return found
			}
		case *For:
			if found := nestedFallbackMarker(node.Body); found != nil {
				return found
			}
		case *Case:
			for _, clause := range node.Clauses {
				if found := nestedFallbackMarker(clause.Body); found != nil {
					return found
				}
			}
			if found := nestedFallbackMarker(node.Else); found != nil {
				return found
			}
		}
	}
	return nil
}

// nestedSnippetBodyMarker returns the first composition marker anywhere in
// caller-owned stamped output. Unlike nestedFallbackMarker, component and
// Portal boundaries do not create an escape hatch: their call-site children are
// part of the same fn() output and an inner marker would still reach the runtime
// unexpanded. A snippet body is a composition LEAF (D166) — that includes a
// <Snippet> hanging off a nested component invocation, which is why the
// *Component case recurses instead of stopping. Nesting is expressed by
// extraction: move the inner invocation and its snippet into their own
// component, whose template declares the marker at top level.
func nestedSnippetBodyMarker(nodes []Node) Node {
	for _, n := range nodes {
		switch node := n.(type) {
		case *Slot, *Snippet:
			return node
		case *Portal:
			if found := nestedSnippetBodyMarker(node.Children); found != nil {
				return found
			}
		case *Element:
			if found := nestedSnippetBodyMarker(node.Children); found != nil {
				return found
			}
		case *Component:
			if found := nestedSnippetBodyMarker(node.Children); found != nil {
				return found
			}
		case *If:
			if found := nestedSnippetBodyMarker(node.Then); found != nil {
				return found
			}
			if found := nestedSnippetBodyMarker(node.Else); found != nil {
				return found
			}
		case *For:
			if found := nestedSnippetBodyMarker(node.Body); found != nil {
				return found
			}
		case *Case:
			for _, clause := range node.Clauses {
				if found := nestedSnippetBodyMarker(clause.Body); found != nil {
					return found
				}
			}
			if found := nestedSnippetBodyMarker(node.Else); found != nil {
				return found
			}
		}
	}
	return nil
}

func snippetBodyMarkerErr(n Node, file string) *ParseError {
	return errAt(file, nodePos(n), "a composition marker cannot appear inside a <Snippet> body — stamped output cannot declare composition positions; put the marker in the component's own template, and to give a nested component invocation a snippet of its own, move that invocation and its snippet into their own component")
}

// validateCallSiteSlots enforces the call-site slot rules on the DIRECT children
// of a component invocation: a dynamic slot={expr} target is rejected, and a
// control-flow block carrying top-level slot-attributed nodes is rejected. A
// static `slot` on a direct child is legal and rides through untouched.
func validateCallSiteSlots(comp *Component, file string) *ParseError {
	plain := map[string]Position{}
	for _, child := range comp.Children {
		switch c := child.(type) {
		case *Element:
			if perr := checkStaticSlotAttr(c.Attrs, file); perr != nil {
				return perr
			}
			name, has := staticSlotTarget(c.Attrs)
			if !has || name == "" {
				name = "default"
			}
			if _, exists := plain[name]; !exists {
				plain[name] = c.Pos
			}
		case *Component:
			if perr := checkStaticSlotAttr(c.Props, file); perr != nil {
				return perr
			}
			name, has := staticSlotTarget(c.Props)
			if !has || name == "" {
				name = "default"
			}
			if _, exists := plain[name]; !exists {
				plain[name] = c.Pos
			}
		case *If, *For, *Case:
			if perr := rejectSlotInControlFlow(c, file); perr != nil {
				return perr
			}
			if _, exists := plain["default"]; !exists {
				plain["default"] = nodePos(c)
			}
		case *Text:
			if strings.TrimSpace(c.Value) != "" {
				if _, exists := plain["default"]; !exists {
					plain["default"] = c.Pos
				}
			}
		case *Snippet:
			// Collected in the second pass after all ordinary fills are known.
		default:
			if _, exists := plain["default"]; !exists {
				plain["default"] = nodePos(c)
			}
		}
	}

	snippets := map[string]Position{}
	for _, child := range comp.Children {
		snippet, ok := child.(*Snippet)
		if !ok {
			continue
		}
		name := snippet.Fits
		if name == "" {
			name = "default"
		}
		if prev, dup := snippets[name]; dup {
			return errAt(file, snippet.Pos, "duplicate Snippet for %q — already declared at %d:%d", name, prev.Line, prev.Col)
		}
		snippets[name] = snippet.Pos
		if prev, conflict := plain[name]; conflict {
			if name == "default" {
				return errAt(file, snippet.Pos, "a default <Snippet> cannot be mixed with ordinary default content in the same component invocation (content starts at %d:%d)", prev.Line, prev.Col)
			}
			return errAt(file, snippet.Pos, "<Snippet fits=%q> conflicts with ordinary content routed to slot %q at %d:%d", name, name, prev.Line, prev.Col)
		}
	}
	return nil
}

func staticSlotTarget(attrs []Attr) (string, bool) {
	for _, a := range attrs {
		if at, ok := a.(*StaticAttr); ok && at.Name == "slot" {
			return at.Value, true
		}
	}
	return "", false
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
			if snippet, ok := child.(*Snippet); ok {
				pe := errAt(file, snippet.Pos, "a <Snippet> inside a {#if}/{#unless}/{#for}/{#case} block at a component's direct-child level is ambiguous — put the <Snippet> immediately inside the component tag")
				pe.Note = slotInControlFlowNote
				return pe
			}
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
