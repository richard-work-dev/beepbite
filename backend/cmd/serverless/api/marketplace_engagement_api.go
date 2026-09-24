package main

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

type marketplaceEngagementRoute struct {
	name, slug, id, token string
}

func matchMarketplaceEngagementRoute(method, path string) (marketplaceEngagementRoute, bool) {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	switch {
	case method == "GET" && len(parts) == 3 && parts[0] == "stores" && parts[2] == "reviews":
		return marketplaceEngagementRoute{name: "public-reviews", slug: parts[1]}, true
	case method == "POST" && len(parts) == 1 && parts[0] == "reviews":
		return marketplaceEngagementRoute{name: "submit-review"}, true
	case method == "POST" && len(parts) == 3 && parts[0] == "reviews" && parts[2] == "reply":
		return marketplaceEngagementRoute{name: "reply-review", id: parts[1]}, true
	case method == "GET" && len(parts) == 2 && parts[0] == "track":
		return marketplaceEngagementRoute{name: "tracking", token: parts[1]}, true
	case method == "GET" && len(parts) == 3 && parts[0] == "locations" && parts[2] == "pickup-slots":
		return marketplaceEngagementRoute{name: "pickup-slots", id: parts[1]}, true
	default:
		return marketplaceEngagementRoute{}, false
	}
}

func (a *application) handleMarketplaceEngagementAPI(ctx context.Context, request events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, bool, error) {
	route, matched := matchMarketplaceEngagementRoute(request.RequestContext.HTTP.Method, request.RawPath)
	if !matched {
		return events.APIGatewayV2HTTPResponse{}, false, nil
	}
	var response events.APIGatewayV2HTTPResponse
	switch route.name {
	case "public-reviews":
		response = a.listPublicMarketplaceReviews(ctx, route.slug, request.RawQueryString)
	case "submit-review":
		response = a.submitMarketplaceReview(ctx, request)
	case "reply-review":
		response = a.replyMarketplaceReview(ctx, request, route.id)
	case "tracking":
		response = a.getMarketplaceTracking(ctx, route.token)
	case "pickup-slots":
		response = a.listPickupSlots(ctx, route.id, request.RawQueryString)
	}
	return response, true, nil
}

func (a *application) listPublicMarketplaceReviews(ctx context.Context, slug, rawQuery string) events.APIGatewayV2HTTPResponse {
	location, err := a.marketplaceLocationBySlug(ctx, slug)
	if errors.Is(err, errNotFound) {
		return errorResponse(404, "store not found")
	} else if err != nil {
		return dataAccessError(err)
	}
	values, err := url.ParseQuery(rawQuery)
	if err != nil {
		return errorResponse(400, "invalid query")
	}
	limit := queryInteger(values.Get("limit"), 20, 1, 100)
	rows, err := a.queryDataRows(ctx, location.orgID, "marketplace_reviews")
	if err != nil {
		return dataAccessError(err)
	}
	locationID := displayString(location.row["id"])
	reviews := make([]map[string]any, 0)
	for _, row := range rows {
		if displayString(row["location_id"]) != locationID || displayString(valueOr(row, "status", "visible")) != "visible" {
			continue
		}
		photos, ok := stringSlice(row["photos"])
		if !ok {
			photos = []string{}
		}
		reviews = append(reviews, map[string]any{
			"id": row["id"], "stars": row["stars"], "text": valueOr(row, "text", row["review_text"]),
			"photos": photos, "owner_reply": valueOr(row, "owner_reply", nil),
			"owner_replied_at": valueOr(row, "owner_replied_at", nil), "created_at": row["created_at"],
		})
	}
	sort.Slice(reviews, func(i, j int) bool {
		return displayString(reviews[i]["created_at"]) > displayString(reviews[j]["created_at"])
	})
	if len(reviews) > limit {
		reviews = reviews[:limit]
	}
	response := mustJSONResponse(200, map[string]any{"data": reviews, "limit": limit})
	response.Headers = map[string]string{"Cache-Control": "public, max-age=60"}
	return response
}

