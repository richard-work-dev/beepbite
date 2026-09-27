package main

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
)

type commerceRoute struct {
	name   string
	params []string
}

func matchCommerceRoute(method, path string) (commerceRoute, bool) {
	segments := strings.Split(strings.Trim(path, "/"), "/")
	switch {
	case method == "POST" && len(segments) == 2 && segments[0] == "pos" && segments[1] == "orders":
		return commerceRoute{name: "pos_create"}, true
	case method == "GET" && len(segments) == 3 && segments[0] == "pos" && segments[1] == "orders" && segments[2] == "held":
		return commerceRoute{name: "pos_held"}, true
	case len(segments) == 4 && segments[0] == "pos" && segments[1] == "orders" && method == "POST" && (segments[3] == "charge" || segments[3] == "hold" || segments[3] == "release"):
		return commerceRoute{name: "pos_" + segments[3], params: []string{segments[2]}}, true
	case len(segments) == 4 && segments[0] == "pos" && segments[1] == "orders" && method == "PATCH" && segments[3] == "items":
		return commerceRoute{name: "pos_modify", params: []string{segments[2]}}, true
	case len(segments) == 4 && segments[0] == "cash-drawers" && segments[2] == "sessions" && method == "POST" && segments[3] == "open":
		return commerceRoute{name: "cash_open", params: []string{segments[1]}}, true
	case len(segments) == 3 && segments[0] == "cash-drawers" && segments[2] == "sessions" && method == "GET":
		return commerceRoute{name: "cash_list", params: []string{segments[1]}}, true
	case len(segments) == 4 && segments[0] == "cash-drawers" && segments[1] == "sessions" && method == "POST" && segments[3] == "movements":
		return commerceRoute{name: "cash_movement", params: []string{segments[2]}}, true
	case len(segments) == 4 && segments[0] == "cash-drawers" && segments[1] == "sessions" && method == "POST" && segments[3] == "close":
		return commerceRoute{name: "cash_close", params: []string{segments[2]}}, true
	case len(segments) == 3 && segments[0] == "cash-drawers" && segments[1] == "sessions" && method == "GET":
		return commerceRoute{name: "cash_get", params: []string{segments[2]}}, true
	case len(segments) == 4 && segments[0] == "kds" && segments[1] == "stations" && method == "GET" && (segments[3] == "tickets" || segments[3] == "stream"):
		return commerceRoute{name: "kds_station_" + segments[3], params: []string{segments[2]}}, true
	case len(segments) == 4 && segments[0] == "kds" && segments[1] == "tickets" && method == "GET" && segments[3] == "details":
		return commerceRoute{name: "kds_details", params: []string{segments[2]}}, true
	case len(segments) == 4 && segments[0] == "kds" && segments[1] == "tickets" && method == "POST" && (segments[3] == "start" || segments[3] == "ready" || segments[3] == "bump" || segments[3] == "recall" || segments[3] == "refire" || segments[3] == "rush"):
		return commerceRoute{name: "kds_" + segments[3], params: []string{segments[2]}}, true
	case len(segments) == 2 && segments[0] == "kds" && segments[1] == "expo" && method == "GET":
		return commerceRoute{name: "kds_expo_list"}, true
	case len(segments) == 4 && segments[0] == "kds" && segments[1] == "orders" && method == "GET" && segments[3] == "expo":
		return commerceRoute{name: "kds_expo", params: []string{segments[2]}}, true
	case len(segments) == 4 && segments[0] == "kds" && segments[1] == "orders" && method == "POST" && segments[3] == "fanout":
		return commerceRoute{name: "kds_fanout", params: []string{segments[2]}}, true
	case len(segments) == 2 && segments[0] == "timeclock" && method == "POST" && (segments[1] == "clock-in" || segments[1] == "clock-out"):
		return commerceRoute{name: "time_" + strings.ReplaceAll(segments[1], "-", "_")}, true
	case len(segments) == 2 && segments[0] == "timeclock" && segments[1] == "entries" && method == "GET":
		return commerceRoute{name: "time_list"}, true
	case len(segments) == 3 && segments[0] == "timeclock" && segments[1] == "entries" && method == "PATCH":
		return commerceRoute{name: "time_edit", params: []string{segments[2]}}, true
	default:
		return commerceRoute{}, false
	}
}

func (a *application) handleCommerceAPI(ctx context.Context, request events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, bool, error) {
	route, matched := matchCommerceRoute(request.RequestContext.HTTP.Method, request.RawPath)
	if !matched {
		return events.APIGatewayV2HTTPResponse{}, false, nil
	}
	headers := commerceRequestHeaders(route.name, request)
	request.Headers = headers
	claims, err := a.authenticate(ctx, headers)
	if err != nil {
		return errorResponse(401, "invalid token"), true, nil
	}
	orgID, err := a.authorizedOrganization(ctx, request, claims.UserID)
	if err != nil {
		return dataAccessError(err), true, nil
	}

	var response events.APIGatewayV2HTTPResponse
	switch route.name {
	case "pos_create":
		response = a.createPOSOrder(ctx, orgID, request.Body)
	case "pos_modify":
		response = a.modifyPOSOrder(ctx, orgID, route.params[0], request.Body)
	case "pos_charge":
		response = a.chargePOSOrder(ctx, orgID, route.params[0], request.Body)
	case "pos_hold", "pos_release":
		response = a.holdPOSOrder(ctx, orgID, route.params[0], route.name == "pos_hold")
	case "pos_held":
		response = a.listHeldPOSOrders(ctx, orgID, request.RawQueryString)
	case "cash_open":
		response = a.openCashSession(ctx, orgID, route.params[0], request.Body)
	case "cash_list":
		response = a.listCashSessions(ctx, orgID, route.params[0], request.RawQueryString)
	case "cash_get":
		response = a.getCashSession(ctx, orgID, route.params[0])
	case "cash_movement":
		response = a.addCashMovement(ctx, orgID, route.params[0], request.Body)
	case "cash_close":
		response = a.closeCashSession(ctx, orgID, route.params[0], request.Body)
	case "kds_station_tickets":
		response = a.listKDSTickets(ctx, orgID, route.params[0])
	case "kds_station_stream":
		response = events.APIGatewayV2HTTPResponse{StatusCode: 200, Headers: map[string]string{"content-type": "text/event-stream", "cache-control": "no-cache"}, Body: "retry: 5000\nevent: connected\ndata: {}\n\n"}
	case "kds_details":
		response = a.getKDSTicketDetails(ctx, orgID, route.params[0])
	case "kds_start", "kds_ready", "kds_bump", "kds_recall", "kds_refire", "kds_rush":
		response = a.transitionKDSTicket(ctx, orgID, route.params[0], strings.TrimPrefix(route.name, "kds_"))
	case "kds_expo":
		response = a.getKDSExpo(ctx, orgID, route.params[0])
	case "kds_expo_list":
		response = a.listKDSExpo(ctx, orgID)
	case "kds_fanout":
		response = a.fanoutKDS(ctx, orgID, route.params[0])
	case "time_clock_in", "time_clock_out":
		response = a.createTimeEntry(ctx, orgID, claims.UserID, strings.TrimPrefix(route.name, "time_"), request.Body)
	case "time_list":
		response = a.listTimeEntries(ctx, claims.UserID, orgID, request.RawQueryString)
	case "time_edit":
		response = a.editTimeEntry(ctx, claims.UserID, orgID, route.params[0], request.Body)
	}
	return response, true, nil
}

func commerceRequestHeaders(routeName string, request events.APIGatewayV2HTTPRequest) map[string]string {
	headers := request.Headers
	if routeName == "kds_station_stream" {
		values, _ := url.ParseQuery(request.RawQueryString)
		token := strings.TrimSpace(values.Get("token"))
		organizationID := strings.TrimSpace(values.Get("organization_id"))
		if (token != "" && requestHeader(headers, "authorization") == "") || (organizationID != "" && requestHeader(headers, "x-organization-id") == "") {
			headers = make(map[string]string, len(request.Headers)+1)
			for key, value := range request.Headers {
				headers[key] = value
			}
			if token != "" {
				headers["authorization"] = "Bearer " + token
			}
			if organizationID != "" {
				headers["x-organization-id"] = organizationID
			}
		}
	}
	return headers
}

