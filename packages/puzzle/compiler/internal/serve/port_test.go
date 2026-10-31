package serve

import (
	"fmt"
	"net"
	"strconv"
	"strings"
	"testing"
)

// --- port scanning -----------------------------------------------------------

// occupy binds a loopback port and returns it plus a closer, so a test can make
// a specific port genuinely busy rather than mocking the bind.
func occupy(t *testing.T) (int, net.Listener) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("occupying a port: %v", err)
	}
	t.Cleanup(func() { ln.Close() })
	return ln.Addr().(*net.TCPAddr).Port, ln
}

func TestListenUsesRequestedPortWhenFree(t *testing.T) {
	// Take a port, release it: the number is known-good and almost certainly
	// still free, without racing a hardcoded constant against the machine.
	want, held := occupy(t)
	held.Close()

	ln, err := Listen(want, false)
	if err != nil {
		t.Fatalf("Listen: %v", err)
	}
	defer ln.Close()

	if got := BoundPort(ln, 0); got != want {
		t.Errorf("bound port = %d, want the requested %d", got, want)
	}
}

func TestListenScansPastBusyPort(t *testing.T) {
	busy, _ := occupy(t)

	ln, err := Listen(busy, false)
	if err != nil {
		t.Fatalf("Listen should have scanned past a busy port: %v", err)
	}
	defer ln.Close()

	got := BoundPort(ln, 0)
	if got == busy {
		t.Fatalf("bound the busy port %d", busy)
	}
	if got <= busy || got >= busy+PortScanLimit {
		t.Errorf("bound port = %d, want one in (%d, %d)", got, busy, busy+PortScanLimit)
	}
}

func TestListenStrictPortFailsOnBusyPort(t *testing.T) {
	busy, _ := occupy(t)

	ln, err := Listen(busy, true)
	if err == nil {
		ln.Close()
		t.Fatalf("strict mode bound port %d, want an error", BoundPort(ln, 0))
	}
	// The OS supplies the tail of this message and every platform words it
	// differently ("address already in use" on unix, "Only one usage of each
	// socket address…" on Windows). What the user needs is the same everywhere:
	// the operation that failed and the port it failed on.
	if !strings.Contains(err.Error(), "bind:") || !strings.Contains(err.Error(), strconv.Itoa(busy)) {
		t.Errorf("error should name the bind failure and the port %d, got: %v", busy, err)
	}
}

func TestListenExhaustedScanReportsRequestedPort(t *testing.T) {
	// Fill the whole scan window so the range is genuinely exhausted, then check
	// the surfaced error names the port the user asked for — not the last one
	// tried, which the user never mentioned.
	first, _ := occupy(t)
	var held []net.Listener
	for offset := 1; offset < PortScanLimit; offset++ {
		ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", first+offset))
		if err != nil {
			// Something else already owns it — equally "busy" for our purposes.
			continue
		}
		held = append(held, ln)
	}
	defer func() {
		for _, ln := range held {
			ln.Close()
		}
	}()

	ln, err := Listen(first, false)
	if err == nil {
		ln.Close()
		t.Fatalf("exhausted scan bound port %d, want an error", BoundPort(ln, 0))
	}
	if !strings.Contains(err.Error(), fmt.Sprintf("%d", first)) {
		t.Errorf("error should name the requested port %d, got: %v", first, err)
	}
}

func TestListenPortZeroTakesAnyFreePort(t *testing.T) {
	ln, err := Listen(0, false)
	if err != nil {
		t.Fatalf("Listen(0): %v", err)
	}
	defer ln.Close()

	if got := BoundPort(ln, 0); got == 0 {
		t.Error("port 0 should resolve to a kernel-assigned port")
	}
}

func TestListenRejectsOutOfRangePorts(t *testing.T) {
	for _, port := range []int{-1, 70000} {
		t.Run(fmt.Sprintf("%d", port), func(t *testing.T) {
			ln, err := Listen(port, false)
			if ln != nil {
				ln.Close()
				t.Errorf("Listen(%d) returned a listener, want nil", port)
			}
			if err == nil {
				t.Fatalf("Listen(%d) returned nil error", port)
			}
			if !strings.Contains(err.Error(), fmt.Sprintf("%d", port)) {
				t.Errorf("error should name invalid port %d, got: %v", port, err)
			}
		})
	}
}

func TestBindHost(t *testing.T) {
	for host, want := range map[string]string{
		"":          "127.0.0.1",
		"localhost": "127.0.0.1",
		"LocalHost": "127.0.0.1",
		"0.0.0.0":   "0.0.0.0",
		"10.0.0.5":  "10.0.0.5",
		"::":        "::",
	} {
		if got := BindHost(host); got != want {
			t.Errorf("BindHost(%q) = %q, want %q", host, got, want)
		}
	}
}

func TestBannerURLs(t *testing.T) {
	local, network := Banner("", 3000)
	if local != "http://localhost:3000/" || network != nil {
		t.Errorf("default banner = %q %v, want localhost only", local, network)
	}
	local, network = Banner("0.0.0.0", 3000)
	if local != "http://localhost:3000/" {
		t.Errorf("all-interfaces local = %q", local)
	}
	for _, u := range network {
		if !strings.HasPrefix(u, "http://") || !strings.HasSuffix(u, ":3000/") || strings.Contains(u, "127.0.0.1") {
			t.Errorf("bad network URL %q", u)
		}
	}
	if local, network = Banner("10.1.2.3", 4000); local != "http://10.1.2.3:4000/" || network != nil {
		t.Errorf("specific host banner = %q %v", local, network)
	}
	if local, _ = Banner("::1", 4000); local != "http://[::1]:4000/" {
		t.Errorf("IPv6 banner must bracket the address, got %q", local)
	}
}

// TestListenHostAllInterfaces binds every interface and is reachable over
// loopback, the address a --host server is still opened at locally.
func TestListenHostAllInterfaces(t *testing.T) {
	ln, err := ListenHost(AllInterfacesHost, 0, false)
	if err != nil {
		t.Skipf("cannot bind 0.0.0.0 here: %v", err)
	}
	defer ln.Close()
	addr := ln.Addr().(*net.TCPAddr)
	if !addr.IP.IsUnspecified() {
		t.Errorf("bound %v, want the unspecified address", addr.IP)
	}
	conn, err := net.Dial("tcp", fmt.Sprintf("127.0.0.1:%d", addr.Port))
	if err != nil {
		t.Fatalf("dial loopback: %v", err)
	}
	conn.Close()
}

func TestListenDefaultStaysOnLoopback(t *testing.T) {
	ln, err := ListenHost("", 0, false)
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	if ip := ln.Addr().(*net.TCPAddr).IP; !ip.IsLoopback() {
		t.Errorf("default bind %v is not loopback", ip)
	}
}
