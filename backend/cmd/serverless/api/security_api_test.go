package main

import "testing"

func TestTOTPEncryptionRoundTrip(t *testing.T) {
	encrypted, err := encryptTOTP("runtime-secret", "ABC123")
	if err != nil {
		t.Fatal(err)
	}
	plain, err := decryptTOTP("runtime-secret", encrypted)
	if err != nil || plain != "ABC123" {
		t.Fatalf("round trip failed: %q %v", plain, err)
	}
}

func TestCapabilityList(t *testing.T) {
	got := capabilityList(map[string]any{"can_pos": true, "can_kds": false})
	if len(got) != 1 || got[0] != "can_pos" {
		t.Fatalf("unexpected: %#v", got)
	}
}
