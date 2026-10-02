package main

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"
)

const purgePageSize = 20

type purgeJob struct {
	OrganizationID string `json:"organization_id"`
	Status         string `json:"status"`
	CursorPK       string `json:"cursor_pk,omitempty"`
	CursorSK       string `json:"cursor_sk,omitempty"`
	S3Cursor       string `json:"s3_cursor,omitempty"`
}

type purgeRunner struct {
	table         string
	uploadsBucket string
	dynamo        *dynamodb.Client
	s3            *s3.Client
}

func handler(ctx context.Context, event events.DynamoDBEvent) (events.DynamoDBEventResponse, error) {
	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		return failedStreamRecords(event), err
	}
	runner := purgeRunner{
		table:         os.Getenv("CORE_TABLE"),
		uploadsBucket: os.Getenv("UPLOADS_BUCKET"),
		dynamo:        dynamodb.NewFromConfig(cfg),
		s3:            s3.NewFromConfig(cfg),
	}
	if runner.table == "" {
		return failedStreamRecords(event), errors.New("CORE_TABLE is not configured")
	}
	response := events.DynamoDBEventResponse{}
	for _, record := range event.Records {
		if !isPurgeJobRecord(record) {
			slog.Info("core data changed", "event_id", record.EventID, "event_name", record.EventName)
			continue
		}
		if err := runner.advance(ctx, record.Change.NewImage["PK"].String()[len("PURGE#"):]); err != nil {
			slog.Error("tenant purge page failed", "event_id", record.EventID, "error", err)
			response.BatchItemFailures = append(response.BatchItemFailures, events.DynamoDBBatchItemFailure{ItemIdentifier: record.Change.SequenceNumber})
		}
	}
	return response, nil
}

func isPurgeJobRecord(record events.DynamoDBEventRecord) bool {
	if record.EventName == string(events.DynamoDBOperationTypeRemove) {
		return false
	}
	image := record.Change.NewImage
	pk, sk := streamString(image, "PK"), streamString(image, "SK")
	return strings.HasPrefix(pk, "PURGE#") && sk == "JOB" && streamString(image, "entity_type") == "account_purge_job"
}

func streamString(image map[string]events.DynamoDBAttributeValue, key string) string {
	value, ok := image[key]
	if !ok || value.DataType() != events.DataTypeString {
		return ""
	}
	return value.String()
}

func failedStreamRecords(event events.DynamoDBEvent) events.DynamoDBEventResponse {
	response := events.DynamoDBEventResponse{}
	for _, record := range event.Records {
		response.BatchItemFailures = append(response.BatchItemFailures, events.DynamoDBBatchItemFailure{ItemIdentifier: record.Change.SequenceNumber})
	}
	return response
}

func (r *purgeRunner) advance(ctx context.Context, organizationID string) error {
	key := map[string]types.AttributeValue{
		"PK": &types.AttributeValueMemberS{Value: "PURGE#" + organizationID},
		"SK": &types.AttributeValueMemberS{Value: "JOB"},
	}
	result, err := r.dynamo.GetItem(ctx, &dynamodb.GetItemInput{TableName: aws.String(r.table), Key: key, ConsistentRead: aws.Bool(true)})
	if err != nil {
		return err
	}
	if len(result.Item) == 0 {
		return nil // idempotent retry after a completed/removed job
	}
	data, ok := result.Item["data"].(*types.AttributeValueMemberS)
	if !ok {
		return errors.New("purge job has no data payload")
	}
	var job purgeJob
	if err := json.Unmarshal([]byte(data.Value), &job); err != nil {
		return err
	}
	if job.Status == "complete" || job.OrganizationID != organizationID {
		return nil
	}
	if job.Status == "purging_data" {
		return r.purgeDataPage(ctx, key, job)
	}
	if job.Status == "purging_uploads" {
		return r.purgeUploadPage(ctx, key, job)
	}
	return errors.New("unknown purge job status")
}

