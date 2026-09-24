package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

type operationalRoute struct {
	name   string
	params []string
}

func matchOperationalRoute(method, path string) (operationalRoute, bool) {
	key := method + " " + strings.TrimSuffix(path, "/")
	exact := map[string]string{
		"GET /onboarding/progress": "onboarding_progress_get",
		"PUT /onboarding/progress": "onboarding_progress_put",
		"GET /onboarding/status":   "onboarding_status",
		"GET /me/preferences":      "preferences_get",
		"PUT /me/preferences":      "preferences_put",
		"GET /reservations":        "reservations_list",
		"POST /reservations":       "reservations_create",
		"GET /waitlist":            "waitlist_list",
		"POST /waitlist":           "waitlist_create",
		"GET /specials":            "specials_list",
		"GET /customers/search":    "customers_search",
		"GET /staff":               "staff_list",
	}
	if name, ok := exact[key]; ok {
		return operationalRoute{name: name}, true
	}

	segments := strings.Split(strings.Trim(path, "/"), "/")
	switch {
	case method == "PATCH" && len(segments) == 2 && segments[0] == "locations":
		return operationalRoute{name: "location_update", params: []string{segments[1]}}, true
	case method == "PATCH" && len(segments) == 2 && segments[0] == "reservations":
		return operationalRoute{name: "reservation_update", params: []string{segments[1]}}, true
	case method == "POST" && len(segments) == 3 && segments[0] == "reservations" && (segments[2] == "confirm" || segments[2] == "seat" || segments[2] == "cancel"):
		return operationalRoute{name: "reservation_transition", params: []string{segments[1], segments[2]}}, true
	case method == "POST" && len(segments) == 3 && segments[0] == "waitlist" && segments[2] == "seat":
		return operationalRoute{name: "waitlist_seat", params: []string{segments[1]}}, true
	case method == "DELETE" && len(segments) == 2 && segments[0] == "waitlist":
		return operationalRoute{name: "waitlist_remove", params: []string{segments[1]}}, true
	case method == "POST" && len(segments) == 3 && segments[0] == "categories" && (segments[2] == "eighty-six" || segments[2] == "un-eighty-six"):
		return operationalRoute{name: "category_86", params: []string{segments[1], segments[2]}}, true
	case method == "PUT" && len(segments) == 3 && segments[0] == "items" && segments[2] == "special":
		return operationalRoute{name: "item_special", params: []string{segments[1]}}, true
	default:
		return operationalRoute{}, false
	}
}

func (a *application) handleOperationalAPI(ctx context.Context, request events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, bool, error) {
	route, matched := matchOperationalRoute(request.RequestContext.HTTP.Method, request.RawPath)
	if !matched {
		return events.APIGatewayV2HTTPResponse{}, false, nil
	}
	claims, err := a.authenticate(ctx, request.Headers)
	if err != nil {
		return errorResponse(401, "invalid token"), true, nil
	}

	var response events.APIGatewayV2HTTPResponse
	switch route.name {
	case "preferences_get":
		response = a.getPreferences(ctx, claims.UserID)
	case "preferences_put":
		response = a.putPreferences(ctx, claims.UserID, request.Body)
	default:
		orgID, orgErr := a.authorizedOrganization(ctx, request, claims.UserID)
		if orgErr != nil {
			return dataAccessError(orgErr), true, nil
		}
		switch route.name {
		case "onboarding_progress_get":
			response = a.getOnboardingProgress(ctx, orgID)
		case "onboarding_progress_put":
			response = a.putOnboardingProgress(ctx, orgID, request.Body)
		case "onboarding_status":
			response = a.getOnboardingStatus(ctx, orgID)
		case "location_update":
			response = a.updateOperationalRow(ctx, claims.UserID, orgID, "locations", route.params[0], request.Body, true)
		case "reservations_list":
			response = a.listReservations(ctx, orgID, request.RawQueryString)
		case "reservations_create":
			response = a.createReservation(ctx, orgID, request.Body)
		case "reservation_update":
			response = a.updateOperationalRow(ctx, claims.UserID, orgID, "reservations", route.params[0], request.Body, false)
		case "reservation_transition":
			response = a.transitionReservation(ctx, orgID, route.params[0], route.params[1])
		case "waitlist_list":
			response = a.listWaitlist(ctx, orgID, request.RawQueryString)
		case "waitlist_create":
			response = a.createWaitlistEntry(ctx, orgID, request.Body)
		case "waitlist_seat":
			response = a.transitionWaitlist(ctx, orgID, route.params[0], "seat", request.Body)
		case "waitlist_remove":
			response = a.transitionWaitlist(ctx, orgID, route.params[0], "remove", request.Body)
		case "category_86":
			response = a.setCategoryAvailability(ctx, orgID, route.params[0], route.params[1] == "eighty-six")
		case "specials_list":
			response = a.listSpecials(ctx, orgID, request.RawQueryString)
		case "item_special":
			response = a.setItemSpecial(ctx, claims.UserID, orgID, route.params[0], request.Body)
		case "customers_search":
			response = a.searchCustomers(ctx, orgID, request.RawQueryString)
		case "staff_list":
			response = a.listStaff(ctx, orgID, request.RawQueryString)
		}
	}
	return response, true, nil
}