func (a *application) createStoredRow(ctx context.Context, orgID, table string, row map[string]any) (map[string]any, error) {
	id, err := randomID()
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	row["id"], row["organization_id"], row["created_at"], row["updated_at"] = id, orgID, now, now
	if err := a.putDataRow(ctx, orgID, table, row, true); err != nil {
		return nil, err
	}
	return row, nil
}

func (a *application) deleteStoredRow(ctx context.Context, orgID, table, id string) error {
	_, err := a.dynamo.DeleteItem(ctx, &dynamodb.DeleteItemInput{TableName: aws.String(a.table), Key: dataRowKey(orgID, table, id)})
	return err
}

func (a *application) createPOSOrder(ctx context.Context, orgID, body string) events.APIGatewayV2HTTPResponse {
	var input map[string]any
	if decodeDataObject(body, &input) != nil {
		return errorResponse(400, "invalid request body")
	}
	locationID := strings.TrimSpace(fmt.Sprint(input["location_id"]))
	orderType := strings.TrimSpace(fmt.Sprint(input["order_type"]))
	if orderType == "takeaway" {
		orderType = "pickup"
	}
	if locationID == "" || (orderType != "dine_in" && orderType != "pickup" && orderType != "delivery") {
		return errorResponse(400, "location_id and valid order_type required")
	}
	if _, err := a.dataRowByID(ctx, orgID, "locations", locationID); err != nil {
		return errorResponse(404, "location not found")
	}
	tableSessionID := strings.TrimSpace(displayString(input["table_session_id"]))
	if tableSessionID != "" {
		session, sessionErr := a.dataRowByID(ctx, orgID, "table_sessions", tableSessionID)
		if sessionErr != nil || displayString(session["location_id"]) != locationID {
			return errorResponse(400, "invalid table_session_id")
		}
		if displayString(session["status"]) != "open" {
			return errorResponse(409, "table session is not open")
		}
		if orderType != "dine_in" {
			return errorResponse(400, "table_session_id requires dine_in order_type")
		}
	}
	lines, ok := input["items"].([]any)
	if !ok || len(lines) == 0 {
		return errorResponse(400, "items must not be empty")
	}

	subtotal := int64(0)
	prepared := make([]map[string]any, 0, len(lines))
	for _, raw := range lines {
		line, ok := raw.(map[string]any)
		if !ok {
			return errorResponse(400, "items must contain objects")
		}
		itemID := strings.TrimSpace(fmt.Sprint(line["item_id"]))
		qty, valid := integerValue(line["quantity"])
		if itemID == "" || !valid || qty < 1 {
			return errorResponse(400, "each item requires item_id and quantity > 0")
		}
		item, err := a.dataRowByID(ctx, orgID, "items", itemID)
		if err != nil || fmt.Sprint(item["location_id"]) != locationID {
			return errorResponse(400, "one or more item_ids are invalid")
		}
		if item["is_86ed"] == true || item["is_active"] == false {
			return errorResponse(409, "item is unavailable")
		}
		unit, ok := integerValue(item["price_cents"])
		if !ok {
			if price, numberOK := numericValue(item["price"]); numberOK {
				unit = int64(math.Round(price * 100))
			} else {
				return errorResponse(400, "item has no price")
			}
		}
		lineTotal := unit * qty
		subtotal += lineTotal
		prepared = append(prepared, map[string]any{
			"item_id": itemID, "item_name": item["name"], "category_id": item["category_id"],
			"quantity": qty, "unit_price_cents": unit, "line_total_cents": lineTotal,
			"special_instructions": valueOr(line, "notes", nil), "course_id": valueOr(line, "course_id", nil),
			"variation_option_ids": valueOr(line, "variation_option_ids", []string{}), "modifiers": valueOr(line, "modifiers", []any{}),
		})
	}

	location, _ := a.dataRowByID(ctx, orgID, "locations", locationID)
	taxRate, _ := numericValue(location["tax_rate"])
	taxInclusive, _ := location["tax_inclusive"].(bool)
	tax := int64(0)
	if taxRate > 0 {
		if taxInclusive {
			tax = int64(math.Round(float64(subtotal) * taxRate / (100 + taxRate)))
		} else {
			tax = int64(math.Round(float64(subtotal) * taxRate / 100))
		}
	}
	total := subtotal
	if !taxInclusive {
		total += tax
	}
	now := time.Now().UTC()
	order := map[string]any{
		"location_id": locationID, "order_type": orderType, "status": "confirmed",
		"order_number":   "POS-" + now.Format("060102150405") + "-" + strconv.FormatInt(now.UnixNano()%1000, 10),
		"subtotal_cents": subtotal, "tax_cents": tax, "gratuity_cents": int64(0), "total_cents": total,
		"currency_code": valueOr(location, "currency_code", "USD"), "currency_decimals": int64(2),
		"tax_rate": taxRate, "tax_inclusive": taxInclusive, "tax_label": valueOr(location, "tax_label", "Tax"),
		"table_number": valueOr(input, "table_number", nil), "table_session_id": nullableString(tableSessionID),
		"register_session_id": valueOr(input, "register_session_id", nil), "customer_id": valueOr(input, "customer_id", nil),
		"notes": valueOr(input, "notes", nil), "party_size": valueOr(input, "party_size", 1), "held_at": nil,
	}
	created, err := a.createStoredRow(ctx, orgID, "orders", order)
	if err != nil {
		return dataAccessError(err)
	}
	createdItems := make([]map[string]any, 0, len(prepared))
	for _, line := range prepared {
		line["order_id"] = created["id"]
		createdItem, createErr := a.createStoredRow(ctx, orgID, "order_items", line)
		if createErr != nil {
			return dataAccessError(createErr)
		}
		createdItems = append(createdItems, createdItem)
	}
	tickets, err := a.fanoutKDSRows(ctx, orgID, created)
	if err != nil {
		return dataAccessError(err)
	}
	return mustJSONResponse(201, posOrderResponse(created, tickets, createdItems))
}

func posOrderResponse(order map[string]any, ticketIDs []string, orderItems []map[string]any) map[string]any {
	subtotal, _ := integerValue(order["subtotal_cents"])
	tax, _ := integerValue(order["tax_cents"])
	gratuity, _ := integerValue(order["gratuity_cents"])
	total, _ := integerValue(order["total_cents"])
	return map[string]any{
		"order_id": order["id"], "order_number": order["order_number"],
		"subtotal_minor": subtotal, "tax_minor": tax, "gratuity_minor": gratuity, "total_minor": total,
		"subtotal": float64(subtotal) / 100, "tax": float64(tax) / 100, "gratuity": float64(gratuity) / 100, "total": float64(total) / 100,
		"currency_code": order["currency_code"], "currency_decimals": valueOr(order, "currency_decimals", 2),
		"tax_rate": valueOr(order, "tax_rate", 0), "tax_inclusive": valueOr(order, "tax_inclusive", false), "tax_label": valueOr(order, "tax_label", "Tax"),
		"kds_ticket_ids": ticketIDs, "items": orderItems, "status": order["status"], "payment_method": valueOr(order, "payment_method", ""),
	}
}

