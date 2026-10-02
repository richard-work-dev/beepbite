package main

import (
	"encoding/json"
	"testing"

	"github.com/aws/aws-lambda-go/events"
)

func TestPurgeJobStreamRecordRecognition(t *testing.T) {
	var event events.DynamoDBEvent
	if err := json.Unmarshal([]byte(`{"Records":[
		{"eventID":"job","eventName":"INSERT","dynamodb":{"SequenceNumber":"1","NewImage":{"PK":{"S":"PURGE#org-1"},"SK":{"S":"JOB"},"entity_type":{"S":"account_purge_job"}}}},
		{"eventID":"data","eventName":"INSERT","dynamodb":{"SequenceNumber":"2","NewImage":{"PK":{"S":"ORG#org-1"},"SK":{"S":"DATA#orders#o-1"},"entity_type":{"S":"orders"}}}},
		{"eventID":"removed-job","eventName":"REMOVE","dynamodb":{"SequenceNumber":"3","NewImage":{"PK":{"S":"PURGE#org-1"},"SK":{"S":"JOB"},"entity_type":{"S":"account_purge_job"}}}}
	]}`), &event); err != nil {
		t.Fatal(err)
	}
	if len(event.Records) != 3 {
		t.Fatalf("decoded %d records", len(event.Records))
	}
	if !isPurgeJobRecord(event.Records[0]) {
		t.Fatal("account purge marker was not recognized")
	}
	if isPurgeJobRecord(event.Records[1]) || isPurgeJobRecord(event.Records[2]) {
		t.Fatal("ordinary data and removed markers must not start a purge")
	}
}

func TestFailedStreamRecordsUsesSequenceNumbers(t *testing.T) {
	event := events.DynamoDBEvent{Records: []events.DynamoDBEventRecord{{Change: events.DynamoDBStreamRecord{SequenceNumber: "42"}}}}
	response := failedStreamRecords(event)
	if len(response.BatchItemFailures) != 1 || response.BatchItemFailures[0].ItemIdentifier != "42" {
		t.Fatalf("unexpected partial batch response: %#v", response)
	}
}
