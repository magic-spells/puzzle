// keys.go implements the portable, TTY-agnostic half of `puzzle dev`'s
// "press q to quit" affordance. listenKeys is deliberately kept pure over an
// io.Reader (rather than reaching for os.Stdin directly) so it can be unit
// tested without a real terminal: a test feeds it a bytes.Reader and asserts on
// the returned channel. The termios/TTY plumbing that puts a real stdin into
// cbreak mode lives in the build-tagged keys_unix.go / keys_other.go files.
package dev

import (
	"context"
	"io"
)

// listenKeys spawns a goroutine that reads r one byte at a time and, when it
// sees 'q' or 'Q', signals on the returned channel (a single non-blocking send)
// and returns. On read error/EOF or when ctx is cancelled the goroutine exits
// silently without signalling — so a piped/redirected stdin that hits EOF (CI,
// tests) never triggers a spurious quit.
//
// The channel is buffered (size 1) so the send never blocks even if no one is
// selecting on it yet; callers select on it as one arm of the dev-loop select.
func listenKeys(ctx context.Context, r io.Reader) <-chan struct{} {
	quit := make(chan struct{}, 1)
	go func() {
		buf := make([]byte, 1)
		for {
			select {
			case <-ctx.Done():
				return
			default:
			}
			n, err := r.Read(buf)
			if n > 0 && (buf[0] == 'q' || buf[0] == 'Q') {
				select {
				case quit <- struct{}{}:
				default:
				}
				return
			}
			if err != nil {
				return // EOF or read error: feature simply goes quiet.
			}
		}
	}()
	return quit
}
