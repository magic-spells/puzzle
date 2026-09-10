package update

import (
	"errors"
	"os"
	"os/exec"
)

// RefreshCommand is the hidden subcommand the detached helper runs. It is the
// whole reason the helper exists: `puzzle build` finishes and exits in
// milliseconds, so an in-process goroutine refreshing the cache dies before the
// request completes. A separate process outlives the command that started it.
const RefreshCommand = "update-check"

// helperEnv marks the child so it cannot start a helper of its own. The
// subcommand does not print the notice, so recursion is already impossible by
// construction — this makes it impossible by inspection too, and survives
// someone later wiring the notice into more commands.
const helperEnv = "PUZZLE_UPDATE_HELPER"

// executablePath resolves the CLI to re-exec. A seam: the spawn integration
// test points it at a freshly built binary, because a test process's own
// executable is the test binary.
var executablePath = os.Executable

// spawnRefresh starts the detached background refresh. A seam: unit tests
// replace it to observe that a spawn was requested without forking anything.
var spawnRefresh = spawnDetached

// spawnDetached starts `puzzle update-check` as a process that survives this
// one: its own session (or process group on Windows), null standard streams so
// it holds nothing of the terminal open, and no Wait — the parent releases it
// and exits.
func spawnDetached() error {
	if os.Getenv(helperEnv) != "" {
		return errors.New("update: refusing to spawn a refresh helper from a helper")
	}
	exe, err := executablePath()
	if err != nil {
		return err
	}
	cmd := exec.Command(exe, RefreshCommand)
	// nil streams give the child the null device on every platform, which is
	// what keeps a detached helper from writing over a prompt after the command
	// that started it has returned to the shell.
	cmd.Stdin, cmd.Stdout, cmd.Stderr = nil, nil, nil
	cmd.Env = append(os.Environ(), helperEnv+"=1")
	detach(cmd)
	if err := cmd.Start(); err != nil {
		return err
	}
	// Release, never Wait: nothing here is going to be alive to reap the child.
	// The init process adopts it.
	return cmd.Process.Release()
}
