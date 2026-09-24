package main

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/events"
)

type posCompletionRoute struct {
	name   string
	params []string
}

func matchPOSCompletionRoute(method, path string) (posCompletionRoute, bool) {
	segments := strings.Split(strings.Trim(path, "/"), "/")
	switch {
	case method == "GET" && len(segments) == 3 && segments[0] == "orders" && segments[2] == "receipt":
		return posCompletionRoute{name: "receipt", params: []string{segments[1]}}, true
	case method == "GET" && len(segments) == 3 && segments[0] == "orders" && segments[2] == "adjustments":
		return posCompletionRoute{name: "adjustments_list", params: []string{segments[1]}}, true
	case method == "POST" && len(segments) == 3 && segments[0] == "orders" && (segments[2] == "void" || segments[2] == "refund" || segments[2] == "mark-paid-on-delivery"):
		return posCompletionRoute{name: strings.ReplaceAll(segments[2], "-", "_"), params: []string{segments[1]}}, true
	case method == "POST" && len(segments) == 5 && segments[0] == "orders" && segments[2] == "items" && (segments[4] == "comp" || segments[4] == "price-override"):
		return posCompletionRoute{name: "item_" + strings.ReplaceAll(segments[4], "-", "_"), params: []string{segments[1], segments[3]}}, true
	case method == "GET" && len(segments) == 2 && segments[0] == "cash-out":
		return posCompletionRoute{name: "cash_out", params: []string{segments[1]}}, true
	default:
		return posCompletionRoute{}, false
	}
}

func (a *application) handlePOSCompletionAPI(ctx context.Context, request events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, bool, error) {
	route, matched := matchPOSCompletionRoute(request.RequestContext.HTTP.Method, request.RawPath)
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
	if strings.HasPrefix(route.name, "item_") || route.name == "void" || route.name == "refund" {
		if !a.isManager(ctx, claims.UserID, orgID) {
			return errorResponse(403, "manager role required"), true, nil
		}
	}

	var response events.APIGatewayV2HTTPResponse
	switch route.name {
	case "receipt":
		response = a.getPOSReceipt(ctx, orgID, route.params[0])
	case "adjustments_list":
		response = a.listPOSAdjustments(ctx, orgID, route.params[0])
	case "void", "refund":
		response = a.adjustPOSOrder(ctx, orgID, claims.UserID, route.params[0], "", route.name, request.Body)
	case "item_comp", "item_price_override":
		response = a.adjustPOSOrder(ctx, orgID, claims.UserID, route.params[0], route.params[1], strings.TrimPrefix(route.name, "item_"), request.Body)
	case "mark_paid_on_delivery":
		response = a.markPOSPaidOnDelivery(ctx, orgID, claims.UserID, route.params[0], request.Body)
	case "cash_out":
		response = a.getCashOutReport(ctx, orgID, route.params[0])
	}
	return response, true, nil
}

