package main

import (
	"math"
	"testing"
)

func TestMatchInventoryRoute(t *testing.T) {
	tests := []struct {
		method, path, name, param string
	}{
		{"GET", "/inventory/auto-po-suggestions", "auto_po", ""},
		{"POST", "/inventory/purchase-orders", "po_create", ""},
		{"POST", "/inventory/purchase-orders/po-1/submit", "po_submit", "po-1"},
		{"GET", "/inventory/goods-receipts", "grn_list", ""},
		{"POST", "/inventory/goods-receipts", "grn_create", ""},
		{"POST", "/inventory/goods-receipts/grn-1/receive", "grn_receive", "grn-1"},
		{"POST", "/inventory/supplier-invoices/inv-1/match", "invoice_match", "inv-1"},
	}
	for _, test := range tests {
		route, ok := matchInventoryRoute(test.method, test.path)
		if !ok || route.name != test.name || route.param != test.param {
			t.Fatalf("%s %s matched %#v, %v", test.method, test.path, route, ok)
		}
	}
	if _, ok := matchInventoryRoute("DELETE", "/inventory/purchase-orders/po-1"); ok {
		t.Fatal("unexpected route match")
	}
}

func TestPurchaseOrderReceiptStatus(t *testing.T) {
	items := []map[string]any{
		{"id": "line-1", "ordered_quantity": float64(4)},
		{"id": "line-2", "ordered_quantity": float64(2)},
	}
	tests := []struct {
		name     string
		received map[string]float64
		want     string
	}{
		{name: "sin recepción", received: map[string]float64{}, want: "sent"},
		{name: "recepción parcial", received: map[string]float64{"line-1": 4}, want: "partially_received"},
		{name: "recepción completa", received: map[string]float64{"line-1": 4, "line-2": 2}, want: "received"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := purchaseOrderReceiptStatus(items, test.received); got != test.want {
				t.Fatalf("expected %s, got %s", test.want, got)
			}
		})
	}
}

func TestCalculateInvoiceMatch(t *testing.T) {
	poItemID := "po-item-1"
	status, lines := calculateInvoiceMatch([]invoiceMatchLine{{
		InvoiceLineID: "line-1", PurchaseOrderItemID: &poItemID,
		InvoiceQty: 10.1, POQty: 10, InvoicePriceCents: 101, POPriceCents: 100,
	}}, defaultInvoiceTolerance)
	if status != "matched" || lines[0].HasVariance {
		t.Fatalf("expected matched, got %s: %#v", status, lines[0])
	}
	status, lines = calculateInvoiceMatch([]invoiceMatchLine{{
		InvoiceLineID: "line-2", PurchaseOrderItemID: &poItemID,
		InvoiceQty: 12, POQty: 10, InvoicePriceCents: 100, POPriceCents: 100,
	}}, defaultInvoiceTolerance)
	if status != "qty_variance" || !lines[0].HasVariance || math.Abs(lines[0].QtyVariancePct-0.2) > 0.000001 {
		t.Fatalf("expected quantity variance, got %s: %#v", status, lines[0])
	}
	status, _ = calculateInvoiceMatch([]invoiceMatchLine{{InvoiceLineID: "unlinked", InvoiceQty: 1, InvoicePriceCents: 100}}, defaultInvoiceTolerance)
	if status != "qty_variance" {
		t.Fatalf("unlinked line must be a quantity variance, got %s", status)
	}
}
