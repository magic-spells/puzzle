//go:build !(darwin || dragonfly || freebsd || linux || netbsd || openbsd)

// keys_other.go is the no-op fallback for platforms without a unix termios
// (Windows, js/wasm, …). The "press q to quit" affordance is simply off there:
// stdinCbreak reports (nil, false), so Serve never starts the key listener and
// never prints the quit hint. Ctrl+C shutdown is unaffected.
package dev

// stdinCbreak is unsupported on this platform; the key listener stays off.
func stdinCbreak() (func(), bool) {
	return nil, false
}
