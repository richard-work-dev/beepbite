package main

import "testing"

func TestMatchDriverRoute(t *testing.T) {
	tests := []struct {
		method, path, name string
		matched            bool
	}{
		{"GET", "/driver-invites", "list-invites", true},
		{"POST", "/driver-invites", "create-invite", true},
		{"POST", "/driver-invites/inv-1/revoke", "revoke-invite", true},
		{"GET", "/drivers", "list-drivers", true},
		{"DELETE", "/drivers/user-1", "remove-driver", true},
		{"GET", "/driver/assignments", "assignments", true},
		{"POST", "/driver/assignments/a-1/accept", "transition", true},
		{"POST", "/driver/shifts/online", "shift", true},
		{"POST", "/driver/pings", "ping", true},
		{"GET", "/driver/pings", "", false},
	}
	for _, test := range tests {
		route, matched := matchDriverRoute(test.method, test.path)
		if matched != test.matched || route.name != test.name {
			t.Fatalf("%s %s: route=%q matched=%v", test.method, test.path, route.name, matched)
		}
	}
}

func TestValidDriverTransition(t *testing.T) {
	tests := []struct {
		current, action, next string
		valid                 bool
	}{
		{"offered", "accept", "accepted", true},
		{"accepted", "pickup", "picked_up", true},
		{"picked_up", "deliver", "delivered", true},
		{"accepted", "cancel", "canceled", true},
		{"offered", "deliver", "delivered", false},
		{"delivered", "cancel", "canceled", false},
		{"offered", "unknown", "", false},
	}
	for _, test := range tests {
		next, valid := validDriverTransition(test.current, test.action)
		if next != test.next || valid != test.valid {
			t.Fatalf("%s/%s: next=%q valid=%v", test.current, test.action, next, valid)
		}
	}
}