func (a *application) getPOSReceipt(ctx context.Context, orgID, orderID string) events.APIGatewayV2HTTPResponse {
	order, err := a.dataRowByID(ctx, orgID, "orders", orderID)
	if err != nil {
		return errorResponse(404, "order not found")
	}
	location, err := a.dataRowByID(ctx, orgID, "locations", displayString(order["location_id"]))
	if err != nil {
		return errorResponse(404, "location not found")
	}
	allItems, err := a.queryDataRows(ctx, orgID, "order_items")
	if err != nil {
		return dataAccessError(err)
	}
	menuItems, _ := a.queryDataRows(ctx, orgID, "items")
	menuItemByID := make(map[string]map[string]any, len(menuItems))
	for _, item := range menuItems {
		menuItemByID[fmt.Sprint(item["id"])] = item
	}
	allModifiers, _ := a.queryDataRows(ctx, orgID, "order_item_modifiers")
	modifiersByItemID := make(map[string][]map[string]any)
	for _, modifier := range allModifiers {
		itemID := fmt.Sprint(modifier["order_item_id"])
		modifiersByItemID[itemID] = append(modifiersByItemID[itemID], map[string]any{
			"name":                 valueOr(modifier, "name_snapshot", valueOr(modifier, "name", "")),
			"price_cents_snapshot": valueOr(modifier, "price_cents_snapshot", valueOr(modifier, "price_cents", 0)),
		})
	}
	lineItems := make([]map[string]any, 0)
	for _, item := range allItems {
		if fmt.Sprint(item["order_id"]) != orderID {
			continue
		}
		itemID := fmt.Sprint(item["id"])
		modifiers := receiptModifiers(item["modifiers"])
		modifiers = append(modifiers, modifiersByItemID[itemID]...)
		itemName := valueOr(item, "item_name", "")
		if displayString(itemName) == "" {
			itemName = valueOr(menuItemByID[fmt.Sprint(item["item_id"])], "name", "")
		}
		lineItems = append(lineItems, map[string]any{
			"order_item_id": item["id"], "item_name": itemName,
			"quantity": valueOr(item, "quantity", 0), "unit_price_cents": valueOr(item, "unit_price_cents", 0),
			"total_price_cents": valueOr(item, "line_total_cents", valueOr(item, "total_price_cents", 0)), "modifiers": modifiers,
		})
	}
	sort.Slice(lineItems, func(i, j int) bool {
		return fmt.Sprint(lineItems[i]["order_item_id"]) < fmt.Sprint(lineItems[j]["order_item_id"])
	})

	allPayments, err := a.queryDataRows(ctx, orgID, "order_payments")
	if err != nil {
		return dataAccessError(err)
	}
	payments := make([]map[string]any, 0)
	tipCents := int64(0)
	for _, payment := range allPayments {
		if fmt.Sprint(payment["order_id"]) != orderID {
			continue
		}
		tip, _ := integerValue(payment["tip_amount_cents"])
		tipCents += tip
		payments = append(payments, map[string]any{
			"payment_id": payment["id"], "method": valueOr(payment, "payment_method_code", ""),
			"amount_paid_cents": valueOr(payment, "amount_paid_cents", 0), "tip_amount_cents": tip,
			"change_given_cents": valueOr(payment, "change_given_cents", 0), "payment_reference": valueOr(payment, "payment_reference", nil),
			"paid_at": valueOr(payment, "paid_at", payment["created_at"]),
		})
	}
	sort.Slice(payments, func(i, j int) bool { return fmt.Sprint(payments[i]["paid_at"]) < fmt.Sprint(payments[j]["paid_at"]) })

	return mustJSONResponse(200, map[string]any{
		"store_name": valueOr(location, "name", ""), "store_address": locationAddress(location),
		"order_id": orderID, "order_number": valueOr(order, "order_number", ""), "created_at": order["created_at"],
		"line_items": lineItems, "subtotal_cents": valueOr(order, "subtotal_cents", valueOr(order, "subtotal_amount_cents", 0)), "tax_cents": valueOr(order, "tax_cents", valueOr(order, "tax_amount_cents", 0)),
		"tip_cents": tipCents, "total_cents": valueOr(order, "total_cents", valueOr(order, "total_amount_cents", 0)), "currency_code": valueOr(order, "currency_code", ""),
		"payments": payments, "fiscal_receipt_number": valueOr(order, "fiscal_receipt_number", nil),
	})
}

func receiptModifiers(raw any) []map[string]any {
	result := make([]map[string]any, 0)
	values, ok := raw.([]any)
	if !ok {
		return result
	}
	for _, value := range values {
		modifier, ok := value.(map[string]any)
		if !ok {
			continue
		}
		result = append(result, map[string]any{
			"name":                 valueOr(modifier, "name", valueOr(modifier, "name_snapshot", "")),
			"price_cents_snapshot": valueOr(modifier, "price_cents_snapshot", valueOr(modifier, "price_cents", 0)),
		})
	}
	return result
}

func locationAddress(location map[string]any) any {
	if address, ok := location["address"].(string); ok && strings.TrimSpace(address) != "" {
		return strings.TrimSpace(address)
	}
	parts := make([]string, 0, 4)
	for _, key := range []string{"address_line1", "address_line2", "city", "postal_code"} {
		if value := strings.TrimSpace(displayString(location[key])); value != "" && value != "<nil>" {
			parts = append(parts, value)
		}
	}
	if len(parts) == 0 {
		return nil
	}
	return strings.Join(parts, ", ")
}

func (a *application) listPOSAdjustments(ctx context.Context, orgID, orderID string) events.APIGatewayV2HTTPResponse {
	if _, err := a.dataRowByID(ctx, orgID, "orders", orderID); err != nil {
		return errorResponse(404, "order not found")
	}
	rows, err := a.queryDataRows(ctx, orgID, "order_adjustments")
	if err != nil {
		return dataAccessError(err)
	}
	result := make([]map[string]any, 0)
	for _, row := range rows {
		if fmt.Sprint(row["order_id"]) == orderID {
			result = append(result, row)
		}
	}
	sort.Slice(result, func(i, j int) bool { return fmt.Sprint(result[i]["created_at"]) > fmt.Sprint(result[j]["created_at"]) })
	return mustJSONResponse(200, result)
}

