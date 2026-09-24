package main

import (
	"math"
	"testing"
	"time"
)

func TestMatchMarketplaceRoute(t *testing.T) {
	tests := []struct{ method, path, name, slug string }{
		{"GET", "/stores", "list", ""},
		{"GET", "/stores/cafe-central", "detail", "cafe-central"},
		{"POST", "/stores/cafe-central/orders", "checkout", "cafe-central"},
	}
	for _, test := range tests {
		route, ok := matchMarketplaceRoute(test.method, test.path)
		if !ok || route.name != test.name || route.slug != test.slug {
			t.Fatalf("matchMarketplaceRoute(%q, %q) = %#v, %v", test.method, test.path, route, ok)
		}
	}
}

func TestMarketplaceItemAvailabilityAndRemaining(t *testing.T) {
	now := time.Date(2026, 9, 24, 12, 0, 0, 0, time.UTC)
	item := map[string]any{"is_active": true, "daily_quantity": int64(5), "daily_sold_count": int64(3), "daily_counter_date": "2026-09-24"}
	if remaining := marketplaceRemaining(item, now); remaining != int64(2) {
		t.Fatalf("marketplaceRemaining() = %#v", remaining)
	}
	if !marketplaceItemAvailable(item, now) {
		t.Fatal("item with remaining inventory should be available")
	}
	item["daily_sold_count"] = int64(5)
	if marketplaceItemAvailable(item, now) {
		t.Fatal("sold-out item should not be available")
	}
}

func TestHaversineKM(t *testing.T) {
	distance := haversineKM(4.711, -74.0721, 4.711, -74.0721)
	if math.Abs(distance) > 0.001 {
		t.Fatalf("same-point distance = %f", distance)
	}
}

func TestCurrencyScale(t *testing.T) {
	for code, want := range map[string]int64{"JPY": 1, "USD": 100, "KWD": 1000} {
		if got := currencyScale(code); got != want {
			t.Fatalf("currencyScale(%q) = %d, want %d", code, got, want)
		}
	}
}
