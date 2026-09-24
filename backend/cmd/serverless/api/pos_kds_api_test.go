package main

import (
	"testing"

	"github.com/aws/aws-lambda-go/events"
)

func TestMatchCommerceRoute(t *testing.T) {
	tests := []struct {
		method string
		path   string
		name   string
		param  string
	}{
		{method: "POST", path: "/pos/orders", name: "pos_create"},
		{method: "PATCH", path: "/pos/orders/order-1/items", name: "pos_modify", param: "order-1"},
		{method: "POST", path: "/pos/orders/order-1/charge", name: "pos_charge", param: "order-1"},
		{method: "POST", path: "/cash-drawers/drawer-1/sessions/open", name: "cash_open", param: "drawer-1"},
		{method: "POST", path: "/cash-drawers/sessions/session-1/close", name: "cash_close", param: "session-1"},
		{method: "GET", path: "/kds/stations/station-1/tickets", name: "kds_station_tickets", param: "station-1"},
		{method: "POST", path: "/kds/tickets/ticket-1/bump", name: "kds_bump", param: "ticket-1"},
		{method: "PATCH", path: "/timeclock/entries/entry-1", name: "time_edit", param: "entry-1"},
	}
	for _, test := range tests {
		route, ok := matchCommerceRoute(test.method, test.path)
		if !ok || route.name != test.name {
			t.Fatalf("matchCommerceRoute(%q, %q) = %#v, %v", test.method, test.path, route, ok)
		}
		if test.param != "" && (len(route.params) != 1 || route.params[0] != test.param) {
			t.Fatalf("route params = %#v, want %q", route.params, test.param)
		}
	}
	if _, ok := matchCommerceRoute("DELETE", "/pos/orders/order-1"); ok {
		t.Fatal("unknown commerce route was matched")
	}
}

func TestPOSOrderResponseUsesMinorUnits(t *testing.T) {
	response := posOrderResponse(map[string]any{
		"id": "order-1", "order_number": "POS-1", "subtotal_cents": int64(1000), "tax_cents": int64(150),
		"gratuity_cents": int64(0), "total_cents": int64(1150), "currency_code": "USD", "status": "confirmed",
	}, []string{"ticket-1"})
	if response["total_minor"] != int64(1150) || response["total"] != 11.5 {
		t.Fatalf("unexpected amount projection: %#v", response)
	}
	if tickets, ok := response["kds_ticket_ids"].([]string); !ok || len(tickets) != 1 {
		t.Fatalf("unexpected tickets: %#v", response["kds_ticket_ids"])
	}
}

func TestNullableString(t *testing.T) {
	if nullableString(nil) != nil || nullableString("") != nil {
		t.Fatal("empty values must map to nil")
	}
	if nullableString(" staff-1 ") != "staff-1" {
		t.Fatal("non-empty strings must be trimmed")
	}
}

func TestCommerceRequestHeadersPromotesSSEQueryContext(t *testing.T) {
	headers := commerceRequestHeaders("kds_station_stream", events.APIGatewayV2HTTPRequest{
		Headers:        map[string]string{"origin": "https://example.com"},
		RawQueryString: "token=access-token&organization_id=org-1",
	})
	if headers["authorization"] != "Bearer access-token" || headers["x-organization-id"] != "org-1" {
		t.Fatalf("SSE query context was not promoted: %#v", headers)
	}
}

func TestMatchPOSCompletionRoute(t *testing.T) {
	tests := []struct {
		method string
		path   string
		name   string
		params []string
	}{
		{method: "GET", path: "/orders/order-1/receipt", name: "receipt", params: []string{"order-1"}},
		{method: "GET", path: "/orders/order-1/adjustments", name: "adjustments_list", params: []string{"order-1"}},
		{method: "POST", path: "/orders/order-1/void", name: "void", params: []string{"order-1"}},
		{method: "POST", path: "/orders/order-1/refund", name: "refund", params: []string{"order-1"}},
		{method: "POST", path: "/orders/order-1/mark-paid-on-delivery", name: "mark_paid_on_delivery", params: []string{"order-1"}},
		{method: "POST", path: "/orders/order-1/items/item-1/comp", name: "item_comp", params: []string{"order-1", "item-1"}},
		{method: "POST", path: "/orders/order-1/items/item-1/price-override", name: "item_price_override", params: []string{"order-1", "item-1"}},
		{method: "GET", path: "/cash-out/session-1", name: "cash_out", params: []string{"session-1"}},
	}
	for _, test := range tests {
		route, ok := matchPOSCompletionRoute(test.method, test.path)
		if !ok || route.name != test.name || len(route.params) != len(test.params) {
			t.Fatalf("matchPOSCompletionRoute(%q, %q) = %#v, %v", test.method, test.path, route, ok)
		}
		for index := range test.params {
			if route.params[index] != test.params[index] {
				t.Fatalf("route params = %#v, want %#v", route.params, test.params)
			}
		}
	}
	if _, ok := matchPOSCompletionRoute("DELETE", "/orders/order-1/receipt"); ok {
		t.Fatal("unknown completion route was matched")
	}
}

func TestReceiptProjectionHelpers(t *testing.T) {
	modifiers := receiptModifiers([]any{
		map[string]any{"name": "Extra cheese", "price_cents": int64(125)},
		map[string]any{"name_snapshot": "Large", "price_cents_snapshot": int64(200)},
		"invalid",
	})
	if len(modifiers) != 2 || modifiers[0]["price_cents_snapshot"] != int64(125) || modifiers[1]["name"] != "Large" {
		t.Fatalf("unexpected modifier projection: %#v", modifiers)
	}
	address := locationAddress(map[string]any{"address": map[string]any{"raw": "ignored"}, "address_line1": "1 Main St", "city": "Bogota"})
	if address != "1 Main St, Bogota" {
		t.Fatalf("locationAddress() = %#v", address)
	}
}
