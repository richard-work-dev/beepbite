package main

import (
	"encoding/json"
	"testing"
)

func TestDataTableFromPath(t *testing.T) {
	tests := []struct {
		path  string
		want  string
		valid bool
	}{
		{path: "/data/items", want: "items", valid: true},
		{path: "/api/v1/data/orders", want: "orders", valid: true},
		{path: "/data/items/extra", valid: false},
		{path: "/data/", valid: false},
	}
	for _, test := range tests {
		got, valid := dataTableFromPath(test.path)
		if got != test.want || valid != test.valid {
			t.Fatalf("dataTableFromPath(%q) = (%q, %v), want (%q, %v)", test.path, got, valid, test.want, test.valid)
		}
	}
}

func TestParseAndApplyDataQuery(t *testing.T) {
	query, err := parseDataQuery("eq=status,open&gte=total,10&in=channel,pos,web&order=total.desc&limit=1")
	if err != nil {
		t.Fatalf("parseDataQuery returned an error: %v", err)
	}
	rows := []map[string]any{
		{"id": "one", "status": "open", "total": json.Number("12"), "channel": "pos"},
		{"id": "two", "status": "open", "total": json.Number("20"), "channel": "web"},
		{"id": "three", "status": "closed", "total": json.Number("30"), "channel": "pos"},
	}
	filtered := applyDataFilters(rows, query)
	if len(filtered) != 1 || filtered[0]["id"] != "two" {
		t.Fatalf("filtered rows = %#v, want only id=two", filtered)
	}
}

func TestDataRowsResponseProjectsAndUnwrapsSingle(t *testing.T) {
	response, err := dataRowsResponse([]map[string]any{{"id": "one", "name": "Coffee", "price": 4}}, dataQuery{
		selects: []string{"id", "name"},
		single:  true,
	})
	if err != nil {
		t.Fatalf("dataRowsResponse returned an error: %v", err)
	}
	if response.StatusCode != 200 {
		t.Fatalf("status = %d, want 200", response.StatusCode)
	}
	var body map[string]any
	if err := json.Unmarshal([]byte(response.Body), &body); err != nil {
		t.Fatalf("invalid response JSON: %v", err)
	}
	if body["id"] != "one" || body["name"] != "Coffee" {
		t.Fatalf("body = %#v", body)
	}
	if _, exists := body["price"]; exists {
		t.Fatalf("unselected price leaked into response: %#v", body)
	}
}

func TestValidateDataRowRejectsCredentialHashes(t *testing.T) {
	if err := validateDataRow("staff", map[string]any{"pin_hash": "secret"}); err == nil {
		t.Fatal("expected pin_hash to be rejected")
	}
	if err := validateDataRow("items", map[string]any{"name": "Coffee"}); err != nil {
		t.Fatalf("ordinary item rejected: %v", err)
	}
}

func TestOrganizationRolesMatchSchema(t *testing.T) {
	for _, role := range []string{"owner", "manager", "staff", "admin", "kitchen", "pos", "driver"} {
		if !validOrganizationRole(role) {
			t.Fatalf("expected %q to be a valid organization role", role)
		}
	}
	if validOrganizationRole("member") {
		t.Fatal("legacy member role should not be accepted")
	}
	if !managerRole("admin") {
		t.Fatal("admin should be allowed to manage organization data")
	}
}

func TestOrganizationMustRetainOwner(t *testing.T) {
	if hasOrganizationOwner([]map[string]any{{"role": "manager"}}) {
		t.Fatal("organization without owner was accepted")
	}
	if !hasOrganizationOwner([]map[string]any{{"role": "staff"}, {"role": "owner"}}) {
		t.Fatal("organization owner was not detected")
	}
}
