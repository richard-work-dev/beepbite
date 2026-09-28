package main

import (
	"context"
	"fmt"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/events"
)

const inventoryCountEpsilon = 0.000001

func validBusinessDate(value string) bool {
	if len(value) != 10 {
		return false
	}
	parsed, err := time.Parse("2006-01-02", value)
	return err == nil && parsed.Format("2006-01-02") == value
}

func parseInventoryCountLines(raw any) (map[string]float64, error) {
	values, ok := raw.([]any)
	if !ok || len(values) == 0 {
		return nil, fmt.Errorf("se requiere el conteo de todos los insumos")
	}
	result := make(map[string]float64, len(values))
	for index, value := range values {
		line, ok := value.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("el conteo %d tiene un formato inválido", index+1)
		}
		itemID := strings.TrimSpace(displayString(line["inventory_item_id"]))
		quantity, valid := numericValue(line["counted_quantity"])
		if itemID == "" || !valid || quantity < 0 {
			return nil, fmt.Errorf("el conteo %d necesita un insumo y una cantidad válida", index+1)
		}
		if _, duplicate := result[itemID]; duplicate {
			return nil, fmt.Errorf("el insumo del conteo %d está repetido", index+1)
		}
		result[itemID] = quantity
	}
	return result, nil
}

func (a *application) listDailyInventoryCounts(ctx context.Context, orgID, rawQuery string) events.APIGatewayV2HTTPResponse {
	query, err := parseRequiredLocationQuery(rawQuery)
	if err != nil {
		return errorResponse(400, err.Error())
	}
	locationID := query
	if _, err := a.dataRowByID(ctx, orgID, "locations", locationID); err != nil {
		return errorResponse(404, "local no encontrado")
	}

	items, err := a.inventoryItemsForLocation(ctx, orgID, locationID, false)
	if err != nil {
		return dataAccessError(err)
	}
	itemSummaries := make([]map[string]any, 0, len(items))
	for _, item := range items {
		itemSummaries = append(itemSummaries, map[string]any{
			"id": item["id"], "name": valueOr(item, "name", "Insumo"),
			"unit": valueOr(item, "unit", "unidad"), "current_stock": item["current_stock"],
			"minimum_stock": item["minimum_stock"],
		})
	}

	sessions, err := a.queryDataRows(ctx, orgID, "inventory_count_sessions")
	if err != nil {
		return dataAccessError(err)
	}
	allLines, err := a.queryDataRows(ctx, orgID, "inventory_count_lines")
	if err != nil {
		return dataAccessError(err)
	}
	linesBySession := map[string][]map[string]any{}
	for _, line := range allLines {
		linesBySession[displayString(line["session_id"])] = append(linesBySession[displayString(line["session_id"])], line)
	}
	result := make([]map[string]any, 0)
	for _, session := range sessions {
		if displayString(session["location_id"]) != locationID {
			continue
		}
		copy := make(map[string]any, len(session)+1)
		for key, value := range session {
			copy[key] = value
		}
		lines := linesBySession[displayString(session["id"])]
		sort.SliceStable(lines, func(i, j int) bool {
			return strings.ToLower(displayString(lines[i]["item_name"])) < strings.ToLower(displayString(lines[j]["item_name"]))
		})
		copy["lines"] = lines
		result = append(result, copy)
	}
	sort.SliceStable(result, func(i, j int) bool {
		left, right := displayString(result[i]["business_date"]), displayString(result[j]["business_date"])
		if left == right {
			return displayString(result[i]["created_at"]) > displayString(result[j]["created_at"])
		}
		return left > right
	})
	return mustJSONResponse(200, map[string]any{"inventory_items": itemSummaries, "sessions": result})
}

func parseRequiredLocationQuery(rawQuery string) (string, error) {
	query, err := urlParseQuery(rawQuery)
	if err != nil {
		return "", fmt.Errorf("consulta inválida")
	}
	locationID := strings.TrimSpace(query["location_id"])
	if locationID == "" {
		return "", fmt.Errorf("se requiere location_id")
	}
	return locationID, nil
}

// urlParseQuery keeps query parsing in one small helper that is straightforward
// to exercise without coupling the count workflow to an HTTP framework type.
func urlParseQuery(rawQuery string) (map[string]string, error) {
	values, err := url.ParseQuery(rawQuery)
	if err != nil {
		return nil, err
	}
	result := make(map[string]string, len(values))
	for key := range values {
		result[key] = values.Get(key)
	}
	return result, nil
}

