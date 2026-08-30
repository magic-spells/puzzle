package main

import (
	"strings"
	"testing"
)

func TestCheckJSFlagReserved(t *testing.T) {
	if err := checkCmd.Flags().Set("js", "true"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = checkCmd.Flags().Set("js", "false") })
	err := checkCmd.RunE(checkCmd, nil)
	if err == nil || !strings.Contains(err.Error(), "not yet implemented") {
		t.Fatalf("error = %v, want not yet implemented", err)
	}
}
