package main

import (
	"context"
	"fmt"
	"math"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/events"
)

const defaultInvoiceTolerance = 0.02

type inventoryRoute struct {
	name  string
	param string
}

func matchInventoryRoute(method, path string) (inventoryRoute, bool) {
	segments := strings.Split(strings.Trim(path, "/"), "/")
	switch {
	case method == "GET" && len(segments) == 2 && segments[0] == "inventory" && segments[1] == "auto-po-suggestions":
		return inventoryRoute{name: "auto_po"}, true
	case method == "POST" && len(segments) == 2 && segments[0] == "inventory" && segments[1] == "purchase-orders":
		return inventoryRoute{name: "po_create"}, true
	case method == "POST" && len(segments) == 4 && segments[0] == "inventory" && segments[1] == "purchase-orders" && segments[3] == "submit":
		return inventoryRoute{name: "po_submit", param: segments[2]}, true
	case method == "POST" && len(segments) == 4 && segments[0] == "inventory" && segments[1] == "goods-receipts" && segments[3] == "receive":
		return inventoryRoute{name: "grn_receive", param: segments[2]}, true
	case method == "POST" && len(segments) == 4 && segments[0] == "inventory" && segments[1] == "supplier-invoices" && segments[3] == "match":
		return inventoryRoute{name: "invoice_match", param: segments[2]}, true
	default:
		return inventoryRoute{}, false
	}
}

func (a *application) handleInventoryAPI(ctx context.Context, request events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, bool, error) {
	route, matched := matchInventoryRoute(request.RequestContext.HTTP.Method, request.RawPath)
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
	case "auto_po":
		response = a.autoPOSuggestions(ctx, orgID, request.RawQueryString)
	case "po_create":
		response = a.createPurchaseOrder(ctx, orgID, request.Body)
	case "po_submit":
		response = a.submitPurchaseOrder(ctx, orgID, route.param, request.Body)
	case "grn_receive":
		response = a.receiveGoodsReceipt(ctx, orgID, route.param)
	case "invoice_match":
		response = a.matchSupplierInvoice(ctx, orgID, route.param, request.Body)
	}
	return response, true, nil
}

