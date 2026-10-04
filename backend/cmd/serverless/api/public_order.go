package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

var publicOrderRequestPattern = regexp.MustCompile(`^[a-zA-Z0-9-]{16,80}$`)

const publicOrderLimit = 5

// publicOrderRateLimitKey uses a short-lived, window-specific digest: raw client
// IP addresses are never persisted and cannot be correlated across windows.
func publicOrderRateLimitKey(locationID, sourceIP string, now time.Time) (map[string]types.AttributeValue, int64) {
	window := now.UTC().Unix() / int64((10*time.Minute)/time.Second)
	digest := sha256.Sum256([]byte(fmt.Sprintf("%d:%s", window, strings.TrimSpace(sourceIP))))
	expires := (window + 2) * int64((10*time.Minute)/time.Second)
	return map[string]types.AttributeValue{
		"PK": &types.AttributeValueMemberS{Value: "RATE#PUBLIC_ORDER#" + locationID + "#" + hex.EncodeToString(digest[:])},
		"SK": &types.AttributeValueMemberS{Value: fmt.Sprintf("WINDOW#%d", window)},
	}, expires
}

func (a *application) allowPublicOrder(ctx context.Context, locationID, sourceIP string, now time.Time) (bool, error) {
	if strings.TrimSpace(sourceIP) == "" {
		return false, errors.New("missing trusted API Gateway client address")
	}
	key, expires := publicOrderRateLimitKey(locationID, sourceIP, now)
	_, err := a.dynamo.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName:           aws.String(a.table),
		Key:                 key,
		UpdateExpression:    aws.String("SET expires_at = :expires ADD request_count :one"),
		ConditionExpression: aws.String("attribute_not_exists(request_count) OR request_count < :limit"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":expires": &types.AttributeValueMemberN{Value: strconv.FormatInt(expires, 10)},
			":one":     &types.AttributeValueMemberN{Value: "1"},
			":limit":   &types.AttributeValueMemberN{Value: strconv.Itoa(publicOrderLimit)},
		},
	})
	if err == nil {
		return true, nil
	}
	var limitReached *types.ConditionalCheckFailedException
	if errors.As(err, &limitReached) {
		return false, nil
	}
	return false, err
}

func publicOrderModeEnabled(location map[string]any, mode string) bool {
	switch mode {
	case "collection":
		return boolOr(location, "accepts_pickup", boolOr(location, "offers_collection", false))
	case "delivery":
		return boolOr(location, "accepts_delivery", boolOr(location, "offers_delivery", false))
	case "dine_in":
		return displayString(location["service_style"]) != "takeaway"
	default:
		return false
	}
}

func publicOrderPaymentMethods(location map[string]any) []string {
	methods, _ := stringSlice(location["on_delivery_payment_methods"])
	result := []string{}
	seen := map[string]bool{}
	for _, method := range methods {
		if seen[method] {
			continue
		}
		if method == "cash" || method == "card_machine" || (method == "eft" && publicTransferDetails(location) != nil) {
			result = append(result, method)
			seen[method] = true
		}
	}
	return result
}

// publicTransferDetails returns only complete, customer-facing bank details.
// An EFT option without a beneficiary and at least one usable destination is
// intentionally not exposed as a valid checkout method.
func publicTransferDetails(location map[string]any) map[string]any {
	holder := strings.TrimSpace(displayString(location["transfer_account_holder"]))
	alias := strings.TrimSpace(displayString(location["transfer_alias"]))
	cbuInput := strings.TrimSpace(displayString(location["transfer_cbu"]))
	cbu := strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, cbuInput)
	if len(holder) == 0 || len(holder) > 100 {
		return nil
	}
	if len(cbu) != 22 {
		cbu = ""
	}
	if len(alias) > 40 {
		alias = ""
	}
	if alias == "" && cbu == "" {
		return nil
	}
	details := map[string]any{"account_holder": holder}
	if alias != "" {
		details["alias"] = alias
	}
	if cbu != "" {
		details["cbu"] = cbu
	}
	return details
}

func publicOrderMoney(value any, currency string) int64 {
	amount, ok := numericValue(value)
	if !ok || math.IsNaN(amount) || math.IsInf(amount, 0) || amount < 0 || amount > 1e9 {
		return 0
	}
	return int64(math.Round(amount * float64(currencyScale(currency))))
}

func marketplaceLocationTime(now time.Time, location map[string]any) time.Time {
	zone := strings.TrimSpace(displayString(location["timezone"]))
	if zone == "" {
		zone = "America/Argentina/Buenos_Aires"
	}
	if loc, err := time.LoadLocation(zone); err == nil {
		return now.In(loc)
	}
	return now.UTC()
}

