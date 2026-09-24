package main

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/events"
)

type tableSessionRoute struct {
	name   string
	params []string
}

func matchTableSessionRoute(method, path string) (tableSessionRoute, bool) {
	segments := strings.Split(strings.Trim(path, "/"), "/")
	switch {
	case len(segments) == 2 && segments[0] == "tables" && method == "PATCH":
		return tableSessionRoute{name: "table_update", params: []string{segments[1]}}, true
	case len(segments) == 3 && segments[0] == "tables" && segments[2] == "open-session" && method == "POST":
		return tableSessionRoute{name: "session_open", params: []string{segments[1]}}, true
	case len(segments) == 2 && segments[0] == "sessions" && method == "GET":
		return tableSessionRoute{name: "session_detail", params: []string{segments[1]}}, true
	case len(segments) == 3 && segments[0] == "sessions" && method == "POST" && (segments[2] == "close" || segments[2] == "transfer" || segments[2] == "split-check" || segments[2] == "seats"):
		return tableSessionRoute{name: "session_" + strings.ReplaceAll(segments[2], "-", "_"), params: []string{segments[1]}}, true
	case len(segments) == 3 && segments[0] == "sessions" && segments[2] == "seats" && method == "GET":
		return tableSessionRoute{name: "seats_list", params: []string{segments[1]}}, true
	case len(segments) == 2 && segments[0] == "seats" && (method == "PATCH" || method == "DELETE"):
		return tableSessionRoute{name: "seat_" + strings.ToLower(method), params: []string{segments[1]}}, true
	default:
		return tableSessionRoute{}, false
	}
}

func (a *application) handleTableSessionAPI(ctx context.Context, request events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, bool, error) {
	route, matched := matchTableSessionRoute(request.RequestContext.HTTP.Method, request.RawPath)
	if !matched {
		return events.APIGatewayV2HTTPResponse{}, false, nil
	}
	claims, err := a.authenticate(ctx, request.Headers)
	if err != nil {
		return errorResponse(401, "invalid token"), true, nil
	}
	orgID, err := a.authorizedOrganization(ctx, request, claims.UserID)
	if err != nil {
		return dataAccessError(err), true, nil
	}

	var response events.APIGatewayV2HTTPResponse
	switch route.name {
	case "table_update":
		response = a.updateRestaurantTable(ctx, orgID, route.params[0], request.Body)
	case "session_open":
		response = a.openTableSession(ctx, orgID, route.params[0], request.Body)
	case "session_detail":
		response = a.getTableSessionDetail(ctx, orgID, route.params[0])
	case "session_close":
		response = a.closeTableSession(ctx, orgID, route.params[0], request.Body)
	case "session_transfer":
		response = a.transferTableSession(ctx, orgID, route.params[0], request.Body)
	case "session_split_check":
		response = a.splitTableCheck(ctx, orgID, route.params[0], request.Body)
	case "session_seats":
		response = a.createTableSeat(ctx, orgID, route.params[0], request.Body)
	case "seats_list":
		response = a.listTableSeats(ctx, orgID, route.params[0])
	case "seat_patch":
		response = a.updateTableSeat(ctx, orgID, route.params[0], request.Body)
	case "seat_delete":
		response = a.deleteTableSeat(ctx, orgID, route.params[0])
	}
	return response, true, nil
}

func (a *application) updateRestaurantTable(ctx context.Context, orgID, tableID, body string) events.APIGatewayV2HTTPResponse {
	table, err := a.dataRowByID(ctx, orgID, "tables", tableID)
	if err != nil {
		return errorResponse(404, "table not found")
	}
	var changes map[string]any
	if decodeDataObject(body, &changes) != nil {
		return errorResponse(400, "invalid request body")
	}
	allowed := map[string]bool{"section_id": true, "label": true, "capacity": true, "status": true, "pos_x": true, "pos_y": true, "is_active": true}
	for key, value := range changes {
		if !allowed[key] {
			continue
		}
		if key == "capacity" {
			capacity, ok := integerValue(value)
			if !ok || capacity < 1 {
				return errorResponse(400, "capacity must be >= 1")
			}
		}
		if key == "status" {
			status := fmt.Sprint(value)
			if status != "available" && status != "occupied" && status != "reserved" && status != "out_of_service" {
				return errorResponse(400, "invalid table status")
			}
		}
		table[key] = value
	}
	table["updated_at"] = time.Now().UTC().Format(time.RFC3339Nano)
	if err := a.putDataRow(ctx, orgID, "tables", table, false); err != nil {
		return dataAccessError(err)
	}
	return mustJSONResponse(200, table)
}

