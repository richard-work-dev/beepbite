package main

import (
	"testing"
	"time"
)

func TestInvoiceTotals(t *testing.T) {
	row := map[string]any{"vat_rate_pct": 10.0, "lines": []any{map[string]any{"qty": 2.0, "unit_cents": 500.0}}}
	invoiceTotals(row)
	if row["subtotal_cents"] != int64(1000) || row["total_cents"] != int64(1100) {
		t.Fatalf("unexpected totals: %#v", row)
	}
}

func TestMemberAndPlatformRoutesDoNotOverlap(t *testing.T) {
	if _, ok := matchMemberRoute("GET", "/delivery-zones"); ok {
		t.Fatal("member matcher claimed platform route")
	}
}

func TestCustomerForgetRoute(t *testing.T) {
	for _, tc := range []struct {
		method, path, wantID string
		wantMatch            bool
	}{
		{"POST", "/customers/c-1/forget", "c-1", true},
		{"GET", "/customers/c-1/forget", "", false},
		{"POST", "/customers/forget", "", false},
		{"POST", "/customers//forget", "", false},
	} {
		gotID, gotMatch := customerForgetID(tc.path, tc.method)
		if gotID != tc.wantID || gotMatch != tc.wantMatch {
			t.Errorf("customerForgetID(%q, %q) = (%q, %v), want (%q, %v)", tc.path, tc.method, gotID, gotMatch, tc.wantID, tc.wantMatch)
		}
	}
}

func TestRedactCustomerPII(t *testing.T) {
	customer := map[string]any{
		"id": "c-1", "name": "A Customer", "first_name": "A", "last_name": "Customer",
		"email": "customer@example.com", "phone": "+541100000000", "whatsapp_number": "+541100000000",
		"notes": "personal note", "address": "personal address", "birth_date": "1990-01-01",
		"document_number": "1234", "total_spent": 12345,
	}
	redactCustomerPII(customer, "2026-10-02T12:00:00Z")
	for _, field := range []string{"name", "first_name", "last_name", "email", "phone", "whatsapp_number", "notes", "address", "birth_date", "document_number"} {
		if _, exists := customer[field]; exists {
			t.Errorf("PII field %q remains after redaction", field)
		}
	}
	if customer["id"] != "c-1" || customer["total_spent"] != 12345 || customer["pii_redacted_at"] == nil {
		t.Fatalf("redaction removed non-PII accounting fields or missed marker: %#v", customer)
	}
}

func TestRedactOrderCustomerPII(t *testing.T) {
	order := map[string]any{
		"id": "o-1", "customer_id": "c-1", "customer_name": "A Customer",
		"customer_email": "customer@example.com", "customer_phone": "+541100000000",
		"delivery_address": "personal address", "delivery_lat": -34.0, "delivery_lng": -58.0,
		"notes": "personal instruction", "total_cents": 5000,
	}
	redactOrderCustomerPII(order, "2026-10-02T12:00:00Z")
	for _, field := range []string{"customer_name", "customer_email", "customer_phone", "delivery_address", "delivery_lat", "delivery_lng", "notes"} {
		if _, exists := order[field]; exists {
			t.Errorf("PII snapshot field %q remains after redaction", field)
		}
	}
	if order["customer_id"] != "c-1" || order["total_cents"] != 5000 || order["customer_pii_redacted_at"] == nil {
		t.Fatalf("redaction damaged accounting identifiers or totals: %#v", order)
	}
}

func TestAggregateStats(t *testing.T) {
	from := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	rows := []map[string]any{
		{"status": "completed", "created_at": "2026-09-02T12:00:00Z", "total_cents": float64(1200), "subtotal_cents": float64(1000), "customer_id": "c1", "location_id": "l1"},
		{"status": "cancelled", "created_at": "2026-09-02T13:00:00Z", "total_cents": float64(9999), "location_id": "l1"},
	}
	kpi, series := aggregateStats(rows, from, from.AddDate(0, 1, 0), "l1")
	if kpi.GrossSalesCents != 1200 || kpi.NetSalesCents != 1000 || kpi.OrderCount != 1 || kpi.NewCustomers != 1 || series["2026-09-02"]["orders"] != 1 {
		t.Fatalf("unexpected aggregation: %#v %#v", kpi, series)
	}
}