type publicOrderLine struct {
	item                map[string]any
	quantity, unitCents int64
	notes               string
}

type publicOrderQuote struct {
	lines                               []publicOrderLine
	subtotal, tax, delivery, total, tip int64
	zone                                deliverySelection
}

func pricePublicOrder(input, location map[string]any, catalog []map[string]any, rate float64, inclusive bool, now time.Time, zones []map[string]any) (publicOrderQuote, error) {
	q := publicOrderQuote{}
	mode := displayString(input["fulfillment_type"])
	if !publicOrderModeEnabled(location, mode) {
		return q, errors.New("Esta modalidad no está habilitada en el local.")
	}
	lines, ok := input["items"].([]any)
	if !ok || len(lines) == 0 || len(lines) > 20 {
		return q, errors.New("El pedido debe tener entre 1 y 20 productos diferentes.")
	}
	currency := displayString(valueOr(location, "currency_code", location["default_currency_code"]))
	if currency == "" {
		return q, errors.New("El local todavía no configuró su moneda.")
	}
	available := map[string]map[string]any{}
	for _, item := range catalog {
		if displayString(item["location_id"]) == displayString(location["id"]) && marketplaceItemAvailable(item, now) {
			available[displayString(item["id"])] = item
		}
	}
	seen := map[string]bool{}
	for _, raw := range lines {
		line, ok := raw.(map[string]any)
		if !ok {
			return q, errors.New("Uno de los productos no es válido.")
		}
		id := displayString(line["item_id"])
		item := available[id]
		quantity, valid := integerValue(line["quantity"])
		if item == nil || !valid || quantity < 1 || quantity > 99 || seen[id] {
			return q, errors.New("Un producto ya no está disponible o su cantidad no es válida. Actualizá el menú.")
		}
		seen[id] = true
		if remaining := marketplaceRemaining(item, now); remaining != nil && quantity > remaining.(int64) {
			return q, fmt.Errorf("No hay suficiente disponibilidad de %s. Actualizá el menú.", displayString(item["name"]))
		}
		cents, hasCents := integerValue(item["price_cents"])
		if !hasCents {
			price, valid := numericValue(item["price"])
			if !valid || math.IsNaN(price) || math.IsInf(price, 0) || price < 0 || price > 1e9 {
				return q, errors.New("El precio de un producto no es válido.")
			}
			cents = int64(math.Round(price * float64(currencyScale(currency))))
		}
		if cents < 0 || cents > 1e12 {
			return q, errors.New("El precio de un producto no es válido.")
		}
		notes := strings.TrimSpace(displayString(line["notes"]))
		if utf8.RuneCountInString(notes) > 300 {
			return q, errors.New("Las aclaraciones de cada producto admiten hasta 300 caracteres.")
		}
		q.lines = append(q.lines, publicOrderLine{item: item, quantity: quantity, unitCents: cents, notes: notes})
		q.subtotal += cents * quantity
	}
	if math.IsNaN(rate) || math.IsInf(rate, 0) || rate < 0 || rate > 100 {
		return q, errors.New("El local debe revisar su configuración de impuestos.")
	}
	q.total = q.subtotal
	if inclusive {
		q.tax = int64(math.Round(float64(q.subtotal) * rate / (100 + rate)))
	} else {
		q.tax = int64(math.Round(float64(q.subtotal) * rate / 100))
		q.total += q.tax
	}
	var deliveryErr error
	q.zone, deliveryErr = priceDelivery(input, location, zones, q.subtotal)
	if deliveryErr != nil {
		return q, deliveryErr
	}
	q.delivery = q.zone.fee
	q.tip, ok = integerValue(valueOr(input, "tip_cents", int64(0)))
	if !ok || q.tip < 0 || q.tip > q.subtotal*3 {
		return q, errors.New("La propina no es válida.")
	}
	q.total += q.delivery + q.tip
	if expected, exists := input["expected_total_cents"]; exists {
		value, valid := integerValue(expected)
		if !valid || value != q.total {
			return q, errors.New("El total cambió. Actualizá los precios y revisá el pedido antes de confirmar.")
		}
	}
	return q, nil
}

