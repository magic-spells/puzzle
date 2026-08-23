//go:build unix

package styles

import (
	"os/exec"
	"syscall"
)

// setProcAttr puts the child in its own process group so we can signal the whole
// tree (node + any helper it spawns) as a unit on shutdown.
func setProcAttr(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.Setpgid = true
}

// killProcessTree hard-kills the child's process group. Tailwind --watch has
// nothing to flush, so a straight SIGKILL of the group (negative pid) is the
// simple, reliable choice — it guarantees node dies with us rather than being
// reparented to init. Best-effort: a nil/already-exited process is a no-op.
func killProcessTree(cmd *exec.Cmd) {
	if cmd == nil || cmd.Process == nil {
		return
	}
	pid := cmd.Process.Pid
	if err := syscall.Kill(-pid, syscall.SIGKILL); err != nil {
		// Group signalling can fail if setProcAttr did not take (e.g. the child
		// never became a group leader); fall back to killing the process itself.
		_ = cmd.Process.Kill()
	}
}
