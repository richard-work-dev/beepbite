package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/apigatewaymanagementapi"
	"github.com/aws/aws-sdk-go-v2/service/apigatewaymanagementapi/types"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	dynamodbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/aws/aws-sdk-go-v2/service/secretsmanager"
	"github.com/beepbite/backend/internal/auth"
)

var (
	clientsOnce sync.Once
	clientsErr  error
	dynamo      *dynamodb.Client
	secrets     *secretsmanager.Client
	jwtSecretMu sync.Mutex
	jwtSecret   string
)

func loadClients(ctx context.Context) error {
	clientsOnce.Do(func() {
		cfg, err := config.LoadDefaultConfig(ctx)
		if err != nil {
			clientsErr = err
			return
		}
		dynamo = dynamodb.NewFromConfig(cfg)
		secrets = secretsmanager.NewFromConfig(cfg)
	})
	return clientsErr
}

func loadJWTSecret(ctx context.Context) (string, error) {
	jwtSecretMu.Lock()
	defer jwtSecretMu.Unlock()

	if jwtSecret != "" {
		return jwtSecret, nil
	}
	if err := loadClients(ctx); err != nil {
		return "", err
	}
	secretID := os.Getenv("RUNTIME_SECRET_ID")
	if secretID == "" {
		return "", errors.New("RUNTIME_SECRET_ID is required")
	}
	out, err := secrets.GetSecretValue(ctx, &secretsmanager.GetSecretValueInput{SecretId: aws.String(secretID)})
	if err != nil {
		return "", err
	}
	if out.SecretString == nil {
		return "", errors.New("runtime secret is not a string")
	}
	payload := bytes.TrimPrefix([]byte(*out.SecretString), []byte{0xef, 0xbb, 0xbf})
	var values map[string]string
	if err := json.Unmarshal(payload, &values); err != nil {
		return "", fmt.Errorf("decode runtime secret: %w", err)
	}
	jwtSecret = values["JWT_SECRET"]
	if jwtSecret == "" {
		return "", errors.New("JWT_SECRET is missing")
	}
	return jwtSecret, nil
}

func handler(ctx context.Context, request events.APIGatewayWebsocketProxyRequest) (events.APIGatewayProxyResponse, error) {
	if err := loadClients(ctx); err != nil {
		return response(500), err
	}

	switch request.RequestContext.RouteKey {
	case "$connect":
		return connect(ctx, request)
	case "$disconnect":
		_, err := dynamo.DeleteItem(ctx, &dynamodb.DeleteItemInput{
			TableName: aws.String(os.Getenv("CONNECTIONS_TABLE")),
			Key: map[string]dynamodbtypes.AttributeValue{
				"connection_id": &dynamodbtypes.AttributeValueMemberS{Value: request.RequestContext.ConnectionID},
			},
		})
		return response(200), err
	default:
		return echo(ctx, request)
	}
}

func connect(ctx context.Context, request events.APIGatewayWebsocketProxyRequest) (events.APIGatewayProxyResponse, error) {
	token := request.QueryStringParameters["token"]
	secret, err := loadJWTSecret(ctx)
	if err != nil {
		return response(500), err
	}
	claims, err := auth.Parse(token, secret)
	if err != nil {
		return response(401), nil
	}
	now := time.Now().UTC()
	_, err = dynamo.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(os.Getenv("CONNECTIONS_TABLE")),
		Item: map[string]dynamodbtypes.AttributeValue{
			"connection_id": &dynamodbtypes.AttributeValueMemberS{Value: request.RequestContext.ConnectionID},
			"user_id":       &dynamodbtypes.AttributeValueMemberS{Value: claims.UserID},
			"connected_at":  &dynamodbtypes.AttributeValueMemberS{Value: now.Format(time.RFC3339Nano)},
			"expires_at":    &dynamodbtypes.AttributeValueMemberN{Value: fmt.Sprint(now.Add(24 * time.Hour).Unix())},
		},
	})
	return response(200), err
}

func echo(ctx context.Context, request events.APIGatewayWebsocketProxyRequest) (events.APIGatewayProxyResponse, error) {
	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		return response(500), err
	}
	endpoint := fmt.Sprintf("https://%s/%s", request.RequestContext.DomainName, request.RequestContext.Stage)
	client := apigatewaymanagementapi.NewFromConfig(cfg, func(options *apigatewaymanagementapi.Options) {
		options.BaseEndpoint = aws.String(endpoint)
	})
	_, err = client.PostToConnection(ctx, &apigatewaymanagementapi.PostToConnectionInput{
		ConnectionId: aws.String(request.RequestContext.ConnectionID),
		Data:         []byte(request.Body),
	})
	var gone *types.GoneException
	if errors.As(err, &gone) {
		return response(410), nil
	}
	return response(200), err
}

func response(status int) events.APIGatewayProxyResponse {
	return events.APIGatewayProxyResponse{StatusCode: status}
}

func main() {
	lambda.Start(handler)
}
