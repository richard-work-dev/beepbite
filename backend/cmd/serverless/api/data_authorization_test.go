package main

import "testing"

func TestDataTableCapability(t *testing.T) {
	cases := []struct {
		table, method, want string
		restricted          bool
	}{
		{"items", "POST", "can_manage_menu", true},
		{"items", "GET", "", false},
		{"inventory_items", "GET", "manager", true},
		{"orders", "POST", "", false},
	}
	for _, tc := range cases {
		got, restricted := dataTableCapability(tc.table, tc.method)
		if got != tc.want || restricted != tc.restricted {
			t.Fatalf("dataTableCapability(%q, %q) = (%q, %v), want (%q, %v)", tc.table, tc.method, got, restricted, tc.want, tc.restricted)
		}
	}
}

func TestMemberCapability(t *testing.T) {
	if !memberCapability(map[string]any{"capabilities": map[string]any{"can_manage_menu": true}}, "can_manage_menu") {
		t.Fatal("expected enabled capability")
	}
	if memberCapability(map[string]any{"capabilities": map[string]any{"can_manage_menu": false}}, "can_manage_menu") {
		t.Fatal("disabled capability must not authorize")
	}
}
