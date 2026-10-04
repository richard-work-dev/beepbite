package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/beepbite/backend/pkg/tokens"
)

type workflowTransport func(*http.Request) (*http.Response, error)

func (f workflowTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

// AWS SDK integration against an in-memory HTTP transport. No AWS account,
// credentials, network, real order or real payment is used by these tests.
func workflowTestApp(t *testing.T, order map[string]any, assignments []map[string]any) (*application, *[][]map[string]any) {
	t.Helper()
	writes := [][]map[string]any{}
	wire := func(pk, sk string, row map[string]any) map[string]any {
		data, _ := json.Marshal(row)
		return map[string]any{"PK": map[string]string{"S": pk}, "SK": map[string]string{"S": sk}, "data": map[string]string{"S": string(data)}}
	}
	client := &http.Client{Transport: workflowTransport(func(r *http.Request) (*http.Response, error) {
		var input map[string]any
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			t.Fatal(err)
		}
		var output any = map[string]any{}
		switch {
		case strings.HasSuffix(r.Header.Get("X-Amz-Target"), ".GetItem"):
			key := input["Key"].(map[string]any)
			pk, sk := key["PK"].(map[string]any)["S"].(string), key["SK"].(map[string]any)["S"].(string)
			row := order
			if strings.HasPrefix(sk, "MEMBERSHIP#") {
				row = map[string]any{"role": "owner", "capabilities": map[string]any{}}
			}
			if strings.HasPrefix(sk, "DATA#staff#") {
				row = map[string]any{"id": "cook", "role": "kitchen", "location_id": "loc", "is_active": true, "capabilities": map[string]any{"can_kds": true}}
			}
			output = map[string]any{"Item": wire(pk, sk, row)}
		case strings.HasSuffix(r.Header.Get("X-Amz-Target"), ".Query"):
			values := input["ExpressionAttributeValues"].(map[string]any)
			prefix := values[":prefix"].(map[string]any)["S"].(string)
			rows := []map[string]any{}
			if prefix == "DATA#driver_assignments#" {
				rows = assignments
			}
			if prefix == "DATA#orders#" {
				rows = []map[string]any{order}
			}
			items := []map[string]any{}
			for i, row := range rows {
				items = append(items, wire("ORG#org", fmt.Sprintf("%s%d", prefix, i), row))
			}
			output = map[string]any{"Items": items}
		case strings.HasSuffix(r.Header.Get("X-Amz-Target"), ".PutItem"):
			writes = append(writes, []map[string]any{input})
		case strings.HasSuffix(r.Header.Get("X-Amz-Target"), ".TransactWriteItems"):
			batch := []map[string]any{}
			for _, item := range input["TransactItems"].([]any) {
				batch = append(batch, item.(map[string]any)["Put"].(map[string]any))
			}
			writes = append(writes, batch)
		default:
			t.Fatalf("unexpected DynamoDB operation %s", r.Header.Get("X-Amz-Target"))
		}
		body, _ := json.Marshal(output)
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"application/x-amz-json-1.0"}}, Body: io.NopCloser(strings.NewReader(string(body)))}, nil
	})}
	ddb := dynamodb.New(dynamodb.Options{Region: "us-east-1", BaseEndpoint: aws.String("https://dynamo.test"), HTTPClient: client, Credentials: aws.CredentialsProviderFunc(func(context.Context) (aws.Credentials, error) {
		return aws.Credentials{AccessKeyID: "fake", SecretAccessKey: "fake"}, nil
	})})
	return &application{table: "test", dynamo: ddb, jwtSecret: "local-test-secret"}, &writes
}

