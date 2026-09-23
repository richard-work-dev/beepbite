package main

import (
	"context"
	"log/slog"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
)

func handler(_ context.Context, event events.DynamoDBEvent) (events.DynamoDBEventResponse, error) {
	for _, record := range event.Records {
		slog.Info("core data changed", "event_id", record.EventID, "event_name", record.EventName)
	}
	return events.DynamoDBEventResponse{}, nil
}

func main() {
	lambda.Start(handler)
}
