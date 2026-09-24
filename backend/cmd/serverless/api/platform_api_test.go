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