func (a *application) createPurchaseOrder(ctx context.Context, orgID, body string) events.APIGatewayV2HTTPResponse {
	var input map[string]any
	if decodeDataObject(body, &input) != nil {
		return errorResponse(400, "invalid request body")
	}
	locationID := strings.TrimSpace(displayString(input["location_id"]))
	poNumber := strings.TrimSpace(displayString(input["po_number"]))
	if locationID == "" || poNumber == "" {
		return errorResponse(400, "location_id and po_number required")
	}
	location, err := a.dataRowByID(ctx, orgID, "locations", locationID)
	if err != nil {
		return errorResponse(404, "location not found")
	}
	supplierID := strings.TrimSpace(displayString(input["supplier_id"]))
	if supplierID != "" {
		if _, err := a.dataRowByID(ctx, orgID, "suppliers", supplierID); err != nil {
			return errorResponse(404, "supplier not found")
		}
	}
	existing, err := a.queryDataRows(ctx, orgID, "purchase_orders")
	if err != nil {
		return dataAccessError(err)
	}
	for _, row := range existing {
		if strings.EqualFold(displayString(row["po_number"]), poNumber) {
			return errorResponse(409, "po_number already exists")
		}
	}
	rawLines, ok := input["lines"].([]any)
	if !ok || len(rawLines) == 0 {
		return errorResponse(400, "at least one line item required")
	}
	lines := make([]map[string]any, 0, len(rawLines))
	var subtotal int64
	for index, raw := range rawLines {
		line, valid := raw.(map[string]any)
		if !valid {
			return errorResponse(400, fmt.Sprintf("line %d must be an object", index))
		}
		inventoryItemID := strings.TrimSpace(displayString(line["inventory_item_id"]))
		quantity, quantityOK := numericValue(line["ordered_quantity"])
		unit := strings.TrimSpace(displayString(line["ordered_unit"]))
		unitPrice, priceOK := integerValue(line["ordered_unit_price_cents"])
		if inventoryItemID == "" || !quantityOK || quantity <= 0 || unit == "" || !priceOK || unitPrice < 0 {
			return errorResponse(400, fmt.Sprintf("line %d has invalid inventory item, quantity, unit, or price", index))
		}
		inventoryItem, getErr := a.dataRowByID(ctx, orgID, "inventory_items", inventoryItemID)
		if getErr != nil || displayString(inventoryItem["location_id"]) != locationID {
			return errorResponse(400, fmt.Sprintf("line %d inventory item is invalid", index))
		}
		lineTotal := int64(math.Round(quantity * float64(unitPrice)))
		subtotal += lineTotal
		lines = append(lines, map[string]any{
			"inventory_item_id": inventoryItemID, "supplier_inventory_item_id": nullableString(line["supplier_inventory_item_id"]),
			"ordered_quantity": quantity, "ordered_unit": unit, "ordered_unit_price_cents": unitPrice,
			"line_total_cents": lineTotal, "notes": nullableString(line["notes"]),
		})
	}
	currency := strings.TrimSpace(displayString(input["currency"]))
	if currency == "" {
		currency = strings.TrimSpace(displayString(location["currency_code"]))
	}
	if currency == "" {
		return errorResponse(400, "currency required")
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	po, err := a.createStoredRow(ctx, orgID, "purchase_orders", map[string]any{
		"location_id": locationID, "supplier_id": nullableString(input["supplier_id"]), "po_number": poNumber,
		"status": "draft", "ordered_by": nil, "ordered_at": nil, "expected_delivery_date": nullableString(input["expected_delivery_date"]),
		"delivered_at": nil, "currency": currency, "subtotal_cents": subtotal, "tax_cents": int64(0),
		"shipping_cents": int64(0), "total_cents": subtotal, "notes": nullableString(input["notes"]), "updated_at": now,
	})
	if err != nil {
		return dataAccessError(err)
	}
	for _, line := range lines {
		line["purchase_order_id"] = po["id"]
		createdLine, err := a.createStoredRow(ctx, orgID, "purchase_order_items", line)
		if err != nil {
			for _, created := range lines {
				if id := displayString(created["id"]); id != "" {
					_ = a.deleteStoredRow(ctx, orgID, "purchase_order_items", id)
				}
			}
			_ = a.deleteStoredRow(ctx, orgID, "purchase_orders", displayString(po["id"]))
			return dataAccessError(err)
		}
		line["id"] = createdLine["id"]
	}
	return mustJSONResponse(201, po)
}

func (a *application) submitPurchaseOrder(ctx context.Context, orgID, poID, body string) events.APIGatewayV2HTTPResponse {
	po, err := a.dataRowByID(ctx, orgID, "purchase_orders", poID)
	if err != nil {
		return errorResponse(404, "purchase order not found")
	}
	if displayString(po["status"]) != "draft" {
		return errorResponse(409, "purchase order is not in draft status")
	}
	input := map[string]any{}
	if strings.TrimSpace(body) != "" && decodeDataObject(body, &input) != nil {
		return errorResponse(400, "invalid request body")
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	po["status"], po["ordered_at"], po["updated_at"] = "sent", now, now
	if err := a.putDataRow(ctx, orgID, "purchase_orders", po, false); err != nil {
		return dataAccessError(err)
	}
	if _, err := a.createStoredRow(ctx, orgID, "audit_log", map[string]any{
		"location_id": po["location_id"], "actor_type": "system", "actor_label": nullableString(input["actor_label"]),
		"action": "purchase_order.submitted", "entity_type": "purchase_order", "entity_id": poID,
		"before_state": map[string]any{"status": "draft"}, "after_state": map[string]any{"status": "sent"},
	}); err != nil {
		po["status"], po["ordered_at"], po["updated_at"] = "draft", nil, now
		_ = a.putDataRow(ctx, orgID, "purchase_orders", po, false)
		return dataAccessError(err)
	}
	return mustJSONResponse(200, po)
}

func (a *application) autoPOSuggestions(ctx context.Context, orgID, rawQuery string) events.APIGatewayV2HTTPResponse {
	query, err := url.ParseQuery(rawQuery)
	if err != nil {
		return errorResponse(400, "invalid query")
	}
	locationID := strings.TrimSpace(query.Get("location_id"))
	if locationID == "" {
		return errorResponse(400, "location_id query parameter required")
	}
	if _, err := a.dataRowByID(ctx, orgID, "locations", locationID); err != nil {
		return errorResponse(404, "location not found")
	}
	items, err := a.queryDataRows(ctx, orgID, "inventory_items")
	if err != nil {
		return dataAccessError(err)
	}
	links, err := a.queryDataRows(ctx, orgID, "supplier_inventory_items")
	if err != nil {
		return dataAccessError(err)
	}
	suppliers, err := a.queryDataRows(ctx, orgID, "suppliers")
	if err != nil {
		return dataAccessError(err)
	}
	supplierByID := map[string]map[string]any{}
	for _, supplier := range suppliers {
		if supplier["is_active"] != false {
			supplierByID[displayString(supplier["id"])] = supplier
		}
	}
	preferred := map[string]map[string]any{}
	for _, link := range links {
		if link["is_preferred"] == true && link["is_active"] != false {
			preferred[displayString(link["inventory_item_id"])] = link
		}
	}
	type suggestionGroup struct {
		supplierID, supplierName string
		lines                    []map[string]any
		total                    int64
	}
	groups := map[string]*suggestionGroup{}
	for _, item := range items {
		if displayString(item["location_id"]) != locationID {
			continue
		}
		current, currentOK := numericValue(item["current_stock"])
		minimum, minimumOK := numericValue(item["minimum_stock"])
		if !currentOK || !minimumOK || current >= minimum {
			continue
		}
		link := preferred[displayString(item["id"])]
		if link == nil {
			continue
		}
		supplierID := displayString(link["supplier_id"])
		supplier := supplierByID[supplierID]
		if supplier == nil {
			continue
		}
		quantity := minimum - current
		unit := displayString(link["pack_unit"])
		if unit == "" {
			unit = displayString(item["unit"])
		}
		unitPrice, _ := integerValue(link["last_price_per_pack_cents"])
		lineTotal := int64(math.Round(quantity * float64(unitPrice)))
		group := groups[supplierID]
		if group == nil {
			group = &suggestionGroup{supplierID: supplierID, supplierName: displayString(supplier["name"])}
			groups[supplierID] = group
		}
		group.lines = append(group.lines, map[string]any{
			"inventory_item_id": item["id"], "supplier_inventory_item_id": link["id"],
			"ordered_quantity": quantity, "ordered_unit": unit, "ordered_unit_price_cents": unitPrice,
		})
		group.total += lineTotal
	}
	keys := make([]string, 0, len(groups))
	for key := range groups {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	suggestions := make([]map[string]any, 0, len(keys))
	for _, key := range keys {
		group := groups[key]
		suggestions = append(suggestions, map[string]any{
			"location_id": locationID, "supplier_id": group.supplierID, "supplier_name": group.supplierName,
			"status": "draft", "lines": group.lines, "estimated_total_cents": group.total,
		})
	}
	return mustJSONResponse(200, map[string]any{"location_id": locationID, "suggestions": suggestions})
}

type receiptLine struct {
	receiptItem, purchaseItem, inventoryItem map[string]any
	quantity                                 float64
	unitPrice                                int64
}

func (a *application) receiveGoodsReceipt(ctx context.Context, orgID, receiptID string) events.APIGatewayV2HTTPResponse {
	receipt, err := a.dataRowByID(ctx, orgID, "goods_receipts", receiptID)
	if err != nil {
		return errorResponse(404, "GRN not found")
	}
	if displayString(receipt["received_at"]) != "" {
		return errorResponse(409, "GRN has already been received")
	}
	po, err := a.dataRowByID(ctx, orgID, "purchase_orders", displayString(receipt["purchase_order_id"]))
	if err != nil {
		return errorResponse(409, "purchase order not found")
	}
	allReceiptItems, err := a.queryDataRows(ctx, orgID, "goods_receipt_items")
	if err != nil {
		return dataAccessError(err)
	}
	prepared := make([]receiptLine, 0)
	for _, receiptItem := range allReceiptItems {
		if displayString(receiptItem["goods_receipt_id"]) != receiptID {
			continue
		}
		purchaseItem, getErr := a.dataRowByID(ctx, orgID, "purchase_order_items", displayString(receiptItem["purchase_order_item_id"]))
		if getErr != nil || displayString(purchaseItem["purchase_order_id"]) != displayString(po["id"]) {
			return errorResponse(409, "GRN line has an invalid purchase order item")
		}
		inventoryItem, getErr := a.dataRowByID(ctx, orgID, "inventory_items", displayString(purchaseItem["inventory_item_id"]))
		quantity, quantityOK := numericValue(receiptItem["quantity_received"])
		unitPrice, priceOK := integerValue(receiptItem["unit_price_cents"])
		if getErr != nil || !quantityOK || quantity <= 0 || !priceOK || unitPrice < 0 {
			return errorResponse(409, "GRN line is invalid")
		}
		prepared = append(prepared, receiptLine{receiptItem: receiptItem, purchaseItem: purchaseItem, inventoryItem: inventoryItem, quantity: quantity, unitPrice: unitPrice})
	}
	if len(prepared) == 0 {
		return errorResponse(409, "GRN has no line items")
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	for _, line := range prepared {
		currentStock, _ := numericValue(line.inventoryItem["current_stock"])
		currentCost, _ := numericValue(line.inventoryItem["cost_per_unit"])
		newStock := currentStock + line.quantity
		newCost := currentCost
		if newStock > 0 {
			newCost = (currentStock*currentCost + line.quantity*(float64(line.unitPrice)/100)) / newStock
		}
		line.inventoryItem["current_stock"], line.inventoryItem["cost_per_unit"], line.inventoryItem["updated_at"] = newStock, newCost, now
		if err := a.putDataRow(ctx, orgID, "inventory_items", line.inventoryItem, false); err != nil {
			return dataAccessError(err)
		}
		if linkedItemID := displayString(line.inventoryItem["link_to_item_id"]); linkedItemID != "" && currentStock <= 0 && newStock > 0 {
			if menuItem, getErr := a.dataRowByID(ctx, orgID, "items", linkedItemID); getErr == nil && menuItem["auto_86_when_inventory_empty"] == true {
				menuItem["is_86ed"], menuItem["updated_at"] = false, now
				if putErr := a.putDataRow(ctx, orgID, "items", menuItem, false); putErr != nil {
					return dataAccessError(putErr)
				}
			}
		}
		movement, err := a.createStoredRow(ctx, orgID, "stock_movements", map[string]any{
			"inventory_item_id": line.inventoryItem["id"], "movement_type": "purchase", "quantity": line.quantity,
			"unit_cost": newCost, "reference_id": receiptID, "notes": "GRN receive",
		})
		if err != nil {
			return dataAccessError(err)
		}
		line.receiptItem["stock_movement_id"], line.receiptItem["updated_at"] = movement["id"], now
		if err := a.putDataRow(ctx, orgID, "goods_receipt_items", line.receiptItem, false); err != nil {
			return dataAccessError(err)
		}
		_, err = a.createStoredRow(ctx, orgID, "ingredient_price_history", map[string]any{
			"inventory_item_id": line.inventoryItem["id"], "supplier_id": po["supplier_id"], "source_type": "goods_receipt",
			"goods_receipt_item_id": line.receiptItem["id"], "price_per_base_unit_cents": line.unitPrice, "effective_at": now,
		})
		if err != nil {
			return dataAccessError(err)
		}
	}
	receipt["received_at"], receipt["updated_at"] = now, now
	if err := a.putDataRow(ctx, orgID, "goods_receipts", receipt, false); err != nil {
		return dataAccessError(err)
	}
	return mustJSONResponse(200, map[string]any{"grn_id": receiptID, "lines_processed": len(prepared), "status": "received"})
}

type invoiceMatchLine struct {
	InvoiceLineID       string  `json:"invoice_line_id"`
	PurchaseOrderItemID *string `json:"purchase_order_item_id,omitempty"`
	InvoiceQty          float64 `json:"invoice_qty"`
	POQty               float64 `json:"po_qty"`
	GRNQty              float64 `json:"grn_qty"`
	InvoicePriceCents   int64   `json:"invoice_price_cents"`
	POPriceCents        int64   `json:"po_price_cents"`
	GRNPriceCents       int64   `json:"grn_price_cents"`
	QtyVariancePct      float64 `json:"qty_variance_pct"`
	PriceVariancePct    float64 `json:"price_variance_pct"`
	HasVariance         bool    `json:"has_variance"`
}

func calculateInvoiceMatch(lines []invoiceMatchLine, tolerance float64) (string, []invoiceMatchLine) {
	if tolerance <= 0 {
		tolerance = defaultInvoiceTolerance
	}
	hasQuantityVariance, hasPriceVariance := false, false
	for index := range lines {
		line := &lines[index]
		if line.POQty != 0 {
			line.QtyVariancePct = (line.InvoiceQty - line.POQty) / line.POQty
		}
		if line.POPriceCents != 0 {
			line.PriceVariancePct = float64(line.InvoicePriceCents-line.POPriceCents) / float64(line.POPriceCents)
		}
		quantityVariance := math.Abs(line.QtyVariancePct) > tolerance
		priceVariance := math.Abs(line.PriceVariancePct) > tolerance
		if line.PurchaseOrderItemID == nil || *line.PurchaseOrderItemID == "" {
			quantityVariance, priceVariance = true, true
		}
		line.HasVariance = quantityVariance || priceVariance
		hasQuantityVariance = hasQuantityVariance || quantityVariance
		hasPriceVariance = hasPriceVariance || priceVariance
	}
	if hasQuantityVariance {
		return "qty_variance", lines
	}
	if hasPriceVariance {
		return "price_variance", lines
	}
	return "matched", lines
}

func (a *application) matchSupplierInvoice(ctx context.Context, orgID, invoiceID, body string) events.APIGatewayV2HTTPResponse {
	invoice, err := a.dataRowByID(ctx, orgID, "supplier_invoices", invoiceID)
	if err != nil {
		return errorResponse(404, "supplier invoice not found")
	}
	tolerance := defaultInvoiceTolerance
	if strings.TrimSpace(body) != "" {
		input := map[string]any{}
		if decodeDataObject(body, &input) != nil {
			return errorResponse(400, "invalid request body")
		}
		if value, exists := input["tolerance_pct"]; exists {
			parsed, ok := numericValue(value)
			if !ok || parsed <= 0 || parsed > 1 {
				return errorResponse(400, "tolerance_pct must be greater than 0 and at most 1")
			}
			tolerance = parsed
		}
	}
	allLines, err := a.queryDataRows(ctx, orgID, "supplier_invoice_lines")
	if err != nil {
		return dataAccessError(err)
	}
	lines := make([]invoiceMatchLine, 0)
	for _, source := range allLines {
		if displayString(source["supplier_invoice_id"]) != invoiceID {
			continue
		}
		line := invoiceMatchLine{InvoiceLineID: displayString(source["id"])}
		line.InvoiceQty, _ = numericValue(source["quantity"])
		line.InvoicePriceCents, _ = integerValue(source["unit_price_cents"])
		poItemID := strings.TrimSpace(displayString(source["purchase_order_item_id"]))
		if poItemID != "" {
			if poItem, getErr := a.dataRowByID(ctx, orgID, "purchase_order_items", poItemID); getErr == nil {
				line.PurchaseOrderItemID = &poItemID
				line.POQty, _ = numericValue(poItem["ordered_quantity"])
				line.POPriceCents, _ = integerValue(poItem["ordered_unit_price_cents"])
			}
		}
		grnItemID := strings.TrimSpace(displayString(source["goods_receipt_item_id"]))
		if grnItemID != "" {
			if grnItem, getErr := a.dataRowByID(ctx, orgID, "goods_receipt_items", grnItemID); getErr == nil {
				line.GRNQty, _ = numericValue(grnItem["quantity_received"])
				line.GRNPriceCents, _ = integerValue(grnItem["unit_price_cents"])
			}
		}
		lines = append(lines, line)
	}
	status, matchedLines := calculateInvoiceMatch(lines, tolerance)
	invoice["match_status"], invoice["updated_at"] = status, time.Now().UTC().Format(time.RFC3339Nano)
	if err := a.putDataRow(ctx, orgID, "supplier_invoices", invoice, false); err != nil {
		return dataAccessError(err)
	}
	code := 200
	if status != "matched" {
		code = 422
	}
	return mustJSONResponse(code, map[string]any{"invoice_id": invoiceID, "match_status": status, "tolerance_pct": tolerance, "lines": matchedLines})
}
