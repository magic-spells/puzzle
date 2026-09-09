package main

import (
	"strings"
	"testing"
)

// TestOutputFlag pins the --static / --hybrid mutual exclusion and the mode
// string each produces (CONTRACT 1). Neither set defers to puzzle.config.js.
func TestOutputFlag(t *testing.T) {
	tests := []struct {
		name    string
		static  bool
		hybrid  bool
		want    string
		wantErr bool
	}{
		{"neither", false, false, "", false},
		{"static", true, false, "static", false},
		{"hybrid", false, true, "hybrid", false},
		{"both is an error", true, true, "", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := outputFlag(tt.static, tt.hybrid)
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected an error when both flags are set")
				}
				if !strings.Contains(err.Error(), "mutually exclusive") {
					t.Errorf("both-flags error should say mutually exclusive, got: %v", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.want {
				t.Errorf("outputFlag(%v, %v) = %q, want %q", tt.static, tt.hybrid, got, tt.want)
			}
		})
	}
}
