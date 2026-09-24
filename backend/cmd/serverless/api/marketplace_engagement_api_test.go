package main

import (
	"testing"
	"time"
)

func TestMatchMarketplaceEngagementRoute(t *testing.T) {
	tests := []struct {
		method, path, name string
		matched            bool
	}{
		{"GET", "/stores/my-shop/reviews", "public-reviews", true},
		{"POST", "/reviews", "submit-review", true},
		{"POST", "/reviews/rev-1/reply", "reply-review", true},
		{"GET", "/track/token-1", "tracking", true},
		{"GET", "/locations/loc-1/pickup-slots", "pickup-slots", true},
		{"DELETE", "/reviews/rev-1", "", false},
	}
	for _, test := range tests {
		t.Run(test.method+" "+test.path, func(t *testing.T) {
			route, matched := matchMarketplaceEngagementRoute(test.method, test.path)
			if matched != test.matched || route.name != test.name {
				t.Fatalf("got route=%q matched=%v, want route=%q matched=%v", route.name, matched, test.name, test.matched)
			}
		})
	}
}

func TestGeneratePickupSlots(t *testing.T) {
	date := time.Date(2026, 9, 24, 0, 0, 0, 0, time.UTC)
	slots := generatePickupSlots(date, 30)
	if len(slots) != 22 {
		t.Fatalf("got %d slots, want 22", len(slots))
	}
	if got := slots[0].Format(time.RFC3339); got != "2026-09-24T10:00:00Z" {
		t.Fatalf("first slot = %s", got)
	}
	if got := slots[len(slots)-1].Format(time.RFC3339); got != "2026-09-24T20:30:00Z" {
		t.Fatalf("last slot = %s", got)
	}
}

func TestValidatePickupAt(t *testing.T) {
	value, err := validatePickupAt("2026-09-24T15:30:00-05:00", "collection")
	if err != nil || value != "2026-09-24T20:30:00Z" {
		t.Fatalf("value=%v err=%v", value, err)
	}
	if _, err := validatePickupAt("2026-09-24T15:30:00Z", "delivery"); err == nil {
		t.Fatal("expected delivery pickup_at to be rejected")
	}
	if _, err := validatePickupAt("tomorrow", "collection"); err == nil {
		t.Fatal("expected malformed pickup_at to be rejected")
	}
}

func TestMarketplaceReviewResponseNormalizesPhotos(t *testing.T) {
	response := marketplaceReviewResponse(map[string]any{
		"id": "r1", "stars": int64(5), "review_text": "Great", "photos": nil,
	})
	photos, ok := response["photos"].([]string)
	if !ok || len(photos) != 0 {
		t.Fatalf("photos = %#v, want empty []string", response["photos"])
	}
	if response["text"] != "Great" {
		t.Fatalf("text = %#v", response["text"])
	}
}
