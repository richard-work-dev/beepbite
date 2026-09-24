package main

import (
	"context"
	"errors"
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
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

type marketplaceRoute struct{ name, slug string }

func matchMarketplaceRoute(method, path string) (marketplaceRoute, bool) {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	switch {
	case len(parts) == 1 && parts[0] == "stores" && method == "GET":
		return marketplaceRoute{name: "list"}, true
	case len(parts) == 2 && parts[0] == "stores" && method == "GET":
		return marketplaceRoute{name: "detail", slug: parts[1]}, true
	case len(parts) == 3 && parts[0] == "stores" && parts[2] == "orders" && method == "POST":
		return marketplaceRoute{name: "checkout", slug: parts[1]}, true
	default:
		return marketplaceRoute{}, false
	}
}

func (a *application) handleMarketplaceAPI(ctx context.Context, request events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, bool, error) {
	route, matched := matchMarketplaceRoute(request.RequestContext.HTTP.Method, request.RawPath)
	if !matched {
		return events.APIGatewayV2HTTPResponse{}, false, nil
	}
	var response events.APIGatewayV2HTTPResponse
	switch route.name {
	case "list":
		response = a.listMarketplaceStores(ctx, request.RawQueryString)
	case "detail":
		response = a.getMarketplaceStore(ctx, route.slug)
	case "checkout":
		response = a.createMarketplaceOrder(ctx, route.slug, request.Body)
	}
	if response.Headers == nil {
		response.Headers = map[string]string{}
	}
	if route.name != "checkout" {
		response.Headers["Cache-Control"] = "public, max-age=60"
	}
	return response, true, nil
}

type marketplaceLocation struct {
	orgID string
	row   map[string]any
}

func (a *application) marketplaceLocations(ctx context.Context) ([]marketplaceLocation, error) {
	locations := []marketplaceLocation{}
	var startKey map[string]types.AttributeValue
	for {
		result, err := a.dynamo.Scan(ctx, &dynamodb.ScanInput{
			TableName:        aws.String(a.table),
			FilterExpression: aws.String("entity_type = :entity"),
			ExpressionAttributeValues: map[string]types.AttributeValue{
				":entity": &types.AttributeValueMemberS{Value: "locations"},
			},
			ExclusiveStartKey: startKey,
			ConsistentRead:    aws.Bool(true),
		})
		if err != nil {
			return nil, err
		}
		for _, item := range result.Items {
			row, ok := decodeJSONItem(item)
			if !ok || !marketplaceVisible(row) {
				continue
			}
			orgID := displayString(row["organization_id"])
			if orgID == "" {
				orgID = strings.TrimPrefix(stringValue(item["PK"]), "ORG#")
			}
			if orgID != "" {
				locations = append(locations, marketplaceLocation{orgID: orgID, row: row})
			}
		}
		if len(result.LastEvaluatedKey) == 0 {
			break
		}
		startKey = result.LastEvaluatedKey
	}
	return locations, nil
}

func marketplaceVisible(row map[string]any) bool {
	visible, _ := row["is_marketplace_visible"].(bool)
	active, activeSet := row["is_active"].(bool)
	return visible && (!activeSet || active)
}

func (a *application) marketplaceLocationBySlug(ctx context.Context, slug string) (marketplaceLocation, error) {
	decoded, err := url.PathUnescape(slug)
	if err != nil {
		return marketplaceLocation{}, errNotFound
	}
	locations, err := a.marketplaceLocations(ctx)
	if err != nil {
		return marketplaceLocation{}, err
	}
	for _, location := range locations {
		if displayString(location.row["slug"]) == decoded {
			return location, nil
		}
	}
	return marketplaceLocation{}, errNotFound
}

func (a *application) listMarketplaceStores(ctx context.Context, rawQuery string) events.APIGatewayV2HTTPResponse {
	values, err := url.ParseQuery(rawQuery)
	if err != nil {
		return errorResponse(400, "invalid query")
	}
	limit := queryInteger(values.Get("limit"), 20, 1, 100)
	offset := queryInteger(values.Get("offset"), 0, 0, math.MaxInt)
	q, city, country := strings.ToLower(strings.TrimSpace(values.Get("q"))), strings.ToLower(strings.TrimSpace(values.Get("city"))), strings.ToLower(strings.TrimSpace(values.Get("country")))
	lat, latOK := queryFloat(values.Get("lat"))
	lng, lngOK := queryFloat(values.Get("lng"))
	radius, radiusOK := queryFloat(values.Get("radius_km"))
	if !radiusOK || radius <= 0 {
		radius = 10
	}
	locations, err := a.marketplaceLocations(ctx)
	if err != nil {
		return dataAccessError(err)
	}
	stores := make([]map[string]any, 0)
	for _, location := range locations {
		row := location.row
		name, slug := displayString(row["name"]), displayString(row["slug"])
		if q != "" && !strings.Contains(strings.ToLower(name), q) && !strings.Contains(strings.ToLower(slug), q) {
			continue
		}
		if city != "" && strings.ToLower(displayString(row["city"])) != city {
			continue
		}
		if country != "" && strings.ToLower(displayString(row["country"])) != country {
			continue
		}
		if latOK && lngOK {
			storeLat, storeLatOK := numericValue(row["latitude"])
			storeLng, storeLngOK := numericValue(row["longitude"])
			if storeLatOK && storeLngOK && haversineKM(lat, lng, storeLat, storeLng) > radius {
				continue
			}
		}
		average, _, ratingErr := a.marketplaceRating(ctx, location.orgID, displayString(row["id"]))
		if ratingErr != nil {
			return dataAccessError(ratingErr)
		}
		stores = append(stores, map[string]any{
			"id": row["id"], "name": name, "slug": valueOr(row, "slug", nil), "city": valueOr(row, "city", nil),
			"country": valueOr(row, "country", nil), "address": valueOr(row, "address", nil),
			"description": valueOr(row, "description", nil), "avg_rating": average,
		})
	}
	sort.Slice(stores, func(i, j int) bool { return displayString(stores[i]["name"]) < displayString(stores[j]["name"]) })
	if offset >= len(stores) {
		stores = []map[string]any{}
	} else {
		end := offset + limit
		if end > len(stores) {
			end = len(stores)
		}
		stores = stores[offset:end]
	}
	return mustJSONResponse(200, map[string]any{"data": stores, "limit": limit, "offset": offset})
}

func queryInteger(value string, fallback, minimum, maximum int) int {
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed < minimum {
		return fallback
	}
	if parsed > maximum {
		return maximum
	}
	return parsed
}

func queryFloat(value string) (float64, bool) {
	if value == "" {
		return 0, false
	}
	parsed, err := strconv.ParseFloat(value, 64)
	return parsed, err == nil
}

func haversineKM(lat1, lng1, lat2, lng2 float64) float64 {
	const earthRadiusKM = 6371
	toRadians := math.Pi / 180
	dLat, dLng := (lat2-lat1)*toRadians, (lng2-lng1)*toRadians
	a := math.Sin(dLat/2)*math.Sin(dLat/2) + math.Cos(lat1*toRadians)*math.Cos(lat2*toRadians)*math.Sin(dLng/2)*math.Sin(dLng/2)
	return earthRadiusKM * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}

func (a *application) marketplaceRating(ctx context.Context, orgID, locationID string) (any, int, error) {
	reviews, err := a.queryDataRows(ctx, orgID, "reviews")
	if err != nil {
		return nil, 0, err
	}
	var total float64
	count := 0
	for _, review := range reviews {
		if displayString(review["location_id"]) != locationID || (displayString(review["status"]) != "" && displayString(review["status"]) != "visible") {
			continue
		}
		stars, ok := numericValue(valueOr(review, "stars", review["rating"]))
		if ok {
			total += stars
			count++
		}
	}
	if count == 0 {
		return nil, 0, nil
	}
	return math.Round(total/float64(count)*100) / 100, count, nil
}

func (a *application) getMarketplaceStore(ctx context.Context, slug string) events.APIGatewayV2HTTPResponse {
	location, err := a.marketplaceLocationBySlug(ctx, slug)
	if errors.Is(err, errNotFound) {
		return errorResponse(404, "store not found")
	} else if err != nil {
		return dataAccessError(err)
	}
	locationID := displayString(location.row["id"])
	categories, err := a.queryDataRows(ctx, location.orgID, "categories")
	if err != nil {
		return dataAccessError(err)
	}
	items, err := a.queryDataRows(ctx, location.orgID, "items")
	if err != nil {
		return dataAccessError(err)
	}
	currencyCode := displayString(valueOr(location.row, "currency_code", location.row["default_currency_code"]))
	menu := marketplaceMenu(locationID, currencyCode, categories, items, time.Now().UTC())
	average, count, err := a.marketplaceRating(ctx, location.orgID, locationID)
	if err != nil {
		return dataAccessError(err)
	}
	row := location.row
	return mustJSONResponse(200, map[string]any{
		"id": row["id"], "name": row["name"], "slug": valueOr(row, "slug", nil), "city": valueOr(row, "city", nil),
		"country": valueOr(row, "country", nil), "address": valueOr(row, "address", nil), "description": valueOr(row, "description", nil),
		"offers_delivery": boolOr(row, "offers_delivery", false), "offers_collection": boolOr(row, "offers_collection", false),
		"estimated_prep_time_minutes": integerOr(row, "estimated_prep_time", 30),
		"currency_code":               valueOr(row, "currency_code", valueOr(row, "default_currency_code", nil)),
		"avg_rating":                  average, "review_count": count, "categories": menu, "online_payment_available": false,
	})
}

func boolOr(row map[string]any, key string, fallback bool) bool {
	value, ok := row[key].(bool)
	if !ok {
		return fallback
	}
	return value
}

func integerOr(row map[string]any, key string, fallback int64) int64 {
	value, ok := integerValue(row[key])
	if !ok {
		return fallback
	}
	return value
}

func marketplaceMenu(locationID, currencyCode string, categories, items []map[string]any, now time.Time) []map[string]any {
	menu := make([]map[string]any, 0)
	for _, category := range categories {
		if displayString(category["location_id"]) != locationID || !boolOr(category, "is_active", true) {
			continue
		}
		entry := map[string]any{"id": category["id"], "name": category["name"], "description": valueOr(category, "description", nil), "sort_order": integerOr(category, "sort_order", 0), "items": []map[string]any{}}
		categoryItems := make([]map[string]any, 0)
		for _, item := range items {
			if displayString(item["location_id"]) != locationID || displayString(item["category_id"]) != displayString(category["id"]) || !marketplaceItemAvailable(item, now) {
				continue
			}
			price, ok := numericValue(item["price"])
			if !ok {
				if cents, centsOK := integerValue(item["price_cents"]); centsOK {
					price = float64(cents) / float64(currencyScale(currencyCode))
				}
			}
			categoryItems = append(categoryItems, map[string]any{
				"id": item["id"], "name": item["name"], "description": valueOr(item, "description", nil),
				"price": strconv.FormatFloat(price, 'f', 2, 64), "image_url": valueOr(item, "image_url", nil),
				"preparation_time_minutes": integerOr(item, "preparation_time", 0), "calories": valueOr(item, "calories", nil),
				"spice_level": valueOr(item, "spice_level", nil), "sort_order": integerOr(item, "sort_order", 0),
				"remaining_today": marketplaceRemaining(item, now),
			})
		}
		sort.Slice(categoryItems, func(i, j int) bool {
			return integerOr(categoryItems[i], "sort_order", 0) < integerOr(categoryItems[j], "sort_order", 0)
		})
		if len(categoryItems) > 0 {
			entry["items"] = categoryItems
			menu = append(menu, entry)
		}
	}
	sort.Slice(menu, func(i, j int) bool { return integerOr(menu[i], "sort_order", 0) < integerOr(menu[j], "sort_order", 0) })
	return menu
}

func currencyScale(code string) int64 {
	zeroDecimals := map[string]bool{"BIF": true, "CLP": true, "DJF": true, "GNF": true, "ISK": true, "JPY": true, "KMF": true, "KRW": true, "PYG": true, "RWF": true, "UGX": true, "UYI": true, "VND": true, "VUV": true, "XAF": true, "XOF": true, "XPF": true}
	threeDecimals := map[string]bool{"BHD": true, "IQD": true, "JOD": true, "KWD": true, "LYD": true, "OMR": true, "TND": true}
	code = strings.ToUpper(strings.TrimSpace(code))
	if zeroDecimals[code] {
		return 1
	}
	if threeDecimals[code] {
		return 1000
	}
	return 100
}

func marketplaceItemAvailable(item map[string]any, now time.Time) bool {
	if !boolOr(item, "is_active", true) || boolOr(item, "is_86ed", false) {
		return false
	}
	if from := displayString(item["available_from"]); from != "" {
		if parsed, err := time.Parse(time.RFC3339, from); err == nil && parsed.After(now) {
			return false
		}
	}
	if until := displayString(item["available_until"]); until != "" {
		if parsed, err := time.Parse(time.RFC3339, until); err == nil && !parsed.After(now) {
			return false
		}
	}
	remaining := marketplaceRemaining(item, now)
	return remaining == nil || remaining.(int64) > 0
}

func marketplaceRemaining(item map[string]any, now time.Time) any {
	quantity, ok := integerValue(item["daily_quantity"])
	if !ok {
		return nil
	}
	sold := int64(0)
	if displayString(item["daily_counter_date"]) == now.Format("2006-01-02") {
		sold, _ = integerValue(item["daily_sold_count"])
	}
	remaining := quantity - sold
	if remaining < 0 {
		remaining = 0
	}
	return remaining
}

func (a *application) createMarketplaceOrder(ctx context.Context, slug, body string) events.APIGatewayV2HTTPResponse {
	location, err := a.marketplaceLocationBySlug(ctx, slug)
	if errors.Is(err, errNotFound) {
		return errorResponse(404, "store not found")
	} else if err != nil {
		return dataAccessError(err)
	}
	var input map[string]any
	if decodeDataObject(body, &input) != nil {
		return errorResponse(400, "invalid request body")
	}
	fulfillment := strings.ToLower(displayString(input["fulfillment_type"]))
	if fulfillment != "delivery" && fulfillment != "collection" && fulfillment != "dine_in" {
		return errorResponse(400, "fulfillment_type must be one of: delivery, collection, dine_in")
	}
	lines, ok := input["items"].([]any)
	if !ok || len(lines) == 0 {
		return errorResponse(400, "items must not be empty")
	}
	tip, tipOK := integerValue(valueOr(input, "tip_cents", int64(0)))
	if !tipOK || tip < 0 {
		return errorResponse(400, "tip_cents must be >= 0")
	}
	methods, _ := stringSlice(location.row["on_delivery_payment_methods"])
	if len(methods) == 0 {
		return errorResponse(422, "no payment method available — store cannot accept orders right now")
	}
	status, paymentMethod := "confirmed", "cash"
	if fulfillment == "delivery" {
		status = "pending_on_delivery"
		if displayString(input["on_delivery_method"]) == "card_machine" {
			paymentMethod = "card_on_delivery"
		} else {
			paymentMethod = "cash_on_delivery"
		}
	}
	orgID, locationID := location.orgID, displayString(location.row["id"])
	if customerID := displayString(input["customer_id"]); customerID != "" {
		if _, err := a.dataRowByID(ctx, orgID, "customers", customerID); err != nil {
			return errorResponse(400, "customer_id is invalid")
		}
	}
	allItems, err := a.queryDataRows(ctx, orgID, "items")
	if err != nil {
		return dataAccessError(err)
	}
	itemByID := map[string]map[string]any{}
	for _, item := range allItems {
		if displayString(item["location_id"]) == locationID && marketplaceItemAvailable(item, time.Now().UTC()) {
			itemByID[displayString(item["id"])] = item
		}
	}
	type pricedLine struct {
		itemID              string
		quantity, unitCents int64
		notes               string
	}
	priced := make([]pricedLine, 0, len(lines))
	requestedByItem := map[string]int64{}
	var subtotal int64
	for index, raw := range lines {
		line, ok := raw.(map[string]any)
		if !ok {
			return errorResponse(400, fmt.Sprintf("item %d is invalid", index))
		}
		itemID := displayString(line["item_id"])
		quantity, quantityOK := integerValue(line["quantity"])
		item, found := itemByID[itemID]
		if !found || !quantityOK || quantity <= 0 {
			return errorResponse(400, fmt.Sprintf("item %d is unavailable or has invalid quantity", index))
		}
		currencyCode := displayString(valueOr(location.row, "currency_code", location.row["default_currency_code"]))
		unitCents, priceOK := integerValue(item["price_cents"])
		if !priceOK {
			price, ok := numericValue(item["price"])
			if !ok || price < 0 {
				return errorResponse(409, "item price is invalid")
			}
			unitCents = int64(math.Round(price * float64(currencyScale(currencyCode))))
		}
		requestedByItem[itemID] += quantity
		if remaining := marketplaceRemaining(item, time.Now().UTC()); remaining != nil && requestedByItem[itemID] > remaining.(int64) {
			return errorResponse(422, "requested quantity is unavailable")
		}
		priced = append(priced, pricedLine{itemID: itemID, quantity: quantity, unitCents: unitCents, notes: displayString(line["notes"])})
		subtotal += unitCents * quantity
	}
	if tip > subtotal*3 {
		return errorResponse(400, "tip amount is not valid for this order")
	}
	taxRate, taxInclusive, taxErr := a.marketplaceTaxConfig(ctx, orgID, locationID, location.row)
	if taxErr != nil {
		return dataAccessError(taxErr)
	}
	taxCents := int64(0)
	total := subtotal
	if taxRate > 0 {
		if taxInclusive {
			taxCents = int64(math.Round(float64(subtotal) * taxRate / (100 + taxRate)))
		} else {
			taxCents = int64(math.Round(float64(subtotal) * taxRate / 100))
			total += taxCents
		}
	}
	total += tip
	orderNumber := fmt.Sprintf("MKT%s", time.Now().UTC().Format("060102150405.000"))
	order, err := a.createStoredRow(ctx, orgID, "orders", map[string]any{
		"location_id": locationID, "customer_id": nullableString(input["customer_id"]), "order_number": orderNumber,
		"order_type": mapMarketplaceFulfillment(fulfillment), "fulfillment_type": fulfillment, "status": status,
		"subtotal_cents": subtotal, "tax_cents": taxCents, "total_cents": total, "tax_rate": taxRate,
		"tax_inclusive": taxInclusive, "currency_code": valueOr(location.row, "currency_code", nil),
		"delivery_address": nullableString(input["delivery_address"]), "estimated_prep_time": integerOr(location.row, "estimated_prep_time", 30),
		"gratuity_cents": tip, "business_date": time.Now().UTC().Format("2006-01-02"), "payment_method": paymentMethod,
	})
	if err != nil {
		return dataAccessError(err)
	}
	createdItems := make([]map[string]any, 0, len(priced))
	for _, line := range priced {
		created, err := a.createStoredRow(ctx, orgID, "order_items", map[string]any{
			"order_id": order["id"], "item_id": line.itemID, "quantity": line.quantity,
			"unit_price_cents": line.unitCents, "total_price_cents": line.unitCents * line.quantity,
			"line_total_cents": line.unitCents * line.quantity, "special_instructions": nullableString(line.notes),
		})
		if err != nil {
			for _, createdItem := range createdItems {
				_ = a.deleteStoredRow(ctx, orgID, "order_items", displayString(createdItem["id"]))
			}
			_ = a.deleteStoredRow(ctx, orgID, "orders", displayString(order["id"]))
			return dataAccessError(err)
		}
		createdItems = append(createdItems, created)
	}
	itemSnapshots := map[string]map[string]any{}
	now := time.Now().UTC()
	for itemID, quantity := range requestedByItem {
		item := itemByID[itemID]
		itemSnapshots[itemID] = cloneDataRow(item)
		sold := int64(0)
		if displayString(item["daily_counter_date"]) == now.Format("2006-01-02") {
			sold, _ = integerValue(item["daily_sold_count"])
		}
		item["daily_counter_date"], item["daily_sold_count"], item["updated_at"] = now.Format("2006-01-02"), sold+quantity, now.Format(time.RFC3339Nano)
		if err := a.putDataRow(ctx, orgID, "items", item, false); err != nil {
			for _, snapshot := range itemSnapshots {
				_ = a.putDataRow(ctx, orgID, "items", snapshot, false)
			}
			for _, createdItem := range createdItems {
				_ = a.deleteStoredRow(ctx, orgID, "order_items", displayString(createdItem["id"]))
			}
			_ = a.deleteStoredRow(ctx, orgID, "orders", displayString(order["id"]))
			return dataAccessError(err)
		}
	}
	return mustJSONResponse(201, map[string]any{
		"order_id": order["id"], "order_number": orderNumber, "status": status,
		"payment_method": paymentMethod, "total": float64(total) / float64(currencyScale(displayString(valueOr(location.row, "currency_code", location.row["default_currency_code"])))),
	})
}

func cloneDataRow(row map[string]any) map[string]any {
	clone := make(map[string]any, len(row))
	for key, value := range row {
		clone[key] = value
	}
	return clone
}

func (a *application) marketplaceTaxConfig(ctx context.Context, orgID, locationID string, location map[string]any) (float64, bool, error) {
	rates, err := a.queryDataRows(ctx, orgID, "tax_rates")
	if err != nil {
		return 0, false, err
	}
	sort.Slice(rates, func(i, j int) bool {
		return displayString(rates[i]["created_at"]) < displayString(rates[j]["created_at"])
	})
	for _, rate := range rates {
		if displayString(rate["location_id"]) != locationID || !boolOr(rate, "is_active", true) {
			continue
		}
		value, ok := numericValue(rate["rate"])
		if ok {
			return value, boolOr(rate, "is_inclusive", false), nil
		}
	}
	value, _ := numericValue(location["tax_rate"])
	return value, boolOr(location, "tax_inclusive", false), nil
}

func mapMarketplaceFulfillment(value string) string {
	if value == "collection" {
		return "pickup"
	}
	return value
}
