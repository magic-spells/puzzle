// Package ui contains small terminal-formatting helpers for the compiler CLI.
package ui

import (
	"bytes"
	"io"
	"os"
	"sync"
	"time"

	"github.com/mattn/go-isatty"
)

const (
	ansiReset   = "\x1b[0m"
	ansiBold    = "\x1b[1m"
	ansiDim     = "\x1b[2m"
	ansiRed     = "\x1b[31m"
	ansiGreen   = "\x1b[32m"
	ansiYellow  = "\x1b[33m"
	ansiCyan    = "\x1b[36m"
	ansiMagenta = "\x1b[35m"
)

// Printer applies ANSI styling when its stream supports color.
type Printer struct {
	enabled bool
}

// New returns a printer for f. Styling is enabled only for terminal files when
// NO_COLOR is unset and TERM is not "dumb".
func New(f *os.File) *Printer {
	return newWithEnv(f, os.Getenv)
}

// IsTerminal reports whether f is a real terminal. A char-device stat check is
// not enough: /dev/null is a character device, and treating it as a TTY makes
// interactive prompts block forever in cron/CI environments.
func IsTerminal(f *os.File) bool {
	if f == nil {
		return false
	}
	return isatty.IsTerminal(f.Fd()) || isatty.IsCygwinTerminal(f.Fd())
}

func newWithEnv(f *os.File, getenv func(string) string) *Printer {
	if f == nil {
		return &Printer{}
	}
	info, err := f.Stat()
	if err != nil {
		return &Printer{}
	}
	return &Printer{enabled: colorEnabled(info.Mode(), getenv)}
}

func colorEnabled(mode os.FileMode, getenv func(string) string) bool {
	return mode&os.ModeCharDevice != 0 && getenv("NO_COLOR") == "" && getenv("TERM") != "dumb"
}

// Enabled reports whether this printer emits ANSI escapes.
func (p *Printer) Enabled() bool {
	return p != nil && p.enabled
}

// Bold returns s in bold when color is enabled.
func (p *Printer) Bold(s string) string { return p.style(ansiBold, s) }

// Dim returns s dimmed when color is enabled.
func (p *Printer) Dim(s string) string { return p.style(ansiDim, s) }

// Red returns s in red when color is enabled.
func (p *Printer) Red(s string) string { return p.style(ansiRed, s) }

// Green returns s in green when color is enabled.
func (p *Printer) Green(s string) string { return p.style(ansiGreen, s) }

// Yellow returns s in yellow when color is enabled.
func (p *Printer) Yellow(s string) string { return p.style(ansiYellow, s) }

// Cyan returns s in cyan when color is enabled.
func (p *Printer) Cyan(s string) string { return p.style(ansiCyan, s) }

// Magenta returns s in magenta when color is enabled.
func (p *Printer) Magenta(s string) string { return p.style(ansiMagenta, s) }

func (p *Printer) style(code, s string) string {
	if !p.Enabled() || s == "" {
		return s
	}
	return code + s + ansiReset
}

// Clock returns the timestamp format used by dev-server log lines.
func Clock() string {
	return time.Now().Format("3:04:05 PM")
}

// NewLineWriter returns a writer that buffers bytes into lines, applies fn to
// each complete line, and writes accepted lines to dst.
func NewLineWriter(dst io.Writer, fn func(line string) (string, bool)) io.WriteCloser {
	if fn == nil {
		fn = func(line string) (string, bool) { return line, true }
	}
	return &lineWriter{dst: dst, fn: fn}
}

type lineWriter struct {
	mu     sync.Mutex
	dst    io.Writer
	fn     func(line string) (string, bool)
	buf    []byte
	closed bool
}

func (w *lineWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	if w.closed {
		return 0, io.ErrClosedPipe
	}
	n := len(p)
	for len(p) > 0 {
		i := bytes.IndexByte(p, '\n')
		if i < 0 {
			w.buf = append(w.buf, p...)
			return n, nil
		}
		w.buf = append(w.buf, p[:i]...)
		if err := w.emitLocked(string(bytes.TrimSuffix(w.buf, []byte("\r")))); err != nil {
			return n, err
		}
		w.buf = w.buf[:0]
		p = p[i+1:]
	}
	return n, nil
}

func (w *lineWriter) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()

	if w.closed {
		return nil
	}
	w.closed = true
	if len(w.buf) == 0 {
		return nil
	}
	line := string(bytes.TrimSuffix(w.buf, []byte("\r")))
	w.buf = nil
	return w.emitLocked(line)
}

func (w *lineWriter) emitLocked(line string) error {
	out, ok := w.fn(line)
	if !ok {
		return nil
	}
	if _, err := io.WriteString(w.dst, out); err != nil {
		return err
	}
	if len(out) == 0 || out[len(out)-1] != '\n' {
		_, err := io.WriteString(w.dst, "\n")
		return err
	}
	return nil
}
