package main

import "testing"

func TestMatchTableSessionRoute(t *testing.T) {
	tests := []struct {
		method string
		path   string
		name   string
		params []string
	}{
		{method: "PATCH", path: "/tables/table-1", name: "table_update", params: []string{"table-1"}},
		{method: "POST", path: "/tables/table-1/open-session", name: "session_open", params: []string{"table-1"}},
		{method: "GET", path: "/sessions/session-1", name: "session_detail", params: []string{"session-1"}},
		{method: "POST", path: "/sessions/session-1/close", name: "session_close", params: []string{"session-1"}},
		{method: "POST", path: "/sessions/session-1/transfer", name: "session_transfer", params: []string{"session-1"}},
		{method: "POST", path: "/sessions/session-1/split-check", name: "session_split_check", params: []string{"session-1"}},
		{method: "POST", path: "/sessions/session-1/seats", name: "session_seats", params: []string{"session-1"}},
		{method: "GET", path: "/sessions/session-1/seats", name: "seats_list", params: []string{"session-1"}},
		{method: "PATCH", path: "/seats/seat-1", name: "seat_patch", params: []string{"seat-1"}},
		{method: "DELETE", path: "/seats/seat-1", name: "seat_delete", params: []string{"seat-1"}},
	}
	for _, test := range tests {
		route, ok := matchTableSessionRoute(test.method, test.path)
		if !ok || route.name != test.name || len(route.params) != len(test.params) {
			t.Fatalf("matchTableSessionRoute(%q, %q) = %#v, %v", test.method, test.path, route, ok)
		}
		for index := range test.params {
			if route.params[index] != test.params[index] {
				t.Fatalf("route params = %#v, want %#v", route.params, test.params)
			}
		}
	}
	if _, ok := matchTableSessionRoute("DELETE", "/sessions/session-1"); ok {
		t.Fatal("unknown table-session route was matched")
	}
}
