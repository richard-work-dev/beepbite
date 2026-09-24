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
