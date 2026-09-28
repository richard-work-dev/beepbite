//go:build !windows

package nodeid

import (
	"fmt"
	"io/fs"
)

// checkPrivateMode refuses to use a key file that is readable or writable
// by anyone other than its owner. POSIX permission bits are authoritative on
// the platforms BeepBite currently ships.
func checkPrivateMode(path string, mode fs.FileMode) error {
	if mode.Perm()&0o077 != 0 {
		return fmt.Errorf(
			"nodeid: refusing to use %s: mode %04o is readable or writable by group/other, want 0600 or stricter",
			path, mode.Perm(),
		)
	}
	return nil
}