func (a *application) inventoryItemsForLocation(ctx context.Context, orgID, locationID string, includeInactive bool) ([]map[string]any, error) {
	allItems, err := a.queryDataRows(ctx, orgID, "inventory_items")
	if err != nil {
		return nil, err
	}
	items := make([]map[string]any, 0)
	for _, item := range allItems {
		if displayString(item["location_id"]) == locationID && (includeInactive || item["is_active"] != false) {
			items = append(items, item)
		}
	}
	sort.SliceStable(items, func(i, j int) bool {
		return strings.ToLower(displayString(items[i]["name"])) < strings.ToLower(displayString(items[j]["name"]))
	})
	return items, nil
}

func (a *application) openDailyInventoryCount(ctx context.Context, orgID, actorID, body string) events.APIGatewayV2HTTPResponse {
	input := map[string]any{}
	if decodeDataObject(body, &input) != nil {
		return errorResponse(400, "cuerpo de solicitud inválido")
	}
	locationID := strings.TrimSpace(displayString(input["location_id"]))
	businessDate := strings.TrimSpace(displayString(input["business_date"]))
	if locationID == "" || !validBusinessDate(businessDate) {
		return errorResponse(400, "el local y la fecha operativa son obligatorios")
	}
	if _, err := a.dataRowByID(ctx, orgID, "locations", locationID); err != nil {
		return errorResponse(404, "local no encontrado")
	}
	counts, err := parseInventoryCountLines(input["lines"])
	if err != nil {
		return errorResponse(400, err.Error())
	}
	sessions, err := a.queryDataRows(ctx, orgID, "inventory_count_sessions")
	if err != nil {
		return dataAccessError(err)
	}
	for _, session := range sessions {
		if displayString(session["location_id"]) != locationID {
			continue
		}
		if displayString(session["status"]) != "closed" {
			return errorResponse(409, "ya existe una jornada de inventario abierta para este local")
		}
		if displayString(session["business_date"]) == businessDate {
			return errorResponse(409, "el inventario de esta fecha ya fue cerrado")
		}
	}
	items, err := a.inventoryItemsForLocation(ctx, orgID, locationID, false)
	if err != nil {
		return dataAccessError(err)
	}
	if len(items) == 0 {
		return errorResponse(409, "no hay insumos configurados para contar")
	}
	if len(counts) != len(items) {
		return errorResponse(400, "debés registrar el conteo de todos los insumos")
	}
	for _, item := range items {
		if _, found := counts[displayString(item["id"])]; !found {
			return errorResponse(400, "el conteo no incluye todos los insumos del local")
		}
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
	sessionID := locationID + "-" + businessDate
	session := map[string]any{
		"id": sessionID, "organization_id": orgID, "location_id": locationID,
		"business_date": businessDate, "status": "open", "opened_by": actorID, "opened_at": now,
		"closed_by": nil, "closed_at": nil, "opening_notes": nullableString(input["notes"]),
		"closing_notes": nil, "opening_variance_count": 0, "closing_variance_count": 0,
		"created_at": now, "updated_at": now,
	}
	if err := a.putDataRow(ctx, orgID, "inventory_count_sessions", session, true); err != nil {
		return errorResponse(409, "la jornada de inventario ya existe")
	}
	lines := make([]map[string]any, 0, len(items))
	varianceCount := 0
	for _, item := range items {
		itemID := displayString(item["id"])
		systemQuantity, _ := numericValue(item["current_stock"])
		countedQuantity := counts[itemID]
		variance := countedQuantity - systemQuantity
		line, createErr := a.createStoredRow(ctx, orgID, "inventory_count_lines", map[string]any{
			"session_id": sessionID, "inventory_item_id": itemID,
			"item_name": valueOr(item, "name", "Insumo"), "unit": valueOr(item, "unit", "unidad"),
			"system_opening_quantity": systemQuantity, "opening_quantity": countedQuantity,
			"opening_variance": variance, "expected_closing_quantity": nil, "closing_quantity": nil,
			"closing_variance": nil, "opening_movement_id": nil, "closing_movement_id": nil,
		})
		if createErr != nil {
			return dataAccessError(createErr)
		}
		if absInventoryVariance(variance) > inventoryCountEpsilon {
			varianceCount++
			movement, adjustErr := a.applyInventoryCountAdjustment(ctx, orgID, actorID, item, sessionID, "opening_count", systemQuantity, countedQuantity)
			if adjustErr != nil {
				return dataAccessError(adjustErr)
			}
			line["opening_movement_id"] = movement["id"]
			line["updated_at"] = now
			if err := a.putDataRow(ctx, orgID, "inventory_count_lines", line, false); err != nil {
				return dataAccessError(err)
			}
		}
		lines = append(lines, line)
	}
	session["opening_variance_count"], session["updated_at"] = varianceCount, now
	if err := a.putDataRow(ctx, orgID, "inventory_count_sessions", session, false); err != nil {
		return dataAccessError(err)
	}
	session["lines"] = lines
	return mustJSONResponse(201, session)
}

func (a *application) closeDailyInventoryCount(ctx context.Context, orgID, actorID, sessionID, body string) events.APIGatewayV2HTTPResponse {
	session, err := a.dataRowByID(ctx, orgID, "inventory_count_sessions", sessionID)
	if err != nil {
		return errorResponse(404, "jornada de inventario no encontrada")
	}
	if displayString(session["status"]) != "open" {
		return errorResponse(409, "la jornada de inventario ya está cerrada")
	}
	input := map[string]any{}
	if decodeDataObject(body, &input) != nil {
		return errorResponse(400, "cuerpo de solicitud inválido")
	}
	counts, err := parseInventoryCountLines(input["lines"])
	if err != nil {
		return errorResponse(400, err.Error())
	}
	allLines, err := a.queryDataRows(ctx, orgID, "inventory_count_lines")
	if err != nil {
		return dataAccessError(err)
	}
	lines := make([]map[string]any, 0)
	for _, line := range allLines {
		if displayString(line["session_id"]) == sessionID {
			lines = append(lines, line)
		}
	}
	if len(lines) == 0 || len(counts) != len(lines) {
		return errorResponse(400, "debés registrar el conteo de todos los insumos")
	}
	items, err := a.inventoryItemsForLocation(ctx, orgID, displayString(session["location_id"]), true)
	if err != nil {
		return dataAccessError(err)
	}
	itemByID := make(map[string]map[string]any, len(items))
	for _, item := range items {
		itemByID[displayString(item["id"])] = item
	}
	for _, line := range lines {
		itemID := displayString(line["inventory_item_id"])
		if _, found := counts[itemID]; !found || itemByID[itemID] == nil {
			return errorResponse(400, "el conteo final no coincide con los insumos de la apertura")
		}
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
	varianceCount := 0
	for _, line := range lines {
		itemID := displayString(line["inventory_item_id"])
		if displayString(line["counted_at"]) != "" {
			previousCount, countOK := numericValue(line["closing_quantity"])
			if !countOK || absInventoryVariance(previousCount-counts[itemID]) > inventoryCountEpsilon {
				return errorResponse(409, "el cierre ya fue procesado parcialmente con otro conteo")
			}
			previousVariance, _ := numericValue(line["closing_variance"])
			if absInventoryVariance(previousVariance) > inventoryCountEpsilon {
				varianceCount++
			}
			continue
		}
		item := itemByID[itemID]
		expected, _ := numericValue(item["current_stock"])
		counted := counts[itemID]
		variance := counted - expected
		line["expected_closing_quantity"], line["closing_quantity"], line["closing_variance"] = expected, counted, variance
		line["counted_at"], line["counted_by"], line["updated_at"] = now, actorID, now
		if absInventoryVariance(variance) > inventoryCountEpsilon {
			varianceCount++
			movement, adjustErr := a.applyInventoryCountAdjustment(ctx, orgID, actorID, item, sessionID, "closing_count", expected, counted)
			if adjustErr != nil {
				return dataAccessError(adjustErr)
			}
			line["closing_movement_id"] = movement["id"]
		}
		if err := a.putDataRow(ctx, orgID, "inventory_count_lines", line, false); err != nil {
			return dataAccessError(err)
		}
	}
	session["status"], session["closed_by"], session["closed_at"] = "closed", actorID, now
	session["closing_notes"], session["closing_variance_count"], session["updated_at"] = nullableString(input["notes"]), varianceCount, now
	if err := a.putDataRow(ctx, orgID, "inventory_count_sessions", session, false); err != nil {
		return dataAccessError(err)
	}
	session["lines"] = lines
	return mustJSONResponse(200, session)
}

func (a *application) applyInventoryCountAdjustment(ctx context.Context, orgID, actorID string, item map[string]any, sessionID, movementType string, before, after float64) (map[string]any, error) {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	item["current_stock"], item["updated_at"] = after, now
	if err := a.putDataRow(ctx, orgID, "inventory_items", item, false); err != nil {
		return nil, err
	}
	if err := a.syncInventoryMenuAvailability(ctx, orgID, item, before, after, now); err != nil {
		return nil, err
	}
	return a.createStoredRow(ctx, orgID, "stock_movements", map[string]any{
		"inventory_item_id": item["id"], "movement_type": movementType,
		"quantity": after - before, "balance_before": before, "balance_after": after,
		"reference_id": sessionID, "performed_by": actorID, "notes": "Conteo diario de inventario",
	})
}

func (a *application) syncInventoryMenuAvailability(ctx context.Context, orgID string, inventoryItem map[string]any, before, after float64, now string) error {
	if absInventoryVariance(before-after) < 0.0000001 {
		return nil
	}
	return a.syncMenuAvailabilityForInventoryItem(ctx, orgID, inventoryItem, now)
}

func absInventoryVariance(value float64) float64 {
	if value < 0 {
		return -value
	}
	return value
}
