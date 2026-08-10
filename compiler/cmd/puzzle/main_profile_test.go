package main

import (
	"strings"
	"testing"

	"github.com/spf13/cobra"
)

func TestBuildAndDevRegisterProfileBuildFlag(t *testing.T) {
	for _, cmd := range []*cobra.Command{buildCmd, devCmd} {
		flag := cmd.Flags().Lookup("profile-build")
		if flag == nil {
			t.Fatalf("%s does not register --profile-build", cmd.Name())
		}
		if flag.DefValue != "false" {
			t.Fatalf("%s --profile-build default = %q, want false", cmd.Name(), flag.DefValue)
		}
	}
}

func TestDevHelpDescribesProfileBuild(t *testing.T) {
	for _, want := range []string{"--profile-build", "PUZZLE_PROFILE_BUILD=1", "stderr"} {
		if !strings.Contains(devCmd.Long, want) {
			t.Fatalf("dev help missing %q:\n%s", want, devCmd.Long)
		}
	}
}
