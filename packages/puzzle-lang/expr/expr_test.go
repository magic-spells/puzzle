package expr

import (
	"fmt"
	"math"
	"os"
	"runtime"
	"runtime/debug"
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
		t.Error("an arrow at the top level must fail: arrows are call arguments only")
	}
	// The default is not a handler: `event` there is the DOM event, whose
	// chain skips the method table; in a value position it is data.
	if _, err := Parse("event.target.closest('li')", Pos{Line: 1, Col: 1}); err == nil {
		t.Error("outside a handler an event chain is data and keeps the method table")
	}
	mustParse(t, "event.target.closest('li')", Pos{Line: 1, Col: 1}, Options{Handler: true})
}

// Outside a handler `event` is an ordinary name: a data field or prop named
// `event` reads like any other, as a plain member tree.
func TestEventOutsideAHandlerIsData(t *testing.T) {
	n := mustParse(t, "event.title", Pos{Line: 1, Col: 1})
	m, ok := n.(*Member)
	if !ok || m.Computed || m.Optional || m.Property != "title" {
		t.Fatalf("event.title: got %T %s, want a plain member", n, Print(n))
	}
	if id, ok := m.Object.(*Identifier); !ok || id.Name != "event" {
		t.Fatalf("event.title: object %T, want the identifier event", m.Object)
	}
}

// A binding-name rule, shared by arrow parameters here and by the template
// parser's {#for} and <Snippet> bindings.
func TestBindingNames(t *testing.T) {
	for _, name := range []string{"item", "größe", "値段", "$el", "_x", "eval2", "async", "of", "Date", "JSON", "event"} {
		if !IsIdentifier(name) || BindingNameReason(name) != "" {
			t.Errorf("%q should be bindable (%q)", name, BindingNameReason(name))
		}
	}
	for _, name := range []string{"", "1x", "a-b", "a b", "a.b"} {
		if IsIdentifier(name) {
			t.Errorf("%q is not an identifier", name)
		}
	}
	for name, reason := range map[string]string{
		"class": "strict-mode", "this": "strict-mode", "eval": "strict-mode", "arguments": "strict-mode",
		"null": "strict-mode", "NaN": "literal", "Infinity": "literal", "undefined": "literal",
		"Math": "global", "Number": "global", "Boolean": "global",
		"Object": "global", "parseInt": "global", "isFinite": "global", "Array": "global",
	} {
		if got := BindingNameReason(name); !strings.Contains(got, reason) {
			t.Errorf("%q: reason %q, want one mentioning %q", name, got, reason)
		}
	}
}

// The receiver-type table covers every global function.
func TestGlobalResultTypes(t *testing.T) {
	for ns, fns := range GlobalFunctions {
		for _, fn := range fns {
			if globalResultTypes[ns+"."+fn] == "" {
				t.Errorf("%s.%s has no result type", ns, fn)
			}
		}
	}
}

// A large expression parses in linear time. Each shape (a flat operator
// chain, a long array, a long string, a long argument list, a member path, and
// a template literal with a substitution every five bytes) is timed at 16 KiB,
// 64 KiB, 256 KiB, and 1 MiB, smallest first. A linear parse costs about the
// same per byte at every size; a quadratic one costs 16 times more per byte at
// 256 KiB than at 16 KiB, and 64 times more at 1 MiB.
//
// After each size the test fits the linear model t = c·n to the sizes timed so
// far by least squares. A size's pull on c grows with the square of its
// length, so c is in effect the per-byte cost of the largest sizes: the ones
// where fixed costs and timer noise matter least, and where a quadratic term
// shows. A linear parse costs a smaller size about c per byte, or more where
// fixed costs weigh; a quadratic one costs it far less. So the test fails when
// the fit comes to more than linearHeadroom (linearHeadroomCI when CI is set)
// times what some size took, and it holds that verdict until the newest size
// takes at least linearFloor. The fit is not the cheapest size's per-byte
// cost: one reading that came out low would set it, and every other size
// would then look slow.
//
// A timing test on a shared runner needs a fair measurement and a repeatable
// verdict:
//   - a size is timed over repeated parses, at least linearMinParses of them
//     and at least linearRun of wall time, and one parse costs the total over
//     the count. A single parse is too short to time. Windows advances its
//     monotonic clock once per timer interrupt, 0.5 to 15.6 ms apart, so a
//     sub-millisecond parse reads as 0 or as a whole tick, and the fastest of
//     several readings is 0. That is how a Windows runner once timed a 16 KiB
//     parse at 0 ns/B, next to which every larger size looked infinitely
//     slow. Timed over linearRun, a size is off by at most one tick per
//     stretch of parses, and never reads as 0;
//   - every stretch of timed parses starts from a collected heap with
//     collection paused, so the time is the parser's own work. What collection
//     costs depends on heap state the parse does not control: a small parse
//     can finish below the runtime's minimum heap and never collect, and a
//     heavy shape timed just before can leave a heap goal high enough that a
//     mid-size parse skips collection while the 1 MiB one pays for it — the
//     lopsided comparison that once put the linear template shape at 22 times
//     the time for 4 times the input on a Windows runner. A stretch ends
//     before it allocates linearStretchBytes, so collection stays paused
//     through it, and a memory limit restarts collection before a regression
//     that allocates quadratically exhausts memory;
//   - a shape that fails is timed again, up to linearAttempts in all. A real
//     regression fails every attempt; a busy runner does not.
func TestLargeExpressionIsLinear(t *testing.T) {
	if testing.Short() {
		t.Skip("timing test")
	}
	headroom := linearHeadroom
	if os.Getenv("CI") != "" {
		headroom = linearHeadroomCI
	}
	shapes := []struct {
		name string
		gen  func(n int) string
	}{
		{"operator chain", func(n int) string { return strings.Repeat("a + ", n/4) + "a" }},
		{"array", func(n int) string { return "[" + strings.Repeat("1, ", n/3) + "1]" }},
		{"string", func(n int) string { return "'" + strings.Repeat("x", n) + "'" }},
		{"arguments", func(n int) string { return "f(" + strings.Repeat("a.b, ", n/5) + "c)" }},
		{"member path", func(n int) string { return "a" + strings.Repeat(".b", n/2) }},
		{"template", func(n int) string { return "`" + strings.Repeat("x${a}", n/5) + "`" }},
	}
	for _, s := range shapes {
		var failures []string
		for attempt := 1; attempt <= linearAttempts; attempt++ {
			report, ok := measureLinear(t, s.gen, headroom)
			if ok {
				t.Logf("%s: %s", s.name, report)
				break
			}
			failures = append(failures, report)
		}
		if len(failures) == linearAttempts {
			t.Errorf("%s: not linear in %d attempts (headroom %g×):\n\t%s",
				s.name, linearAttempts, headroom, strings.Join(failures, "\n\t"))
		}
	}
}