func validatePublicOrderContact(input map[string]any) error {
	mode := strings.TrimSpace(displayString(input["fulfillment_type"]))
	dineIn := mode == "dine_in"
	name := strings.TrimSpace(displayString(input["customer_name"]))
	phone := strings.TrimSpace(displayString(input["customer_phone"]))
	table := strings.TrimSpace(displayString(input["table_label"]))
	if dineIn {
		if utf8.RuneCountInString(table) < 1 || utf8.RuneCountInString(table) > 60 {
			return errors.New("Indicá el número de mesa para identificar el pedido.")
		}
		if utf8.RuneCountInString(name) > 100 {
			return errors.New("El nombre no puede superar los 100 caracteres.")
		}
	} else if utf8.RuneCountInString(name) < 2 || utf8.RuneCountInString(name) > 100 {
		return errors.New("Ingresá un nombre de entre 2 y 100 caracteres.")
	}
	if !dineIn || phone != "" {
		digits := 0
		for _, r := range phone {
			if r >= '0' && r <= '9' {
				digits++
			} else if !strings.ContainsRune("+()- .", r) {
				return errors.New("Ingresá un teléfono válido con código de área.")
			}
		}
		if digits < 8 || digits > 15 || len(phone) > 24 {
			return errors.New("Ingresá un teléfono válido con código de área.")
		}
	}
	if input["customer_id"] != nil && displayString(input["customer_id"]) != "" {
		return errors.New("El pedido público debe incluir los datos de contacto, no una cuenta de cliente.")
	}
	if displayString(input["fulfillment_type"]) == "delivery" {
		address := strings.TrimSpace(displayString(input["delivery_address"]))
		if utf8.RuneCountInString(address) < 8 || utf8.RuneCountInString(address) > 500 {
			return errors.New("Completá calle, altura y localidad para la entrega.")
		}
	}
	if utf8.RuneCountInString(displayString(input["notes"])) > 500 || utf8.RuneCountInString(displayString(input["table_label"])) > 60 {
		return errors.New("Las aclaraciones o la referencia de mesa son demasiado largas.")
	}
	return nil
}

func validatePublicOrderPaymentMethod(input, location map[string]any) error {
	method := strings.TrimSpace(displayString(input["on_delivery_method"]))
	if method == "" && strings.TrimSpace(displayString(input["fulfillment_type"])) == "dine_in" {
		return nil
	}
	for _, allowed := range publicOrderPaymentMethods(location) {
		if method == allowed {
			return nil
		}
	}
	return errors.New("Ese medio de pago no está habilitado. Actualizá los datos del local.")
}

func publicOrderCustomerName(mode, name, table string) string {
	if strings.TrimSpace(mode) == "dine_in" {
		return "Mesa " + strings.TrimSpace(table)
	}
	return strings.TrimSpace(name)
}

func publicOrderHash(input map[string]any) string {
	encoded, _ := json.Marshal(input)
	hash := sha256.Sum256(encoded)
	return hex.EncodeToString(hash[:])
}

