package main

import (
	"context"
	"crypto/rand"
	"errors"
	"math/big"
	"net/url"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"golang.org/x/crypto/bcrypt"
)

const giftCardAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

type customerBalanceRoute struct{ name, param string }

func matchCustomerBalanceRoute(method, path string) (customerBalanceRoute, bool) {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	switch {
	case len(parts) == 2 && parts[0] == "gift-cards" && method == "POST" && (parts[1] == "issue" || parts[1] == "redeem" || parts[1] == "reload" || parts[1] == "refund"):
		return customerBalanceRoute{name: "gift_" + parts[1]}, true
	case len(parts) == 2 && parts[0] == "gift-cards" && parts[1] == "lookup" && method == "GET":
		return customerBalanceRoute{name: "gift_lookup"}, true
	case len(parts) == 3 && parts[0] == "loyalty" && parts[1] == "stamps" && parts[2] == "config" && (method == "GET" || method == "PUT"):
		return customerBalanceRoute{name: "stamp_config_" + strings.ToLower(method)}, true
	case len(parts) == 3 && parts[0] == "customers" && parts[2] == "stamps" && method == "GET":
		return customerBalanceRoute{name: "stamps_get", param: parts[1]}, true
	case len(parts) == 4 && parts[0] == "customers" && parts[2] == "stamps" && parts[3] == "accrue" && method == "POST":
		return customerBalanceRoute{name: "stamps_accrue", param: parts[1]}, true
	default:
		return customerBalanceRoute{}, false
	}
}

func (a *application) handleCustomerBalanceAPI(ctx context.Context, request events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, bool, error) {
	route, matched := matchCustomerBalanceRoute(request.RequestContext.HTTP.Method, request.RawPath)
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
	case "gift_issue":
		response = a.issueGiftCard(ctx, claims.UserID, orgID, request.Body)
	case "gift_redeem", "gift_reload", "gift_refund":
		response = a.mutateGiftCard(ctx, orgID, strings.TrimPrefix(route.name, "gift_"), request.Body)
	case "gift_lookup":
		response = a.lookupGiftCard(ctx, orgID, request.RawQueryString)
	case "stamp_config_get":
		response = a.getStampConfig(ctx, orgID)
	case "stamp_config_put":
		response = a.putStampConfig(ctx, orgID, request.Body)
	case "stamps_get":
		response = a.getCustomerStamps(ctx, orgID, route.param)
	case "stamps_accrue":
		response = a.accrueCustomerStamps(ctx, orgID, route.param, request.Body)
	}
	return response, true, nil
}

func generateGiftCardCode() (string, error) {
	maximum := big.NewInt(int64(len(giftCardAlphabet)))
	buffer := make([]byte, 16)
	for i := range buffer {
		value, err := rand.Int(rand.Reader, maximum)
		if err != nil {
			return "", err
		}
		buffer[i] = giftCardAlphabet[value.Int64()]
	}
	return string(buffer), nil
}

func maskGiftCardCode(code string) string {
	code = strings.ToUpper(code)
	if len(code) <= 4 {
		return code
	}
	return strings.Repeat("*", len(code)-4) + code[len(code)-4:]
}

func (a *application) giftCardByCode(ctx context.Context, orgID, code string) (map[string]any, error) {
	cards, err := a.queryDataRows(ctx, orgID, "gift_cards")
	if err != nil {
		return nil, err
	}
	for _, card := range cards {
		if strings.EqualFold(displayString(card["code"]), strings.TrimSpace(code)) {
			return card, nil
		}
	}
	return nil, errNotFound
}

