package expr

import (
	"math"
	"strings"
	"testing"
	"time"
)

// expr_test.go covers what the conformance table cannot show: node positions
// (the table prints trees without them), the base position, Walk, number
// formatting, the method table, and time on large input.

func mustParse(t *testing.T, src string, base Pos, opts ...Options) Node {
	t.Helper()
	n, err := Parse(src, base, opts...)
	if err != nil {
		t.Fatalf("%q: %v", src, err)
	}
	return n
}

// Every node carries the position of its first token, in file coordinates
// relative to the base the caller passed.
func TestNodePositions(t *testing.T) {
	base := Pos{Line: 10, Col: 5, Offset: 200}
	src := "a.b +\n  items.filter(x => x.done)[0]"
	n := mustParse(t, src, base).(*Binary)
	check := func(what string, got, want Pos) {
		t.Helper()
		if got != want {
			t.Errorf("%s: got %+v, want %+v", what, got, want)
		}
	}
	check("binary", n.Pos(), base)
	check("binary operator", n.OpPos, Pos{10, 9, 204})
	left := n.Left.(*Member)
	check("member", left.Pos(), base)
	check("member property", left.PropPos, Pos{10, 7, 202})
	idx := n.Right.(*Member)
	check("index member", idx.Pos(), Pos{11, 3, 208})
	check("index bracket", idx.PropPos, Pos{11, 28, 233})
	call := idx.Object.(*Call)
	check("call", call.Pos(), Pos{11, 3, 208})
	check("method name", call.Callee.(*Member).PropPos, Pos{11, 9, 214})
	arrow := call.Args[0].(*Arrow)
	check("arrow", arrow.Pos(), Pos{11, 16, 221})
	check("arrow parameter", arrow.Params[0].Start, Pos{11, 16, 221})
	check("arrow body", arrow.Body.Pos(), Pos{11, 21, 226})
}

func TestNodePositionsInLiterals(t *testing.T) {
	n := mustParse(t, "{ k: [1, `a${b}`] }", Pos{Line: 1, Col: 1}).(*Object)
	if n.Entries[0].KeyPos != (Pos{1, 3, 2}) {
		t.Errorf("key: %+v", n.Entries[0].KeyPos)
	}
	arr := n.Entries[0].Value.(*Array)
	if arr.Pos() != (Pos{1, 6, 5}) || arr.Elements[1].Pos() != (Pos{1, 10, 9}) {
		t.Errorf("array %+v, template %+v", arr.Pos(), arr.Elements[1].Pos())
	}
	tpl := arr.Elements[1].(*TemplateLiteral)
	if tpl.Exprs[0].Pos() != (Pos{1, 14, 13}) {
		t.Errorf("substitution: %+v", tpl.Exprs[0].Pos())
	}
}

// Errors are positioned relative to the base too.
func TestErrorPositionUsesBase(t *testing.T) {
	_, err := Parse("a +\n b &", Pos{Line: 3, Col: 7, Offset: 50})
	e, ok := err.(*Error)
	if !ok {
		t.Fatalf("got %v", err)
	}
	if e.Pos != (Pos{4, 4, 57}) || e.Error() != "4:4: "+msgBitwise {
		t.Errorf("got %+v %q", e.Pos, e.Error())
	}
}

func TestWalkVisitsInSourceOrder(t *testing.T) {
	n := mustParse(t, "f(a, b.c[d ? e : `${g}`]) + { k: -h, l }", Pos{Line: 1, Col: 1})
	var names []string
	Walk(n, func(n Node) bool {
		if id, ok := n.(*Identifier); ok {
			names = append(names, id.Name)
		}
		return true
	})
	if got := strings.Join(names, " "); got != "f a b d e g h l" {
		t.Errorf("walk order: %s", got)
	}
	// Returning false skips a node's children: Binary, Call (children
	// skipped), Object, Unary, h, l.
	count := 0
	Walk(n, func(n Node) bool {
		count++
		_, isCall := n.(*Call)
		return !isCall
	})
	if count != 6 {
		t.Errorf("visited %d nodes with calls skipped, want 6", count)
	}
}