func (r *purgeRunner) purgeDataPage(ctx context.Context, jobKey map[string]types.AttributeValue, job purgeJob) error {
	input := &dynamodb.QueryInput{
		TableName:                 aws.String(r.table),
		KeyConditionExpression:    aws.String("PK = :pk"),
		ExpressionAttributeValues: map[string]types.AttributeValue{":pk": &types.AttributeValueMemberS{Value: "ORG#" + job.OrganizationID}},
		Limit:                     aws.Int32(purgePageSize),
		ConsistentRead:            aws.Bool(true),
	}
	if job.CursorPK != "" && job.CursorSK != "" {
		input.ExclusiveStartKey = map[string]types.AttributeValue{
			"PK": &types.AttributeValueMemberS{Value: job.CursorPK},
			"SK": &types.AttributeValueMemberS{Value: job.CursorSK},
		}
	}
	page, err := r.dynamo.Query(ctx, input)
	if err != nil {
		return err
	}
	for _, item := range page.Items {
		sk, ok := item["SK"].(*types.AttributeValueMemberS)
		if !ok {
			return errors.New("organization row has no sort key")
		}
		if strings.HasPrefix(sk.Value, "MEMBER#") {
			var row map[string]any
			if data, ok := item["data"].(*types.AttributeValueMemberS); ok && json.Unmarshal([]byte(data.Value), &row) == nil {
				if profileID := stringValue(row["profile_id"]); profileID != "" {
					_, err = r.dynamo.DeleteItem(ctx, &dynamodb.DeleteItemInput{TableName: aws.String(r.table), Key: map[string]types.AttributeValue{
						"PK": &types.AttributeValueMemberS{Value: "USER#" + profileID},
						"SK": &types.AttributeValueMemberS{Value: "MEMBERSHIP#" + job.OrganizationID},
					}})
					if err != nil {
						return err
					}
					if err := r.deleteOrphanAccount(ctx, profileID); err != nil {
						return err
					}
				}
			}
		}
	}
	if len(page.Items) > 0 {
		writes := make([]types.WriteRequest, 0, len(page.Items))
		for _, item := range page.Items {
			writes = append(writes, types.WriteRequest{DeleteRequest: &types.DeleteRequest{Key: map[string]types.AttributeValue{
				"PK": item["PK"], "SK": item["SK"],
			}}})
		}
		if err := r.batchDelete(ctx, writes); err != nil {
			return err
		}
	}
	if len(page.LastEvaluatedKey) == 0 {
		job.Status, job.CursorPK, job.CursorSK = "purging_uploads", "", ""
	} else {
		job.Status = "purging_data"
		pk, pkOK := page.LastEvaluatedKey["PK"].(*types.AttributeValueMemberS)
		sk, skOK := page.LastEvaluatedKey["SK"].(*types.AttributeValueMemberS)
		if !pkOK || !skOK {
			return errors.New("DynamoDB returned an invalid purge cursor")
		}
		job.CursorPK, job.CursorSK = pk.Value, sk.Value
	}
	return r.saveJob(ctx, jobKey, job)
}

func (r *purgeRunner) deleteOrphanAccount(ctx context.Context, userID string) error {
	partition := "USER#" + userID
	rows, err := queryPartition(ctx, r.dynamo, r.table, partition, "MEMBERSHIP#")
	if err != nil {
		return err
	}
	if len(rows) != 0 {
		return nil
	}
	profile, err := r.dynamo.GetItem(ctx, &dynamodb.GetItemInput{TableName: aws.String(r.table), ConsistentRead: aws.Bool(true), Key: map[string]types.AttributeValue{
		"PK": &types.AttributeValueMemberS{Value: partition},
		"SK": &types.AttributeValueMemberS{Value: "PROFILE"},
	}})
	if err != nil || len(profile.Item) == 0 {
		return err
	}
	writes := []types.WriteRequest{{DeleteRequest: &types.DeleteRequest{Key: map[string]types.AttributeValue{
		"PK": &types.AttributeValueMemberS{Value: partition}, "SK": &types.AttributeValueMemberS{Value: "PROFILE"},
	}}}}
	if email := stringValue(profile.Item["email"]); email != "" {
		writes = append(writes, types.WriteRequest{DeleteRequest: &types.DeleteRequest{Key: map[string]types.AttributeValue{
			"PK": &types.AttributeValueMemberS{Value: "EMAIL#" + strings.ToLower(email)},
			"SK": &types.AttributeValueMemberS{Value: "LOOKUP"},
		}}})
	}
	if err := r.batchDelete(ctx, writes); err != nil {
		return err
	}
	return r.deleteRefreshTokens(ctx, userID)
}