func (a *application) getOnboardingProgress(ctx context.Context, orgID string) events.APIGatewayV2HTTPResponse {
	rows, err := a.queryDataRows(ctx, orgID, "onboarding_progress")
	if err != nil {
		return dataAccessError(err)
	}
	if len(rows) == 0 {
		return mustJSONResponse(200, map[string]any{"org_id": orgID, "step": 0, "completed_steps": []string{}})
	}
	return mustJSONResponse(200, rows[0])
}

func (a *application) putOnboardingProgress(ctx context.Context, orgID, body string) events.APIGatewayV2HTTPResponse {
	var input map[string]any
	if decodeDataObject(body, &input) != nil {
		return errorResponse(400, "invalid request body")
	}
	step, ok := integerValue(input["step"])
	if !ok || step < 0 {
		return errorResponse(400, "step must be >= 0")
	}
	completed, ok := stringSlice(input["completed_steps"])
	if !ok {
		return errorResponse(400, "completed_steps must be an array of strings")
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	row := map[string]any{"id": orgID, "org_id": orgID, "organization_id": orgID, "step": step, "completed_steps": completed, "updated_at": now}
	if err := a.putDataRow(ctx, orgID, "onboarding_progress", row, false); err != nil {
		return dataAccessError(err)
	}
	return mustJSONResponse(200, row)
}

func (a *application) getOnboardingStatus(ctx context.Context, orgID string) events.APIGatewayV2HTTPResponse {
	locations, err := a.queryDataRows(ctx, orgID, "locations")
	if err != nil {
		return dataAccessError(err)
	}
	items, err := a.queryDataRows(ctx, orgID, "items")
	if err != nil {
		return dataAccessError(err)
	}
	staff, err := a.queryDataRows(ctx, orgID, "staff")
	if err != nil {
		return dataAccessError(err)
	}
	drivers, err := a.queryDataRows(ctx, orgID, "delivery_drivers")
	if err != nil {
		return dataAccessError(err)
	}
	orders, err := a.queryDataRows(ctx, orgID, "orders")
	if err != nil {
		return dataAccessError(err)
	}
	activeItems := 0
	for _, row := range items {
		if value, exists := row["is_active"]; !exists || value == true {
			activeItems++
		}
	}
	hasOrder := false
	for _, row := range orders {
		status := strings.ToLower(fmt.Sprint(row["status"]))
		if status == "completed" || status == "delivered" {
			hasOrder = true
			break
		}
	}
	return mustJSONResponse(200, map[string]bool{
		"has_location":        len(locations) > 0,
		"has_five_items":      activeItems >= 5,
		"has_staff_or_driver": len(staff)+len(drivers) > 0,
		"has_order":           hasOrder,
	})
}

func (a *application) getPreferences(ctx context.Context, userID string) events.APIGatewayV2HTTPResponse {
	result, err := a.dynamo.GetItem(ctx, &dynamodb.GetItemInput{TableName: aws.String(a.table), Key: map[string]types.AttributeValue{
		"PK": &types.AttributeValueMemberS{Value: "USER#" + userID}, "SK": &types.AttributeValueMemberS{Value: "PREFERENCES"},
	}, ConsistentRead: aws.Bool(true)})
	if err != nil {
		return dataAccessError(err)
	}
	if row, ok := decodeJSONItem(result.Item); ok {
		return mustJSONResponse(200, row)
	}
	return mustJSONResponse(200, map[string]any{"profile_id": userID, "last_view_pos": nil, "last_view_kds": nil})
}

func (a *application) putPreferences(ctx context.Context, userID, body string) events.APIGatewayV2HTTPResponse {
	var changes map[string]any
	if decodeDataObject(body, &changes) != nil {
		return errorResponse(400, "invalid request body")
	}
	allowedPOS := map[string]bool{"quick": true, "full": true, "floor": true, "orders": true}
	allowedKDS := map[string]bool{"station": true, "expo": true, "bumpbar": true}
	if value, exists := changes["last_view_pos"]; exists && !allowedPOS[fmt.Sprint(value)] {
		return errorResponse(400, "last_view_pos must be one of: quick, full, floor, orders")
	}
	if value, exists := changes["last_view_kds"]; exists && !allowedKDS[fmt.Sprint(value)] {
		return errorResponse(400, "last_view_kds must be one of: station, expo, bumpbar")
	}
	current := map[string]any{"profile_id": userID, "last_view_pos": nil, "last_view_kds": nil}
	result, err := a.dynamo.GetItem(ctx, &dynamodb.GetItemInput{TableName: aws.String(a.table), Key: map[string]types.AttributeValue{
		"PK": &types.AttributeValueMemberS{Value: "USER#" + userID}, "SK": &types.AttributeValueMemberS{Value: "PREFERENCES"},
	}})
	if err != nil {
		return dataAccessError(err)
	}
	if row, ok := decodeJSONItem(result.Item); ok {
		current = row
	}
	for _, key := range []string{"last_view_pos", "last_view_kds"} {
		if value, exists := changes[key]; exists {
			current[key] = value
		}
	}
	current["updated_at"] = time.Now().UTC().Format(time.RFC3339Nano)
	item, err := jsonDataItem("USER#"+userID, "PREFERENCES", "user_preferences", userID, current)
	if err != nil {
		return dataAccessError(err)
	}
	if _, err = a.dynamo.PutItem(ctx, &dynamodb.PutItemInput{TableName: aws.String(a.table), Item: item}); err != nil {
		return dataAccessError(err)
	}
	return mustJSONResponse(200, current)
}

func (a *application) updateOperationalRow(ctx context.Context, userID, orgID, table, id, body string, managerOnly bool) events.APIGatewayV2HTTPResponse {
	if managerOnly {
		membership, err := a.getMembership(ctx, userID, orgID)
		if err != nil || !managerRole(fmt.Sprint(membership["role"])) {
			return errorResponse(403, "forbidden")
		}
	}
	var changes map[string]any
	if decodeDataObject(body, &changes) != nil {
		return errorResponse(400, "invalid request body")
	}
	row, err := a.dataRowByID(ctx, orgID, table, id)
	if err != nil {
		return dataAccessError(err)
	}
	delete(changes, "id")
	delete(changes, "organization_id")
	delete(changes, "created_at")
	for key, value := range changes {
		row[key] = value
	}
	row["updated_at"] = time.Now().UTC().Format(time.RFC3339Nano)
	if err := a.putDataRow(ctx, orgID, table, row, false); err != nil {
		return dataAccessError(err)
	}
	return mustJSONResponse(200, row)
}

func (a *application) createReservation(ctx context.Context, orgID, body string) events.APIGatewayV2HTTPResponse {
	var row map[string]any
	if decodeDataObject(body, &row) != nil {
		return errorResponse(400, "invalid request body")
	}
	if strings.TrimSpace(fmt.Sprint(row["location_id"])) == "" || strings.TrimSpace(fmt.Sprint(row["customer_name"])) == "" || strings.TrimSpace(fmt.Sprint(row["reservation_at"])) == "" {
		return errorResponse(400, "location_id, customer_name and reservation_at required")
	}
	party, ok := integerValue(row["party_size"])
	if !ok || party < 1 {
		return errorResponse(400, "party_size must be > 0")
	}
	if _, ok := row["duration_minutes"]; !ok {
		row["duration_minutes"] = 90
	}
	if strings.TrimSpace(fmt.Sprint(row["status"])) == "" {
		row["status"] = "pending"
	}
	for _, key := range []string{"customer_id", "customer_phone", "customer_email", "table_id", "section_id", "special_requests", "confirmation_sent_at", "created_by_staff_id"} {
		if _, exists := row[key]; !exists {
			row[key] = nil
		}
	}
	return a.createOperationalRow(ctx, orgID, "reservations", row)
}

func (a *application) listReservations(ctx context.Context, orgID, rawQuery string) events.APIGatewayV2HTTPResponse {
	values, _ := url.ParseQuery(rawQuery)
	locationID, date := values.Get("location_id"), values.Get("date")
	if locationID == "" || date == "" {
		return errorResponse(400, "location_id and date required")
	}
	rows, err := a.queryDataRows(ctx, orgID, "reservations")
	if err != nil {
		return dataAccessError(err)
	}
	filtered := rows[:0]
	for _, row := range rows {
		if fmt.Sprint(row["location_id"]) == locationID && strings.HasPrefix(fmt.Sprint(row["reservation_at"]), date) {
			filtered = append(filtered, row)
		}
	}
	sort.Slice(filtered, func(i, j int) bool {
		return fmt.Sprint(filtered[i]["reservation_at"]) < fmt.Sprint(filtered[j]["reservation_at"])
	})
	return mustJSONResponse(200, filtered)
}

func (a *application) transitionReservation(ctx context.Context, orgID, id, transition string) events.APIGatewayV2HTTPResponse {
	status := map[string]string{"confirm": "confirmed", "seat": "seated", "cancel": "cancelled"}[transition]
	row, err := a.dataRowByID(ctx, orgID, "reservations", id)
	if err != nil {
		return dataAccessError(err)
	}
	row["status"] = status
	row["updated_at"] = time.Now().UTC().Format(time.RFC3339Nano)
	if err := a.putDataRow(ctx, orgID, "reservations", row, false); err != nil {
		return dataAccessError(err)
	}
	return mustJSONResponse(200, row)
}

func (a *application) createWaitlistEntry(ctx context.Context, orgID, body string) events.APIGatewayV2HTTPResponse {
	var row map[string]any
	if decodeDataObject(body, &row) != nil {
		return errorResponse(400, "invalid request body")
	}
	if strings.TrimSpace(fmt.Sprint(row["location_id"])) == "" || strings.TrimSpace(fmt.Sprint(row["customer_name"])) == "" {
		return errorResponse(400, "location_id and customer_name required")
	}
	party, ok := integerValue(row["party_size"])
	if !ok || party < 1 {
		return errorResponse(400, "party_size must be > 0")
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	row["added_at"] = now
	row["seated_at"] = nil
	row["removed_at"] = nil
	row["removal_reason"] = nil
	return a.createOperationalRow(ctx, orgID, "waitlist", row)
}

func (a *application) listWaitlist(ctx context.Context, orgID, rawQuery string) events.APIGatewayV2HTTPResponse {
	values, _ := url.ParseQuery(rawQuery)
	locationID := values.Get("location_id")
	if locationID == "" {
		return errorResponse(400, "location_id required")
	}
	rows, err := a.queryDataRows(ctx, orgID, "waitlist")
	if err != nil {
		return dataAccessError(err)
	}
	active := rows[:0]
	for _, row := range rows {
		if fmt.Sprint(row["location_id"]) == locationID && row["seated_at"] == nil && row["removed_at"] == nil {
			active = append(active, row)
		}
	}
	sort.Slice(active, func(i, j int) bool { return fmt.Sprint(active[i]["added_at"]) < fmt.Sprint(active[j]["added_at"]) })
	return mustJSONResponse(200, active)
}

func (a *application) transitionWaitlist(ctx context.Context, orgID, id, transition, body string) events.APIGatewayV2HTTPResponse {
	row, err := a.dataRowByID(ctx, orgID, "waitlist", id)
	if err != nil {
		return dataAccessError(err)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if transition == "seat" {
		row["seated_at"] = now
	} else {
		var input map[string]any
		_ = decodeDataObject(body, &input)
		row["removed_at"] = now
		row["removal_reason"] = input["reason"]
	}
	row["updated_at"] = now
	if err := a.putDataRow(ctx, orgID, "waitlist", row, false); err != nil {
		return dataAccessError(err)
	}
	return mustJSONResponse(200, row)
}

func (a *application) setCategoryAvailability(ctx context.Context, orgID, categoryID string, unavailable bool) events.APIGatewayV2HTTPResponse {
	categories, err := a.queryDataRows(ctx, orgID, "categories")
	if err != nil {
		return dataAccessError(err)
	}
	found := false
	categoryIDs := map[string]bool{categoryID: true}
	for changed := true; changed; {
		changed = false
		for _, row := range categories {
			id := fmt.Sprint(row["id"])
			if id == categoryID {
				found = true
			}
			if categoryIDs[fmt.Sprint(row["parent_id"])] && !categoryIDs[id] {
				categoryIDs[id] = true
				changed = true
			}
		}
	}
	if !found {
		return errorResponse(404, "not found")
	}
	items, err := a.queryDataRows(ctx, orgID, "items")
	if err != nil {
		return dataAccessError(err)
	}
	affected := 0
	for _, row := range items {
		if !categoryIDs[fmt.Sprint(row["category_id"])] {
			continue
		}
		row["is_86ed"] = unavailable
		row["updated_at"] = time.Now().UTC().Format(time.RFC3339Nano)
		if err := a.putDataRow(ctx, orgID, "items", row, false); err != nil {
			return dataAccessError(err)
		}
		affected++
	}
	return mustJSONResponse(200, map[string]any{"category_id": categoryID, "items_affected": affected, "is_86ed": unavailable})
}

func (a *application) listSpecials(ctx context.Context, orgID, rawQuery string) events.APIGatewayV2HTTPResponse {
	values, _ := url.ParseQuery(rawQuery)
	locationID := values.Get("location_id")
	rows, err := a.queryDataRows(ctx, orgID, "items")
	if err != nil {
		return dataAccessError(err)
	}
	today := time.Now().UTC().Format("2006-01-02")
	result := make([]map[string]any, 0)
	for _, row := range rows {
		if row["is_daily_special"] != true || (locationID != "" && fmt.Sprint(row["location_id"]) != locationID) {
			continue
		}
		date := fmt.Sprint(row["special_date"])
		if row["special_date"] != nil && date != "" && date != today {
			continue
		}
		copy := map[string]any{"id": row["id"], "name": row["name"], "location_id": row["location_id"], "special_price_cents": row["special_price_cents"], "special_date": row["special_date"], "image_url": row["image_url"]}
		if cents, exists := row["price_cents"]; exists {
			copy["price_cents"] = cents
		} else if price, ok := numericValue(row["price"]); ok {
			copy["price_cents"] = int64(price * 100)
		}
		result = append(result, copy)
	}
	return mustJSONResponse(200, result)
}

func (a *application) setItemSpecial(ctx context.Context, userID, orgID, itemID, body string) events.APIGatewayV2HTTPResponse {
	membership, err := a.getMembership(ctx, userID, orgID)
	if err != nil || !managerRole(fmt.Sprint(membership["role"])) {
		return errorResponse(403, "requires owner or manager role")
	}
	var changes map[string]any
	if decodeDataObject(body, &changes) != nil {
		return errorResponse(400, "invalid request body")
	}
	if _, ok := changes["is_daily_special"].(bool); !ok {
		return errorResponse(400, "is_daily_special required")
	}
	if value, exists := changes["special_price_cents"]; exists && value != nil {
		price, ok := integerValue(value)
		if !ok || price < 0 {
			return errorResponse(400, "special_price_cents must be >= 0")
		}
	}
	row, err := a.dataRowByID(ctx, orgID, "items", itemID)
	if err != nil {
		return dataAccessError(err)
	}
	for _, key := range []string{"is_daily_special", "special_price_cents", "special_date"} {
		if value, exists := changes[key]; exists {
			row[key] = value
		}
	}
	row["updated_at"] = time.Now().UTC().Format(time.RFC3339Nano)
	if err := a.putDataRow(ctx, orgID, "items", row, false); err != nil {
		return dataAccessError(err)
	}
	return mustJSONResponse(200, map[string]any{"item_id": itemID, "is_daily_special": row["is_daily_special"]})
}

func (a *application) searchCustomers(ctx context.Context, orgID, rawQuery string) events.APIGatewayV2HTTPResponse {
	values, _ := url.ParseQuery(rawQuery)
	term := strings.ToLower(strings.TrimSpace(values.Get("q")))
	if term == "" {
		return errorResponse(400, "q is required")
	}
	limit := 20
	if rawLimit := values.Get("limit"); rawLimit != "" {
		parsed, err := strconv.Atoi(rawLimit)
		if err != nil || parsed < 1 || parsed > 100 {
			return errorResponse(400, "limit must be an integer between 1 and 100")
		}
		limit = parsed
	}
	rows, err := a.queryDataRows(ctx, orgID, "customers")
	if err != nil {
		return dataAccessError(err)
	}
	results := make([]map[string]any, 0, limit)
	for _, row := range rows {
		name := strings.TrimSpace(strings.Join([]string{fmt.Sprint(row["first_name"]), fmt.Sprint(row["last_name"])}, " "))
		if explicit := strings.TrimSpace(fmt.Sprint(row["name"])); explicit != "" {
			name = explicit
		}
		phone := fmt.Sprint(row["whatsapp_number"])
		if phone == "<nil>" || phone == "" {
			phone = fmt.Sprint(row["phone"])
		}
		if !strings.Contains(strings.ToLower(name), term) && !strings.Contains(strings.ToLower(phone), term) {
			continue
		}
		results = append(results, map[string]any{"id": row["id"], "name": name, "phone": phone, "email": row["email"], "total_orders": valueOr(row, "total_orders", 0), "last_order_date": row["last_order_date"]})
		if len(results) == limit {
			break
		}
	}
	return mustJSONResponse(200, map[string]any{"customers": results})
}

func (a *application) listStaff(ctx context.Context, orgID, rawQuery string) events.APIGatewayV2HTTPResponse {
	values, _ := url.ParseQuery(rawQuery)
	locationID := values.Get("location_id")
	roles := map[string]bool{}
	for _, role := range strings.Split(values.Get("role"), ",") {
		if role = strings.TrimSpace(role); role != "" {
			roles[role] = true
		}
	}
	rows, err := a.queryDataRows(ctx, orgID, "staff")
	if err != nil {
		return dataAccessError(err)
	}
	result := rows[:0]
	for _, row := range rows {
		if locationID != "" && fmt.Sprint(row["location_id"]) != locationID {
			continue
		}
		if len(roles) > 0 && !roles[fmt.Sprint(row["role"])] {
			continue
		}
		result = append(result, row)
	}
	return mustJSONResponse(200, result)
}

func (a *application) createOperationalRow(ctx context.Context, orgID, table string, row map[string]any) events.APIGatewayV2HTTPResponse {
	id, err := randomID()
	if err != nil {
		return dataAccessError(err)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	row["id"] = id
	row["organization_id"] = orgID
	row["created_at"] = now
	row["updated_at"] = now
	if err := a.putDataRow(ctx, orgID, table, row, true); err != nil {
		return dataAccessError(err)
	}
	return mustJSONResponse(201, row)
}

func (a *application) dataRowByID(ctx context.Context, orgID, table, id string) (map[string]any, error) {
	result, err := a.dynamo.GetItem(ctx, &dynamodb.GetItemInput{TableName: aws.String(a.table), Key: dataRowKey(orgID, table, id), ConsistentRead: aws.Bool(true)})
	if err != nil {
		return nil, err
	}
	row, ok := decodeJSONItem(result.Item)
	if !ok {
		return nil, errNotFound
	}
	return row, nil
}

func mustJSONResponse(status int, value any) events.APIGatewayV2HTTPResponse {
	response, _ := jsonResponse(status, value)
	return response
}

func integerValue(value any) (int64, bool) {
	switch typed := value.(type) {
	case json.Number:
		parsed, err := typed.Int64()
		return parsed, err == nil
	case float64:
		return int64(typed), typed == float64(int64(typed))
	case int:
		return int64(typed), true
	case int64:
		return typed, true
	default:
		return 0, false
	}
}

func numericValue(value any) (float64, bool) {
	switch typed := value.(type) {
	case json.Number:
		parsed, err := typed.Float64()
		return parsed, err == nil
	case float64:
		return typed, true
	case int:
		return float64(typed), true
	case int64:
		return float64(typed), true
	default:
		return 0, false
	}
}

func stringSlice(value any) ([]string, bool) {
	if value == nil {
		return []string{}, true
	}
	entries, ok := value.([]any)
	if !ok {
		if strings, ok := value.([]string); ok {
			return strings, true
		}
		return nil, false
	}
	result := make([]string, 0, len(entries))
	for _, entry := range entries {
		text, ok := entry.(string)
		if !ok {
			return nil, false
		}
		result = append(result, text)
	}
	return result, true
}

func valueOr(row map[string]any, key string, fallback any) any {
	if value, exists := row[key]; exists && value != nil {
		return value
	}
	return fallback
}