// Orders, lines, stock reservation, tracking and the retry receipt commit together.
// In particular, a timed-out HTTP response must never create a second order.
func (a *application) createMarketplaceOrder(ctx context.Context, slug, body, sourceIP string) events.APIGatewayV2HTTPResponse {
	if len(body) > 64*1024 {
		return errorResponse(413, "El pedido es demasiado grande.")
	}
	var input map[string]any
	if decodeDataObject(body, &input) != nil {
		return errorResponse(400, "No pudimos leer el pedido.")
	}
	if err := validatePublicOrderContact(input); err != nil {
		return errorResponse(400, err.Error())
	}
	requestID := displayString(input["request_id"])
	if !publicOrderRequestPattern.MatchString(requestID) {
		return errorResponse(400, "Falta la referencia del pedido. Volvé a abrir el menú.")
	}
	location, err := a.marketplaceLocationBySlug(ctx, slug)
	if errors.Is(err, errNotFound) {
		return errorResponse(404, "El local no está disponible para pedidos online.")
	} else if err != nil {
		return dataAccessError(err)
	}
	orgID, locationID := location.orgID, displayString(location.row["id"])
	receiptID := locationID + "-" + requestID
	hash := publicOrderHash(input)
	if response, found := a.replayPublicOrder(ctx, orgID, receiptID, hash); found {
		return response
	}
	rateLimitNow := time.Now().UTC()
	allowed, limitErr := a.allowPublicOrder(ctx, locationID, sourceIP, rateLimitNow)
	if limitErr != nil {
		return dataAccessError(limitErr)
	}
	if !allowed {
		response := errorResponse(429, "Llegaron varios pedidos desde esta conexión. Esperá unos minutos y volvé a intentar.")
		retryAfter := int64(600) - rateLimitNow.Unix()%600
		response.Headers = map[string]string{"Retry-After": strconv.FormatInt(retryAfter, 10), "Cache-Control": "no-store"}
		return response
	}
	if !boolOr(location.row, "online_orders_enabled", true) {
		return errorResponse(422, "El local pausó los pedidos online.")
	}
	if err := validatePublicOrderPaymentMethod(input, location.row); err != nil {
		return errorResponse(422, err.Error())
	}
	method := strings.TrimSpace(displayString(input["on_delivery_method"]))
	catalog, err := a.queryDataRows(ctx, orgID, "items")
	if err != nil {
		return dataAccessError(err)
	}
	categories, err := a.queryDataRows(ctx, orgID, "categories")
	if err != nil {
		return dataAccessError(err)
	}
	activeCategories := map[string]bool{}
	for _, category := range categories {
		if displayString(category["location_id"]) == locationID && boolOr(category, "is_active", true) {
			activeCategories[displayString(category["id"])] = true
		}
	}
	publicCatalog := []map[string]any{}
	for _, item := range catalog {
		if activeCategories[displayString(item["category_id"])] {
			publicCatalog = append(publicCatalog, item)
		}
	}
	rate, inclusive, err := a.marketplaceTaxConfig(ctx, orgID, locationID, location.row)
	if err != nil {
		return dataAccessError(err)
	}
	now := time.Now().UTC()
	businessNow := marketplaceLocationTime(now, location.row)
	var zones []map[string]any
	if displayString(input["fulfillment_type"]) == "delivery" {
		zones, err = a.queryDataRows(ctx, orgID, "delivery_zones")
		if err != nil {
			return dataAccessError(err)
		}
	}
	quote, err := pricePublicOrder(input, location.row, publicCatalog, rate, inclusive, businessNow, zones)
	if err != nil {
		return errorResponse(409, err.Error())
	}
	currency := displayString(valueOr(location.row, "currency_code", location.row["default_currency_code"]))
	orderID, err := randomID()
	if err != nil {
		return dataAccessError(err)
	}
	customerID, err := randomID()
	if err != nil {
		return dataAccessError(err)
	}
	token, err := randomID()
	if err != nil {
		return dataAccessError(err)
	}
	orderNumber := "WEB-" + now.Format("060102") + "-" + strings.ToUpper(orderID[:8])
	mode := displayString(input["fulfillment_type"])
	customerName := publicOrderCustomerName(mode, displayString(input["customer_name"]), displayString(input["table_label"]))
	notes := strings.TrimSpace(displayString(input["notes"]))
	if mode == "dine_in" && strings.TrimSpace(displayString(input["table_label"])) != "" {
		notes = strings.TrimSpace("Mesa / referencia: " + strings.TrimSpace(displayString(input["table_label"])) + ". " + notes)
	}
	businessDate := now.Format("2006-01-02")
	if zone, err := time.LoadLocation(displayString(location.row["timezone"])); err == nil {
		businessDate = now.In(zone).Format("2006-01-02")
	}
	order := map[string]any{
		"id": orderID, "location_id": locationID, "customer_id": customerID,
		"customer_name": customerName, "customer_phone": strings.TrimSpace(displayString(input["customer_phone"])),
		"order_number": orderNumber, "order_type": mapMarketplaceFulfillment(mode), "fulfillment_type": mode,
		"status": "confirmed", "payment_status": "pending", "payment_method": method, "source": "web",
		"subtotal_cents": quote.subtotal, "tax_cents": quote.tax, "delivery_fee_cents": quote.delivery, "total_cents": quote.total,
		"gratuity_cents": quote.tip, "tax_rate": rate, "tax_inclusive": inclusive, "currency_code": currency,
		"notes": nullableString(notes), "table_label": nil, "delivery_address": nil,
		"business_date": businessDate, "estimated_prep_time": integerOr(location.row, "estimated_prep_time", 30),
	}
	if method == "eft" {
		// Keep a snapshot so later edits to the store's transfer destination do
		// not change where a customer is told to pay for an existing order.
		order["transfer_details"] = publicTransferDetails(location.row)
	}
	if mode == "delivery" {
		order["delivery_address"] = strings.TrimSpace(displayString(input["delivery_address"]))
		setDeliverySnapshot(order, quote.zone)
	}
	if mode == "dine_in" {
		order["table_label"] = nullableString(input["table_label"])
	}
	response := map[string]any{
		"order_id": orderID, "order_number": orderNumber, "status": "confirmed", "payment_method": method,
		"total": float64(quote.total) / float64(currencyScale(currency)), "total_cents": quote.total, "currency_code": currency,
		"tracking_token": token, "tracking_url": "/track/" + token,
	}
	writes := []types.TransactWriteItem{}
	add := func(table string, row map[string]any, original map[string]any) error {
		id := displayString(row["id"])
		if id == "" {
			var err error
			id, err = randomID()
			if err != nil {
				return err
			}
			row["id"] = id
		}
		row["organization_id"], row["updated_at"] = orgID, now.Format(time.RFC3339Nano)
		if row["created_at"] == nil {
			row["created_at"] = now.Format(time.RFC3339Nano)
		}
		item, err := jsonDataItem("ORG#"+orgID, "DATA#"+table+"#"+id, table, id, row)
		if err != nil {
			return err
		}
		put := &types.Put{TableName: aws.String(a.table), Item: item, ConditionExpression: aws.String("attribute_not_exists(PK)")}
		if original != nil {
			encoded, err := json.Marshal(original)
			if err != nil {
				return err
			}
			put.ConditionExpression = aws.String("#data = :previous")
			put.ExpressionAttributeNames = map[string]string{"#data": "data"}
			put.ExpressionAttributeValues = map[string]types.AttributeValue{":previous": &types.AttributeValueMemberS{Value: string(encoded)}}
		}
		writes = append(writes, types.TransactWriteItem{Put: put})
		return nil
	}
	rows := []struct {
		table string
		row   map[string]any
	}{
		{"orders", order},
		{"customers", map[string]any{"id": customerID, "first_name": order["customer_name"], "last_name": "", "whatsapp_number": order["customer_phone"], "location_id": locationID}},
		{"order_tracking_tokens", marketplaceTrackingTokenRow(token, orderID)},
		{"public_order_receipts", map[string]any{"id": receiptID, "request_hash": hash, "response": response}},
	}
	for _, row := range rows {
		if err := add(row.table, row.row, nil); err != nil {
			return dataAccessError(err)
		}
	}
	orderLines := []map[string]any{}
	for _, line := range quote.lines {
		item := line.item
		row := map[string]any{
			"order_id": orderID, "item_id": item["id"], "item_name": item["name"], "category_id": item["category_id"],
			"quantity": line.quantity, "unit_price_cents": line.unitCents, "total_price_cents": line.unitCents * line.quantity,
			"line_total_cents": line.unitCents * line.quantity, "special_instructions": nullableString(line.notes),
		}
		if err := add("order_items", row, nil); err != nil {
			return dataAccessError(err)
		}
		orderLines = append(orderLines, row)
		updated := cloneDataRow(item)
		sold := int64(0)
		if displayString(item["daily_counter_date"]) == businessNow.Format("2006-01-02") {
			sold, _ = integerValue(item["daily_sold_count"])
		}
		updated["daily_sold_count"], updated["daily_counter_date"] = sold+line.quantity, businessNow.Format("2006-01-02")
		if err := add("items", updated, item); err != nil {
			return dataAccessError(err)
		}
	}
	if err := a.preparePublicOrderKitchen(ctx, orgID, order, orderLines, now, add); err != nil {
		if errors.Is(err, errInsufficientInventory) {
			return errorResponse(409, "No hay stock suficiente para preparar el pedido. Actualizá el menú o consultá al local.")
		}
		if errors.Is(err, errInvalidData) {
			return errorResponse(409, "El local debe revisar la disponibilidad de sus productos antes de tomar pedidos.")
		}
		return dataAccessError(err)
	}
	if len(writes) > 100 {
		return errorResponse(422, "Este pedido necesita dividirse en pedidos más pequeños. Consultá al local.")
	}
	_, err = a.dynamo.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{TransactItems: writes})
	if err != nil {
		// A concurrent retry may have committed while this request was pricing.
		if response, found := a.replayPublicOrder(ctx, orgID, receiptID, hash); found {
			return response
		}
		var cancelled *types.TransactionCanceledException
		if errors.As(err, &cancelled) {
			return errorResponse(409, "La disponibilidad cambió mientras confirmabas. Actualizá el menú y reintentá.")
		}
		return dataAccessError(err)
	}
	return mustJSONResponse(201, response)
}

func (a *application) replayPublicOrder(ctx context.Context, orgID, receiptID, hash string) (events.APIGatewayV2HTTPResponse, bool) {
	receipt, err := a.dataRowByID(ctx, orgID, "public_order_receipts", receiptID)
	if errors.Is(err, errNotFound) {
		return events.APIGatewayV2HTTPResponse{}, false
	}
	if err != nil {
		return dataAccessError(err), true
	}
	if displayString(receipt["request_hash"]) != hash {
		return errorResponse(409, "La referencia ya pertenece a otro pedido. Volvé al menú para iniciar uno nuevo."), true
	}
	response, ok := receipt["response"].(map[string]any)
	if !ok {
		return errorResponse(500, "No pudimos recuperar el pedido."), true
	}
	return mustJSONResponse(200, response), true
}