func (r *purgeRunner) deleteRefreshTokens(ctx context.Context, userID string) error {
	var start map[string]types.AttributeValue
	for {
		page, err := r.dynamo.Query(ctx, &dynamodb.QueryInput{
			TableName: aws.String(r.table), IndexName: aws.String("GSI2"),
			KeyConditionExpression: aws.String("GSI2PK = :user AND begins_with(GSI2SK, :prefix)"),
			ExpressionAttributeValues: map[string]types.AttributeValue{
				":user":   &types.AttributeValueMemberS{Value: "USER#" + userID},
				":prefix": &types.AttributeValueMemberS{Value: "REFRESH#"},
			}, ExclusiveStartKey: start,
		})
		if err != nil {
			return err
		}
		writes := make([]types.WriteRequest, 0, len(page.Items))
		for _, item := range page.Items {
			writes = append(writes, types.WriteRequest{DeleteRequest: &types.DeleteRequest{Key: map[string]types.AttributeValue{
				"PK": item["PK"], "SK": item["SK"],
			}}})
		}
		if err := r.batchDelete(ctx, writes); err != nil {
			return err
		}
		if len(page.LastEvaluatedKey) == 0 {
			return nil
		}
		start = page.LastEvaluatedKey
	}
}

func queryPartition(ctx context.Context, client *dynamodb.Client, table, partition, prefix string) ([]map[string]types.AttributeValue, error) {
	var rows []map[string]types.AttributeValue
	var start map[string]types.AttributeValue
	for {
		page, err := client.Query(ctx, &dynamodb.QueryInput{
			TableName: aws.String(table), KeyConditionExpression: aws.String("PK = :pk AND begins_with(SK, :prefix)"),
			ExpressionAttributeValues: map[string]types.AttributeValue{
				":pk": &types.AttributeValueMemberS{Value: partition}, ":prefix": &types.AttributeValueMemberS{Value: prefix},
			}, ExclusiveStartKey: start, ConsistentRead: aws.Bool(true),
		})
		if err != nil {
			return nil, err
		}
		rows = append(rows, page.Items...)
		if len(page.LastEvaluatedKey) == 0 {
			return rows, nil
		}
		start = page.LastEvaluatedKey
	}
}

func (r *purgeRunner) batchDelete(ctx context.Context, pending []types.WriteRequest) error {
	for len(pending) > 0 {
		result, err := r.dynamo.BatchWriteItem(ctx, &dynamodb.BatchWriteItemInput{RequestItems: map[string][]types.WriteRequest{r.table: pending}})
		if err != nil {
			return err
		}
		pending = result.UnprocessedItems[r.table]
		if len(pending) > 0 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(150 * time.Millisecond):
			}
		}
	}
	return nil
}

func (r *purgeRunner) purgeUploadPage(ctx context.Context, jobKey map[string]types.AttributeValue, job purgeJob) error {
	if r.uploadsBucket == "" {
		job.Status = "complete"
		return r.saveJob(ctx, jobKey, job)
	}
	input := &s3.ListObjectsV2Input{Bucket: aws.String(r.uploadsBucket), Prefix: aws.String("organizations/" + job.OrganizationID + "/"), ContinuationToken: optionalString(job.S3Cursor)}
	page, err := r.s3.ListObjectsV2(ctx, input)
	if err != nil {
		return err
	}
	if len(page.Contents) > 0 {
		objects := make([]s3types.ObjectIdentifier, 0, len(page.Contents))
		for _, object := range page.Contents {
			if object.Key != nil {
				objects = append(objects, s3types.ObjectIdentifier{Key: object.Key})
			}
		}
		deleted, deleteErr := r.s3.DeleteObjects(ctx, &s3.DeleteObjectsInput{Bucket: aws.String(r.uploadsBucket), Delete: &s3types.Delete{Objects: objects, Quiet: aws.Bool(true)}})
		if deleteErr != nil {
			return deleteErr
		}
		if len(deleted.Errors) > 0 {
			return errors.New("one or more tenant uploads could not be deleted")
		}
	}
	if page.IsTruncated != nil && *page.IsTruncated && page.NextContinuationToken != nil {
		job.S3Cursor = *page.NextContinuationToken
		return r.saveJob(ctx, jobKey, job)
	}
	job.Status, job.S3Cursor = "complete", ""
	return r.saveJob(ctx, jobKey, job)
}

func (r *purgeRunner) saveJob(ctx context.Context, key map[string]types.AttributeValue, job purgeJob) error {
	payload, err := json.Marshal(job)
	if err != nil {
		return err
	}
	_, err = r.dynamo.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(r.table), Key: key,
		UpdateExpression:          aws.String("SET #data = :data"),
		ExpressionAttributeNames:  map[string]string{"#data": "data"},
		ExpressionAttributeValues: map[string]types.AttributeValue{":data": &types.AttributeValueMemberS{Value: string(payload)}},
	})
	return err
}

func optionalString(value string) *string {
	if value == "" {
		return nil
	}
	return aws.String(value)
}

func stringValue(value any) string {
	if text, ok := value.(string); ok {
		return text
	}
	return ""
}

func main() {
	lambda.Start(handler)
}
