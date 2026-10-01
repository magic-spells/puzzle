//go:build !windows

package update

import (
	"os/exec"
	"syscall"
)

// detach puts the helper in its own session. Setsid alone is enough — it makes
// a new session leader with no controlling terminal, which implies a new process
// group — so a Ctrl-C in the shell that ran `puzzle build` cannot kill the
// refresh, and the refresh cannot steal the terminal back.
func detach(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
}
