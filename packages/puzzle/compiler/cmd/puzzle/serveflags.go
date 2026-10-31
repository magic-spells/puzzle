package main

import (
	"fmt"
	"net"
	"os"
	"strings"

	"github.com/magic-spells/puzzle/compiler/internal/serve"
	"github.com/spf13/cobra"
)

// addHostFlag registers --host on a server command (dev, preview). Like Vite's,
// it takes an optional value: a bare --host exposes the server on every
// interface (0.0.0.0) and the banner prints the LAN URLs; --host <addr> binds
// that address; omitted, the server stays on localhost.
func addHostFlag(cmd *cobra.Command) {
	cmd.Flags().String("host", serve.DefaultHost,
		"Address to bind; a bare --host (or --host 0.0.0.0) listens on every interface and prints the LAN URL")
	cmd.Flags().Lookup("host").NoOptDefVal = serve.AllInterfacesHost
}

// serverArgs is the Args validator for dev and preview: at most one [dir],
// not counting an address that resolveHost will reclaim as --host's value.
func serverArgs(cmd *cobra.Command, args []string) error {
	_, rest := resolveHost(cmd, args)
	return cobra.MaximumNArgs(1)(cmd, rest)
}

// resolveHost returns the --host value and the positional args that remain.
//
// pflag only attaches an optional value written as --host=<addr>; the spelling
// people actually type, `--host 0.0.0.0`, parses as a bare --host followed by a
// positional "0.0.0.0" — which would then be taken for the project directory.
// So when --host was given bare, the first positional that is an IP address or
// "localhost" (and not an existing directory) is reclaimed as its value. A
// hostname other than localhost has to use --host=<name>.
func resolveHost(cmd *cobra.Command, args []string) (string, []string) {
	host, _ := cmd.Flags().GetString("host")
	if !cmd.Flags().Changed("host") || host != serve.AllInterfacesHost {
		return host, args
	}
	for i, arg := range args {
		if !looksLikeHost(arg) || isExistingDir(arg) {
			continue
		}
		rest := append(append([]string(nil), args[:i]...), args[i+1:]...)
		return arg, rest
	}
	return host, args
}

func looksLikeHost(s string) bool {
	return net.ParseIP(s) != nil || strings.EqualFold(s, serve.DefaultHost)
}

func isExistingDir(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

// serverDir returns the optional [dir] positional for dev and preview.
func serverDir(args []string) (string, error) {
	switch len(args) {
	case 0:
		return ".", nil
	case 1:
		return args[0], nil
	default:
		return "", fmt.Errorf("accepts at most 1 arg(s), received %d", len(args))
	}
}
