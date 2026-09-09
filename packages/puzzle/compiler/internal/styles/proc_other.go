//go:build !unix

package styles

import "os/exec"

// setProcAttr is a no-op on non-unix platforms: process groups are handled
// differently (and killing the direct child is sufficient for our `node`-run
// watcher, which spawns no subshell).
func setProcAttr(cmd *exec.Cmd) {}

// killProcessTree kills the child process. On non-unix platforms we do not form
// a process group; the watcher is a single `node`/CLI process, so killing it
// directly is enough.
func killProcessTree(cmd *exec.Cmd) {
	if cmd == nil || cmd.Process == nil {
		return
	}
	_ = cmd.Process.Kill()
}