func (a *application) submitMarketplaceReview(ctx context.Context, request events.APIGatewayV2HTTPRequest) events.APIGatewayV2HTTPResponse {
	claims, err := a.authenticate(ctx, request.Headers)
	if err != nil {
		return errorResponse(401, "invalid token")
	}
	orgID, err := a.authorizedOrganization(ctx, request, claims.UserID)
	if err != nil {
		return dataAccessError(err)
	}
	var input map[string]any
	if decodeDataObject(request.Body, &input) != nil {
		return errorResponse(400, "invalid request body")
	}
	orderID := strings.TrimSpace(displayString(input["order_id"]))
	stars, starsOK := integerValue(input["stars"])
	if orderID == "" {
		return errorResponse(400, "order_id required")
	}
	if !starsOK || stars < 1 || stars > 5 {
		return errorResponse(400, "stars must be between 1 and 5")
	}
	text := strings.TrimSpace(displayString(input["text"]))
	if len(text) > 2000 {
		return errorResponse(400, "text must contain at most 2000 characters")
	}
	photos, photosOK := stringSlice(input["photos"])
	if !photosOK || len(photos) > 8 {
		return errorResponse(400, "photos must contain at most 8 URLs")
	}
	order, err := a.dataRowByID(ctx, orgID, "orders", orderID)
	if err != nil {
		return errorResponse(422, "order not eligible for review — must be delivered or completed and belong to you")
	}
	status := displayString(order["status"])
	customerID := displayString(order["customer_id"])
	if status != "delivered" && status != "completed" || customerID == "" {
		return errorResponse(422, "order not eligible for review — must be delivered or completed and belong to you")
	}
	customer, err := a.dataRowByID(ctx, orgID, "customers", customerID)
	if err != nil || displayString(customer["profile_id"]) != claims.UserID {
		return errorResponse(422, "order not eligible for review — must be delivered or completed and belong to you")
	}
	existing, err := a.queryDataRows(ctx, orgID, "marketplace_reviews")
	if err != nil {
		return dataAccessError(err)
	}
	for _, review := range existing {
		if displayString(review["order_id"]) == orderID {
			return errorResponse(409, "a review already exists for this order")
		}
	}
	review, err := a.createStoredRow(ctx, orgID, "marketplace_reviews", map[string]any{
		"order_id": orderID, "customer_profile_id": claims.UserID, "location_id": order["location_id"],
		"stars": stars, "text": nullableString(text), "review_text": nullableString(text), "photos": photos,
		"verified_purchase": true, "status": "visible", "owner_reply": nil, "owner_replied_at": nil,
	})
	if err != nil {
		return dataAccessError(err)
	}
	if err := a.refreshMarketplaceRating(ctx, orgID, displayString(order["location_id"])); err != nil {
		_ = a.deleteStoredRow(ctx, orgID, "marketplace_reviews", displayString(review["id"]))
		return dataAccessError(err)
	}
	return mustJSONResponse(201, marketplaceReviewResponse(review))
}

