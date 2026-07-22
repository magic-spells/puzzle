package ui

import (
	"bytes"
	"os"
	"strings"
	"testing"
)

func TestLineWriterBuffersFiltersAndFlushes(t *testing.T) {
	var out bytes.Buffer
	w := NewLineWriter(&out, func(line string) (string, bool) {
		if strings.HasPrefix(line, "drop") {
			return "", false
		}
		return strings.ToUpper(line), true
	})

	if _, err := w.Write([]byte("hel")); err != nil {
		t.Fatal(err)
	}
	if _, err := w.Write([]byte("lo\ndrop me\nwo")); err != nil {
		t.Fatal(err)
	}
	if _, err := w.Write([]byte("rld\nfinal")); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}

	want := "HELLO\nWORLD\nFINAL\n"
	if got := out.String(); got != want {
		t.Fatalf("line writer output = %q, want %q", got, want)
	}
}

func TestLineWriterHandlesCRLF(t *testing.T) {
	var out bytes.Buffer
	w := NewLineWriter(&out, func(line string) (string, bool) {
		return "[" + line + "]", true
	})
	if _, err := w.Write([]byte("one\r\ntwo\r")); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	if got, want := out.String(), "[one]\n[two]\n"; got != want {
		t.Fatalf("line writer output = %q, want %q", got, want)
	}
}

func TestColorEnabledConditions(t *testing.T) {
	env := func(values map[string]string) func(string) string {
		return func(key string) string { return values[key] }
	}

	if !colorEnabled(os.ModeCharDevice, env(map[string]string{"TERM": "xterm-256color"})) {
		t.Fatal("expected color for terminal mode with normal env")
	}
	if colorEnabled(0, env(map[string]string{"TERM": "xterm-256color"})) {
		t.Fatal("regular files must not enable color")
	}
	if colorEnabled(os.ModeCharDevice, env(map[string]string{"TERM": "dumb"})) {
		t.Fatal("TERM=dumb must disable color")
	}
	if colorEnabled(os.ModeCharDevice, env(map[string]string{"TERM": "xterm", "NO_COLOR": "1"})) {
		t.Fatal("NO_COLOR must disable color")
	}
}

func TestPrinterStylesNoopWhenDisabled(t *testing.T) {
	p := &Printer{}
	if got := p.Bold(p.Magenta("Puzzle")); got != "Puzzle" {
		t.Fatalf("disabled printer should not style text, got %q", got)
	}
}
