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
