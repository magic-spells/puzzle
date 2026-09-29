package codegen

import (
	"strings"
	"testing"
)

// A string-literal preset or zone the date functions do not know is a
// positioned compile error in every position the language reaches, handler
// arguments included; a known one and a dynamic one compile.
func TestLiteralDatePresetsAreChecked(t *testing.T) {
	for _, tc := range []struct{ name, body, want string }{
		{"time typo", "<p>{ time(at, 'shrot') }</p>", "T.pzl:2:17: unknown time preset 'shrot' — the presets are 'short', 'medium', 'long' and 'iso'"},
		{"date in an attribute", "<p title={ date(at, 'full') }>x</p>", "unknown date preset 'full'"},
		{"datetime in a handler argument", "<button @click={ save(datetime(at, 'longg')) }>x</button>", "unknown datetime preset 'longg'"},
		{"a retired preset name", "<p>{ datetime(at, 'date') }</p>", "'date' is not a datetime preset — call date(value) for that"},
		{"nested", "<p>{ truncate(date(at, 'shortt'), 3) }</p>", "unknown date preset 'shortt'"},
		{"in_timezone with a space", "<p>{ date(in_timezone(at, 'Eastern Time')) }</p>", "'Eastern Time' is not a time zone id"},
		{"in_timezone empty", "<p>{ in_timezone(at, '') }</p>", "'' is not a time zone id"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := compileCore(t, "  "+tc.body)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("error = %v, want it to contain %q", err, tc.want)
			}
		})
	}
	for _, body := range []string{
		"<p>{ time(at, 'short') } { date(at, 'long') } { datetime(at, 'iso') } { date(at) }</p>",
		"<p>{ date(at, preset) } { time(at, `short`) }</p>",
		"<p>{ date(in_timezone(at, 'America/New_York')) } { in_timezone(at, 'UTC') } { in_timezone(at, 'Etc/GMT+5') } { in_timezone(at, '+05:30') } { in_timezone(at, zone) }</p>",
		"<button @click={ time(at, 'shrot') }>x</button>",
	} {
		if _, err := compileCore(t, "  "+body); err != nil {
			t.Errorf("%s: unexpected error %v", body, err)
		}
	}
}
