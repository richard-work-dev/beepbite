package main

import (
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

func TestMarketplaceLocationTimeUsesConfiguredBusinessDay(t *testing.T) {
	now := time.Date(2026, time.October, 1, 2, 30, 0, 0, time.UTC)
	local := marketplaceLocationTime(now, map[string]any{"timezone": "America/Argentina/Buenos_Aires"})
	if got, want := local.Format("2006-01-02"), "2026-09-30"; got != want {
		t.Fatalf("business date = %s, want %s", got, want)
	}
}

func TestPublicOrderPaymentMethodsOnlyExposeConfiguredTransferWithValidDetails(t *testing.T) {
	location := map[string]any{
		"on_delivery_payment_methods": []any{"eft", "cash", "eft", "card_machine"},
		"transfer_account_holder":     "Riko Pollo SRL",
		"transfer_alias":              "rikopollo.mp",
		"transfer_cbu":                "0000000000000000000000",
	}
	methods := publicOrderPaymentMethods(location)
	if got, want := strings.Join(methods, ","), "eft,cash,card_machine"; got != want {
		t.Fatalf("methods = %q, want %q", got, want)
	}
	details := publicTransferDetails(location)
	if details["account_holder"] != "Riko Pollo SRL" || details["alias"] != "rikopollo.mp" || details["cbu"] != "0000000000000000000000" {
		t.Fatalf("unexpected transfer details: %#v", details)
	}

	delete(location, "transfer_account_holder")
	if got := strings.Join(publicOrderPaymentMethods(location), ","); got != "cash,card_machine" {
		t.Fatalf("EFT without a beneficiary should be hidden; methods = %q", got)
	}
}

func TestPublicTransferDetailsRequiresAliasOrTwentyTwoDigitCBU(t *testing.T) {
	base := map[string]any{"transfer_account_holder": "Riko Pollo", "transfer_cbu": "1234-5678"}
	if publicTransferDetails(base) != nil {
		t.Fatal("incomplete account details must not be exposed")
	}
	base["transfer_alias"] = "riko.pollo"
	if got := publicTransferDetails(base); got == nil || got["alias"] != "riko.pollo" {
		t.Fatalf("a valid alias and holder should enable transfer, got %#v", got)
	}
}

func TestPublicOrderRateLimitKeyIsWindowScopedAndDoesNotStoreIP(t *testing.T) {
	base := time.Date(2026, time.October, 1, 12, 1, 0, 0, time.UTC)
	first, firstExpiry := publicOrderRateLimitKey("store-1", "203.0.113.15", base)
	sameWindow, _ := publicOrderRateLimitKey("store-1", "203.0.113.15", base.Add(2*time.Minute))
	nextWindow, _ := publicOrderRateLimitKey("store-1", "203.0.113.15", base.Add(10*time.Minute))
	otherIP, _ := publicOrderRateLimitKey("store-1", "203.0.113.16", base)
	if first["PK"].(*types.AttributeValueMemberS).Value != sameWindow["PK"].(*types.AttributeValueMemberS).Value {
		t.Fatal("requests in the same window should share a rate-limit key")
	}
	if first["PK"].(*types.AttributeValueMemberS).Value == nextWindow["PK"].(*types.AttributeValueMemberS).Value {
		t.Fatal("rate-limit keys should rotate between windows")
	}
	if first["PK"].(*types.AttributeValueMemberS).Value == otherIP["PK"].(*types.AttributeValueMemberS).Value {
		t.Fatal("different client addresses should have different rate-limit keys")
	}
	if strings.Contains(first["PK"].(*types.AttributeValueMemberS).Value, "203.0.113.15") {
		t.Fatal("rate-limit key must not contain the raw client IP")
	}
	if firstExpiry <= base.Unix() {
		t.Fatal("rate-limit item must expire after the current window")
	}
}
