package parser

// options.go is the parser's per-host switchboard (D172: one parser that
// knows every construct, with per-dialect switches). The parser supports the
// whole language; each host turns on the extensions it uses and turns off the
// checks that do not apply to it.
//
// The zero Options is PuzzleKit's grammar exactly: every extension is off and
// every check is on, so a caller that passes nothing — the compiler — parses
// and diagnoses byte-for-byte as it did before Options existed.

// Options selects the optional grammar and checks for one parse. Every public
// entry point takes at most one Options value as a trailing argument; passing
// none is the zero value.
type Options struct {
	// Let turns on the {#let} block (let.go): `{#let name = expression}`, or
	// one assignment per line in the multiline form. It names values for the
	// rest of the child list it sits in. Off, `{#let}` is the ordinary
	// unknown-block error. Sites turns it on; PuzzleKit names computed values
	// in data() instead.
	Let bool

	// SkipIslandCheck skips the post-parse `island` rules (island.go). A host
	// with no islands — Sites renders on the server and drops the attribute —
	// diagnoses `island` itself.
	SkipIslandCheck bool
	// SkipSlotCheck skips the post-parse composition rules for <Children/>,
	// <Slot>, <Snippet> and slot= call-site routing (slot.go). A host whose
	// slot rules depend on the kind of file it is parsing (Sites's layouts
	// reserve named slots) runs its own.
	SkipSlotCheck bool
	// SkipRefCheck skips the post-parse `ref` rules (refs.go). A host with no
	// element refs diagnoses `ref` itself.
	SkipRefCheck bool
}

// pickOptions returns the one Options a variadic entry point received, or the
// zero value.
func pickOptions(opts []Options) Options {
	if len(opts) > 0 {
		return opts[0]
	}
	return Options{}
}

// validate runs the post-parse checks the options leave on, in the order the
// parser has always run them.
func (o Options) validate(root *Element, file string) *ParseError {
	if !o.SkipIslandCheck {
		if perr := validateIslands(root, file); perr != nil {
			return perr
		}
	}
	if !o.SkipSlotCheck {
		if perr := validateSlots(root, file); perr != nil {
			return perr
		}
	}
	if !o.SkipRefCheck {
		if perr := validateRefs(root, file); perr != nil {
			return perr
		}
	}
	return nil
}