func (a *application) openTableSession(ctx context.Context, orgID, tableID, body string) events.APIGatewayV2HTTPResponse {
	table, err := a.dataRowByID(ctx, orgID, "tables", tableID)
	if err != nil || table["is_active"] == false {
		return errorResponse(404, "table not found")
	}
	var input map[string]any
	if decodeDataObject(body, &input) != nil {
		return errorResponse(400, "invalid request body")
	}
	locationID := strings.TrimSpace(displayString(input["location_id"]))
	partySize, ok := integerValue(input["party_size"])
	if locationID == "" || locationID != fmt.Sprint(table["location_id"]) {
		return errorResponse(404, "location not found")
	}
	if !ok || partySize < 1 {
		return errorResponse(400, "party_size must be >= 1")
	}
	sessions, err := a.queryDataRows(ctx, orgID, "table_sessions")
	if err != nil {
		return dataAccessError(err)
	}
	for _, session := range sessions {
		if fmt.Sprint(session["table_id"]) == tableID && fmt.Sprint(session["status"]) == "open" {
			return errorResponse(409, "table already has an open session")
		}
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	session, err := a.createStoredRow(ctx, orgID, "table_sessions", map[string]any{
		"table_id": tableID, "location_id": locationID, "opened_by": nullableString(input["opened_by"]),
		"party_size": partySize, "status": "open", "opened_at": now, "closed_at": nil,
		"transferred_to_session_id": nil, "notes": nullableString(input["notes"]),
	})
	if err != nil {
		return dataAccessError(err)
	}
	table["status"], table["updated_at"] = "occupied", now
	if err := a.putDataRow(ctx, orgID, "tables", table, false); err != nil {
		return dataAccessError(err)
	}
	return mustJSONResponse(201, session)
}

func (a *application) getTableSessionDetail(ctx context.Context, orgID, sessionID string) events.APIGatewayV2HTTPResponse {
	session, err := a.dataRowByID(ctx, orgID, "table_sessions", sessionID)
	if err != nil {
		return errorResponse(404, "table session not found")
	}
	seats, err := a.tableSeats(ctx, orgID, sessionID)
	if err != nil {
		return dataAccessError(err)
	}
	orders, err := a.queryDataRows(ctx, orgID, "orders")
	if err != nil {
		return dataAccessError(err)
	}
	linkedOrders := make([]map[string]any, 0)
	for _, order := range orders {
		if fmt.Sprint(order["table_session_id"]) != sessionID {
			continue
		}
		linkedOrders = append(linkedOrders, map[string]any{
			"id": order["id"], "order_type": valueOr(order, "order_type", "dine_in"), "status": valueOr(order, "status", ""),
			"course_number": valueOr(order, "course_number", nil), "created_at": order["created_at"],
		})
	}
	sort.Slice(linkedOrders, func(i, j int) bool {
		return fmt.Sprint(linkedOrders[i]["created_at"]) < fmt.Sprint(linkedOrders[j]["created_at"])
	})
	result := make(map[string]any, len(session)+2)
	for key, value := range session {
		result[key] = value
	}
	result["seats"], result["orders"] = seats, linkedOrders
	return mustJSONResponse(200, result)
}

func (a *application) closeTableSession(ctx context.Context, orgID, sessionID, body string) events.APIGatewayV2HTTPResponse {
	session, err := a.dataRowByID(ctx, orgID, "table_sessions", sessionID)
	if err != nil {
		return errorResponse(404, "table session not found")
	}
	if fmt.Sprint(session["status"]) != "open" {
		return errorResponse(409, "table session is not open")
	}
	var input map[string]any
	if decodeDataObject(body, &input) != nil {
		return errorResponse(400, "invalid request body")
	}
	if value, exists := input["party_size"]; exists {
		partySize, ok := integerValue(value)
		if !ok || partySize < 1 {
			return errorResponse(400, "party_size must be >= 1")
		}
		session["party_size"] = partySize
	}
	if notes := nullableString(input["notes"]); notes != nil {
		session["notes"] = notes
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	session["status"], session["closed_at"], session["updated_at"] = "closed", now, now
	if err := a.putDataRow(ctx, orgID, "table_sessions", session, false); err != nil {
		return dataAccessError(err)
	}
	if table, getErr := a.dataRowByID(ctx, orgID, "tables", fmt.Sprint(session["table_id"])); getErr == nil {
		table["status"], table["updated_at"] = "available", now
		if putErr := a.putDataRow(ctx, orgID, "tables", table, false); putErr != nil {
			return dataAccessError(putErr)
		}
	}
	return mustJSONResponse(200, session)
}

func (a *application) transferTableSession(ctx context.Context, orgID, sessionID, body string) events.APIGatewayV2HTTPResponse {
	source, err := a.dataRowByID(ctx, orgID, "table_sessions", sessionID)
	if err != nil {
		return errorResponse(404, "table session not found")
	}
	if fmt.Sprint(source["status"]) != "open" {
		return errorResponse(409, "source session is not open")
	}
	var input map[string]any
	if decodeDataObject(body, &input) != nil {
		return errorResponse(400, "invalid request body")
	}
	targetID := strings.TrimSpace(displayString(input["to_table_id"]))
	target, err := a.dataRowByID(ctx, orgID, "tables", targetID)
	if err != nil || fmt.Sprint(target["location_id"]) != fmt.Sprint(source["location_id"]) || target["is_active"] == false {
		return errorResponse(404, "target table not found")
	}
	sessions, err := a.queryDataRows(ctx, orgID, "table_sessions")
	if err != nil {
		return dataAccessError(err)
	}
	for _, session := range sessions {
		if fmt.Sprint(session["table_id"]) == targetID && fmt.Sprint(session["status"]) == "open" {
			return errorResponse(409, "target table already has an open session")
		}
	}
	partySize, ok := integerValue(input["party_size"])
	if !ok || partySize < 1 {
		partySize, _ = integerValue(source["party_size"])
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	newSession, err := a.createStoredRow(ctx, orgID, "table_sessions", map[string]any{
		"table_id": targetID, "location_id": source["location_id"], "opened_by": nullableString(input["opened_by"]),
		"party_size": partySize, "status": "open", "opened_at": now, "closed_at": nil,
		"transferred_to_session_id": nil, "notes": valueOr(input, "notes", source["notes"]),
	})
	if err != nil {
		return dataAccessError(err)
	}
	source["status"], source["transferred_to_session_id"], source["updated_at"] = "transferred", newSession["id"], now
	if err := a.putDataRow(ctx, orgID, "table_sessions", source, false); err != nil {
		return dataAccessError(err)
	}
	if oldTable, getErr := a.dataRowByID(ctx, orgID, "tables", fmt.Sprint(source["table_id"])); getErr == nil {
		oldTable["status"], oldTable["updated_at"] = "available", now
		if putErr := a.putDataRow(ctx, orgID, "tables", oldTable, false); putErr != nil {
			return dataAccessError(putErr)
		}
	}
	target["status"], target["updated_at"] = "occupied", now
	if err := a.putDataRow(ctx, orgID, "tables", target, false); err != nil {
		return dataAccessError(err)
	}
	return mustJSONResponse(201, newSession)
}

func (a *application) splitTableCheck(ctx context.Context, orgID, sessionID, body string) events.APIGatewayV2HTTPResponse {
	session, err := a.dataRowByID(ctx, orgID, "table_sessions", sessionID)
	if err != nil {
		return errorResponse(404, "table session not found")
	}
	if fmt.Sprint(session["status"]) != "open" {
		return errorResponse(409, "table session is not open")
	}
	var input map[string]any
	if decodeDataObject(body, &input) != nil {
		return errorResponse(400, "invalid request body")
	}
	rawSplits, ok := input["splits"].([]any)
	if !ok || len(rawSplits) == 0 {
		return errorResponse(400, "splits must not be empty")
	}
	existing, err := a.queryDataRows(ctx, orgID, "check_splits")
	if err != nil {
		return dataAccessError(err)
	}
	labels := map[string]bool{}
	for _, row := range existing {
		if fmt.Sprint(row["table_session_id"]) == sessionID {
			labels[strings.ToLower(fmt.Sprint(row["split_label"]))] = true
		}
	}
	orders, err := a.queryDataRows(ctx, orgID, "orders")
	if err != nil {
		return dataAccessError(err)
	}
	orderIDs := map[string]bool{}
	for _, order := range orders {
		if fmt.Sprint(order["table_session_id"]) == sessionID {
			orderIDs[fmt.Sprint(order["id"])] = true
		}
	}
	orderItems, err := a.queryDataRows(ctx, orgID, "order_items")
	if err != nil {
		return dataAccessError(err)
	}
	availableQuantity := map[string]float64{}
	for _, item := range orderItems {
		if orderIDs[fmt.Sprint(item["order_id"])] {
			quantity, _ := numericValue(item["quantity"])
			availableQuantity[fmt.Sprint(item["id"])] = quantity
		}
	}
	allocatedQuantity := map[string]float64{}
	type preparedSplit struct {
		label string
		items []map[string]any
	}
	prepared := make([]preparedSplit, 0, len(rawSplits))
	for _, raw := range rawSplits {
		split, valid := raw.(map[string]any)
		if !valid {
			return errorResponse(400, "splits must contain objects")
		}
		label := strings.TrimSpace(displayString(split["label"]))
		labelKey := strings.ToLower(label)
		if label == "" {
			return errorResponse(400, "each split must have a label")
		}
		if labels[labelKey] {
			return errorResponse(409, "split label already exists for this session")
		}
		labels[labelKey] = true
		rawItems, valid := split["items"].([]any)
		if !valid {
			return errorResponse(400, "split items must be an array")
		}
		items := make([]map[string]any, 0, len(rawItems))
		for _, rawItem := range rawItems {
			item, itemOK := rawItem.(map[string]any)
			quantity, quantityOK := numericValue(item["quantity"])
			orderItemID := strings.TrimSpace(displayString(item["order_item_id"]))
			if !itemOK || orderItemID == "" || !quantityOK || quantity <= 0 {
				return errorResponse(400, "each split item requires order_item_id and quantity > 0")
			}
			available, exists := availableQuantity[orderItemID]
			if !exists {
				return errorResponse(400, "split item does not belong to this table session")
			}
			allocatedQuantity[orderItemID] += quantity
			if allocatedQuantity[orderItemID] > available {
				return errorResponse(422, "split item quantity exceeds the order item quantity")
			}
			items = append(items, item)
		}
		prepared = append(prepared, preparedSplit{label: label, items: items})
	}

	createdSplits := make([]map[string]any, 0, len(prepared))
	createdItems := make([]map[string]any, 0)
	for _, split := range prepared {
		created, createErr := a.createStoredRow(ctx, orgID, "check_splits", map[string]any{
			"table_session_id": sessionID, "split_label": split.label, "created_by": nullableString(input["created_by"]),
		})
		if createErr != nil {
			return dataAccessError(createErr)
		}
		createdSplits = append(createdSplits, created)
		for _, item := range split.items {
			createdItem, itemErr := a.createStoredRow(ctx, orgID, "check_split_items", map[string]any{
				"check_split_id": created["id"], "order_item_id": item["order_item_id"], "quantity": item["quantity"],
			})
			if itemErr != nil {
				return dataAccessError(itemErr)
			}
			createdItems = append(createdItems, createdItem)
		}
	}
	return mustJSONResponse(201, map[string]any{"splits": createdSplits, "items": createdItems})
}

func (a *application) createTableSeat(ctx context.Context, orgID, sessionID, body string) events.APIGatewayV2HTTPResponse {
	if _, err := a.dataRowByID(ctx, orgID, "table_sessions", sessionID); err != nil {
		return errorResponse(404, "table session not found")
	}
	var input map[string]any
	if decodeDataObject(body, &input) != nil {
		return errorResponse(400, "invalid request body")
	}
	seatNumber, ok := integerValue(input["seat_number"])
	if !ok || seatNumber < 1 {
		return errorResponse(400, "seat_number must be >= 1")
	}
	seats, err := a.tableSeats(ctx, orgID, sessionID)
	if err != nil {
		return dataAccessError(err)
	}
	for _, seat := range seats {
		value, _ := integerValue(seat["seat_number"])
		if value == seatNumber {
			return errorResponse(409, "seat number already exists in this session")
		}
	}
	seat, err := a.createStoredRow(ctx, orgID, "seats", map[string]any{
		"table_session_id": sessionID, "seat_number": seatNumber, "guest_name": nullableString(input["guest_name"]),
	})
	if err != nil {
		return dataAccessError(err)
	}
	return mustJSONResponse(201, seat)
}

func (a *application) listTableSeats(ctx context.Context, orgID, sessionID string) events.APIGatewayV2HTTPResponse {
	if _, err := a.dataRowByID(ctx, orgID, "table_sessions", sessionID); err != nil {
		return errorResponse(404, "table session not found")
	}
	seats, err := a.tableSeats(ctx, orgID, sessionID)
	if err != nil {
		return dataAccessError(err)
	}
	return mustJSONResponse(200, seats)
}

func (a *application) tableSeats(ctx context.Context, orgID, sessionID string) ([]map[string]any, error) {
	rows, err := a.queryDataRows(ctx, orgID, "seats")
	if err != nil {
		return nil, err
	}
	seats := make([]map[string]any, 0)
	for _, row := range rows {
		if fmt.Sprint(row["table_session_id"]) == sessionID {
			seats = append(seats, row)
		}
	}
	sort.Slice(seats, func(i, j int) bool {
		left, _ := integerValue(seats[i]["seat_number"])
		right, _ := integerValue(seats[j]["seat_number"])
		return left < right
	})
	return seats, nil
}

func (a *application) updateTableSeat(ctx context.Context, orgID, seatID, body string) events.APIGatewayV2HTTPResponse {
	seat, err := a.dataRowByID(ctx, orgID, "seats", seatID)
	if err != nil {
		return errorResponse(404, "seat not found")
	}
	var input map[string]any
	if decodeDataObject(body, &input) != nil {
		return errorResponse(400, "invalid request body")
	}
	if value, exists := input["seat_number"]; exists {
		seatNumber, ok := integerValue(value)
		if !ok || seatNumber < 1 {
			return errorResponse(400, "seat_number must be >= 1")
		}
		seats, queryErr := a.tableSeats(ctx, orgID, fmt.Sprint(seat["table_session_id"]))
		if queryErr != nil {
			return dataAccessError(queryErr)
		}
		for _, existing := range seats {
			existingNumber, _ := integerValue(existing["seat_number"])
			if fmt.Sprint(existing["id"]) != seatID && existingNumber == seatNumber {
				return errorResponse(409, "seat number already exists in this session")
			}
		}
		seat["seat_number"] = seatNumber
	}
	if value, exists := input["guest_name"]; exists {
		seat["guest_name"] = nullableString(value)
	}
	seat["updated_at"] = time.Now().UTC().Format(time.RFC3339Nano)
	if err := a.putDataRow(ctx, orgID, "seats", seat, false); err != nil {
		return dataAccessError(err)
	}
	return mustJSONResponse(200, seat)
}

func (a *application) deleteTableSeat(ctx context.Context, orgID, seatID string) events.APIGatewayV2HTTPResponse {
	if _, err := a.dataRowByID(ctx, orgID, "seats", seatID); err != nil {
		return errorResponse(404, "seat not found")
	}
	if err := a.deleteStoredRow(ctx, orgID, "seats", seatID); err != nil {
		return dataAccessError(err)
	}
	return events.APIGatewayV2HTTPResponse{StatusCode: 204}
}
