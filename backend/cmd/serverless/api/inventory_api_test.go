package main

import (
	"encoding/json"
	"math"
	"testing"
)

func TestMatchInventoryRoute(t *testing.T) {
	tests := []struct {
		method, path, name, param string
	}{
		{"GET", "/inventory/auto-po-suggestions", "auto_po", ""},
		{"GET", "/inventory/daily-counts", "daily_counts_list", ""},
		{"POST", "/inventory/daily-counts/open", "daily_counts_open", ""},
		{"POST", "/inventory/daily-counts/count-1/close", "daily_counts_close", "count-1"},
		{"GET", "/inventory/recipes", "recipes_list", ""},
		{"PUT", "/inventory/recipes/menu-1", "recipes_replace", "menu-1"},
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

func TestParseInventoryRecipeComponents(t *testing.T) {
	components, err := parseInventoryRecipeComponents([]any{
		map[string]any{"inventory_item_id": "pollo", "quantity": json.Number("0.25")},
		map[string]any{"inventory_item_id": "papas", "quantity": float64(0.15)},
	})
	if err != nil || components["pollo"] != 0.25 || components["papas"] != 0.15 {
		t.Fatalf("unexpected recipe components: %#v, %v", components, err)
	}
	if _, err := parseInventoryRecipeComponents([]any{
		map[string]any{"inventory_item_id": "pollo", "quantity": 1},
		map[string]any{"inventory_item_id": "pollo", "quantity": 2},
	}); err == nil {
		t.Fatal("expected duplicate inventory item to fail")
	}
	if _, err := parseInventoryRecipeComponents([]any{
		map[string]any{"inventory_item_id": "pollo", "quantity": 0},
	}); err == nil {
		t.Fatal("expected zero quantity to fail")
	}
}

func TestInventoryRequirementsAggregatesOrderAndRecipeQuantities(t *testing.T) {
	orderItems := []map[string]any{
		{"item_id": "combo", "quantity": 2},
		{"item_id": "combo", "quantity": 1},
		{"item_id": "other", "quantity": 4},
	}
	recipes := []map[string]any{
		{"menu_item_id": "combo", "inventory_item_id": "pollo", "quantity": 0.5, "is_active": true},
		{"menu_item_id": "combo", "inventory_item_id": "papas", "quantity": 0.2, "is_active": true},
		{"menu_item_id": "other", "inventory_item_id": "papas", "quantity": 0.1, "is_active": true},
		{"menu_item_id": "combo", "inventory_item_id": "salsa", "quantity": 1, "is_active": false},
	}
	requirements := inventoryRequirements(orderItems, recipes)
	if requirements["pollo"] != 1.5 || requirements["papas"] != 1.0 {
		t.Fatalf("unexpected requirements: %#v", requirements)
	}
	if _, exists := requirements["salsa"]; exists {
		t.Fatalf("inactive component must not be consumed: %#v", requirements)
	}
}

func TestValidBusinessDate(t *testing.T) {
	for _, value := range []string{"2026-09-27", "2024-02-29"} {
		if !validBusinessDate(value) {
			t.Fatalf("expected %s to be valid", value)
		}
	}
	for _, value := range []string{"", "27-09-2026", "2026-02-30", "2026-9-7"} {
		if validBusinessDate(value) {
			t.Fatalf("expected %s to be invalid", value)
		}
	}
}

func TestParseInventoryCountLines(t *testing.T) {
	lines, err := parseInventoryCountLines([]any{
		map[string]any{"inventory_item_id": "pollo", "counted_quantity": json.Number("12.5")},
		map[string]any{"inventory_item_id": "papas", "counted_quantity": float64(0)},
	})
	if err != nil || lines["pollo"] != 12.5 || lines["papas"] != 0 {
		t.Fatalf("unexpected parsed counts: %#v, %v", lines, err)
	}
	if _, err := parseInventoryCountLines([]any{
		map[string]any{"inventory_item_id": "pollo", "counted_quantity": 2},
		map[string]any{"inventory_item_id": "pollo", "counted_quantity": 3},
	}); err == nil {
		t.Fatal("expected duplicate item to fail")
	}
	if _, err := parseInventoryCountLines([]any{
		map[string]any{"inventory_item_id": "pollo", "counted_quantity": -1},
	}); err == nil {
		t.Fatal("expected negative quantity to fail")
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
