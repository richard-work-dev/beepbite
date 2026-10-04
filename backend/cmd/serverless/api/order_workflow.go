package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/beepbite/backend/pkg/tokens"
)

type workflowActor struct {
	id, name, role, locationID string
	capabilities               any
}

func containsCapability(caps []string, capability string) bool {
	for _, value := range caps {
		if value == capability {
			return true
		}
	}
	return false
}

func (a *application) listPOSOrderQueue(ctx context.Context, orgID, rawQuery string, actor workflowActor) events.APIGatewayV2HTTPResponse {
	values, _ := url.ParseQuery(rawQuery)
	locationID := values.Get("location_id")
	if locationID == "" {
		return errorResponse(400, "Seleccioná un local.")
	}
	if actor.locationID != "" && actor.locationID != locationID {
		return errorResponse(403, "El local no corresponde a tu sesión.")
	}
	if _, err := a.dataRowByID(ctx, orgID, "locations", locationID); err != nil {
		return errorResponse(404, "Local no encontrado.")
	}
	orders, err := a.queryDataRows(ctx, orgID, "orders")
	if err != nil {
		return dataAccessError(err)
	}
	assignments, err := a.queryDataRows(ctx, orgID, "driver_assignments")
	if err != nil {
		return dataAccessError(err)
	}
	payments, err := a.queryDataRows(ctx, orgID, "order_payments")
	if err != nil {
		return dataAccessError(err)
	}
	paidByOrder := map[string]int64{}
	for _, payment := range payments {
		if displayString(payment["payment_status"]) != "completed" {
			continue
		}
		amount, change := integerOr(payment, "amount_paid_cents", 0), integerOr(payment, "change_given_cents", 0)
		if amount > change {
			paidByOrder[displayString(payment["order_id"])] += amount - change
		}
	}
	activeAssignment := map[string]string{}
	for _, assignment := range assignments {
		status := displayString(assignment["status"])
		if status == "offered" || status == "assigned" || status == "accepted" || status == "picked_up" {
			activeAssignment[displayString(assignment["order_id"])] = status
		}
	}
	active, debt, closed := []map[string]any{}, []map[string]any{}, []map[string]any{}
	for _, order := range orders {
		if displayString(order["location_id"]) != locationID {
			continue
		}
		order["driver_assignment_status"] = activeAssignment[displayString(order["id"])]
		order["paid_cents"] = paidByOrder[displayString(order["id"])]
		status := displayString(order["status"])
		if status == "cancelled" || status == "completed" || status == "delivered" {
			if status != "cancelled" && displayString(order["payment_status"]) != "paid" {
				debt = append(debt, order)
			} else {
				closed = append(closed, order)
			}
		} else {
			active = append(active, order)
		}
	}
	for _, rows := range [][]map[string]any{active, debt} {
		sort.Slice(rows, func(i, j int) bool {
			return displayString(rows[i]["created_at"]) < displayString(rows[j]["created_at"])
		})
	}
	sort.Slice(closed, func(i, j int) bool {
		return displayString(closed[i]["created_at"]) > displayString(closed[j]["created_at"])
	})
	hasMore := len(active) > 250 || len(debt) > 250
	active, debt, closed = active[:min(len(active), 250)], debt[:min(len(debt), 250)], closed[:min(len(closed), 100)]
	return mustJSONResponse(200, map[string]any{"orders": append(append(active, debt...), closed...), "has_more": hasMore})
}

func (actor workflowActor) allows(capability string) bool {
	if managerRole(actor.role) {
		return true
	}
	caps := capabilityList(actor.capabilities)
	for _, cap := range caps {
		if cap == capability || (capability == "can_kds" && cap == "can_kitchen") {
			return true
		}
	}
	// Existing POS members are cashiers. An explicit settlement override wins.
	if capability == "can_settle" {
		if values, ok := actor.capabilities.(map[string]any); ok {
			if value, exists := values["can_settle"]; exists {
				return value == true
			}
		}
		for _, cap := range caps {
			if cap == "can_pos" {
				return true
			}
		}
	}
	return false
}

// An overlay restricts the account behind a shared terminal; it never inherits
// the owner's privileges. Re-read staff permissions so revocations take effect.
func (a *application) workflowActor(ctx context.Context, request events.APIGatewayV2HTTPRequest, userID, orgID string) (workflowActor, error) {
	membership, err := a.getMembership(ctx, userID, orgID)
	if err != nil {
		return workflowActor{}, errForbidden
	}
	actor := workflowActor{id: userID, name: userID, role: displayString(membership["role"]), capabilities: membership["capabilities"]}
	raw := requestHeader(request.Headers, "x-actor-token")
	if raw == "" {
		if profiles, profileErr := a.profileRows(ctx, userID); profileErr == nil && len(profiles) > 0 {
			name := displayString(valueOr(profiles[0], "full_name", profiles[0]["first_name"]))
			if name != "" {
				actor.name = name
			}
		}
		return actor, nil
	}
	secret, err := a.loadJWTSecret(ctx)
	if err != nil {
		return workflowActor{}, err
	}
	claims, err := tokens.ParseActorToken(raw, []byte(secret))
	if err != nil || claims.MemberID != userID {
		return workflowActor{}, errForbidden
	}
	staff, err := a.dataRowByID(ctx, orgID, "staff", claims.StaffID)
	if err != nil || staff["is_active"] == false || displayString(staff["location_id"]) != claims.LocationID {
		return workflowActor{}, errForbidden
	}
	name := strings.TrimSpace(displayString(staff["first_name"]) + " " + displayString(staff["last_name"]))
	if name == "" {
		name = displayString(valueOr(staff, "display_name", staff["username"]))
	}
	return workflowActor{id: claims.StaffID, name: name, role: displayString(staff["role"]), locationID: claims.LocationID, capabilities: staff["capabilities"]}, nil
}

