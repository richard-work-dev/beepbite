package main

import (
	"context"
	"encoding/json"
	"os"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
)

type healthResponse struct {
	Service      string `json:"service"`
	Status       string `json:"status"`
	Architecture string `json:"architecture"`
	Time         string `json:"time"`
}

func handler(_ context.Context, request events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	if request.RequestContext.HTTP.Method != "GET" || (request.RawPath != "/health" && request.RawPath != "/api/health") {
		return jsonResponse(404, map[string]string{"error": "not_found"})
	}

	if os.Getenv("CORE_TABLE") == "" {
		return jsonResponse(503, map[string]string{"error": "runtime_not_configured"})
	}

	return jsonResponse(200, healthResponse{
		Service:      "beepbite-api",
		Status:       "ok",
		Architecture: "lambda-dynamodb",
		Time:         time.Now().UTC().Format(time.RFC3339),
	})
}

func jsonResponse(status int, value any) (events.APIGatewayV2HTTPResponse, error) {
	body, err := json.Marshal(value)
	if err != nil {
		return events.APIGatewayV2HTTPResponse{}, err
	}
	return events.APIGatewayV2HTTPResponse{
		StatusCode: status,
		Headers:    map[string]string{"content-type": "application/json; charset=utf-8"},
		Body:       string(body),
	}, nil
}

func main() {
	lambda.Start(handler)
}
