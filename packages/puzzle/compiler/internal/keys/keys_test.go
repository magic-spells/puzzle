package keys

import (
	"bytes"
	"context"
	"testing"
	"time"
)

// Listen must fire when the reader eventually yields 'q', even after some
// unrelated bytes.
func TestListenFiresOnQ(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	r := bytes.NewReader([]byte("abc\nq"))
	quit := Listen(ctx, r)

	select {
	case <-quit:
		// expected
	case <-time.After(time.Second):
		t.Fatal("Listen did not fire on 'q'")
	}
}

// A 'Q' (uppercase) must fire too.
func TestListenFiresOnUpperQ(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	quit := Listen(ctx, bytes.NewReader([]byte("Q")))

	select {
	case <-quit:
	case <-time.After(time.Second):
		t.Fatal("Listen did not fire on 'Q'")
	}
}

// A reader that reaches EOF without ever yielding 'q' must NOT fire — a piped or
// redirected stdin hitting EOF should never trigger a spurious quit.
func TestListenNoFireOnEOF(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	quit := Listen(ctx, bytes.NewReader([]byte("hello world\n")))

	select {
	case <-quit:
		t.Fatal("Listen fired without a 'q' byte")
	case <-time.After(100 * time.Millisecond):
		// expected: no signal.
	}
}
