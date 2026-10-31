package main

import (
	"fmt"
	"net"
	"strings"

	"github.com/magic-spells/puzzle/compiler/internal/serve"
	"github.com/spf13/cobra"
	"github.com/spf13/pflag"
)

// The --host rule, for dev and preview:
//
//   - omitted            → localhost (loopback only)
//   - bare --host        → every interface (0.0.0.0); the banner adds LAN URLs
//   - --host <ip>        → that address, when the token IMMEDIATELY after a bare
//     --host is an IP literal (v4 or v6) or "localhost" — even if a directory of
//     that name exists. A token anywhere else is never read as the address.
//   - --host=<addr>      → that address, always; nothing overrides it
//   - --host <hostname>  → not supported: hostnames need --host=<name>
//
// pflag gives an optional value only to the --host=<v> form, so the space form
// is turned into it before cobra parses (normalizeHostArgs), where the token
// order is still known. hostValue records whether the flag arrived bare, so a
// bare --host followed by a stray word can be named in the error.

// hostBareSentinel is what pflag passes to hostValue.Set for a bare --host
// (the flag's NoOptDefVal). It is "true" so pflag's help prints no [=…]
// suffix — see hostValue.Type.
const hostBareSentinel = "true"

// hostValue is the pflag.Value behind --host.
type hostValue struct {
	addr string
	// bare is set when --host arrived with no value (all interfaces).
	bare bool
	// after is how many positionals pflag had collected when a bare --host was
	// parsed: args[after] is the first positional following it.
	after int
	fs    *pflag.FlagSet
}

func (h *hostValue) String() string { return h.addr }

func (h *hostValue) Set(s string) error {
	if s == hostBareSentinel {
		h.addr, h.bare = serve.AllInterfacesHost, true
		if h.fs != nil {
			h.after = len(h.fs.Args())
		}
		return nil
	}
	if strings.TrimSpace(s) == "" {
		return fmt.Errorf("--host needs an address (use a bare --host for every interface)")
	}
	h.addr, h.bare = s, false
	return nil
}

// Type reports "bool" only so pflag's help omits the [="true"] suffix it would
// print for any other type carrying a NoOptDefVal; the backticked `address` in
// the usage string still names the value. The value is read through
// hostValueOf, never GetBool.
func (h *hostValue) Type() string { return "bool" }

// addHostFlag registers --host on a server command (dev, preview).
func addHostFlag(cmd *cobra.Command) {
	v := &hostValue{addr: serve.DefaultHost, fs: cmd.Flags()}
	cmd.Flags().Var(v, "host",
		"Bind `address`: a bare --host listens on every interface and prints the LAN URL; --host <ip> or --host=<addr> binds that address (hostnames need --host=<name>)")
	cmd.Flags().Lookup("host").NoOptDefVal = hostBareSentinel
}

func hostValueOf(cmd *cobra.Command) *hostValue {
	if f := cmd.Flags().Lookup("host"); f != nil {
		if v, ok := f.Value.(*hostValue); ok {
			return v
		}
	}
	return &hostValue{addr: serve.DefaultHost}
}

// serverArgs is the Args validator for dev and preview: at most one [dir]. A
// bare --host followed by a word that left too many positionals is reported as
// the hostname mistake it almost certainly is.
func serverArgs(cmd *cobra.Command, args []string) error {
	if len(args) > 1 {
		if v := hostValueOf(cmd); v.bare && v.after < len(args) {
			return fmt.Errorf("--host takes a hostname only as --host=<name> (%q was read as a directory)", args[v.after])
		}
	}
	return cobra.MaximumNArgs(1)(cmd, args)
}

// serverHost returns the address the server should bind.
func serverHost(cmd *cobra.Command) string {
	return hostValueOf(cmd).addr
}

// normalizeHostArgs rewrites `--host <ip>` to `--host=<ip>` in a dev or preview
// invocation when the token right after a bare --host is an IP literal or
// "localhost". Nothing after a "--" is touched, and other commands pass through.
func normalizeHostArgs(args []string) []string {
	sub := ""
	for _, a := range args {
		if !strings.HasPrefix(a, "-") {
			sub = a
			break
		}
	}
	if sub != "dev" && sub != "preview" {
		return args
	}
	out := make([]string, 0, len(args))
	for i := 0; i < len(args); i++ {
		a := args[i]
		if a == "--" {
			return append(out, args[i:]...)
		}
		if a == "--host" && i+1 < len(args) && looksLikeHost(args[i+1]) {
			out = append(out, "--host="+args[i+1])
			i++
			continue
		}
		out = append(out, a)
	}
	return out
}

func looksLikeHost(s string) bool {
	return net.ParseIP(s) != nil || strings.EqualFold(s, serve.DefaultHost)
}

// serverDir returns the optional [dir] positional for dev and preview.
func serverDir(args []string) string {
	if len(args) == 1 {
		return args[0]
	}
	return "."
}
