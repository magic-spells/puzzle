//go:build darwin || dragonfly || freebsd || linux || netbsd || openbsd

// keys_unix.go puts stdin into "cbreak" mode so `puzzle dev` can read a single
// keypress (the 'q' quit) without waiting for Enter, and without echoing the
// keystroke to the terminal.
//
// We deliberately use CBREAK, not full raw mode:
//   - ISIG is left ON, so Ctrl+C still generates SIGINT — the existing signal
//     path keeps working exactly as before; 'q' is an addition, not a
//     replacement.
//   - The output flags (OPOST/ONLCR) are left untouched, so the rebuild/log
//     lines the dev loop prints keep their normal "\n"→"\r\n" translation and
//     don't stair-step across the terminal.
//
// We only clear ICANON (line buffering) and ECHO (so the typed 'q' is invisible),
// and set VMIN=1/VTIME=0 for a blocking one-byte read.
//
// The TTY gate is free: IoctlGetTermios fails when stdin is not a terminal
// (a pipe, file redirect, or CI), and we treat that failure as "not a TTY" and
// return ok=false — the feature silently switches off and nothing else changes.
package dev

import (
	"os"

	"golang.org/x/sys/unix"
)

// stdinCbreak switches os.Stdin into cbreak mode and returns a restore func that
// reverts it to the original settings. When stdin is not a TTY (get-termios
// fails) it returns (nil, false) and the caller skips the key listener.
func stdinCbreak() (restore func(), ok bool) {
	fd := int(os.Stdin.Fd())

	// A failed read IS the TTY check: pipes/files/CI have no termios.
	orig, err := unix.IoctlGetTermios(fd, ioctlReadTermios)
	if err != nil {
		return nil, false
	}

	raw := *orig
	// Clear line-buffering and echo only; leave ISIG (Ctrl+C) and the output
	// post-processing flags alone.
	raw.Lflag &^= unix.ICANON | unix.ECHO
	// Blocking single-byte reads: return as soon as one byte is available.
	raw.Cc[unix.VMIN] = 1
	raw.Cc[unix.VTIME] = 0

	if err := unix.IoctlSetTermios(fd, ioctlWriteTermios, &raw); err != nil {
		return nil, false
	}

	return func() {
		// Best-effort restore; nothing sensible to do if it fails on shutdown.
		_ = unix.IoctlSetTermios(fd, ioctlWriteTermios, orig)
	}, true
}
