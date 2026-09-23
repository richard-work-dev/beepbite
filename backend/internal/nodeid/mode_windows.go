//go:build windows

package nodeid

import "io/fs"

// checkPrivateMode cannot infer Windows ACLs from fs.FileMode. Go reports
// synthesized POSIX bits (normally 0666) even when access is restricted by
// the file's DACL, so applying the POSIX check would reject every key file.
// Windows is currently a development-only platform; production release
// targets retain the strict owner-only check in mode_posix.go.
func checkPrivateMode(_ string, _ fs.FileMode) error {
	return nil
}
