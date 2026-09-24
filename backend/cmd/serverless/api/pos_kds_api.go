package main

import (
	"context"
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
	case len(segments) == 4 && segments[0] == "kds" && segments[1] == "tickets" && method == "POST" && (segments[3] == "bump" || segments[3] == "recall" || segments[3] == "refire" || segments[3] == "rush"):
		return commerceRoute{name: "kds_" + segments[3], params: []string{segments[2]}}, true
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
	case "kds_bump", "kds_recall", "kds_refire", "kds_rush":
		response = a.transitionKDSTicket(ctx, orgID, route.params[0], strings.TrimPrefix(route.name, "kds_"))
	case "kds_expo":
		response = a.getKDSExpo(ctx, orgID, route.params[0])
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
		"table_number": valueOr(input, "table_number", nil), "table_session_id": valueOr(input, "table_session_id", nil),
		"register_session_id": valueOr(input, "register_session_id", nil), "customer_id": valueOr(input, "customer_id", nil),
		"notes": valueOr(input, "notes", nil), "party_size": valueOr(input, "party_size", 1), "held_at": nil,
	}
	created, err := a.createStoredRow(ctx, orgID, "orders", order)
	if err != nil {
		return dataAccessError(err)
	}
	for _, line := range prepared {
		line["order_id"] = created["id"]
		if _, err = a.createStoredRow(ctx, orgID, "order_items", line); err != nil {
			return dataAccessError(err)
		}
	}
	tickets, err := a.fanoutKDSRows(ctx, orgID, created)
	if err != nil {
		return dataAccessError(err)
	}
	return mustJSONResponse(201, posOrderResponse(created, tickets))
}

func posOrderResponse(order map[string]any, ticketIDs []string) map[string]any {
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
		"kds_ticket_ids": ticketIDs, "status": order["status"], "payment_method": valueOr(order, "payment_method", ""),
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
	if fmt.Sprint(order["status"]) == "completed" {
		return errorResponse(409, "order already paid")
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
	paymentIDs := make([]string, 0, len(legs))
	for _, leg := range legs {
		method := strings.TrimSpace(fmt.Sprint(leg["payment_method_code"]))
		amount, ok := integerValue(leg["amount_paid_cents"])
		if method == "" || !ok || amount < 0 {
			return errorResponse(400, "each payment requires payment_method_code and amount_paid_cents >= 0")
		}
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
	order["status"], order["payment_status"], order["updated_at"] = "completed", "paid", time.Now().UTC().Format(time.RFC3339Nano)
	if len(legs) == 1 {
		order["payment_method"] = legs[0]["payment_method_code"]
	} else {
		order["payment_method"] = "split"
	}
	if err := a.putDataRow(ctx, orgID, "orders", order, false); err != nil {
		return dataAccessError(err)
	}
	firstID := ""
	if len(paymentIDs) > 0 {
		firstID = paymentIDs[0]
	}
	return mustJSONResponse(200, map[string]any{"order_id": orderID, "payment_id": firstID, "payment_ids": paymentIDs, "payment_status": "completed", "session_closed": false})
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
	grouped := map[string][]map[string]any{}
	for _, line := range lines {
		if fmt.Sprint(line["order_id"]) != orderID {
			continue
		}
		stationID := ""
		for _, route := range itemRoutes {
			if fmt.Sprint(route["item_id"]) == fmt.Sprint(line["item_id"]) && route["is_primary"] != false {
				stationID = fmt.Sprint(route["station_id"])
				break
			}
		}
		if stationID == "" {
			for _, route := range categoryRoutes {
				if fmt.Sprint(route["category_id"]) == fmt.Sprint(line["category_id"]) && route["is_primary"] != false {
					stationID = fmt.Sprint(route["station_id"])
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
	ids, err := a.fanoutKDSRows(ctx, orgID, order)
	if err != nil {
		return dataAccessError(err)
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
	resultItems := make([]map[string]any, 0)
	for _, item := range items {
		if fmt.Sprint(item["ticket_id"]) != ticketID {
			continue
		}
		resultItems = append(resultItems, map[string]any{
			"ticket_item_id": item["id"], "order_item_id": item["order_item_id"], "quantity": item["quantity"],
			"item_status": item["item_status"], "notes": item["notes"], "item_name": item["item_name"],
			"variations": []string{}, "ingredients": []any{}, "prep_steps": []any{}, "allergens": []string{},
		})
	}
	return mustJSONResponse(200, map[string]any{"ticket_id": ticketID, "order_number": order["order_number"], "station_name": station["name"], "table_number": order["table_number"], "fired_at": ticket["fired_at"], "items": resultItems})
}

func (a *application) transitionKDSTicket(ctx context.Context, orgID, ticketID, action string) events.APIGatewayV2HTTPResponse {
	ticket, err := a.dataRowByID(ctx, orgID, "kds_tickets", ticketID)
	if err != nil {
		return errorResponse(404, "ticket not found")
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	switch action {
	case "bump":
		ticket["status"], ticket["ready_at"], ticket["bumped_at"] = "bumped", now, now
	case "recall", "refire":
		ticket["status"], ticket["fired_at"], ticket["started_at"], ticket["ready_at"], ticket["bumped_at"] = "fired", now, nil, nil, nil
	case "rush":
		priority, _ := integerValue(ticket["priority"])
		ticket["priority"] = priority + 1
		if fmt.Sprint(ticket["status"]) == "fired" {
			ticket["status"], ticket["started_at"] = "in_progress", now
		}
	}
	ticket["updated_at"] = now
	if err := a.putDataRow(ctx, orgID, "kds_tickets", ticket, false); err != nil {
		return dataAccessError(err)
	}
	eventType := map[string]string{"bump": "bumped", "recall": "recalled", "refire": "re_fired", "rush": "rushed"}[action]
	event, err := a.createStoredRow(ctx, orgID, "kds_ticket_events", map[string]any{"ticket_id": ticketID, "station_id": ticket["station_id"], "event_type": eventType, "performed_by": nil, "created_at": now})
	if err != nil {
		return dataAccessError(err)
	}
	return mustJSONResponse(200, map[string]any{"ticket": ticket, "event": event})
}

func (a *application) getKDSExpo(ctx context.Context, orgID, orderID string) events.APIGatewayV2HTTPResponse {
	if _, err := a.dataRowByID(ctx, orgID, "orders", orderID); err != nil {
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
		stationTickets = append(stationTickets, map[string]any{"ticket_id": ticket["id"], "station_name": stationNames[fmt.Sprint(ticket["station_id"])], "status": status, "fired_at": ticket["fired_at"], "ready_at": ticket["ready_at"], "course_number": ticket["course_number"], "items": ticketItems})
	}
	if len(stationTickets) == 0 {
		allReady = false
	}
	return mustJSONResponse(200, map[string]any{"order_id": orderID, "earliest_fired_at": earliest, "station_tickets": stationTickets, "max_priority": maxPriority, "all_ready": allReady, "any_in_progress": anyProgress})
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
