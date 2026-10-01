package dispatch

import (
	"testing"
	"time"
)

func TestIsDispatchableOrder(t *testing.T) {
	tests := []struct {
		name            string
		status          string
		fulfillmentType string
		orderType       string
		want            bool
	}{
		{"ready delivery", "ready", "delivery", "", true},
		{"cash on delivery while preparing", "pending_on_delivery", "delivery", "", false},
		{"delivery already in progress", "out_for_delivery", "delivery", "", true},
		{"pickup", "ready", "collection", "pickup", false},
		{"completed delivery", "completed", "delivery", "delivery", false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := isDispatchableOrder(test.status, test.fulfillmentType, test.orderType)
			if got != test.want {
				t.Fatalf("isDispatchableOrder() = %v, want %v", got, test.want)
			}
		})
	}
}

func TestOfferExpired(t *testing.T) {
	now := time.Date(2026, time.September, 29, 12, 0, 0, 0, time.UTC)
	tests := []struct {
		name string
		age  time.Duration
		want bool
	}{
		{"fresh offer", reofferAfter - time.Second, false},
		{"five minute offer", reofferAfter, true},
		{"old offer", reofferAfter + time.Minute, true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			lastOffer := now.Add(-test.age)
			if got := offerExpired(lastOffer, now); got != test.want {
				t.Fatalf("offerExpired() = %v, want %v", got, test.want)
			}
		})
	}
}