func (a *application) modifyPOSOrder(ctx context.Context, orgID, orderID, body string) events.APIGatewayV2HTTPResponse {
	order, err := a.dataRowByID(ctx, orgID, "orders", orderID)
	if err != nil {
		return errorResponse(404, "order not found")
	}
	if fmt.Sprint(order["status"]) == "completed" || fmt.Sprint(order["status"]) == "cancelled" {
		return errorResponse(409, "order cannot be modified")
	}
	tickets, err := a.queryDataRows(ctx, orgID, "kds_tickets")
	if err != nil {
		return dataAccessError(err)
	}
	for _, ticket := range tickets {
		if fmt.Sprint(ticket["order_id"]) == orderID && fmt.Sprint(ticket["status"]) != "fired" {
			return errorResponse(409, "order already in preparation, cannot modify")
		}
	}
	var input map[string]any
	if decodeDataObject(body, &input) != nil {
		return errorResponse(400, "invalid request body")
	}
	lines, ok := input["items"].([]any)
	if !ok || len(lines) == 0 {
		return errorResponse(400, "items must be a non-empty array")
	}
	locationID := fmt.Sprint(order["location_id"])
	subtotal := int64(0)
	prepared := make([]map[string]any, 0, len(lines))
	for _, raw := range lines {
		line, ok := raw.(map[string]any)
		if !ok {
			return errorResponse(400, "items must contain objects")
		}
		itemID := strings.TrimSpace(fmt.Sprint(line["item_id"]))
		qty, valid := integerValue(line["quantity"])
		item, getErr := a.dataRowByID(ctx, orgID, "items", itemID)
		if !valid || qty < 1 || getErr != nil || fmt.Sprint(item["location_id"]) != locationID {
			return errorResponse(400, "one or more item_ids are invalid")
		}
		unit, priceOK := integerValue(item["price_cents"])
		if !priceOK {
			price, numericOK := numericValue(item["price"])
			if !numericOK {
				return errorResponse(400, "item has no price")
			}
			unit = int64(math.Round(price * 100))
		}
		lineTotal := unit * qty
		subtotal += lineTotal
		prepared = append(prepared, map[string]any{"order_id": orderID, "item_id": itemID, "item_name": item["name"], "category_id": item["category_id"], "quantity": qty, "unit_price_cents": unit, "line_total_cents": lineTotal, "special_instructions": valueOr(line, "notes", nil), "course_id": valueOr(line, "course_id", nil), "modifiers": valueOr(line, "modifiers", []any{})})
	}
	if err := a.deleteRowsMatching(ctx, orgID, "order_items", "order_id", orderID); err != nil {
		return dataAccessError(err)
	}
	if err := a.deleteTicketsForOrder(ctx, orgID, orderID); err != nil {
		return dataAccessError(err)
	}
	for _, line := range prepared {
		if _, err := a.createStoredRow(ctx, orgID, "order_items", line); err != nil {
			return dataAccessError(err)
		}
	}
	taxRate, _ := numericValue(order["tax_rate"])
	taxInclusive, _ := order["tax_inclusive"].(bool)
	tax := int64(math.Round(float64(subtotal) * taxRate / 100))
	if taxInclusive && taxRate > 0 {
		tax = int64(math.Round(float64(subtotal) * taxRate / (100 + taxRate)))
	}
	total := subtotal
	if !taxInclusive {
		total += tax
	}
	order["subtotal_cents"], order["tax_cents"], order["total_cents"] = subtotal, tax, total
	order["updated_at"] = time.Now().UTC().Format(time.RFC3339Nano)
	if err := a.putDataRow(ctx, orgID, "orders", order, false); err != nil {
		return dataAccessError(err)
	}
	ticketIDs, err := a.fanoutKDSRows(ctx, orgID, order)
	if err != nil {
		return dataAccessError(err)
	}
	return mustJSONResponse(200, map[string]any{"order_id": orderID, "subtotal": float64(subtotal) / 100, "tax": float64(tax) / 100, "total": float64(total) / 100, "currency_code": order["currency_code"], "kds_ticket_ids": ticketIDs})
}

func (a *application) chargePOSOrder(ctx context.Context, orgID, orderID, body string) events.APIGatewayV2HTTPResponse {
	order, err := a.dataRowByID(ctx, orgID, "orders", orderID)
	if err != nil {
		return errorResponse(404, "order not found")
	}
	if fmt.Sprint(order["payment_status"]) == "paid" {
		return errorResponse(409, "order already paid")
	}
	if fmt.Sprint(order["status"]) == "cancelled" {
		return errorResponse(409, "cancelled order cannot be paid")
	}
	var input map[string]any
	if decodeDataObject(body, &input) != nil {
		return errorResponse(400, "invalid request body")
	}
	legs := []map[string]any{}
	if raw, ok := input["payments"].([]any); ok && len(raw) > 0 {
		for _, entry := range raw {
			leg, ok := entry.(map[string]any)
			if !ok {
				return errorResponse(400, "payments must contain objects")
			}
			legs = append(legs, leg)
		}
	} else {
		legs = append(legs, input)
	}
	// Read the kitchen state before creating payment rows so a transient data
	// error cannot leave duplicate payment records on a retry.
	tickets, err := a.queryDataRows(ctx, orgID, "kds_tickets")
	if err != nil {
		return dataAccessError(err)
	}
	statuses := kdsStatusesForOrder(tickets, orderID)
	payments, err := a.queryDataRows(ctx, orgID, "order_payments")
	if err != nil {
		return dataAccessError(err)
	}
	totalCents, totalOK := integerValue(order["total_cents"])
	if !totalOK || totalCents < 1 {
		return errorResponse(409, "order has no payable balance")
	}
	paidBefore := completedPaymentCents(payments, orderID)
	if paidBefore >= totalCents {
		return errorResponse(409, "order already paid")
	}
	normalizedLegs := make([]map[string]any, 0, len(legs))
	newPaidCents := int64(0)
	for _, leg := range legs {
		method := strings.TrimSpace(fmt.Sprint(leg["payment_method_code"]))
		amount, amountOK := integerValue(leg["amount_paid_cents"])
		change := int64(0)
		if rawChange, exists := leg["change_given_cents"]; exists {
			var changeOK bool
			change, changeOK = integerValue(rawChange)
			if !changeOK {
				return errorResponse(400, "change_given_cents must be an integer")
			}
		}
		if method == "" || !amountOK || amount < 1 || change < 0 || change >= amount {
			return errorResponse(400, "each payment requires a positive amount and valid change")
		}
		if method != "cash" && change > 0 {
			return errorResponse(400, "change is only valid for cash payments")
		}
		leg["payment_method_code"], leg["amount_paid_cents"], leg["change_given_cents"] = method, amount, change
		normalizedLegs = append(normalizedLegs, leg)
		newPaidCents += amount - change
	}
	remainingBefore := totalCents - paidBefore
	if newPaidCents > remainingBefore {
		return errorResponse(400, "payment exceeds remaining balance")
	}
	legs = normalizedLegs
	paymentIDs := make([]string, 0, len(legs))
	for _, leg := range legs {
		method := strings.TrimSpace(fmt.Sprint(leg["payment_method_code"]))
		amount, _ := integerValue(leg["amount_paid_cents"])
		payment, createErr := a.createStoredRow(ctx, orgID, "order_payments", map[string]any{
			"order_id": orderID, "payment_method_code": method, "amount_paid_cents": amount,
			"tip_amount_cents": valueOr(leg, "tip_amount_cents", 0), "change_given_cents": valueOr(leg, "change_given_cents", 0),
			"payment_reference": valueOr(leg, "payment_reference", nil), "processed_by_staff_id": valueOr(input, "processed_by_staff_id", nil), "payment_status": "completed",
		})
		if createErr != nil {
			return dataAccessError(createErr)
		}
		paymentIDs = append(paymentIDs, fmt.Sprint(payment["id"]))
		if method == "cash" {
			sessionID := displayString(order["register_session_id"])
			if sessionID != "" {
				_, _ = a.createStoredRow(ctx, orgID, "cash_drawer_session_payments", map[string]any{"cash_drawer_session_id": sessionID, "order_payment_id": payment["id"], "payment_id": payment["id"]})
			}
		}
	}
	// Payment and kitchen fulfilment are separate lifecycles. A customer may
	// pay before preparation finishes; marking the order completed here used
	// to make it disappear from Expo even though its KDS ticket was active.
	// Complete it now only when every kitchen ticket is already terminal.
	paidCents := paidBefore + newPaidCents
	paymentStatus := "partial"
	if paidCents == totalCents {
		paymentStatus = "paid"
		order["status"] = orderStatusAfterPayment(fmt.Sprint(order["status"]), statuses)
	}
	order["payment_status"], order["updated_at"] = paymentStatus, time.Now().UTC().Format(time.RFC3339Nano)
	if len(legs) == 1 {
		order["payment_method"] = legs[0]["payment_method_code"]
	} else {
		order["payment_method"] = "split"
	}
	if err := a.putDataRow(ctx, orgID, "orders", order, false); err != nil {
		return dataAccessError(err)
	}
	sessionClosed := false
	sessionCloseError := false
	if paymentStatus == "paid" {
		var closeErr error
		sessionClosed, closeErr = a.closeTableSessionWhenPaid(ctx, orgID, displayString(order["table_session_id"]))
		if closeErr != nil {
			// The payment has already been persisted, so returning an error here
			// would encourage the POS to retry the charge. Report the table-close
			// failure separately and let the client refresh the floor safely.
			sessionCloseError = true
		}
	}
	firstID := ""
	if len(paymentIDs) > 0 {
		firstID = paymentIDs[0]
	}
	return mustJSONResponse(200, map[string]any{
		"order_id": orderID, "payment_id": firstID, "payment_ids": paymentIDs, "payment_status": paymentStatus,
		"paid_cents": paidCents, "remaining_cents": totalCents - paidCents, "session_closed": sessionClosed,
		"session_close_error": sessionCloseError,
	})
}

