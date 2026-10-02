package main

import (
	"testing"
	"time"
)

func TestMarketplaceLocationTimeUsesConfiguredBusinessDay(t *testing.T) {
	now := time.Date(2026, time.October, 1, 2, 30, 0, 0, time.UTC)
	local := marketplaceLocationTime(now, map[string]any{"timezone": "America/Argentina/Buenos_Aires"})
	if got, want := local.Format("2006-01-02"), "2026-09-30"; got != want {
		t.Fatalf("business date = %s, want %s", got, want)
	}
}
