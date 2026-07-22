//go:build linux

// keys_termios_linux.go pins the Linux ioctl requests for reading and writing
// the terminal attributes: TCGETS/TCSETS (BSD/darwin use TIOCGETA/TIOCSETA — see
// keys_termios_bsd.go). This split mirrors how golang.org/x/term selects the
// constant per platform.
package dev

import "golang.org/x/sys/unix"

const (
	ioctlReadTermios  = unix.TCGETS
	ioctlWriteTermios = unix.TCSETS
)
