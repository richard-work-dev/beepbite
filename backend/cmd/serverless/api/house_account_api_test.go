package main

import "testing"

func TestMatchHouseAccountRoute(t *testing.T) {
	tests := []struct {
		method, path, name, accountID, resourceID string
	}{
		{"POST", "/house-accounts", "create", "", ""},
		{"GET", "/house-accounts/account-1", "detail", "account-1", ""},
		{"POST", "/house-accounts/account-1/members", "member_add", "account-1", ""},
		{"DELETE", "/house-accounts/account-1/members/customer-1", "member_remove", "account-1", "customer-1"},
		{"POST", "/house-accounts/account-1/charge", "charge", "account-1", ""},
		{"POST", "/house-accounts/account-1/invoices/generate", "invoice_generate", "account-1", ""},
		{"GET", "/house-accounts/account-1/invoices", "invoice_list", "account-1", ""},
		{"POST", "/house-accounts/invoices/invoice-1/pay", "invoice_pay", "", "invoice-1"},
	}
	for _, test := range tests {
		route, ok := matchHouseAccountRoute(test.method, test.path)
		if !ok || route.name != test.name || route.accountID != test.accountID || route.resourceID != test.resourceID {
			t.Fatalf("matchHouseAccountRoute(%q, %q) = %#v, %v", test.method, test.path, route, ok)
		}
	}
	if _, ok := matchHouseAccountRoute("PATCH", "/house-accounts/account-1"); ok {
		t.Fatal("unexpected route match")
	}
}

func TestOpenHouseAccountBalance(t *testing.T) {
	charges := []map[string]any{
		{"amount_cents": int64(1200), "house_account_invoice_id": nil},
		{"amount_cents": int64(300), "house_account_invoice_id": ""},
		{"amount_cents": int64(900), "house_account_invoice_id": "invoice-1"},
	}
	if got := openHouseAccountBalance(charges); got != 1500 {
		t.Fatalf("openHouseAccountBalance() = %d, want 1500", got)
	}
}

func TestDateFromTimestamp(t *testing.T) {
	if got := dateFromTimestamp("2026-09-24T12:34:56.123Z"); got != "2026-09-24" {
		t.Fatalf("dateFromTimestamp() = %q", got)
	}
}
