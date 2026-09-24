package main

import "testing"

func TestMatchMemberRoute(t *testing.T) {
	cases := []struct{ method, path, name string }{{"GET", "/member-invites", "list-invites"}, {"POST", "/member-invites", "create-invite"}, {"POST", "/member-invites/x/revoke", "revoke-invite"}, {"GET", "/members", "list-members"}, {"DELETE", "/members/u", "remove-member"}}
	for _, c := range cases {
		got, ok := matchMemberRoute(c.method, c.path)
		if !ok || got.name != c.name {
			t.Fatalf("%s %s: %#v %v", c.method, c.path, got, ok)
		}
	}
}

func TestMemberCapabilities(t *testing.T) {
	if memberCapabilities("manager")["can_manage_staff"] != true || memberCapabilities("kitchen")["can_kds"] != true || memberCapabilities("staff")["can_view_reports"] != false {
		t.Fatal("unexpected role capabilities")
	}
}