func TestWorkflowRoleResponsibilities(t *testing.T) {
	for _, role := range []string{"owner", "admin", "manager", "pos", "staff", "kitchen", "driver"} {
		actor := workflowActor{role: role, capabilities: memberCapabilities(role)}
		for _, capability := range []string{"can_pos", "can_settle", "can_kds"} {
			want := managerRole(role) || ((role == "pos" || role == "staff") && capability != "can_kds") || (role == "kitchen" && capability == "can_kds")
			if actor.allows(capability) != want {
				t.Errorf("role %s capability %s", role, capability)
			}
		}
	}
	if (workflowActor{role: "pos", capabilities: map[string]any{"can_pos": true, "can_settle": false}}).allows("can_settle") {
		t.Fatal("explicit settlement denial ignored")
	}
}

func TestActorOverlayCannotInheritOwnerPrivileges(t *testing.T) {
	a, _ := workflowTestApp(t, map[string]any{}, nil)
	token, _, err := tokens.IssueActorToken("user", "cook", "loc", []string{"can_kds"}, []byte(a.jwtSecret), time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	actor, err := a.workflowActor(context.Background(), events.APIGatewayV2HTTPRequest{Headers: map[string]string{"x-actor-token": token}}, "user", "org")
	if err != nil || actor.allows("can_pos") || actor.allows("can_settle") || !actor.allows("can_kds") {
		t.Fatalf("overlay privilege error: %#v %v", actor, err)
	}
	if _, err = a.workflowActor(context.Background(), events.APIGatewayV2HTTPRequest{Headers: map[string]string{"x-actor-token": token}}, "other-user", "org"); err == nil {
		t.Fatal("overlay accepted for wrong session")
	}
}

func TestExplicitHandoffRulesAndAudit(t *testing.T) {
	for _, test := range []struct {
		name, mode, current, next, pay, method, expected string
		assigned                                         bool
		code                                             int
	}{
		{"unpaid pickup", "collection", "ready", "completed", "pending", "cash", "ready", false, 409},
		{"paid pickup", "collection", "ready", "completed", "paid", "eft", "ready", false, 200},
		{"serve then pay", "dine_in", "ready", "completed", "pending", "cash", "ready", false, 200},
		{"delivery collect cash", "delivery", "ready", "out_for_delivery", "pending", "cash", "ready", false, 200},
		{"verify transfer", "delivery", "ready", "out_for_delivery", "pending", "eft", "ready", false, 409},
		{"assigned driver owns pickup", "delivery", "ready", "out_for_delivery", "paid", "eft", "ready", true, 409},
		{"stale order", "collection", "preparing", "completed", "paid", "cash", "ready", false, 409},
		{"POS cannot cook", "collection", "confirmed", "preparing", "paid", "cash", "confirmed", false, 403},
	} {
		t.Run(test.name, func(t *testing.T) {
			order := map[string]any{"id": "one", "location_id": "loc", "status": test.current, "fulfillment_type": test.mode, "payment_status": test.pay, "payment_method": test.method}
			assignments := []map[string]any{}
			if test.assigned {
				assignments = append(assignments, map[string]any{"order_id": "one", "status": "offered"})
			}
			a, writes := workflowTestApp(t, order, assignments)
			body, _ := json.Marshal(map[string]any{"status": test.next, "expected_status": test.expected})
			response := a.transitionPOSOrder(context.Background(), "org", "one", workflowActor{id: "cashier", name: "Caja", role: "pos"}, string(body))
			if response.StatusCode != test.code {
				t.Fatalf("status %d body %s", response.StatusCode, response.Body)
			}
			if test.code != 200 && len(*writes) != 0 {
				t.Fatal("rejected transition wrote data")
			}
			if test.code == 200 {
				put := (*writes)[0][0]
				if put["ConditionExpression"] != "#data = :previous" {
					t.Fatal("transition not conditional")
				}
				var saved map[string]any
				_ = json.Unmarshal([]byte(put["Item"].(map[string]any)["data"].(map[string]any)["S"].(string)), &saved)
				if saved["status_updated_by"] != "cashier" || saved["status_history"] == nil {
					t.Fatal("missing responsibility audit")
				}
			}
		})
	}
}

func TestPaymentIsAtomicAndDoesNotConfirmPickup(t *testing.T) {
	a, writes := workflowTestApp(t, map[string]any{"id": "one", "status": "ready", "fulfillment_type": "collection", "payment_status": "pending", "total_cents": 1000}, nil)
	response := a.chargePOSOrder(context.Background(), "org", "one", `{"payment_method_code":"eft","amount_paid_cents":1000,"processed_by_staff_id":"forged"}`, "cashier")
	if response.StatusCode != 200 {
		t.Fatalf("%d %s", response.StatusCode, response.Body)
	}
	if len(*writes) != 1 || len((*writes)[0]) != 2 {
		t.Fatalf("payment and order not committed together: %#v", *writes)
	}
	var result map[string]any
	_ = json.Unmarshal([]byte(response.Body), &result)
	if result["status"] != "ready" || result["payment_status"] != "paid" {
		t.Fatal("payment confused with pickup")
	}
	for _, put := range (*writes)[0] {
		var saved map[string]any
		_ = json.Unmarshal([]byte(put["Item"].(map[string]any)["data"].(map[string]any)["S"].(string)), &saved)
		if saved["order_id"] == "one" && saved["processed_by_staff_id"] != "cashier" {
			t.Fatal("client spoofed payment actor")
		}
	}
}

func TestKitchenCannotChargeFromSharedOwnerTerminal(t *testing.T) {
	a, writes := workflowTestApp(t, map[string]any{"id": "one", "location_id": "loc"}, nil)
	access, _, _ := tokens.IssueAccess("user", "owner@example.test", a.jwtSecret, time.Minute)
	actor, _, _ := tokens.IssueActorToken("user", "cook", "loc", []string{"can_kds"}, []byte(a.jwtSecret), time.Minute)
	request := events.APIGatewayV2HTTPRequest{RawPath: "/pos/orders/one/charge", Body: `{"payment_method_code":"cash","amount_paid_cents":1000}`, Headers: map[string]string{"authorization": "Bearer " + access, "x-organization-id": "org", "x-actor-token": actor}, RequestContext: events.APIGatewayV2HTTPRequestContext{HTTP: events.APIGatewayV2HTTPRequestContextHTTPDescription{Method: "POST"}}}
	response, handled, err := a.handleCommerceAPI(context.Background(), request)
	if err != nil || !handled || response.StatusCode != 403 || len(*writes) != 0 {
		t.Fatalf("kitchen could charge: %d %v", response.StatusCode, err)
	}
}

func TestGenericDataCannotBypassWorkflowRules(t *testing.T) {
	for _, resource := range []string{"orders", "order_payments", "order_items", "order_item_modifiers", "kds_tickets", "kds_ticket_items", "kds_ticket_events"} {
		operations := serverlessDataTables[resource]
		if !operations.Select || operations.Insert || operations.Update || operations.Delete {
			t.Fatalf("generic writes exposed for %s", resource)
		}
	}
}

func TestQueueRetainsFinancialDebtAndUnknownStates(t *testing.T) {
	for _, status := range []string{"completed", "delivered", "future_state"} {
		a, writes := workflowTestApp(t, map[string]any{"id": "one", "location_id": "loc", "status": status, "payment_status": "pending", "total_cents": 1000}, nil)
		response := a.listPOSOrderQueue(context.Background(), "org", "location_id=loc", workflowActor{role: "pos"})
		if response.StatusCode != 200 || len(*writes) != 0 {
			t.Fatalf("queue failed %d", response.StatusCode)
		}
		var payload struct {
			Orders []map[string]any `json:"orders"`
		}
		if json.Unmarshal([]byte(response.Body), &payload) != nil || len(payload.Orders) != 1 || payload.Orders[0]["status"] != status {
			t.Fatal("outstanding or unknown order hidden")
		}
		response = a.listPOSOrderQueue(context.Background(), "org", "location_id=other", workflowActor{locationID: "loc"})
		if response.StatusCode != 403 {
			t.Fatal("wrong-location queue allowed")
		}
	}
}
