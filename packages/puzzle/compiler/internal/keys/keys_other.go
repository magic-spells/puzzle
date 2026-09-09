//go:build !(darwin || dragonfly || freebsd || linux || netbsd || openbsd)

// keys_other.go is the no-op fallback for platforms without a unix termios
// (Windows, js/wasm, …). The "press q to quit" affordance is simply off there:
// StdinCbreak reports (nil, false), so neither `puzzle dev` nor `puzzle preview`
// ever starts the key listener or prints the quit hint. Ctrl+C shutdown is
// unaffected.
package keys

// StdinCbreak is unsupported on this platform; the key listener stays off.
func StdinCbreak() (func(), bool) {
	return nil, false
}
