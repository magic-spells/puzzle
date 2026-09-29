package codegen

import (
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/packages/puzzle-lang/parser"
)

// compileWarnings compiles a core template and returns its warnings.
func compileWarnings(t *testing.T, body string) []Warning {
	t.Helper()
	sec, err := parser.SplitSections(coreSrc(body), "T.pzl")
	if err != nil {
		t.Fatal(err)
	}
	res, err := Compile(sec, Options{Filename: "T.pzl", Mode: ModeView})
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	return res.Warnings
}

// A string-literal preset or zone the standard date functions do not know is
// a positioned compile-time warning in every position the language reaches,
// handler arguments included — never an error, because an app may register
// its own date/time/datetime (shadowing wins, D6) with presets of its own.
// A known preset, a dynamic one and a handler's own call draw nothing.
func TestLiteralDatePresetsWarn(t *testing.T) {
	for _, tc := range []struct{ name, body, want string }{
		{"time typo", "<p>{ time(at, 'shrot') }</p>", "T.pzl:2:17: unknown time preset 'shrot' — the standard presets are 'short', 'medium', 'long' and 'iso'; the standard time() renders its default for any other"},
		{"date in an attribute", "<p title={ date(at, 'full') }>x</p>", "unknown date preset 'full'"},
		{"datetime in a handler argument", "<button @click={ save(datetime(at, 'longg')) }>x</button>", "unknown datetime preset 'longg'"},
		{"a retired preset name", "<p>{ datetime(at, 'date') }</p>", "'date' is not a datetime preset — call date(value) for that"},
		{"nested", "<p>{ truncate(date(at, 'shortt'), 3) }</p>", "unknown date preset 'shortt'"},
		{"in_timezone with a space", "<p>{ date(in_timezone(at, 'Eastern Time')) }</p>", "'Eastern Time' is not a time zone id"},
		{"in_timezone empty", "<p>{ in_timezone(at, '') }</p>", "'' is not a time zone id"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ws := compileWarnings(t, "  "+tc.body)
			if len(ws) != 1 {
				t.Fatalf("want one warning, got %v", ws)
			}
			got := ws[0].File + ":" + itoa(ws[0].Line) + ":" + itoa(ws[0].Col) + ": " + ws[0].Message
			if !strings.Contains(got, tc.want) {
				t.Fatalf("warning = %q, want it to contain %q", got, tc.want)
			}
		})
	}
	for _, body := range []string{
		"<p>{ time(at, 'short') } { date(at, 'long') } { datetime(at, 'iso') } { date(at) }</p>",
		"<p>{ date(at, preset) } { time(at, `short`) }</p>",
		"<p>{ date(in_timezone(at, 'America/New_York')) } { in_timezone(at, 'UTC') } { in_timezone(at, 'Etc/GMT+5') } { in_timezone(at, '+05:30') } { in_timezone(at, zone) }</p>",
		"<button @click={ time(at, 'shrot') }>x</button>",
	} {
		// The handler named `time` draws its own shadow warning (§9 c), never a
		// preset one: its call is the view's handler, not the function.
		for _, w := range compileWarnings(t, "  "+body) {
			if strings.Contains(w.Message, "preset") || strings.Contains(w.Message, "time zone") {
				t.Errorf("%s: unexpected warning %v", body, w)
			}
		}
	}
}