func (a *application) issueGiftCard(ctx context.Context, userID, orgID, body string) events.APIGatewayV2HTTPResponse {
	var input map[string]any
	if decodeDataObject(body, &input) != nil {
		return errorResponse(400, "invalid request body")
	}
	if displayString(input["organization_id"]) != orgID {
		return errorResponse(400, "organization_id is required and must match the active organization")
	}
	balance, ok := integerValue(input["initial_balance_cents"])
	if !ok || balance < 0 {
		return errorResponse(400, "initial_balance_cents must be >= 0")
	}
	cardType := strings.ToLower(displayString(input["card_type"]))
	if cardType == "" {
		cardType = "digital"
	}
	if cardType != "digital" && cardType != "physical" {
		return errorResponse(400, "card_type must be 'physical' or 'digital'")
	}
	expiresAt := nullableString(input["expires_at"])
	if expiresAt != nil {
		if _, err := time.Parse(time.RFC3339, displayString(expiresAt)); err != nil {
			return errorResponse(400, "expires_at must be RFC3339")
		}
	}
	currency := strings.ToUpper(displayString(input["currency"]))
	if currency == "" {
		organizations, err := a.organizationRows(ctx, userID)
		if err != nil {
			return dataAccessError(err)
		}
		for _, organization := range organizations {
			if displayString(organization["id"]) == orgID {
				currency = strings.ToUpper(displayString(organization["default_currency_code"]))
			}
		}
	}
	if len(currency) != 3 {
		return errorResponse(400, "organization has no valid default_currency_code")
	}
	requestedCode := strings.ToUpper(displayString(input["code"]))
	code := requestedCode
	for attempt := 0; attempt < 3; attempt++ {
		if code == "" {
			var err error
			code, err = generateGiftCardCode()
			if err != nil {
				return dataAccessError(err)
			}
		}
		if _, err := a.giftCardByCode(ctx, orgID, code); errors.Is(err, errNotFound) {
			break
		} else if err != nil {
			return dataAccessError(err)
		}
		if requestedCode != "" {
			return errorResponse(409, "gift card code already exists")
		}
		code = ""
	}
	if code == "" {
		return errorResponse(409, "gift card code collision")
	}
	var pinHash any
	if pin := displayString(input["pin"]); pin != "" {
		hash, err := bcrypt.GenerateFromPassword([]byte(pin), bcrypt.DefaultCost)
		if err != nil {
			return dataAccessError(err)
		}
		pinHash = string(hash)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	card, err := a.createStoredRow(ctx, orgID, "gift_cards", map[string]any{
		"code": code, "card_type": cardType, "pin_hash": pinHash, "initial_balance_cents": balance,
		"current_balance_cents": balance, "currency": currency, "status": "active",
		"issued_to_customer_id": nullableString(input["issued_to_customer_id"]), "issued_to_name": nullableString(input["issued_to_name"]),
		"issued_to_email": nullableString(input["issued_to_email"]), "issued_to_phone": nullableString(input["issued_to_phone"]),
		"issued_by_staff_id": nullableString(input["issued_by_staff_id"]), "expires_at": expiresAt,
		"activated_at": now, "last_redeemed_at": nil, "notes": nullableString(input["notes"]),
	})
	if err != nil {
		return dataAccessError(err)
	}
	if _, err := a.createStoredRow(ctx, orgID, "gift_card_transactions", map[string]any{
		"gift_card_id": card["id"], "txn_type": "issue", "amount_cents": balance, "balance_after_cents": balance,
		"performed_by_staff_id": nullableString(input["issued_by_staff_id"]), "notes": nullableString(input["notes"]),
	}); err != nil {
		_ = a.deleteStoredRow(ctx, orgID, "gift_cards", displayString(card["id"]))
		return dataAccessError(err)
	}
	return mustJSONResponse(201, map[string]any{"id": card["id"], "masked_code": maskGiftCardCode(code)})
}

func (a *application) mutateGiftCard(ctx context.Context, orgID, transactionType, body string) events.APIGatewayV2HTTPResponse {
	var input map[string]any
	if decodeDataObject(body, &input) != nil {
		return errorResponse(400, "invalid request body")
	}
	code := displayString(input["code"])
	amount, ok := integerValue(input["amount_cents"])
	if code == "" || !ok || amount <= 0 {
		return errorResponse(400, "code and amount_cents > 0 required")
	}
	card, err := a.giftCardByCode(ctx, orgID, code)
	if err != nil {
		return errorResponse(404, "gift card not found")
	}
	if expires := displayString(card["expires_at"]); expires != "" {
		if parsed, parseErr := time.Parse(time.RFC3339, expires); parseErr == nil && parsed.Before(time.Now()) {
			return errorResponse(422, "gift card has expired")
		}
	}
	if displayString(card["status"]) != "active" {
		return errorResponse(422, "gift card is not active")
	}
	balance, valid := integerValue(card["current_balance_cents"])
	if !valid {
		return errorResponse(409, "gift card balance is invalid")
	}
	ledgerAmount := amount
	if transactionType == "redeem" {
		if balance < amount {
			return errorResponse(422, "insufficient gift card balance")
		}
		ledgerAmount = -amount
	}
	newBalance := balance + ledgerAmount
	now := time.Now().UTC().Format(time.RFC3339Nano)
	card["current_balance_cents"], card["updated_at"] = newBalance, now
	if transactionType == "redeem" {
		card["last_redeemed_at"] = now
	}
	if err := a.putDataRow(ctx, orgID, "gift_cards", card, false); err != nil {
		return dataAccessError(err)
	}
	transaction, err := a.createStoredRow(ctx, orgID, "gift_card_transactions", map[string]any{
		"gift_card_id": card["id"], "txn_type": transactionType, "amount_cents": ledgerAmount,
		"balance_after_cents": newBalance, "order_id": nullableString(input["order_id"]), "payment_id": nullableString(input["payment_id"]),
		"performed_by_staff_id": nullableString(input["performed_by_staff_id"]), "notes": nullableString(input["notes"]),
	})
	if err != nil {
		card["current_balance_cents"] = balance
		_ = a.putDataRow(ctx, orgID, "gift_cards", card, false)
		return dataAccessError(err)
	}
	return mustJSONResponse(200, transaction)
}

func (a *application) lookupGiftCard(ctx context.Context, orgID, rawQuery string) events.APIGatewayV2HTTPResponse {
	values, err := url.ParseQuery(rawQuery)
	if err != nil {
		return errorResponse(400, "invalid query")
	}
	code := strings.TrimSpace(values.Get("code"))
	if code == "" {
		return errorResponse(400, "code query parameter is required")
	}
	card, err := a.giftCardByCode(ctx, orgID, code)
	if err != nil {
		return errorResponse(404, "gift card not found")
	}
	if hash := displayString(card["pin_hash"]); hash != "" {
		pin := values.Get("pin")
		if pin == "" || bcrypt.CompareHashAndPassword([]byte(hash), []byte(pin)) != nil {
			return errorResponse(401, "invalid PIN")
		}
	}
	return mustJSONResponse(200, map[string]any{
		"id": card["id"], "masked_code": maskGiftCardCode(code), "current_balance_cents": card["current_balance_cents"],
		"currency": card["currency"], "status": card["status"], "expires_at": card["expires_at"],
	})
}

func (a *application) stampConfig(ctx context.Context, orgID string) (map[string]any, error) {
	rows, err := a.queryDataRows(ctx, orgID, "loyalty_config")
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, errNotFound
	}
	return rows[0], nil
}

