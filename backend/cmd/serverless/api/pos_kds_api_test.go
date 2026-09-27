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
		{method: "POST", path: "/kds/tickets/ticket-1/start", name: "kds_start", param: "ticket-1"},
		{method: "POST", path: "/kds/tickets/ticket-1/ready", name: "kds_ready", param: "ticket-1"},
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
	}, []string{"ticket-1"}, []map[string]any{{"id": "item-1", "item_id": "menu-1"}})
	if response["total_minor"] != int64(1150) || response["total"] != 11.5 {
		t.Fatalf("unexpected amount projection: %#v", response)
	}
	if tickets, ok := response["kds_ticket_ids"].([]string); !ok || len(tickets) != 1 {
		t.Fatalf("unexpected tickets: %#v", response["kds_ticket_ids"])
	}
	items, ok := response["items"].([]map[string]any)
	if !ok || len(items) != 1 || items[0]["id"] != "item-1" {
		t.Fatalf("unexpected order items: %#v", response["items"])
	}
}

func TestOrderStatusAfterPaymentWaitsForKitchenHandoff(t *testing.T) {
	tests := []struct {
		name     string
		current  string
		statuses []string
		want     string
	}{
		{name: "no kitchen tickets", current: "confirmed", want: "completed"},
		{name: "new ticket", current: "confirmed", statuses: []string{"fired"}, want: "confirmed"},
		{name: "ready ticket", current: "ready", statuses: []string{"ready"}, want: "ready"},
		{name: "all handed off", current: "ready", statuses: []string{"bumped", "cancelled"}, want: "completed"},
		{name: "one station remains", current: "preparing", statuses: []string{"bumped", "in_progress"}, want: "preparing"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := orderStatusAfterPayment(test.current, test.statuses); got != test.want {
				t.Fatalf("orderStatusAfterPayment(%q, %#v) = %q, want %q", test.current, test.statuses, got, test.want)
			}
		})
	}
}

func TestShouldListKDSExpoOrderUsesKitchenLifecycle(t *testing.T) {
	tests := []struct {
		name    string
		status  string
		tickets []string
		want    bool
	}{
		{name: "orphan open order remains recoverable", status: "confirmed", want: true},
		{name: "closed order with active kitchen work remains visible", status: "completed", tickets: []string{"in_progress"}, want: true},
		{name: "ready ticket remains visible", status: "ready", tickets: []string{"ready"}, want: true},
		{name: "handed off ticket leaves board", status: "ready", tickets: []string{"bumped"}, want: false},
		{name: "closed order without tickets stays hidden", status: "completed", want: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := shouldListKDSExpoOrder(test.status, test.tickets); got != test.want {
				t.Fatalf("shouldListKDSExpoOrder(%q, %#v) = %v, want %v", test.status, test.tickets, got, test.want)
			}
		})
	}
}

func TestCompletedPaymentCentsUsesNetSettledAmount(t *testing.T) {
	payments := []map[string]any{
		{"order_id": "order-1", "payment_status": "completed", "amount_paid_cents": int64(2000), "change_given_cents": int64(500)},
		{"order_id": "order-1", "payment_status": "pending", "amount_paid_cents": int64(900)},
		{"order_id": "order-2", "payment_status": "completed", "amount_paid_cents": int64(700)},
	}
	if got := completedPaymentCents(payments, "order-1"); got != 1500 {
		t.Fatalf("completedPaymentCents() = %d, want 1500", got)
	}
}

func TestAggregateKDSStatus(t *testing.T) {
	tests := []struct {
		statuses []string
		want     string
	}{
		{nil, "pending"},
		{[]string{"fired", "bumped"}, "fired"},
		{[]string{"fired", "in_progress"}, "in_progress"},
		{[]string{"ready", "bumped"}, "ready"},
		{[]string{"bumped", "cancelled"}, "bumped"},
	}
	for _, test := range tests {
		if got := aggregateKDSStatus(test.statuses); got != test.want {
			t.Fatalf("aggregateKDSStatus(%#v) = %q, want %q", test.statuses, got, test.want)
		}
	}
}

func TestNormalizeOrderModifiersValidatesAndSnapshotsSelection(t *testing.T) {
	catalog := orderModifierCatalog{
		modifiersByID: map[string]map[string]any{
			"extra": {"id": "extra", "modifier_group_id": "group-1", "name": "Extra queso", "price_delta_cents": int64(250), "is_active": true},
		},
		groupsByID: map[string]map[string]any{
			"group-1": {"id": "group-1", "item_id": "item-1", "min_select": int64(1), "max_select": int64(2), "is_required": true},
		},
		groupsByItem: map[string][]map[string]any{
			"item-1": {{"id": "group-1", "item_id": "item-1", "min_select": int64(1), "max_select": int64(2), "is_required": true}},
		},
	}
	snapshots, delta, err := normalizeOrderModifiers([]any{map[string]any{"modifier_id": "extra"}}, "item-1", catalog)
	if err != nil || delta != 250 || len(snapshots) != 1 {
		t.Fatalf("normalizeOrderModifiers() = %#v, %d, %v", snapshots, delta, err)
	}
	modifier := snapshots[0].(map[string]any)
	if modifier["name_snapshot"] != "Extra queso" || modifier["price_cents_snapshot"] != int64(250) {
		t.Fatalf("unexpected modifier snapshot: %#v", modifier)
	}
	if names := orderModifierNames(snapshots); len(names) != 1 || names[0] != "Extra queso" {
		t.Fatalf("unexpected modifier names: %#v", names)
	}
}

func TestNormalizeOrderModifiersRejectsMissingRequiredGroup(t *testing.T) {
	group := map[string]any{"id": "group-1", "item_id": "item-1", "min_select": int64(1), "max_select": int64(1), "is_required": true}
	catalog := orderModifierCatalog{
		modifiersByID: map[string]map[string]any{},
		groupsByID:    map[string]map[string]any{"group-1": group},
		groupsByItem:  map[string][]map[string]any{"item-1": {group}},
	}
	if _, _, err := normalizeOrderModifiers([]any{}, "item-1", catalog); err == nil {
		t.Fatal("required modifier group was accepted without a selection")
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
