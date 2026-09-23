package main

import (
	"context"
	"log/slog"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
)

func handler(_ context.Context, event events.SQSEvent) (events.SQSEventResponse, error) {
	for _, message := range event.Records {
		slog.Info("job received", "message_id", message.MessageId)
	}
	return events.SQSEventResponse{}, nil
}

func main() {
	lambda.Start(handler)
}
