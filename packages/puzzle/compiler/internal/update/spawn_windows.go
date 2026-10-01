//go:build windows

package update

import (
	"os/exec"
	"syscall"
)

// Windows has no setsid. The equivalent is starting the process with no console
// of its own (DETACHED_PROCESS) in a fresh process group, so a Ctrl-C delivered
// to the console that ran `puzzle build` is not delivered to the refresh.
const (
	detachedProcess       = 0x00000008
	createNewProcessGroup = 0x00000200
)

func detach(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: detachedProcess | createNewProcessGroup,
	}
}
