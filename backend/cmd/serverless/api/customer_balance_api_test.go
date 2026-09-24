package main

import "testing"

func TestMatchCustomerBalanceRoute(t *testing.T) {
	tests := []struct{ method, path, name, param string }{
		{"POST", "/gift-cards/issue", "gift_issue", ""},
		{"POST", "/gift-cards/redeem", "gift_redeem", ""},
		{"POST", "/gift-cards/reload", "gift_reload", ""},
		{"POST", "/gift-cards/refund", "gift_refund", ""},
		{"GET", "/gift-cards/lookup", "gift_lookup", ""},
		{"GET", "/loyalty/stamps/config", "stamp_config_get", ""},
		{"PUT", "/loyalty/stamps/config", "stamp_config_put", ""},
		{"GET", "/customers/customer-1/stamps", "stamps_get", "customer-1"},
		{"POST", "/customers/customer-1/stamps/accrue", "stamps_accrue", "customer-1"},
	}
	for _, test := range tests {
		route, ok := matchCustomerBalanceRoute(test.method, test.path)
		if !ok || route.name != test.name || route.param != test.param {
			t.Fatalf("%s %s matched %#v, %v", test.method, test.path, route, ok)
		}
	}
}

func TestMaskGiftCardCode(t *testing.T) {
	if got := maskGiftCardCode("abcd1234"); got != "****1234" {
		t.Fatalf("maskGiftCardCode() = %q", got)
	}
	if got := maskGiftCardCode("123"); got != "123" {
		t.Fatalf("short maskGiftCardCode() = %q", got)
	}
}
