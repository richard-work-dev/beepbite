package main

import (
	"context"
	"testing"

	"github.com/aws/aws-lambda-go/events"
)

func TestHandlerAcceptsCORSPreflight(t *testing.T) {
	response, err := handler(context.Background(), events.APIGatewayV2HTTPRequest{
		RawPath: "/api/ready",
		RequestContext: events.APIGatewayV2HTTPRequestContext{
			HTTP: events.APIGatewayV2HTTPRequestContextHTTPDescription{Method: "OPTIONS"},
		},
	})
	if err != nil {
		t.Fatalf("handler returned an error: %v", err)
	}
	if response.StatusCode != 204 {
		t.Fatalf("status = %d, want 204", response.StatusCode)
	}
	if response.Body != "" {
		t.Fatalf("body = %q, want empty", response.Body)
	}
}

func TestValidAccountPassword(t *testing.T) {
	for _, test := range []struct {
		password string
		valid    bool
	}{
		{password: "Corta1a", valid: false},
		{password: "solominusculas123", valid: false},
		{password: "SOLOMAYUSCULAS123", valid: false},
		{password: "SinNumerosAqui", valid: false},
		{password: "ClaveSegura2026", valid: true},
	} {
		if got := validAccountPassword(test.password); got != test.valid {
			t.Errorf("validAccountPassword(%q) = %v, want %v", test.password, got, test.valid)
		}
	}
}