func (a *application) closeTableSessionWhenPaid(ctx context.Context, orgID, sessionID string) (bool, error) {
	if sessionID == "" {
		return false, nil
	}
	session, err := a.dataRowByID(ctx, orgID, "table_sessions", sessionID)
	if err != nil || displayString(session["status"]) != "open" {
		return false, err
	}
	orders, err := a.queryDataRows(ctx, orgID, "orders")
	if err != nil {
		return false, err
	}
	linkedOrders := 0
	for _, order := range orders {
		if displayString(order["table_session_id"]) != sessionID || displayString(order["status"]) == "cancelled" {
			continue
		}
		linkedOrders++
		if displayString(order["payment_status"]) != "paid" {
			return false, nil
		}
	}
	if linkedOrders == 0 {
		return false, nil
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	session["status"], session["closed_at"], session["updated_at"] = "closed", now, now
	if err := a.putDataRow(ctx, orgID, "table_sessions", session, false); err != nil {
		return false, err
	}
	if table, tableErr := a.dataRowByID(ctx, orgID, "tables", displayString(session["table_id"])); tableErr == nil {
		table["status"], table["updated_at"] = "available", now
		if err := a.putDataRow(ctx, orgID, "tables", table, false); err != nil {
			return false, err
		}
	}
	return true, nil
}

func (a *application) holdPOSOrder(ctx context.Context, orgID, orderID string, hold bool) events.APIGatewayV2HTTPResponse {
	order, err := a.dataRowByID(ctx, orgID, "orders", orderID)
	if err != nil {
		return errorResponse(404, "order not found")
	}
	status := fmt.Sprint(order["status"])
	if status == "completed" || status == "cancelled" {
		return errorResponse(409, "order is already paid or cancelled")
	}
	if hold && order["held_at"] != nil {
		return errorResponse(409, "order is already held")
	}
	ticketIDs := []string{}
	if hold {
		order["held_at"] = time.Now().UTC().Format(time.RFC3339Nano)
		if err := a.deleteTicketsForOrder(ctx, orgID, orderID); err != nil {
			return dataAccessError(err)
		}
	} else {
		order["held_at"] = nil
		if ticketIDs, err = a.fanoutKDSRows(ctx, orgID, order); err != nil {
			return dataAccessError(err)
		}
	}
	order["updated_at"] = time.Now().UTC().Format(time.RFC3339Nano)
	if err := a.putDataRow(ctx, orgID, "orders", order, false); err != nil {
		return dataAccessError(err)
	}
	return mustJSONResponse(200, map[string]any{"order_id": orderID, "held_at": order["held_at"], "kds_ticket_ids": ticketIDs})
}

func (a *application) listHeldPOSOrders(ctx context.Context, orgID, rawQuery string) events.APIGatewayV2HTTPResponse {
	values, _ := url.ParseQuery(rawQuery)
	locationID := values.Get("location_id")
	if locationID == "" {
		return errorResponse(400, "location_id is required")
	}
	rows, err := a.queryDataRows(ctx, orgID, "orders")
	if err != nil {
		return dataAccessError(err)
	}
	result := make([]map[string]any, 0)
	for _, row := range rows {
		if fmt.Sprint(row["location_id"]) == locationID && row["held_at"] != nil {
			result = append(result, map[string]any{"order_id": row["id"], "order_number": row["order_number"], "location_id": locationID, "status": row["status"], "total_cents": row["total_cents"], "held_at": row["held_at"], "notes": row["notes"]})
		}
	}
	return mustJSONResponse(200, map[string]any{"orders": result})
}

func (a *application) deleteRowsMatching(ctx context.Context, orgID, table, field, value string) error {
	rows, err := a.queryDataRows(ctx, orgID, table)
	if err != nil {
		return err
	}
	for _, row := range rows {
		if fmt.Sprint(row[field]) == value {
			if err := a.deleteStoredRow(ctx, orgID, table, fmt.Sprint(row["id"])); err != nil {
				return err
			}
		}
	}
	return nil
}

func (a *application) deleteTicketsForOrder(ctx context.Context, orgID, orderID string) error {
	tickets, err := a.queryDataRows(ctx, orgID, "kds_tickets")
	if err != nil {
		return err
	}
	for _, ticket := range tickets {
		if fmt.Sprint(ticket["order_id"]) != orderID {
			continue
		}
		if err := a.deleteRowsMatching(ctx, orgID, "kds_ticket_items", "ticket_id", fmt.Sprint(ticket["id"])); err != nil {
			return err
		}
		if err := a.deleteStoredRow(ctx, orgID, "kds_tickets", fmt.Sprint(ticket["id"])); err != nil {
			return err
		}
	}
	return nil
}

func (a *application) fanoutKDSRows(ctx context.Context, orgID string, order map[string]any) ([]string, error) {
	orderID := fmt.Sprint(order["id"])
	if order["held_at"] != nil {
		return []string{}, nil
	}
	existing, err := a.queryDataRows(ctx, orgID, "kds_tickets")
	if err != nil {
		return nil, err
	}
	ids := []string{}
	for _, ticket := range existing {
		if fmt.Sprint(ticket["order_id"]) == orderID && fmt.Sprint(ticket["status"]) != "bumped" {
			ids = append(ids, fmt.Sprint(ticket["id"]))
		}
	}
	if len(ids) > 0 {
		return ids, nil
	}
	lines, err := a.queryDataRows(ctx, orgID, "order_items")
	if err != nil {
		return nil, err
	}
	stations, err := a.queryDataRows(ctx, orgID, "kitchen_stations")
	if err != nil {
		return nil, err
	}
	itemRoutes, _ := a.queryDataRows(ctx, orgID, "item_station_routing")
	categoryRoutes, _ := a.queryDataRows(ctx, orgID, "category_station_routing")
	stationByID := map[string]map[string]any{}
	for _, station := range stations {
		if fmt.Sprint(station["location_id"]) == fmt.Sprint(order["location_id"]) && station["is_active"] != false {
			stationByID[fmt.Sprint(station["id"])] = station
		}
	}
	// A single-store kitchen needs a usable default on its first order. Later
	// stations and item/category routing continue to override this fallback.
	if len(stationByID) == 0 {
		station, createErr := a.createStoredRow(ctx, orgID, "kitchen_stations", map[string]any{
			"location_id": order["location_id"], "name": "Cocina principal", "is_active": true,
		})
		if createErr != nil {
			return nil, createErr
		}
		stationByID[fmt.Sprint(station["id"])] = station
	}
	grouped := map[string][]map[string]any{}
	for _, line := range lines {
		if fmt.Sprint(line["order_id"]) != orderID {
			continue
		}
		stationID := ""
		for _, route := range itemRoutes {
			candidateID := fmt.Sprint(route["station_id"])
			if fmt.Sprint(route["item_id"]) == fmt.Sprint(line["item_id"]) && route["is_primary"] != false && stationByID[candidateID] != nil {
				stationID = candidateID
				break
			}
		}
		if stationID == "" {
			for _, route := range categoryRoutes {
				candidateID := fmt.Sprint(route["station_id"])
				if fmt.Sprint(route["category_id"]) == fmt.Sprint(line["category_id"]) && route["is_primary"] != false && stationByID[candidateID] != nil {
					stationID = candidateID
					break
				}
			}
		}
		if stationID == "" {
			for id := range stationByID {
				stationID = id
				break
			}
		}
		if stationByID[stationID] != nil {
			grouped[stationID] = append(grouped[stationID], line)
		}
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	for stationID, stationLines := range grouped {
		ticket, createErr := a.createStoredRow(ctx, orgID, "kds_tickets", map[string]any{
			"order_id": orderID, "station_id": stationID, "ticket_number": len(existing) + len(ids) + 1,
			"status": "fired", "fired_at": now, "started_at": nil, "ready_at": nil, "bumped_at": nil,
			"bumped_by": nil, "course_number": nil, "priority": 0, "notes": order["notes"],
		})
		if createErr != nil {
			return nil, createErr
		}
		ticketID := fmt.Sprint(ticket["id"])
		ids = append(ids, ticketID)
		for _, line := range stationLines {
			if _, createErr = a.createStoredRow(ctx, orgID, "kds_ticket_items", map[string]any{
				"ticket_id": ticketID, "order_item_id": line["id"], "item_id": line["item_id"], "item_name": line["item_name"],
				"quantity": line["quantity"], "item_status": "fired", "notes": line["special_instructions"],
			}); createErr != nil {
				return nil, createErr
			}
		}
	}
	return ids, nil
}

func (a *application) fanoutKDS(ctx context.Context, orgID, orderID string) events.APIGatewayV2HTTPResponse {
	order, err := a.dataRowByID(ctx, orgID, "orders", orderID)
	if err != nil {
		return errorResponse(404, "order not found")
	}
	if order["held_at"] != nil {
		return errorResponse(409, "the order is on hold and cannot be sent to kitchen")
	}
	ids, err := a.fanoutKDSRows(ctx, orgID, order)
	if err != nil {
		return dataAccessError(err)
	}
	if len(ids) == 0 {
		return errorResponse(409, "the order could not be assigned to an active kitchen station")
	}
	allItems, _ := a.queryDataRows(ctx, orgID, "kds_ticket_items")
	tickets := make([]map[string]any, 0, len(ids))
	for _, id := range ids {
		ticket, getErr := a.dataRowByID(ctx, orgID, "kds_tickets", id)
		if getErr != nil {
			continue
		}
		ticketItems := make([]map[string]any, 0)
		for _, item := range allItems {
			if fmt.Sprint(item["ticket_id"]) == id {
				ticketItems = append(ticketItems, item)
			}
		}
		ticket["items"] = ticketItems
		tickets = append(tickets, ticket)
	}
	return mustJSONResponse(201, tickets)
}

func (a *application) listKDSTickets(ctx context.Context, orgID, stationID string) events.APIGatewayV2HTTPResponse {
	if station, err := a.dataRowByID(ctx, orgID, "kitchen_stations", stationID); err != nil || station["is_active"] == false {
		return errorResponse(404, "station not found")
	}
	rows, err := a.queryDataRows(ctx, orgID, "kds_tickets")
	if err != nil {
		return dataAccessError(err)
	}
	items, err := a.queryDataRows(ctx, orgID, "kds_ticket_items")
	if err != nil {
		return dataAccessError(err)
	}
	orders, err := a.queryDataRows(ctx, orgID, "orders")
	if err != nil {
		return dataAccessError(err)
	}
	ordersByID := make(map[string]map[string]any, len(orders))
	for _, order := range orders {
		ordersByID[fmt.Sprint(order["id"])] = order
	}
	result := make([]map[string]any, 0)
	for _, ticket := range rows {
		if fmt.Sprint(ticket["station_id"]) != stationID || fmt.Sprint(ticket["status"]) == "bumped" {
			continue
		}
		ticketItems := make([]map[string]any, 0)
		for _, item := range items {
			if fmt.Sprint(item["ticket_id"]) == fmt.Sprint(ticket["id"]) {
				ticketItems = append(ticketItems, item)
			}
		}
		copy := map[string]any{}
		for key, value := range ticket {
			copy[key] = value
		}
		if order := ordersByID[fmt.Sprint(ticket["order_id"])]; order != nil {
			copy["order_number"] = order["order_number"]
			copy["order_type"] = order["order_type"]
			copy["table_number"] = order["table_number"]
			copy["customer_name"] = valueOr(order, "customer_name", nil)
			copy["customer_phone"] = valueOr(order, "customer_phone", nil)
			copy["delivery_address"] = valueOr(order, "delivery_address", nil)
			copy["notes"] = valueOr(order, "notes", ticket["notes"])
		}
		copy["items"] = ticketItems
		result = append(result, copy)
	}
	sort.Slice(result, func(i, j int) bool {
		pi, _ := integerValue(result[i]["priority"])
		pj, _ := integerValue(result[j]["priority"])
		if pi != pj {
			return pi > pj
		}
		return fmt.Sprint(result[i]["fired_at"]) < fmt.Sprint(result[j]["fired_at"])
	})
	return mustJSONResponse(200, result)
}

func (a *application) getKDSTicketDetails(ctx context.Context, orgID, ticketID string) events.APIGatewayV2HTTPResponse {
	ticket, err := a.dataRowByID(ctx, orgID, "kds_tickets", ticketID)
	if err != nil {
		return errorResponse(404, "ticket not found")
	}
	order, err := a.dataRowByID(ctx, orgID, "orders", fmt.Sprint(ticket["order_id"]))
	if err != nil {
		return errorResponse(404, "order not found")
	}
	station, _ := a.dataRowByID(ctx, orgID, "kitchen_stations", fmt.Sprint(ticket["station_id"]))
	items, err := a.queryDataRows(ctx, orgID, "kds_ticket_items")
	if err != nil {
		return dataAccessError(err)
	}
	menuItems, _ := a.queryDataRows(ctx, orgID, "items")
	recipeRows, _ := a.queryDataRows(ctx, orgID, "item_recipes")
	prepRows, _ := a.queryDataRows(ctx, orgID, "item_prep_steps")
	menuNames := map[string]string{}
	for _, menuItem := range menuItems {
		menuNames[displayString(menuItem["id"])] = displayString(menuItem["name"])
	}
	resultItems := make([]map[string]any, 0)
	for _, item := range items {
		if fmt.Sprint(item["ticket_id"]) != ticketID {
			continue
		}
		ingredients := make([]map[string]any, 0)
		for _, recipe := range recipeRows {
			if displayString(recipe["parent_item_id"]) == displayString(item["item_id"]) {
				ingredients = append(ingredients, map[string]any{"name": menuNames[displayString(recipe["child_item_id"])], "quantity": valueOr(recipe, "quantity_needed", 0), "unit": valueOr(recipe, "unit", "")})
			}
		}
		prepSteps := make([]map[string]any, 0)
		for _, step := range prepRows {
			if displayString(step["item_id"]) == displayString(item["item_id"]) {
				prepSteps = append(prepSteps, map[string]any{"step_number": valueOr(step, "step_number", len(prepSteps)+1), "instruction": valueOr(step, "instruction", step["description"])})
			}
		}
		resultItems = append(resultItems, map[string]any{
			"ticket_item_id": item["id"], "order_item_id": item["order_item_id"], "quantity": item["quantity"],
			"item_status": item["item_status"], "notes": item["notes"], "item_name": item["item_name"],
			"variations": []string{}, "ingredients": ingredients, "prep_steps": prepSteps, "allergens": []string{},
		})
	}
	return mustJSONResponse(200, map[string]any{
		"ticket_id": ticketID, "order_number": order["order_number"], "station_name": station["name"],
		"table_number": order["table_number"], "order_type": order["order_type"], "fired_at": ticket["fired_at"],
		"customer_name": valueOr(order, "customer_name", nil), "customer_phone": valueOr(order, "customer_phone", nil),
		"delivery_address": valueOr(order, "delivery_address", nil), "notes": valueOr(order, "notes", ticket["notes"]),
		"items": resultItems,
	})
}

func (a *application) transitionKDSTicket(ctx context.Context, orgID, ticketID, action string) events.APIGatewayV2HTTPResponse {
	ticket, err := a.dataRowByID(ctx, orgID, "kds_tickets", ticketID)
	if err != nil {
		return errorResponse(404, "ticket not found")
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	switch action {
	case "start":
		if fmt.Sprint(ticket["status"]) != "fired" {
			return errorResponse(409, "ticket must be fired before preparation starts")
		}
		ticket["status"], ticket["started_at"] = "in_progress", now
	case "ready":
		if fmt.Sprint(ticket["status"]) != "in_progress" && fmt.Sprint(ticket["status"]) != "fired" {
			return errorResponse(409, "ticket is not being prepared")
		}
		ticket["status"], ticket["ready_at"] = "ready", now
	case "bump":
		if fmt.Sprint(ticket["status"]) != "ready" {
			return errorResponse(409, "ticket must be ready before it is completed")
		}
		// Keep ready_at as the actual end-of-preparation timestamp. Overwriting
		// it here made preparation-time reporting measure until handoff.
		ticket["status"], ticket["bumped_at"] = "bumped", now
	case "recall", "refire":
		ticket["status"], ticket["fired_at"], ticket["started_at"], ticket["ready_at"], ticket["bumped_at"] = "fired", now, nil, nil, nil
	case "rush":
		priority, _ := integerValue(ticket["priority"])
		ticket["priority"] = priority + 1
	}
	ticket["updated_at"] = now
	if err := a.putDataRow(ctx, orgID, "kds_tickets", ticket, false); err != nil {
		return dataAccessError(err)
	}
	itemStatus := map[string]string{"start": "in_progress", "ready": "ready", "bump": "bumped", "recall": "fired", "refire": "fired"}[action]
	if itemStatus != "" {
		items, itemErr := a.queryDataRows(ctx, orgID, "kds_ticket_items")
		if itemErr != nil {
			return dataAccessError(itemErr)
		}
		for _, item := range items {
			if fmt.Sprint(item["ticket_id"]) != ticketID {
				continue
			}
			item["item_status"], item["updated_at"] = itemStatus, now
			if itemStatus == "in_progress" {
				item["started_at"] = now
			}
			if itemStatus == "ready" {
				item["ready_at"] = now
			}
			if itemStatus == "bumped" {
				item["bumped_at"] = now
			}
			if itemStatus == "fired" {
				item["started_at"], item["ready_at"], item["bumped_at"] = nil, nil, nil
			}
			if err := a.putDataRow(ctx, orgID, "kds_ticket_items", item, false); err != nil {
				return dataAccessError(err)
			}
		}
	}
	if action != "rush" {
		if err := a.syncOrderStatusFromKDS(ctx, orgID, fmt.Sprint(ticket["order_id"])); err != nil {
			return dataAccessError(err)
		}
	}
	eventType := map[string]string{"start": "started", "ready": "ready", "bump": "bumped", "recall": "recalled", "refire": "re_fired", "rush": "rushed"}[action]
	event, err := a.createStoredRow(ctx, orgID, "kds_ticket_events", map[string]any{"ticket_id": ticketID, "station_id": ticket["station_id"], "event_type": eventType, "performed_by": nil, "created_at": now})
	if err != nil {
		return dataAccessError(err)
	}
	return mustJSONResponse(200, map[string]any{"ticket": ticket, "event": event})
}

// kdsStatusesForOrder returns the ticket states associated with one order.
func kdsStatusesForOrder(tickets []map[string]any, orderID string) []string {
	statuses := make([]string, 0)
	for _, ticket := range tickets {
		if fmt.Sprint(ticket["order_id"]) == orderID {
			statuses = append(statuses, fmt.Sprint(ticket["status"]))
		}
	}
	return statuses
}

func completedPaymentCents(payments []map[string]any, orderID string) int64 {
	total := int64(0)
	for _, payment := range payments {
		if displayString(payment["order_id"]) != orderID || displayString(payment["payment_status"]) != "completed" {
			continue
		}
		amount, amountOK := integerValue(payment["amount_paid_cents"])
		change, changeOK := integerValue(payment["change_given_cents"])
		if !changeOK {
			change = 0
		}
		if amountOK && amount > change {
			total += amount - change
		}
	}
	return total
}

func aggregateKDSStatus(statuses []string) string {
	if len(statuses) == 0 {
		return "pending"
	}
	_, allReady, allFinished := summarizeKDSStatuses(statuses)
	if allFinished {
		return "bumped"
	}
	if allReady {
		return "ready"
	}
	for _, status := range statuses {
		if status == "in_progress" {
			return "in_progress"
		}
	}
	return "fired"
}

// summarizeKDSStatuses reports whether an order is still active, ready as a
// whole, and fully handed off/cancelled. Unknown states remain active so a
// future state cannot silently hide a live order from the board.
func summarizeKDSStatuses(statuses []string) (active, allReady, allFinished bool) {
	if len(statuses) == 0 {
		return false, false, false
	}
	allReady, allFinished = true, true
	for _, status := range statuses {
		switch status {
		case "bumped", "cancelled":
			// Terminal tickets are both ready and finished.
		case "ready":
			active = true
			allFinished = false
		default:
			active = true
			allReady = false
			allFinished = false
		}
	}
	return active, allReady, allFinished
}

func orderStatusAfterPayment(current string, statuses []string) string {
	_, _, allFinished := summarizeKDSStatuses(statuses)
	if len(statuses) == 0 || allFinished {
		return "completed"
	}
	return current
}

func shouldListKDSExpoOrder(orderStatus string, statuses []string) bool {
	active, _, _ := summarizeKDSStatuses(statuses)
	if len(statuses) > 0 {
		return active
	}
	// Keep orphaned open orders visible so Expo can offer its recovery action.
	return map[string]bool{"pending": true, "confirmed": true, "preparing": true, "ready": true, "out_for_delivery": true}[orderStatus]
}

// syncOrderStatusFromKDS keeps the order aligned with its kitchen tickets.
// Delivery statuses remain owned by front-of-house. A paid order becomes
// completed only after every kitchen ticket has been handed off/cancelled.
func (a *application) syncOrderStatusFromKDS(ctx context.Context, orgID, orderID string) error {
	order, err := a.dataRowByID(ctx, orgID, "orders", orderID)
	if err != nil {
		return err
	}
	current := fmt.Sprint(order["status"])
	if current == "cancelled" || current == "completed" || current == "out_for_delivery" || current == "delivered" {
		return nil
	}
	tickets, err := a.queryDataRows(ctx, orgID, "kds_tickets")
	if err != nil {
		return err
	}
	statuses := kdsStatusesForOrder(tickets, orderID)
	if len(statuses) == 0 {
		return nil
	}
	_, allReady, allFinished := summarizeKDSStatuses(statuses)
	next := "preparing"
	if allFinished && fmt.Sprint(order["payment_status"]) == "paid" {
		next = "completed"
	} else if allReady {
		next = "ready"
	}
	if current == next {
		return nil
	}
	order["status"], order["updated_at"] = next, time.Now().UTC().Format(time.RFC3339Nano)
	return a.putDataRow(ctx, orgID, "orders", order, false)
}

func (a *application) getKDSExpo(ctx context.Context, orgID, orderID string) events.APIGatewayV2HTTPResponse {
	order, err := a.dataRowByID(ctx, orgID, "orders", orderID)
	if err != nil {
		return errorResponse(404, "order not found")
	}
	tickets, err := a.queryDataRows(ctx, orgID, "kds_tickets")
	if err != nil {
		return dataAccessError(err)
	}
	items, _ := a.queryDataRows(ctx, orgID, "kds_ticket_items")
	stations, _ := a.queryDataRows(ctx, orgID, "kitchen_stations")
	stationNames := map[string]any{}
	for _, station := range stations {
		stationNames[fmt.Sprint(station["id"])] = station["name"]
	}
	stationTickets := make([]map[string]any, 0)
	earliest := ""
	maxPriority := int64(0)
	allReady, anyProgress := true, false
	for _, ticket := range tickets {
		if fmt.Sprint(ticket["order_id"]) != orderID {
			continue
		}
		fired := fmt.Sprint(ticket["fired_at"])
		if earliest == "" || fired < earliest {
			earliest = fired
		}
		priority, _ := integerValue(ticket["priority"])
		if priority > maxPriority {
			maxPriority = priority
		}
		status := fmt.Sprint(ticket["status"])
		if status != "ready" && status != "bumped" {
			allReady = false
		}
		if status == "in_progress" {
			anyProgress = true
		}
		ticketItems := make([]map[string]any, 0)
		for _, item := range items {
			if fmt.Sprint(item["ticket_id"]) == fmt.Sprint(ticket["id"]) {
				ticketItems = append(ticketItems, item)
			}
		}
		stationTickets = append(stationTickets, map[string]any{"ticket_id": ticket["id"], "station_name": stationNames[fmt.Sprint(ticket["station_id"])], "status": status, "fired_at": ticket["fired_at"], "ready_at": ticket["ready_at"], "bumped_at": ticket["bumped_at"], "course_number": ticket["course_number"], "items": ticketItems})
	}
	if len(stationTickets) == 0 {
		allReady = false
	}
	return mustJSONResponse(200, map[string]any{
		"order_id": orderID, "order_number": order["order_number"], "order_type": order["order_type"], "table_number": order["table_number"],
		"customer_name": valueOr(order, "customer_name", nil), "customer_phone": valueOr(order, "customer_phone", nil), "delivery_address": valueOr(order, "delivery_address", nil), "notes": valueOr(order, "notes", nil),
		"order_status": order["status"], "payment_status": valueOr(order, "payment_status", "pending"),
		"earliest_fired_at": earliest, "station_tickets": stationTickets, "max_priority": maxPriority, "all_ready": allReady, "any_in_progress": anyProgress,
	})
}

// listKDSExpo is the board endpoint. It keeps Expo out of the generic data
// API, whose table permissions are intentionally stricter than kitchen access.
func (a *application) listKDSExpo(ctx context.Context, orgID string) events.APIGatewayV2HTTPResponse {
	orders, err := a.queryDataRows(ctx, orgID, "orders")
	if err != nil {
		return dataAccessError(err)
	}
	tickets, err := a.queryDataRows(ctx, orgID, "kds_tickets")
	if err != nil {
		return dataAccessError(err)
	}
	statusesByOrder := make(map[string][]string)
	for _, ticket := range tickets {
		orderID := fmt.Sprint(ticket["order_id"])
		statusesByOrder[orderID] = append(statusesByOrder[orderID], fmt.Sprint(ticket["status"]))
	}
	result := make([]map[string]any, 0)
	for _, order := range orders {
		orderID := fmt.Sprint(order["id"])
		if !shouldListKDSExpoOrder(fmt.Sprint(order["status"]), statusesByOrder[orderID]) {
			continue
		}
		response := a.getKDSExpo(ctx, orgID, orderID)
		if response.StatusCode != 200 {
			continue
		}
		var row map[string]any
		if json.Unmarshal([]byte(response.Body), &row) == nil {
			result = append(result, row)
		}
	}
	sort.Slice(result, func(i, j int) bool {
		return fmt.Sprint(result[i]["earliest_fired_at"]) < fmt.Sprint(result[j]["earliest_fired_at"])
	})
	return mustJSONResponse(200, result)
}

func (a *application) openCashSession(ctx context.Context, orgID, drawerID, body string) events.APIGatewayV2HTTPResponse {
	drawer, err := a.dataRowByID(ctx, orgID, "cash_drawers", drawerID)
	if err != nil || drawer["is_active"] == false {
		return errorResponse(404, "not found")
	}
	var input map[string]any
	if decodeDataObject(body, &input) != nil {
		return errorResponse(400, "invalid request body")
	}
	opening, ok := integerValue(input["opening_float_cents"])
	if !ok || opening < 0 {
		return errorResponse(400, "opening_float_cents must be >= 0")
	}
	sessions, err := a.queryDataRows(ctx, orgID, "cash_drawer_sessions")
	if err != nil {
		return dataAccessError(err)
	}
	for _, session := range sessions {
		if fmt.Sprint(session["cash_drawer_id"]) == drawerID && fmt.Sprint(session["status"]) == "open" {
			return errorResponse(409, "drawer already has an open session")
		}
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	session, err := a.createStoredRow(ctx, orgID, "cash_drawer_sessions", map[string]any{
		"cash_drawer_id": drawerID, "opened_by": nullableString(input["opened_by_staff_id"]), "closed_by": nil,
		"opening_float_cents": opening, "declared_closing_cents": nil, "expected_closing_cents": nil, "over_short_cents": nil,
		"is_blind_close": valueOr(input, "is_blind_close", false), "status": "open", "opened_at": now, "closed_at": nil, "notes": nullableString(input["notes"]),
	})
	if err != nil {
		return dataAccessError(err)
	}
	_, _ = a.createStoredRow(ctx, orgID, "cash_drawer_counts", map[string]any{"cash_drawer_session_id": session["id"], "count_type": "open", "total_cents": opening, "denominations": valueOr(input, "denominations", map[string]any{}), "counted_by": nullableString(input["opened_by_staff_id"])})
	return mustJSONResponse(201, session)
}

func nullableString(value any) any {
	text := strings.TrimSpace(fmt.Sprint(value))
	if text == "" || text == "<nil>" {
		return nil
	}
	return text
}

func (a *application) listCashSessions(ctx context.Context, orgID, drawerID, rawQuery string) events.APIGatewayV2HTTPResponse {
	if _, err := a.dataRowByID(ctx, orgID, "cash_drawers", drawerID); err != nil {
		return errorResponse(404, "not found")
	}
	values, _ := url.ParseQuery(rawQuery)
	status := values.Get("status")
	if status != "" && status != "open" && status != "closed" && status != "reconciled" {
		return errorResponse(400, "invalid status filter")
	}
	rows, err := a.queryDataRows(ctx, orgID, "cash_drawer_sessions")
	if err != nil {
		return dataAccessError(err)
	}
	result := make([]map[string]any, 0)
	for _, row := range rows {
		if fmt.Sprint(row["cash_drawer_id"]) == drawerID && (status == "" || fmt.Sprint(row["status"]) == status) {
			result = append(result, row)
		}
	}
	sort.Slice(result, func(i, j int) bool { return fmt.Sprint(result[i]["opened_at"]) > fmt.Sprint(result[j]["opened_at"]) })
	if len(result) > 50 {
		result = result[:50]
	}
	return mustJSONResponse(200, result)
}

func (a *application) getCashSession(ctx context.Context, orgID, sessionID string) events.APIGatewayV2HTTPResponse {
	session, err := a.dataRowByID(ctx, orgID, "cash_drawer_sessions", sessionID)
	if err != nil {
		return errorResponse(404, "not found")
	}
	movements, err := a.queryDataRows(ctx, orgID, "cash_drawer_movements")
	if err != nil {
		return dataAccessError(err)
	}
	count := 0
	sessionMovements := make([]map[string]any, 0)
	for _, movement := range movements {
		if fmt.Sprint(movement["cash_drawer_session_id"]) == sessionID {
			count++
			sessionMovements = append(sessionMovements, movement)
		}
	}
	sort.Slice(sessionMovements, func(i, j int) bool {
		return fmt.Sprint(sessionMovements[i]["created_at"]) < fmt.Sprint(sessionMovements[j]["created_at"])
	})
	session["movements_count"] = count
	session["movements"] = sessionMovements
	return mustJSONResponse(200, session)
}

func (a *application) addCashMovement(ctx context.Context, orgID, sessionID, body string) events.APIGatewayV2HTTPResponse {
	session, err := a.dataRowByID(ctx, orgID, "cash_drawer_sessions", sessionID)
	if err != nil || fmt.Sprint(session["status"]) != "open" {
		return errorResponse(400, "cash drawer session is not open")
	}
	var input map[string]any
	if decodeDataObject(body, &input) != nil {
		return errorResponse(400, "invalid request body")
	}
	movementType := fmt.Sprint(input["movement_type"])
	allowed := map[string]bool{"paid_in": true, "paid_out": true, "petty_cash": true, "tip_out": true, "no_sale": true, "drop": true, "pickup": true}
	amount, ok := integerValue(input["amount_cents"])
	if !allowed[movementType] || !ok {
		return errorResponse(400, "invalid movement_type or amount_cents")
	}
	if ((movementType == "paid_in" || movementType == "petty_cash" || movementType == "drop") && amount < 0) || ((movementType == "paid_out" || movementType == "tip_out" || movementType == "pickup") && amount > 0) || (movementType == "no_sale" && amount != 0) {
		return errorResponse(400, "amount_cents has the wrong sign for movement_type")
	}
	movement, err := a.createStoredRow(ctx, orgID, "cash_drawer_movements", map[string]any{
		"cash_drawer_session_id": sessionID, "movement_type": movementType, "amount_cents": amount,
		"reason": nullableString(input["reason"]), "reference_type": nullableString(input["reference_type"]), "reference_id": nullableString(input["reference_id"]),
		"performed_by": nullableString(input["performed_by"]), "approved_by": nullableString(input["approved_by"]),
	})
	if err != nil {
		return dataAccessError(err)
	}
	return mustJSONResponse(201, movement)
}

func (a *application) closeCashSession(ctx context.Context, orgID, sessionID, body string) events.APIGatewayV2HTTPResponse {
	session, err := a.dataRowByID(ctx, orgID, "cash_drawer_sessions", sessionID)
	if err != nil {
		return errorResponse(404, "cash drawer session not found")
	}
	if fmt.Sprint(session["status"]) != "open" {
		return errorResponse(400, "cash drawer session is not open")
	}
	var input map[string]any
	if decodeDataObject(body, &input) != nil {
		return errorResponse(400, "invalid request body")
	}
	declared, ok := integerValue(input["declared_closing_cents"])
	if !ok || declared < 0 {
		return errorResponse(400, "declared_closing_cents must be >= 0")
	}
	expected, _ := integerValue(session["opening_float_cents"])
	movements, err := a.queryDataRows(ctx, orgID, "cash_drawer_movements")
	if err != nil {
		return dataAccessError(err)
	}
	for _, movement := range movements {
		if fmt.Sprint(movement["cash_drawer_session_id"]) == sessionID {
			amount, _ := integerValue(movement["amount_cents"])
			expected += amount
		}
	}
	links, _ := a.queryDataRows(ctx, orgID, "cash_drawer_session_payments")
	payments, _ := a.queryDataRows(ctx, orgID, "order_payments")
	paymentByID := map[string]map[string]any{}
	for _, payment := range payments {
		paymentByID[fmt.Sprint(payment["id"])] = payment
	}
	for _, link := range links {
		if fmt.Sprint(link["cash_drawer_session_id"]) != sessionID {
			continue
		}
		paymentID := displayString(link["order_payment_id"])
		if paymentID == "" {
			paymentID = displayString(link["payment_id"])
		}
		payment := paymentByID[paymentID]
		method := fmt.Sprint(payment["payment_method_code"])
		if payment != nil && (method == "cash" || method == "cash_on_delivery") {
			amount, _ := integerValue(payment["amount_paid_cents"])
			change, _ := integerValue(payment["change_given_cents"])
			expected += amount - change
		}
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	session["closed_by"], session["declared_closing_cents"], session["expected_closing_cents"], session["over_short_cents"] = nullableString(input["closed_by_staff_id"]), declared, expected, declared-expected
	session["status"], session["closed_at"], session["notes"], session["updated_at"] = "closed", now, nullableString(input["notes"]), now
	if err := a.putDataRow(ctx, orgID, "cash_drawer_sessions", session, false); err != nil {
		return dataAccessError(err)
	}
	_, _ = a.createStoredRow(ctx, orgID, "cash_drawer_counts", map[string]any{"cash_drawer_session_id": sessionID, "count_type": "close", "total_cents": declared, "denominations": valueOr(input, "denominations", map[string]any{}), "counted_by": nullableString(input["closed_by_staff_id"])})
	return mustJSONResponse(200, session)
}

func (a *application) createTimeEntry(ctx context.Context, orgID, actorID, entryType, body string) events.APIGatewayV2HTTPResponse {
	var input map[string]any
	if decodeDataObject(body, &input) != nil {
		return errorResponse(400, "invalid request body")
	}
	staffID := strings.TrimSpace(fmt.Sprint(input["staff_id"]))
	if staffID == "" {
		return errorResponse(400, "staff_id required")
	}
	if _, err := a.dataRowByID(ctx, orgID, "staff", staffID); err != nil {
		return errorResponse(404, "staff not found")
	}
	entry, err := a.createStoredRow(ctx, orgID, "staff_time_entries", map[string]any{"staff_id": staffID, "entry_type": entryType, "timestamp": time.Now().UTC().Format(time.RFC3339Nano), "notes": nullableString(input["notes"]), "created_by": actorID})
	if err != nil {
		return dataAccessError(err)
	}
	return mustJSONResponse(201, entry)
}

func (a *application) listTimeEntries(ctx context.Context, userID, orgID, rawQuery string) events.APIGatewayV2HTTPResponse {
	if !a.isManager(ctx, userID, orgID) {
		return errorResponse(403, "forbidden")
	}
	values, _ := url.ParseQuery(rawQuery)
	staffID := values.Get("staff_id")
	limit := 50
	if parsed, err := strconv.Atoi(values.Get("limit")); err == nil && parsed > 0 && parsed <= 200 {
		limit = parsed
	}
	rows, err := a.queryDataRows(ctx, orgID, "staff_time_entries")
	if err != nil {
		return dataAccessError(err)
	}
	result := make([]map[string]any, 0)
	for _, row := range rows {
		if staffID == "" || fmt.Sprint(row["staff_id"]) == staffID {
			result = append(result, row)
		}
	}
	sort.Slice(result, func(i, j int) bool { return fmt.Sprint(result[i]["timestamp"]) > fmt.Sprint(result[j]["timestamp"]) })
	if len(result) > limit {
		result = result[:limit]
	}
	return mustJSONResponse(200, result)
}

func (a *application) editTimeEntry(ctx context.Context, userID, orgID, entryID, body string) events.APIGatewayV2HTTPResponse {
	if !a.isManager(ctx, userID, orgID) {
		return errorResponse(403, "forbidden")
	}
	entry, err := a.dataRowByID(ctx, orgID, "staff_time_entries", entryID)
	if err != nil {
		return errorResponse(404, "entry not found")
	}
	var input map[string]any
	if decodeDataObject(body, &input) != nil {
		return errorResponse(400, "invalid request body")
	}
	if value, exists := input["entry_type"]; exists {
		entryType := fmt.Sprint(value)
		valid := map[string]bool{"clock_in": true, "clock_out": true, "break_start": true, "break_end": true}
		if !valid[entryType] {
			return errorResponse(400, "invalid entry_type")
		}
		entry["entry_type"] = entryType
	}
	if value, exists := input["timestamp"]; exists {
		stamp := fmt.Sprint(value)
		if _, parseErr := time.Parse(time.RFC3339, stamp); parseErr != nil {
			return errorResponse(400, "timestamp must be RFC3339")
		}
		entry["timestamp"] = stamp
	}
	if value, exists := input["notes"]; exists {
		entry["notes"] = value
	}
	entry["edit_reason"], entry["edited_by"], entry["updated_at"] = nullableString(input["reason"]), userID, time.Now().UTC().Format(time.RFC3339Nano)
	if err := a.putDataRow(ctx, orgID, "staff_time_entries", entry, false); err != nil {
		return dataAccessError(err)
	}
	return mustJSONResponse(200, entry)
}

func (a *application) isManager(ctx context.Context, userID, orgID string) bool {
	membership, err := a.getMembership(ctx, userID, orgID)
	return err == nil && managerRole(fmt.Sprint(membership["role"]))
}