func (a *application) adjustPOSOrder(ctx context.Context, orgID, actorID, orderID, itemID, adjustmentType, body string) events.APIGatewayV2HTTPResponse {
	order, err := a.dataRowByID(ctx, orgID, "orders", orderID)
	if err != nil {
		return errorResponse(404, "order not found")
	}
	var input map[string]any
	if decodeDataObject(body, &input) != nil {
		return errorResponse(400, "invalid request body")
	}
	reason := strings.TrimSpace(displayString(input["reason_code"]))
	appliedBy := strings.TrimSpace(displayString(input["applied_by_staff_id"]))
	if appliedBy == "" {
		appliedBy = actorID
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	adjustment := map[string]any{
		"order_id": orderID, "order_item_id": nullableString(itemID), "adjustment_type": adjustmentType,
		"reason_id": nil, "reason_text": nullableString(reason), "amount_cents": int64(0), "original_amount_cents": nil,
		"applied_by": appliedBy, "approved_by": actorID, "approval_status": "approved", "approved_at": now,
	}

	switch adjustmentType {
	case "void":
		if fmt.Sprint(order["status"]) == "completed" || fmt.Sprint(order["payment_status"]) == "paid" {
			return errorResponse(409, "order already has a completed payment; use refund instead")
		}
		existing, queryErr := a.queryDataRows(ctx, orgID, "order_adjustments")
		if queryErr != nil {
			return dataAccessError(queryErr)
		}
		for _, row := range existing {
			if fmt.Sprint(row["order_id"]) == orderID && fmt.Sprint(row["adjustment_type"]) == "void" && fmt.Sprint(row["approval_status"]) != "rejected" {
				return errorResponse(409, "order already has an active void")
			}
		}
		order["status"], order["updated_at"] = "cancelled", now
		if err := a.putDataRow(ctx, orgID, "orders", order, false); err != nil {
			return dataAccessError(err)
		}
	case "refund":
		amount, ok := integerValue(input["amount_cents"])
		payments, queryErr := a.queryDataRows(ctx, orgID, "order_payments")
		if queryErr != nil {
			return dataAccessError(queryErr)
		}
		paid := int64(0)
		for _, payment := range payments {
			if fmt.Sprint(payment["order_id"]) == orderID && fmt.Sprint(payment["payment_status"]) == "completed" {
				value, _ := integerValue(payment["amount_paid_cents"])
				paid += value
			}
		}
		existing, queryErr := a.queryDataRows(ctx, orgID, "order_adjustments")
		if queryErr != nil {
			return dataAccessError(queryErr)
		}
		refunded := int64(0)
		for _, row := range existing {
			if fmt.Sprint(row["order_id"]) == orderID && fmt.Sprint(row["adjustment_type"]) == "refund" && fmt.Sprint(row["approval_status"]) != "rejected" {
				value, _ := integerValue(row["amount_cents"])
				refunded += value
			}
		}
		if !ok {
			// The current POS return flow represents a full refund and does not
			// send amount_cents. Keep partial refunds explicit while making that
			// existing flow settle the remaining refundable balance.
			amount = paid - refunded
		}
		if amount <= 0 {
			return errorResponse(400, "amount_cents must be greater than 0")
		}
		if amount > paid-refunded {
			return errorResponse(422, "refund amount exceeds the refundable balance for this order")
		}
		adjustment["amount_cents"] = amount
		if amount == paid-refunded {
			order["payment_status"] = "refunded"
		} else {
			order["payment_status"] = "partially_refunded"
		}
		order["updated_at"] = now
		if err := a.putDataRow(ctx, orgID, "orders", order, false); err != nil {
			return dataAccessError(err)
		}
	case "comp", "price_override":
		item, itemErr := a.dataRowByID(ctx, orgID, "order_items", itemID)
		if itemErr != nil || fmt.Sprint(item["order_id"]) != orderID {
			return errorResponse(404, "order item not found")
		}
		original, ok := integerValue(item["line_total_cents"])
		if !ok {
			original, _ = integerValue(item["total_price_cents"])
		}
		adjustment["original_amount_cents"] = original
		if adjustmentType == "comp" {
			if item["is_comped"] == true {
				return errorResponse(409, "order item is already comped")
			}
			adjustment["amount_cents"] = original
			item["is_comped"], item["line_total_cents"] = true, int64(0)
		} else {
			newPrice, ok := integerValue(input["new_price_cents"])
			if !ok || newPrice < 0 {
				return errorResponse(400, "new_price_cents must be >= 0")
			}
			quantity, _ := integerValue(item["quantity"])
			newTotal := newPrice * quantity
			adjustment["amount_cents"] = int64(math.Abs(float64(original - newTotal)))
			item["unit_price_cents"], item["line_total_cents"] = newPrice, newTotal
		}
		item["updated_at"] = now
		if err := a.putDataRow(ctx, orgID, "order_items", item, false); err != nil {
			return dataAccessError(err)
		}
		if response := a.recalculatePOSOrder(ctx, orgID, order); response.StatusCode != 0 {
			return response
		}
	default:
		return errorResponse(400, "unsupported adjustment")
	}

	created, err := a.createStoredRow(ctx, orgID, "order_adjustments", adjustment)
	if err != nil {
		return dataAccessError(err)
	}
	return mustJSONResponse(201, created)
}

func (a *application) recalculatePOSOrder(ctx context.Context, orgID string, order map[string]any) events.APIGatewayV2HTTPResponse {
	rows, err := a.queryDataRows(ctx, orgID, "order_items")
	if err != nil {
		return dataAccessError(err)
	}
	subtotal := int64(0)
	for _, row := range rows {
		if fmt.Sprint(row["order_id"]) == fmt.Sprint(order["id"]) {
			value, _ := integerValue(row["line_total_cents"])
			subtotal += value
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
	gratuity, _ := integerValue(order["gratuity_cents"])
	total += gratuity
	order["subtotal_cents"], order["tax_cents"], order["total_cents"] = subtotal, tax, total
	order["updated_at"] = time.Now().UTC().Format(time.RFC3339Nano)
	if err := a.putDataRow(ctx, orgID, "orders", order, false); err != nil {
		return dataAccessError(err)
	}
	return events.APIGatewayV2HTTPResponse{}
}

func (a *application) markPOSPaidOnDelivery(ctx context.Context, orgID, actorID, orderID, body string) events.APIGatewayV2HTTPResponse {
	order, err := a.dataRowByID(ctx, orgID, "orders", orderID)
	if err != nil {
		return errorResponse(404, "order not found")
	}
	if fmt.Sprint(order["status"]) != "pending_on_delivery" {
		return errorResponse(409, "order is not in pending_on_delivery status")
	}
	var input map[string]any
	if decodeDataObject(body, &input) != nil {
		return errorResponse(400, "invalid request body")
	}
	method := strings.TrimSpace(displayString(input["method"]))
	if method != "cash" && method != "card_machine" {
		return errorResponse(400, "method must be 'cash' or 'card_machine'")
	}
	amount, ok := integerValue(input["amount_received_cents"])
	if !ok || amount <= 0 {
		amount, ok = integerValue(valueOr(order, "total_cents", order["total_amount_cents"]))
	}
	if !ok || amount <= 0 {
		return errorResponse(400, "amount_received_cents must be > 0")
	}
	methodCode := "cash_on_delivery"
	if method == "card_machine" {
		methodCode = "card_on_delivery"
	}
	payment, err := a.createStoredRow(ctx, orgID, "order_payments", map[string]any{
		"order_id": orderID, "payment_method_code": methodCode, "amount_paid_cents": amount,
		"tip_amount_cents": int64(0), "change_given_cents": int64(0), "payment_reference": nil,
		"processed_by_staff_id": actorID, "payment_status": "completed", "paid_at": time.Now().UTC().Format(time.RFC3339Nano),
	})
	if err != nil {
		return dataAccessError(err)
	}
	if method == "cash" {
		if sessionID := displayString(order["register_session_id"]); sessionID != "" {
			_, _ = a.createStoredRow(ctx, orgID, "cash_drawer_session_payments", map[string]any{"cash_drawer_session_id": sessionID, "order_payment_id": payment["id"], "payment_id": payment["id"]})
		}
	}
	order["status"], order["payment_status"], order["payment_method"] = "completed", "paid", methodCode
	order["updated_at"] = time.Now().UTC().Format(time.RFC3339Nano)
	if err := a.putDataRow(ctx, orgID, "orders", order, false); err != nil {
		return dataAccessError(err)
	}
	return mustJSONResponse(200, map[string]any{"order_id": orderID, "payment_id": payment["id"], "status": "completed"})
}

func (a *application) getCashOutReport(ctx context.Context, orgID, sessionID string) events.APIGatewayV2HTTPResponse {
	session, err := a.dataRowByID(ctx, orgID, "cash_drawer_sessions", sessionID)
	if err != nil {
		return errorResponse(404, "cash drawer session not found")
	}
	drawer, err := a.dataRowByID(ctx, orgID, "cash_drawers", displayString(session["cash_drawer_id"]))
	if err != nil {
		return errorResponse(404, "cash drawer not found")
	}
	opening, _ := integerValue(session["opening_float_cents"])
	movementRows, err := a.queryDataRows(ctx, orgID, "cash_drawer_movements")
	if err != nil {
		return dataAccessError(err)
	}
	movements := make([]map[string]any, 0)
	movementsNet := int64(0)
	for _, movement := range movementRows {
		if fmt.Sprint(movement["cash_drawer_session_id"]) == sessionID {
			amount, _ := integerValue(movement["amount_cents"])
			movementsNet += amount
			movements = append(movements, movement)
		}
	}
	sort.Slice(movements, func(i, j int) bool {
		return fmt.Sprint(movements[i]["created_at"]) < fmt.Sprint(movements[j]["created_at"])
	})
	links, err := a.queryDataRows(ctx, orgID, "cash_drawer_session_payments")
	if err != nil {
		return dataAccessError(err)
	}
	payments, err := a.queryDataRows(ctx, orgID, "order_payments")
	if err != nil {
		return dataAccessError(err)
	}
	paymentByID := make(map[string]map[string]any, len(payments))
	for _, payment := range payments {
		paymentByID[fmt.Sprint(payment["id"])] = payment
	}
	cashSales := int64(0)
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
		if payment != nil && (method == "cash" || method == "cash_on_delivery") && fmt.Sprint(payment["payment_status"]) == "completed" {
			amount, _ := integerValue(payment["amount_paid_cents"])
			change, _ := integerValue(payment["change_given_cents"])
			cashSales += amount - change
		}
	}
	expected := opening + cashSales + movementsNet
	var counted any
	counts, err := a.queryDataRows(ctx, orgID, "cash_drawer_counts")
	if err != nil {
		return dataAccessError(err)
	}
	sort.Slice(counts, func(i, j int) bool { return fmt.Sprint(counts[i]["created_at"]) > fmt.Sprint(counts[j]["created_at"]) })
	for _, count := range counts {
		if fmt.Sprint(count["cash_drawer_session_id"]) == sessionID && fmt.Sprint(count["count_type"]) == "close" {
			counted, _ = integerValue(count["total_cents"])
			break
		}
	}
	var variance any
	isBalanced := false
	if counted != nil {
		variance = counted.(int64) - expected
		isBalanced = variance.(int64) >= 0
	}
	var staff any
	shifts, err := a.queryDataRows(ctx, orgID, "pos_shifts")
	if err != nil {
		return dataAccessError(err)
	}
	sort.Slice(shifts, func(i, j int) bool { return fmt.Sprint(shifts[i]["opened_at"]) > fmt.Sprint(shifts[j]["opened_at"]) })
	for _, shift := range shifts {
		if fmt.Sprint(shift["cash_drawer_session_id"]) == sessionID {
			staff = map[string]any{
				"shift_id": shift["id"], "staff_id": valueOr(shift, "opened_by", nil), "opened_at": shift["opened_at"],
				"closed_at": valueOr(shift, "closed_at", nil), "shift_notes": valueOr(shift, "notes", nil),
			}
			break
		}
	}
	return mustJSONResponse(200, map[string]any{
		"session_id": sessionID, "cash_drawer_id": session["cash_drawer_id"], "location_id": drawer["location_id"],
		"status": session["status"], "opened_at": session["opened_at"], "closed_at": valueOr(session, "closed_at", nil), "is_blind_close": valueOr(session, "is_blind_close", false),
		"opening_float_cents": opening, "cash_sales_cents": cashSales, "movements_net_cents": movementsNet,
		"expected_cash_cents": expected, "counted_cash_cents": counted, "variance_cents": variance, "is_balanced": isBalanced,
		"declared_closing_cents": valueOr(session, "declared_closing_cents", nil), "over_short_cents": valueOr(session, "over_short_cents", nil),
		"movements": movements, "staff": staff,
	})
}
