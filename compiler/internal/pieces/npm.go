package pieces

import (
	"fmt"
	"strconv"
	"strings"
)

// parseVersion splits a semver string into its numeric parts. A prerelease or
// build suffix ("0.6.0-rc.1") is reported via pre; a string that isn't three
// dot-separated non-negative integers reports ok=false.
func parseVersion(s string) (major, minor, patch int, pre bool, ok bool) {
	rest := s
	if i := strings.IndexAny(rest, "-+"); i >= 0 {
		pre = true
		rest = rest[:i]
	}
	parts := strings.Split(rest, ".")
	if len(parts) != 3 {
		return 0, 0, 0, false, false
	}
	var nums [3]int
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 {
			return 0, 0, 0, false, false
		}
		nums[i] = n
	}
	return nums[0], nums[1], nums[2], pre, true
}

// selectVersion picks the highest published pieces version sharing the CLI's
// major.minor — the lockstep contract: pieces 0.6.x pair with puzzle 0.6.x, and
// the patch digit belongs to the registry. Prereleases are never auto-selected.
// Returns "" (nil error) when no release matches; the caller renders that with
// the full published list so the user sees the real boundary.
func selectVersion(published []string, cliVersion string) (string, error) {
	cliMajor, cliMinor, _, _, ok := parseVersion(cliVersion)
	if !ok {
		return "", fmt.Errorf(
			"cannot derive a pieces release from puzzle version %q — pin one with --pieces-version", cliVersion)
	}
	best, bestPatch := "", -1
	for _, v := range published {
		major, minor, patch, pre, ok := parseVersion(v)
		if !ok || pre || major != cliMajor || minor != cliMinor {
			continue
		}
		if patch > bestPatch {
			best, bestPatch = v, patch
		}
	}
	return best, nil
}