func handoffPaymentError(order map[string]any, next string) string {
	fulfillment := displayString(valueOr(order, "fulfillment_type", order["order_type"]))
	if displayString(order["payment_status"]) == "paid" {
		return ""
	}
	if next == "completed" && fulfillment != "dine_in" {
		return "Registrá el pago antes de confirmar el retiro."
	}
	if next == "out_for_delivery" && displayString(order["payment_method"]) == "eft" {
		return "Verificá y registrá la transferencia antes de despachar."
	}
	return ""
}

func recordOrderTransition(order map[string]any, next string, actor workflowActor) {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	history, _ := order["status_history"].([]any)
	history = append(history, map[string]any{"from": order["status"], "to": next, "at": now, "actor_id": actor.id, "actor_name": actor.name, "actor_role": actor.role})
	if len(history) > 60 {
		history = history[len(history)-60:]
	}
	order["status_history"], order["status"], order["updated_at"] = history, next, now
	order["status_updated_by"], order["status_updated_by_name"] = actor.id, actor.name
	if next == "completed" || next == "delivered" {
		order["handed_off_at"] = now
	}
}

func conditionalRowPut(table, orgID, resource string, previous, next map[string]any) (*types.Put, error) {
	item, err := jsonDataItem("ORG#"+orgID, "DATA#"+resource+"#"+displayString(next["id"]), resource, displayString(next["id"]), next)
	if err != nil {
		return nil, err
	}
	before, err := json.Marshal(previous)
	if err != nil {
		return nil, err
	}
	return &types.Put{TableName: aws.String(table), Item: item, ConditionExpression: aws.String("#data = :previous"), ExpressionAttributeNames: map[string]string{"#data": "data"}, ExpressionAttributeValues: map[string]types.AttributeValue{":previous": &types.AttributeValueMemberS{Value: string(before)}}}, nil
}

func (a *application) putWorkflowRow(ctx context.Context, orgID, resource string, previous, next map[string]any) error {
	put, err := conditionalRowPut(a.table, orgID, resource, previous, next)
	if err != nil {
		return err
	}
	_, err = a.dynamo.PutItem(ctx, &dynamodb.PutItemInput{TableName: put.TableName, Item: put.Item, ConditionExpression: put.ConditionExpression, ExpressionAttributeNames: put.ExpressionAttributeNames, ExpressionAttributeValues: put.ExpressionAttributeValues})
	var conflict *types.ConditionalCheckFailedException
	if errors.As(err, &conflict) {
		return errConflict
	}
	return err
}

func prepareWorkflowCreate(table, orgID, resource string, row map[string]any) (map[string]any, *types.Put, error) {
	id, err := randomID()
	if err != nil {
		return nil, nil, err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	row["id"], row["organization_id"], row["created_at"], row["updated_at"] = id, orgID, now, now
	item, err := jsonDataItem("ORG#"+orgID, "DATA#"+resource+"#"+id, resource, id, row)
	return row, &types.Put{TableName: aws.String(table), Item: item, ConditionExpression: aws.String("attribute_not_exists(PK)")}, err
}

func (a *application) transitionPOSOrder(ctx context.Context, orgID, orderID string, actor workflowActor, body string) events.APIGatewayV2HTTPResponse {
	var input map[string]any
	if decodeDataObject(body, &input) != nil {
		return errorResponse(400, "Solicitud inválida.")
	}
	order, err := a.dataRowByID(ctx, orgID, "orders", orderID)
	if err != nil {
		return errorResponse(404, "Pedido no encontrado.")
	}
	if actor.locationID != "" && actor.locationID != displayString(order["location_id"]) {
		return errorResponse(403, "El pedido pertenece a otro local.")
	}
	current, next := displayString(order["status"]), displayString(input["status"])
	if current != displayString(input["expected_status"]) {
		return errorResponse(409, "El pedido cambió. Actualizá antes de continuar.")
	}
	fulfillment := displayString(valueOr(order, "fulfillment_type", order["order_type"]))
	if !validOrderStatusTransition(current, next, fulfillment) {
		return errorResponse(409, "Este cambio no corresponde al estado del pedido.")
	}
	if next == "preparing" || next == "ready" {
		return errorResponse(403, "La preparación se actualiza desde las comandas de cocina.")
	}
	if next == "cancelled" {
		return errorResponse(403, "Usá la anulación con motivo y autorización del encargado.")
	}
	if message := handoffPaymentError(order, next); message != "" {
		return errorResponse(409, message)
	}
	if fulfillment == "delivery" && (next == "out_for_delivery" || next == "delivered") {
		assignments, err := a.queryDataRows(ctx, orgID, "driver_assignments")
		if err != nil {
			return dataAccessError(err)
		}
		for _, assignment := range assignments {
			if displayString(assignment["order_id"]) == orderID && (displayString(assignment["status"]) == "offered" || displayString(assignment["status"]) == "assigned" || displayString(assignment["status"]) == "accepted" || displayString(assignment["status"]) == "picked_up") {
				return errorResponse(409, "El repartidor asignado debe confirmar el retiro y la entrega desde Reparto.")
			}
		}
	}
	previous := cloneDataRow(order)
	recordOrderTransition(order, next, actor)
	if err := a.putWorkflowRow(ctx, orgID, "orders", previous, order); err != nil {
		return dataAccessError(err)
	}
	if next == "completed" && fulfillment == "dine_in" {
		_, closeErr := a.closeTableSessionWhenPaid(ctx, orgID, displayString(order["table_session_id"]))
		if closeErr != nil {
			order["session_close_error"] = true
		}
	}
	return mustJSONResponse(200, order)
}
