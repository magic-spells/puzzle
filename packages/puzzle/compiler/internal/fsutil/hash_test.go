package fsutil

import "testing"

func TestContentHash(t *testing.T) {
	for _, tt := range []struct {
		name string
		data []byte
		want string
	}{
		{name: "nil", want: "4OYMIQUY"},
		{name: "empty", data: []byte{}, want: "4OYMIQUY"},
		{name: "content", data: []byte("abc"), want: "XJ4BNP4P"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if got := ContentHash(tt.data); got != tt.want {
				t.Fatalf("ContentHash(%q) = %q, want %q", tt.data, got, tt.want)
			}
		})
	}
}
