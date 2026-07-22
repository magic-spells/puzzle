//go:build darwin || dragonfly || freebsd || netbsd || openbsd

// keys_termios_bsd.go pins the BSD/darwin ioctl requests for reading and writing
// the terminal attributes. On these systems they are TIOCGETA/TIOCSETA (Linux
// uses TCGETS/TCSETS — see keys_termios_linux.go). This split mirrors how
// golang.org/x/term selects the constant per platform.
package dev

import "golang.org/x/sys/unix"

const (
	ioctlReadTermios  = unix.TIOCGETA
	ioctlWriteTermios = unix.TIOCSETA
)
