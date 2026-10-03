package main

import (
	"testing"
	"time"
)

func deliveryFixtures() (map[string]any, []map[string]any) {
	return map[string]any{"id": "loc-1", "currency_code": "ARS", "accepts_delivery": true, "accepts_pickup": true, "delivery_fee": 999}, []map[string]any{
		{"id": "centro", "location_id": "loc-1", "name": "Centro", "delivery_fee_cents": int64(150000), "min_order_cents": int64(1000000), "is_active": true},
		{"id": "norte", "location_id": "loc-1", "name": "Zona norte", "delivery_fee_cents": int64(300000), "min_order_cents": int64(2000000), "is_active": true},
		{"id": "paused", "location_id": "loc-1", "name": "Pausada", "delivery_fee_cents": int64(0), "is_active": false},
		{"id": "foreign", "location_id": "loc-2", "name": "Otro local", "delivery_fee_cents": int64(0), "is_active": true},
	}
}

func TestDeliveryFeeIsResolvedFromActiveLocationZone(t *testing.T) {
	location, zones := deliveryFixtures()
	for _, tc := range []struct {
		id, mode       string
		subtotal, want int64
		invalid        bool
	}{
		{"centro", "delivery", 1250000, 150000, false},
		{"norte", "delivery", 2500000, 300000, false},
		{"norte", "delivery", 1250000, 0, true},
		{"", "delivery", 2500000, 0, true},
		{"missing", "delivery", 2500000, 0, true},
		{"paused", "delivery", 2500000, 0, true},
		{"foreign", "delivery", 2500000, 0, true},
		{"centro", "collection", 2500000, 0, false},
		{"centro", "dine_in", 2500000, 0, false},
	} {
		t.Run(tc.mode+"/"+tc.id, func(t *testing.T) {
			// A forged browser fee never changes the configured amount.
			quote, err := priceDelivery(map[string]any{"fulfillment_type": tc.mode, "delivery_zone_id": tc.id, "delivery_fee_cents": 1}, location, zones, tc.subtotal)
			if (err != nil) != tc.invalid {
				t.Fatalf("error = %v, invalid = %v", err, tc.invalid)
			}
			if !tc.invalid && quote.fee != tc.want {
				t.Fatalf("fee = %d, want %d", quote.fee, tc.want)
			}
		})
	}
}

func TestDeliveryFreeThresholdDoesNotBypassZoneOrMinimum(t *testing.T) {
	location, zones := deliveryFixtures()
	location["free_delivery_threshold"] = 12000
	input := map[string]any{"order_type": "delivery", "delivery_zone_id": "centro"}
	q, err := priceDelivery(input, location, zones, 1250000)
	if err != nil || q.fee != 0 || q.id != "centro" {
		t.Fatalf("free zone = %#v, %v", q, err)
	}
	input["delivery_zone_id"] = "norte"
	if _, err := priceDelivery(input, location, zones, 1250000); err == nil {
		t.Fatal("free shipping must not bypass minimum")
	}
	delete(input, "delivery_zone_id")
	if _, err := priceDelivery(input, location, zones, 2500000); err == nil {
		t.Fatal("free shipping must require a zone")
	}
}

func TestDeliveryFallbackOnlyWhenLocalHasNoZones(t *testing.T) {
	location, _ := deliveryFixtures()
	q, err := priceDelivery(map[string]any{"fulfillment_type": "delivery"}, location, nil, 1250000)
	if err != nil || q.fee != 99900 {
		t.Fatalf("base fee = %#v, %v", q, err)
	}
	paused := []map[string]any{{"id": "paused", "location_id": "loc-1", "is_active": false, "name": "Centro", "delivery_fee_cents": 0}}
	if _, err := priceDelivery(map[string]any{"fulfillment_type": "delivery"}, location, paused, 1250000); err == nil {
		t.Fatal("all paused must not use base fee")
	}
}

func TestPublicDeliveryZoneProjectionAndSnapshot(t *testing.T) {
	location, zones := deliveryFixtures()
	options, required := publicDeliveryZones(zones, "loc-1")
	if !required || len(options) != 2 {
		t.Fatalf("options = %#v, required = %v", options, required)
	}
	for _, option := range options {
		if option["location_id"] != nil || option["organization_id"] != nil || option["polygon"] != nil {
			t.Fatal("public zone leaks management metadata")
		}
	}
	selection, _ := priceDelivery(map[string]any{"fulfillment_type": "delivery", "delivery_zone_id": "centro"}, location, zones, 1250000)
	order := map[string]any{}
	setDeliverySnapshot(order, selection)
	zones[0]["delivery_fee_cents"], zones[0]["name"] = 999999, "Renamed"
	if order["delivery_fee_cents"] != int64(150000) || order["delivery_zone_name"] != "Centro" {
		t.Fatalf("snapshot changed: %#v", order)
	}
}

func TestPublicOrderIncludesZoneFeeTaxAndTipAndRejectsStaleTotal(t *testing.T) {
	location, zones := deliveryFixtures()
	input := map[string]any{"fulfillment_type": "delivery", "delivery_zone_id": "centro", "tip_cents": int64(10000), "items": []any{map[string]any{"item_id": "pollo", "quantity": 1}}}
	catalog := []map[string]any{{"id": "pollo", "location_id": "loc-1", "name": "Pollo", "price_cents": int64(1250000), "is_active": true}}
	q, err := pricePublicOrder(input, location, catalog, 10, false, time.Now(), zones)
	if err != nil || q.total != 1535000 || q.delivery != 150000 || q.zone.id != "centro" {
		t.Fatalf("quote = %#v, %v", q, err)
	}
	input["expected_total_cents"] = q.total - q.delivery
	if _, err := pricePublicOrder(input, location, catalog, 10, false, time.Now(), zones); err == nil {
		t.Fatal("missing shipping in expected total must be rejected")
	}
	input["expected_total_cents"] = q.total
	if _, err := pricePublicOrder(input, location, catalog, 10, false, time.Now(), zones); err != nil {
		t.Fatalf("matching quote rejected: %v", err)
	}
}

func TestDeliveryZoneValidationRejectsInvalidMoneyAndDefaultsOptionalFields(t *testing.T) {
	for _, value := range []any{-1, 0.5, "not-money", 1e13} {
		row := map[string]any{"location_id": "loc-1", "name": "Centro", "delivery_fee_cents": value}
		if err := validateDeliveryZone(row); err == nil {
			t.Fatalf("accepted fee %#v", value)
		}
	}
	row := map[string]any{"location_id": "loc-1", "name": " Centro ", "delivery_fee_cents": 150000}
	if err := validateDeliveryZone(row); err != nil {
		t.Fatal(err)
	}
	if row["name"] != "Centro" || row["is_active"] != true || row["min_order_cents"] != int64(0) {
		t.Fatalf("defaults = %#v", row)
	}
}