func (a *application) replyMarketplaceReview(ctx context.Context, request events.APIGatewayV2HTTPRequest, reviewID string) events.APIGatewayV2HTTPResponse {
	claims, err := a.authenticate(ctx, request.Headers)
	if err != nil {
		return errorResponse(401, "invalid token")
	}
	orgID, err := a.authorizedOrganization(ctx, request, claims.UserID)
	if err != nil {
		return dataAccessError(err)
	}
	membership, err := a.getMembership(ctx, claims.UserID, orgID)
	if err != nil || !managerRole(displayString(membership["role"])) {
		return errorResponse(403, "forbidden")
	}
	var input map[string]any
	if decodeDataObject(request.Body, &input) != nil {
		return errorResponse(400, "invalid request body")
	}
	reply := strings.TrimSpace(displayString(input["reply"]))
	if reply == "" || len(reply) > 2000 {
		return errorResponse(400, "reply must contain 1 to 2000 characters")
	}
	review, err := a.dataRowByID(ctx, orgID, "marketplace_reviews", reviewID)
	if err != nil {
		return errorResponse(404, "review not found")
	}
	if _, err = a.dataRowByID(ctx, orgID, "locations", displayString(review["location_id"])); err != nil {
		return errorResponse(404, "review not found")
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	review["owner_reply"], review["owner_replied_at"], review["updated_at"] = reply, now, now
	if err := a.putDataRow(ctx, orgID, "marketplace_reviews", review, false); err != nil {
		return dataAccessError(err)
	}
	return mustJSONResponse(200, marketplaceReviewResponse(review))
}

func marketplaceReviewResponse(row map[string]any) map[string]any {
	photos, ok := stringSlice(row["photos"])
	if !ok {
		photos = []string{}
	}
	return map[string]any{
		"id": row["id"], "location_id": row["location_id"], "order_id": row["order_id"],
		"customer_profile_id": row["customer_profile_id"], "stars": row["stars"],
		"text": valueOr(row, "text", row["review_text"]), "photos": photos,
		"verified_purchase": boolOr(row, "verified_purchase", false), "owner_reply": valueOr(row, "owner_reply", nil),
		"owner_replied_at": valueOr(row, "owner_replied_at", nil), "created_at": row["created_at"],
	}
}

func (a *application) refreshMarketplaceRating(ctx context.Context, orgID, locationID string) error {
	rows, err := a.queryDataRows(ctx, orgID, "marketplace_reviews")
	if err != nil {
		return err
	}
	var total float64
	count := int64(0)
	for _, row := range rows {
		if displayString(row["location_id"]) != locationID || displayString(valueOr(row, "status", "visible")) != "visible" {
			continue
		}
		if stars, ok := numericValue(row["stars"]); ok {
			total += stars
			count++
		}
	}
	location, err := a.dataRowByID(ctx, orgID, "locations", locationID)
	if err != nil {
		return err
	}
	location["rating_count"] = count
	if count == 0 {
		location["avg_rating"] = nil
	} else {
		location["avg_rating"] = float64(int64(total/float64(count)*100+0.5)) / 100
	}
	location["updated_at"] = time.Now().UTC().Format(time.RFC3339Nano)
	return a.putDataRow(ctx, orgID, "locations", location, false)
}

func (a *application) scanDataRowsByEntity(ctx context.Context, entity string) ([]map[string]any, error) {
	rows := []map[string]any{}
	var startKey map[string]types.AttributeValue
	for {
		result, err := a.dynamo.Scan(ctx, &dynamodb.ScanInput{
			TableName: aws.String(a.table), FilterExpression: aws.String("entity_type = :entity"),
			ExpressionAttributeValues: map[string]types.AttributeValue{":entity": &types.AttributeValueMemberS{Value: entity}},
			ExclusiveStartKey:         startKey, ConsistentRead: aws.Bool(true),
		})
		if err != nil {
			return nil, err
		}
		for _, item := range result.Items {
			if row, ok := decodeJSONItem(item); ok {
				rows = append(rows, row)
			}
		}
		if len(result.LastEvaluatedKey) == 0 {
			break
		}
		startKey = result.LastEvaluatedKey
	}
	return rows, nil
}

func (a *application) getMarketplaceTracking(ctx context.Context, encodedToken string) events.APIGatewayV2HTTPResponse {
	token, err := url.PathUnescape(encodedToken)
	if err != nil || strings.TrimSpace(token) == "" {
		return errorResponse(400, "token is required")
	}
	tokens, err := a.scanDataRowsByEntity(ctx, "order_tracking_tokens")
	if err != nil {
		return dataAccessError(err)
	}
	var tracking map[string]any
	for _, row := range tokens {
		if displayString(row["token"]) != token || displayString(row["revoked_at"]) != "" {
			continue
		}
		expires, parseErr := time.Parse(time.RFC3339, displayString(row["expires_at"]))
		if parseErr == nil && expires.After(time.Now().UTC()) {
			tracking = row
			break
		}
	}
	if tracking == nil {
		return errorResponse(404, "tracking token not found or expired")
	}
	orgID, orderID := displayString(tracking["organization_id"]), displayString(tracking["order_id"])
	order, err := a.dataRowByID(ctx, orgID, "orders", orderID)
	if err != nil {
		return errorResponse(404, "tracking token not found or expired")
	}
	location, err := a.dataRowByID(ctx, orgID, "locations", displayString(order["location_id"]))
	if err != nil {
		return dataAccessError(err)
	}
	response := map[string]any{
		"token": token, "order_id": orderID, "status": order["status"], "fulfillment_type": order["fulfillment_type"],
		"estimated_delivery_time": valueOr(order, "estimated_delivery_time", nil),
		"store_lat":               valueOr(location, "latitude", nil), "store_lng": valueOr(location, "longitude", nil),
		"delivery_address": valueOr(order, "delivery_address", nil),
	}
	if displayString(order["status"]) == "out_for_delivery" {
		response["delivery_lat"] = valueOr(order, "delivery_latitude", nil)
		response["delivery_lng"] = valueOr(order, "delivery_longitude", nil)
	}
	return mustJSONResponse(200, response)
}

type pickupSlot struct {
	SlotTime  string `json:"slot_time"`
	Capacity  int64  `json:"capacity"`
	Scheduled int    `json:"scheduled"`
	IsFull    bool   `json:"is_full"`
}

func (a *application) listPickupSlots(ctx context.Context, locationID, rawQuery string) events.APIGatewayV2HTTPResponse {
	values, err := url.ParseQuery(rawQuery)
	if err != nil || values.Get("date") == "" {
		return errorResponse(400, "date query param required (YYYY-MM-DD)")
	}
	date, err := time.Parse("2006-01-02", values.Get("date"))
	if err != nil {
		return errorResponse(400, "date must be YYYY-MM-DD")
	}
	locations, err := a.marketplaceLocations(ctx)
	if err != nil {
		return dataAccessError(err)
	}
	var location marketplaceLocation
	for _, candidate := range locations {
		if displayString(candidate.row["id"]) == locationID {
			location = candidate
			break
		}
	}
	if location.row == nil {
		return errorResponse(404, "location not found")
	}
	minutes, ok := integerValue(location.row["pickup_slot_minutes"])
	if !ok || minutes < 5 || minutes > 240 {
		minutes = 15
	}
	capacity, ok := integerValue(location.row["pickup_slot_capacity"])
	if !ok || capacity < 0 {
		capacity = 0
	}
	orders, err := a.queryDataRows(ctx, location.orgID, "orders")
	if err != nil {
		return dataAccessError(err)
	}
	slots := generatePickupSlots(date, int(minutes))
	result := make([]pickupSlot, 0, len(slots))
	for _, slot := range slots {
		end := slot.Add(time.Duration(minutes) * time.Minute)
		scheduled := 0
		for _, order := range orders {
			if displayString(order["location_id"]) != locationID || displayString(order["status"]) == "cancelled" {
				continue
			}
			pickupAt, parseErr := time.Parse(time.RFC3339, displayString(order["pickup_at"]))
			if parseErr == nil && !pickupAt.Before(slot) && pickupAt.Before(end) {
				scheduled++
			}
		}
		result = append(result, pickupSlot{SlotTime: slot.Format(time.RFC3339), Capacity: capacity, Scheduled: scheduled, IsFull: capacity > 0 && int64(scheduled) >= capacity})
	}
	return mustJSONResponse(200, result)
}

func generatePickupSlots(date time.Time, slotMinutes int) []time.Time {
	if slotMinutes <= 0 {
		slotMinutes = 15
	}
	start := time.Date(date.Year(), date.Month(), date.Day(), 10, 0, 0, 0, time.UTC)
	end := time.Date(date.Year(), date.Month(), date.Day(), 21, 0, 0, 0, time.UTC)
	slots := make([]time.Time, 0, int(end.Sub(start).Minutes())/slotMinutes)
	for slot := start; slot.Before(end); slot = slot.Add(time.Duration(slotMinutes) * time.Minute) {
		slots = append(slots, slot)
	}
	return slots
}

func marketplaceTrackingTokenRow(token, orderID string) map[string]any {
	return map[string]any{
		"token": token, "order_id": orderID, "expires_at": time.Now().UTC().Add(7 * 24 * time.Hour).Format(time.RFC3339), "revoked_at": nil,
	}
}

func validatePickupAt(value any, fulfillment string) (any, error) {
	text := strings.TrimSpace(displayString(value))
	if text == "" {
		return nil, nil
	}
	if fulfillment != "collection" {
		return nil, fmt.Errorf("pickup_at is only valid for collection orders")
	}
	parsed, err := time.Parse(time.RFC3339, text)
	if err != nil {
		return nil, fmt.Errorf("pickup_at must be an ISO-8601 timestamp")
	}
	return parsed.UTC().Format(time.RFC3339), nil
}
