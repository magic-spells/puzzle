package parser

import (
	"reflect"
	"strings"
	"testing"
)

func TestPassiveCaptureModifiers(t *testing.T) {
	root := parseContent(t, `<div @wheel:passive:capture={scroll} @click:outside:passive:once={close}></div>`)
	el := root.Children[0].(*Element)
	for i, want := range [][]string{{"passive", "capture"}, {"outside", "passive", "once"}} {
		if got := el.Attrs[i].(*EventAttr).Modifiers; !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
}

func TestPassiveCaptureErrors(t *testing.T) {
	for _, tt := range []struct{ raw, want string }{
		{"wheel:passive:prevent", "passive and prevent"},
		{"wheel:prevent:passive", "passive and prevent"},
		{"wheel:passive:passive", "duplicate event modifier"},
		{"click:capture:capture", "duplicate event modifier"},
		{"wheel.passive", "write @wheel:passive"},
		{"click.capture", "write @click:capture"},
	} {
		t.Run(tt.raw, func(t *testing.T) {
			_, _, err := parseEventModifiers(tt.raw, Position{Line: 2, Col: 4}, "test.pzl")
			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("got %v, want %q", err, tt.want)
			}
		})
	}
}