func stampConfigResponse(orgID string, config map[string]any) map[string]any {
	return map[string]any{
		"organization_id": orgID, "stamps_enabled": valueOr(config, "stamps_enabled", false),
		"stamps_required": valueOr(config, "stamps_required", 10), "stamp_item_id": valueOr(config, "stamp_item_id", nil),
		"updated_at": valueOr(config, "updated_at", time.Now().UTC().Format(time.RFC3339Nano)),
	}
}

func (a *application) getStampConfig(ctx context.Context, orgID string) events.APIGatewayV2HTTPResponse {
	config, err := a.stampConfig(ctx, orgID)
	if errors.Is(err, errNotFound) {
		config = map[string]any{}
	} else if err != nil {
		return dataAccessError(err)
	}
	return mustJSONResponse(200, stampConfigResponse(orgID, config))
}

func (a *application) putStampConfig(ctx context.Context, orgID, body string) events.APIGatewayV2HTTPResponse {
	var input map[string]any
	if decodeDataObject(body, &input) != nil {
		return errorResponse(400, "invalid request body")
	}
	required, ok := integerValue(input["stamps_required"])
	if !ok || required <= 0 {
		required = 10
	}
	enabled, _ := input["stamps_enabled"].(bool)
	if itemID := displayString(input["stamp_item_id"]); itemID != "" {
		if _, err := a.dataRowByID(ctx, orgID, "items", itemID); err != nil {
			return errorResponse(404, "stamp item not found")
		}
	}
	config, err := a.stampConfig(ctx, orgID)
	if err != nil {
		config = map[string]any{"id": orgID, "organization_id": orgID, "created_at": time.Now().UTC().Format(time.RFC3339Nano)}
	}
	config["stamps_enabled"], config["stamps_required"], config["stamp_item_id"] = enabled, required, nullableString(input["stamp_item_id"])
	config["updated_at"] = time.Now().UTC().Format(time.RFC3339Nano)
	if err := a.putDataRow(ctx, orgID, "loyalty_config", config, false); err != nil {
		return dataAccessError(err)
	}
	return mustJSONResponse(200, stampConfigResponse(orgID, config))
}

