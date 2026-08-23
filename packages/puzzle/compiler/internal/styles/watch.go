package styles

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"
)

// TailwindWatcher manages a long-lived `tailwindcss --watch` child process. It
// is started ONCE per `puzzle dev` session (D27) instead of re-spawning the CLI
// on every rebuild (D26's one-shot path, retained for `puzzle build`). The child
// continuously rewrites its own private output file; the dev loop watches that
// file and recomposes dist/styles.css when it changes.
//
// Lifecycle: StartWatch launches the process and returns immediately. The
// process is killed when the supplied context is cancelled (shutdown) or via an
// explicit Stop. Done() closes when the process exits for any reason — the dev
// loop selects on it to detect an unexpected death and fall back to one-shot
// composition so CSS never goes silently stale.
type TailwindWatcher struct {
	// OutputPath is the private CSS file the child writes (-o). It must not be
	// served directly; the dev loop reads it to recompose the real styles.css.
	OutputPath string
	// Name is the resolved CLI's human-readable identifier (for logs).
	Name string

	cmd      *exec.Cmd
	stdin    *os.File // held-open write end of the child's stdin pipe (see StartWatch)
	done     chan struct{}
	stopOnce sync.Once

	mu  sync.Mutex
	err error
}

// WatchOptions parameterize StartWatch.
type WatchOptions struct {
	// AppRoot is the app root (the child's working directory and the base for
	// CLI resolution).
	AppRoot string
	// Input is the Tailwind input CSS (-i), or "" for the CLI default.
	Input string
	// Output is the private output CSS file (-o). Required.
	Output string
	// Stderr, when set, receives the child's stderr (diagnostics). Optional.
	Stderr io.Writer
	// CLI overrides the resolved Tailwind CLI. Tests inject a fake long-running
	// command here so the watcher lifecycle can be exercised without Tailwind.
	CLI *ResolvedCLI
}

// StartWatch resolves the Tailwind CLI (best-first: direct node_modules, then
// npx), starts it with --watch writing to opts.Output, and returns a handle. It
// errors only if the process fails to start.
func StartWatch(ctx context.Context, opts WatchOptions) (*TailwindWatcher, error) {
	var cli ResolvedCLI
	if opts.CLI != nil {
		cli = *opts.CLI
	} else {
		clis := resolveCLIs(opts.AppRoot)
		if len(clis) == 0 {
			return nil, fmt.Errorf("no Tailwind CLI could be resolved for --watch")
		}
		cli = clis[0]
	}

	args := append([]string{}, cli.Args...)
	args = append(args, "--watch")
	if opts.Input != "" {
		args = append(args, "-i", opts.Input)
	}
	args = append(args, "-o", opts.Output)

	cmd := exec.Command(cli.Exec, args...)
	if opts.AppRoot != "" {
		cmd.Dir = opts.AppRoot
	}
	if opts.Stderr != nil {
		cmd.Stderr = opts.Stderr
	}
	setProcAttr(cmd)

	// Hold a stdin pipe open for the child's lifetime. The Tailwind v4 CLI's
	// --watch mode exits as soon as its stdin reaches EOF; a detached child would
	// otherwise inherit /dev/null (immediate EOF) and terminate right after its
	// first build. We keep the write end (stdinW) open and never feed it, so the
	// child never sees EOF; it is closed on Stop. Best-effort: if the pipe can't
	// be created we start anyway (some CLIs don't care about stdin).
	stdinR, stdinW, pipeErr := os.Pipe()
	if pipeErr == nil {
		cmd.Stdin = stdinR
	}

	if err := cmd.Start(); err != nil {
		if pipeErr == nil {
			stdinR.Close()
			stdinW.Close()
		}
		return nil, fmt.Errorf("starting Tailwind --watch (%s): %w", cli.Name, err)
	}
	// The child now holds its own copy of the read end; the parent doesn't need it.
	if pipeErr == nil {
		stdinR.Close()
	}

	w := &TailwindWatcher{
		OutputPath: opts.Output,
		Name:       cli.Name,
		cmd:        cmd,
		stdin:      stdinW,
		done:       make(chan struct{}),
	}

	// Reap the process and record its exit so Done()/Err() report the truth.
	go func() {
		err := cmd.Wait()
		w.mu.Lock()
		w.err = err
		w.mu.Unlock()
		close(w.done)
	}()

	// Kill the child when the session is cancelled; if it exits on its own first,
	// still call Stop() so the held-open stdin write end is closed either way.
	// Stop() is sync.Once-guarded and killing an already-dead process is a no-op,
	// so calling it on the self-exit path is safe and only releases the pipe (a
	// bare `return` here would leak that fd for the rest of the session).
	go func() {
		select {
		case <-ctx.Done():
			w.Stop()
		case <-w.done:
			w.Stop()
		}
	}()

	return w, nil
}

// Done returns a channel closed when the watcher process has exited.
func (w *TailwindWatcher) Done() <-chan struct{} { return w.done }

// Err returns the process's exit error (nil until it exits; the Wait error
// after). A killed process reports a signal error, which is expected on Stop.
func (w *TailwindWatcher) Err() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.err
}

// Stop kills the watcher process (group) and closes the held-open stdin pipe.
// Safe to call multiple times.
func (w *TailwindWatcher) Stop() {
	w.stopOnce.Do(func() {
		killProcessTree(w.cmd)
		if w.stdin != nil {
			w.stdin.Close()
		}
	})
}