const (
	// linearHeadroom is how far the fit may come over what a size took. Linear
	// shapes measure within about 1.2× of it; a quadratic one comes to 15× its
	// 16 KiB size at 256 KiB, and a quadratic term more than about twice the
	// linear cost at 1 MiB crosses 3×.
	linearHeadroom = 3.0
	// linearHeadroomCI allows for a shared runner's noisier clock and memory.
	// A quadratic shape still comes to about 15× at 256 KiB, and a quadratic
	// term more than about four times the linear cost at 1 MiB crosses 5×.
	linearHeadroomCI = 5.0
	// linearFloor holds the verdict until the newest size parses in at least
	// this long: until then every size is too fast to judge. A linear parse
	// reaches it by 1 MiB; a real quadratic path crosses it by 256 KiB.
	linearFloor = 20 * time.Millisecond
	// linearRun and linearMinParses are the least wall time and the fewest
	// parses a size is timed over.
	linearRun       = 50 * time.Millisecond
	linearMinParses = 3
	// linearStretchBytes caps what a stretch of timed parses allocates between
	// collections, so collection stays paused through the stretch and the heap
	// stays near what one large parse needs. A parse that allocates more is a
	// stretch alone.
	linearStretchBytes = 64 << 20
	// linearMemoryLimit restarts collection if a regression allocates
	// quadratically. A 1 MiB shape allocates at most about 450 MiB a parse.
	linearMemoryLimit = 1 << 30
	// linearAttempts is how many times a failing shape is timed before the
	// test fails.
	linearAttempts = 3
)

var linearSizes = []int{16 << 10, 64 << 10, 256 << 10, 1 << 20}

// measureLinear times gen's source at each of linearSizes, smallest first,
// and reports whether the least-squares fit t = c·n stayed within headroom of
// what every size took. It stops at the first size where it did not, so a
// quadratic regression never runs its largest input.
func measureLinear(t *testing.T, gen func(n int) string, headroom float64) (string, bool) {
	t.Helper()
	var perByte []float64 // each size's ns per byte of source
	var parts []string
	var sumNT, sumNN, fit, worst float64
	judged := false
	for _, n := range linearSizes {
		src := gen(n)
		d := timeParse(t, src)
		b, ns := float64(len(src)), float64(d.Nanoseconds())
		perByte = append(perByte, ns/b)
		parts = append(parts, fmt.Sprintf("%d KiB %v (%.0f ns/B)", n>>10, d.Round(time.Microsecond), ns/b))
		// Least squares for t = c·n: c = Σ n·t / Σ n², each size weighing n².
		sumNT, sumNN = sumNT+b*ns, sumNN+b*b
		fit, worst = sumNT/sumNN, 0
		judged = judged || d >= linearFloor
		for i, cost := range perByte {
			over := fit / cost
			if judged && over > headroom {
				return fmt.Sprintf("%s — the fit (%.0f ns/B) comes to %.1f× what %d KiB took",
					strings.Join(parts, ", "), fit, over, linearSizes[i]>>10), false
			}
			worst = max(worst, over)
		}
	}
	verdict := ""
	if !judged {
		verdict = "; too fast to judge"
	}
	return fmt.Sprintf("%s — fit %.0f ns/B, at most %.2f× what a size took%s",
		strings.Join(parts, ", "), fit, worst, verdict), true
}

// timeParse returns what one parse of src costs, from at least
// linearMinParses parses and at least linearRun of wall time. The parses run
// back to back in stretches, each started from a collected heap with
// collection paused and holding as many parses as fit in linearStretchBytes.
func timeParse(t *testing.T, src string) time.Duration {
	t.Helper()
	defer debug.SetGCPercent(debug.SetGCPercent(-1))
	defer debug.SetMemoryLimit(debug.SetMemoryLimit(linearMemoryLimit))
	parse := func() {
		if _, err := Parse(src, Pos{Line: 1, Col: 1}); err != nil {
			t.Fatalf("parse %d bytes: %v", len(src), err)
		}
	}
	// An untimed parse warms the code and a parse's worth of heap pages, and
	// shows what one parse allocates.
	var before, after runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&before)
	parse()
	runtime.ReadMemStats(&after)
	perStretch := max(1, linearStretchBytes/max(1, int(after.TotalAlloc-before.TotalAlloc)))
	var total time.Duration
	parses := 0
	for total < linearRun || parses < linearMinParses {
		runtime.GC()
		start := time.Now()
		for range perStretch {
			parse()
			parses++
			if total+time.Since(start) >= linearRun && parses >= linearMinParses {
				break
			}
		}
		total += time.Since(start)
	}
	return total / time.Duration(parses)
}