// NaN and Infinity print like names, so the node types are pinned here: they
// are number literals, never data reads, and Math.PI is a Global.
func TestLiteralWordsAndConstants(t *testing.T) {
	for src, want := range map[string]float64{"NaN": math.NaN(), "Infinity": math.Inf(1)} {
		lit, ok := mustParse(t, src, Pos{Line: 1, Col: 1}).(*Literal)
		if !ok || lit.Kind != LitNumber || lit.Raw != src {
			t.Fatalf("%s: got %#v, want a number literal", src, lit)
		}
		if !(math.IsNaN(want) && math.IsNaN(lit.Num)) && lit.Num != want {
			t.Errorf("%s: value %v", src, lit.Num)
		}
	}
	g, ok := mustParse(t, "Math.PI", Pos{Line: 1, Col: 1}).(*Global)
	if !ok || g.Namespace != "Math" || g.Name != "PI" {
		t.Errorf("Math.PI: got %#v", g)
	}
	call := mustParse(t, "Number(x)", Pos{Line: 1, Col: 1}).(*Call)
	if g, ok := call.Callee.(*Global); !ok || g.Namespace != "" || g.Name != "Number" {
		t.Errorf("Number(x) callee: got %#v", call.Callee)
	}
}

func TestFormatNumber(t *testing.T) {
	for f, want := range map[float64]string{
		0: "0", math.Copysign(0, -1): "0", 1: "1", -1.5: "-1.5", 0.1: "0.1",
		100: "100", 1e21: "1e+21", 1.5e21: "1.5e+21", 123e-20: "1.23e-18",
		1e-6: "0.000001", 1e-7: "1e-7", 0.30000000000000004: "0.30000000000000004",
		math.Inf(1): "Infinity", math.Inf(-1): "-Infinity", math.NaN(): "NaN",
		math.MaxFloat64: "1.7976931348623157e+308", 5e-324: "5e-324",
		123456789: "123456789", 2e20: "200000000000000000000",
	} {
		if got := FormatNumber(f); got != want {
			t.Errorf("FormatNumber(%v) = %q, want %q", f, got, want)
		}
	}
}

// The method table is data: the union the parser checks, the per-type lists
// a host implements, and no mutating method anywhere in it.
func TestMethodTable(t *testing.T) {
	for _, name := range []string{"trim", "toUpperCase", "filter", "toSorted", "reduce", "toFixed", "toString", "at"} {
		if !IsMethod(name) {
			t.Errorf("%s should be a method", name)
		}
	}
	for _, name := range []string{"length", "sort", "reverse", "push", "pop", "splice", "localeCompare", "normalize", "entries", "keys", "toPrecision", "getFullYear"} {
		if IsMethod(name) {
			t.Errorf("%s should not be a method", name)
		}
	}
	if !IsGlobalFunction("Math", "round") || !IsGlobalFunction("", "parseInt") || IsGlobalFunction("Math", "random") || IsGlobalFunction("", "Date") {
		t.Error("global function table")
	}
}

// Options is variadic: Parse(src, base) is the value-position default.
func TestParseDefaultOptions(t *testing.T) {
	if _, err := Parse("x => x", Pos{Line: 1, Col: 1}); err == nil {
		t.Error("an arrow at the top level must fail without CallArgument")
	}
	if _, err := Parse("event", Pos{Line: 1, Col: 1}); err == nil {
		t.Error("event must fail without AllowEvent")
	}
	mustParse(t, "event", Pos{Line: 1, Col: 1}, Options{AllowEvent: true})
}

// A large expression parses in linear time: a flat operator chain, a long
// array, a long string, and a long argument list. Each size quadruples; the
// time must not grow sixteenfold.
func TestLargeExpressionIsLinear(t *testing.T) {
	if testing.Short() {
		t.Skip("timing test")
	}
	shapes := map[string]func(n int) string{
		"operator chain": func(n int) string { return strings.Repeat("a + ", n/4) + "a" },
		"array":          func(n int) string { return "[" + strings.Repeat("1, ", n/3) + "1]" },
		"string":         func(n int) string { return "'" + strings.Repeat("x", n) + "'" },
		"arguments":      func(n int) string { return "f(" + strings.Repeat("a.b, ", n/5) + "c)" },
		"member path":    func(n int) string { return "a" + strings.Repeat(".b", n/2) },
		"template":       func(n int) string { return "`" + strings.Repeat("x${a}", n/5) + "`" },
	}
	for name, gen := range shapes {
		small, large := gen(1<<18), gen(1<<20)
		ts := timeParse(t, small)
		tl := timeParse(t, large)
		t.Logf("%s: %v / %v", name, ts, tl)
		if tl > 16*ts && tl > 50*time.Millisecond {
			t.Errorf("%s: 256 KiB in %v, 1 MiB in %v — not linear", name, ts, tl)
		}
	}
}

func timeParse(t *testing.T, src string) time.Duration {
	t.Helper()
	best := time.Duration(math.MaxInt64)
	for i := 0; i < 3; i++ {
		start := time.Now()
		if _, err := Parse(src, Pos{Line: 1, Col: 1}); err != nil {
			t.Fatalf("parse %d bytes: %v", len(src), err)
		}
		if d := time.Since(start); d < best {
			best = d
		}
	}
	return best
}