func (a *application) customerStampState(ctx context.Context, orgID, customerID string) (map[string]any, int64, error) {
	if _, err := a.dataRowByID(ctx, orgID, "customers", customerID); err != nil {
		return nil, 0, errNotFound
	}
	config, configErr := a.stampConfig(ctx, orgID)
	if configErr != nil && !errors.Is(configErr, errNotFound) {
		return nil, 0, configErr
	}
	required, ok := integerValue(config["stamps_required"])
	if !ok || required <= 0 {
		required = 10
	}
	rows, err := a.queryDataRows(ctx, orgID, "customer_loyalty_stamps")
	if err != nil {
		return nil, 0, err
	}
	for _, row := range rows {
		if displayString(row["customer_id"]) == customerID && displayString(row["location_id"]) == "" {
			return row, required, nil
		}
	}
	return nil, required, nil
}

func customerStampsResponse(orgID, customerID string, row map[string]any, required int64) map[string]any {
	stamps, _ := integerValue(row["stamps"])
	remaining := required - stamps
	if remaining < 0 {
		remaining = 0
	}
	return map[string]any{
		"customer_id": customerID, "organization_id": orgID, "location_id": valueOr(row, "location_id", nil),
		"stamps": stamps, "stamps_required": required, "stamps_until_free": remaining,
		"updated_at": valueOr(row, "updated_at", time.Now().UTC().Format(time.RFC3339Nano)),
	}
}

func (a *application) getCustomerStamps(ctx context.Context, orgID, customerID string) events.APIGatewayV2HTTPResponse {
	row, required, err := a.customerStampState(ctx, orgID, customerID)
	if errors.Is(err, errNotFound) {
		return errorResponse(404, "customer not found")
	} else if err != nil {
		return dataAccessError(err)
	}
	if row == nil {
		row = map[string]any{}
	}
	return mustJSONResponse(200, customerStampsResponse(orgID, customerID, row, required))
}

func (a *application) accrueCustomerStamps(ctx context.Context, orgID, customerID, body string) events.APIGatewayV2HTTPResponse {
	input := map[string]any{}
	if strings.TrimSpace(body) != "" && decodeDataObject(body, &input) != nil {
		return errorResponse(400, "invalid request body")
	}
	count := int64(1)
	if value, exists := input["count"]; exists {
		parsed, ok := integerValue(value)
		if !ok || parsed <= 0 {
			return errorResponse(400, "count must be > 0")
		}
		count = parsed
	}
	row, required, err := a.customerStampState(ctx, orgID, customerID)
	if errors.Is(err, errNotFound) {
		return errorResponse(404, "customer not found")
	} else if err != nil {
		return dataAccessError(err)
	}
	if row == nil {
		var createErr error
		row, createErr = a.createStoredRow(ctx, orgID, "customer_loyalty_stamps", map[string]any{
			"customer_id": customerID, "location_id": nil, "stamps": int64(0),
		})
		if createErr != nil {
			return dataAccessError(createErr)
		}
	}
	stamps, _ := integerValue(row["stamps"])
	stamps += count
	rewardEarned := stamps >= required
	if rewardEarned {
		stamps = 0
	}
	row["stamps"], row["updated_at"] = stamps, time.Now().UTC().Format(time.RFC3339Nano)
	if err := a.putDataRow(ctx, orgID, "customer_loyalty_stamps", row, false); err != nil {
		return dataAccessError(err)
	}
	response := customerStampsResponse(orgID, customerID, row, required)
	response["reward_earned"] = rewardEarned
	return mustJSONResponse(201, response)
}
