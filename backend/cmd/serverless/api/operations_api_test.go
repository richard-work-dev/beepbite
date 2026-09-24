package main

import (
	"encoding/json"
	"testing"
)

func TestMatchOperationalRoute(t *testing.T) {
	tests := []struct {
		method string
		path   string
		name   string
		params []string
	}{
		{method: "GET", path: "/onboarding/status", name: "onboarding_status"},
		{method: "PATCH", path: "/locations/loc-1", name: "location_update", params: []string{"loc-1"}},
		{method: "POST", path: "/reservations/res-1/confirm", name: "reservation_transition", params: []string{"res-1", "confirm"}},
		{method: "POST", path: "/categories/cat-1/eighty-six", name: "category_86", params: []string{"cat-1", "eighty-six"}},
		{method: "PUT", path: "/items/item-1/special", name: "item_special", params: []string{"item-1"}},
	}
	for _, test := range tests {
		route, ok := matchOperationalRoute(test.method, test.path)
		if !ok || route.name != test.name || len(route.params) != len(test.params) {
			t.Fatalf("matchOperationalRoute(%q, %q) = %#v, %v", test.method, test.path, route, ok)
		}
		for index := range test.params {
			if route.params[index] != test.params[index] {
				t.Fatalf("param %d = %q, want %q", index, route.params[index], test.params[index])
			}
		}
	}
	if _, ok := matchOperationalRoute("GET", "/not-migrated"); ok {
		t.Fatal("unknown route was matched")
	}
}

func TestOperationValueConversions(t *testing.T) {
	if value, ok := integerValue(json.Number("42")); !ok || value != 42 {
		t.Fatalf("integerValue = %d, %v", value, ok)
	}
	if _, ok := integerValue(json.Number("4.2")); ok {
		t.Fatal("fraction was accepted as an integer")
	}
	values, ok := stringSlice([]any{"menu", "staff"})
	if !ok || len(values) != 2 || values[1] != "staff" {
		t.Fatalf("stringSlice = %#v, %v", values, ok)
	}
}

func TestDisplayStringDoesNotExposeNilMarker(t *testing.T) {
	if got := displayString(nil); got != "" {
		t.Fatalf("displayString(nil) = %q", got)
	}
	if got := displayString("  Ada  "); got != "Ada" {
		t.Fatalf("displayString trimmed value = %q", got)
	}
}
