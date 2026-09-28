package main

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

const maxInventoryRecipeComponents = 40

var errInsufficientInventory = errors.New("insufficient inventory")

type inventoryRequirement struct {
	InventoryItemID string
	Quantity        float64
}

func (a *application) listInventoryRecipes(ctx context.Context, orgID, rawQuery string) events.APIGatewayV2HTTPResponse {
	values, err := url.ParseQuery(rawQuery)
	if err != nil {
		return errorResponse(400, "consulta inválida")
	}
	locationID := strings.TrimSpace(values.Get("location_id"))
	if locationID == "" {
		return errorResponse(400, "se requiere location_id")
	}
	if location, getErr := a.dataRowByID(ctx, orgID, "locations", locationID); getErr != nil || displayString(location["id"]) == "" {
		return errorResponse(404, "local no encontrado")
	}
	menuItems, err := a.queryDataRows(ctx, orgID, "items")
	if err != nil {
		return dataAccessError(err)
	}
	inventoryItems, err := a.inventoryItemsForLocation(ctx, orgID, locationID, true)
	if err != nil {
		return dataAccessError(err)
	}
	components, err := a.queryDataRows(ctx, orgID, "inventory_recipe_items")
	if err != nil {
		return dataAccessError(err)
	}
	filteredMenu := make([]map[string]any, 0)
	for _, item := range menuItems {
		if displayString(item["location_id"]) == locationID && item["is_active"] != false {
			filteredMenu = append(filteredMenu, item)
		}
	}
	filteredComponents := make([]map[string]any, 0)
	for _, component := range components {
		if displayString(component["location_id"]) == locationID && component["is_active"] != false {
			filteredComponents = append(filteredComponents, component)
		}
	}
	sort.Slice(filteredMenu, func(i, j int) bool {
		return displayString(filteredMenu[i]["name"]) < displayString(filteredMenu[j]["name"])
	})
	sort.Slice(inventoryItems, func(i, j int) bool {
		return displayString(inventoryItems[i]["name"]) < displayString(inventoryItems[j]["name"])
	})
	return mustJSONResponse(200, map[string]any{
		"menu_items": filteredMenu, "inventory_items": inventoryItems, "components": filteredComponents,
	})
}

func parseInventoryRecipeComponents(raw any) (map[string]float64, error) {
	values, ok := raw.([]any)
	if !ok {
		return nil, fmt.Errorf("los insumos deben enviarse como una lista")
	}
	if len(values) > maxInventoryRecipeComponents {
		return nil, fmt.Errorf("una receta admite hasta %d insumos", maxInventoryRecipeComponents)
	}
	result := make(map[string]float64, len(values))
	for _, value := range values {
		component, valid := value.(map[string]any)
		if !valid {
			return nil, fmt.Errorf("cada insumo debe ser un objeto")
		}
		inventoryItemID := strings.TrimSpace(displayString(component["inventory_item_id"]))
		quantity, quantityOK := numericValue(component["quantity"])
		if inventoryItemID == "" || !quantityOK || quantity <= 0 || math.IsNaN(quantity) || math.IsInf(quantity, 0) {
			return nil, fmt.Errorf("cada insumo requiere identificador y una cantidad mayor que cero")
		}
		if _, duplicate := result[inventoryItemID]; duplicate {
			return nil, fmt.Errorf("la receta contiene insumos repetidos")
		}
		result[inventoryItemID] = roundInventoryQuantity(quantity)
	}
	return result, nil
}

func (a *application) replaceInventoryRecipe(ctx context.Context, orgID, actorID, menuItemID, body string) events.APIGatewayV2HTTPResponse {
	var input map[string]any
	if decodeDataObject(body, &input) != nil {
		return errorResponse(400, "cuerpo de solicitud inválido")
	}
	locationID := strings.TrimSpace(displayString(input["location_id"]))
	if locationID == "" {
		return errorResponse(400, "se requiere el local")
	}
	menuItem, err := a.dataRowByID(ctx, orgID, "items", menuItemID)
	if err != nil || displayString(menuItem["location_id"]) != locationID {
		return errorResponse(404, "producto del menú no encontrado")
	}
	quantities, err := parseInventoryRecipeComponents(input["components"])
	if err != nil {
		return errorResponse(400, err.Error())
	}
	inventoryItems, err := a.inventoryItemsForLocation(ctx, orgID, locationID, true)
	if err != nil {
		return dataAccessError(err)
	}
	itemsByID := make(map[string]map[string]any, len(inventoryItems))
	for _, item := range inventoryItems {
		itemsByID[displayString(item["id"])] = item
	}
	for inventoryItemID := range quantities {
		item := itemsByID[inventoryItemID]
		if item == nil || item["is_active"] == false {
			return errorResponse(409, "la receta contiene un insumo inexistente o inactivo")
		}
	}
	existing, err := a.queryDataRows(ctx, orgID, "inventory_recipe_items")
	if err != nil {
		return dataAccessError(err)
	}
	transaction := make([]types.TransactWriteItem, 0, len(existing)+len(quantities)+1)
	desiredIDs := make(map[string]bool, len(quantities))
	for inventoryItemID := range quantities {
		desiredIDs[menuItemID+"#"+inventoryItemID] = true
	}
	for _, component := range existing {
		if displayString(component["menu_item_id"]) == menuItemID && !desiredIDs[displayString(component["id"])] {
			transaction = append(transaction, types.TransactWriteItem{Delete: &types.Delete{
				TableName: aws.String(a.table), Key: dataRowKey(orgID, "inventory_recipe_items", displayString(component["id"])),
			}})
		}
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	created := make([]map[string]any, 0, len(quantities))
	for inventoryItemID, quantity := range quantities {
		row := map[string]any{
			"id": menuItemID + "#" + inventoryItemID, "organization_id": orgID, "location_id": locationID,
			"menu_item_id": menuItemID, "inventory_item_id": inventoryItemID, "quantity": quantity,
			"is_active": true, "created_by": actorID, "created_at": now, "updated_at": now,
		}
		item, itemErr := jsonDataItem("ORG#"+orgID, "DATA#inventory_recipe_items#"+displayString(row["id"]), "inventory_recipe_items", displayString(row["id"]), row)
		if itemErr != nil {
			return dataAccessError(itemErr)
		}
		transaction = append(transaction, types.TransactWriteItem{Put: &types.Put{TableName: aws.String(a.table), Item: item}})
		created = append(created, row)
	}
	if len(quantities) == 0 && menuItem["inventory_86ed"] == true {
		menuItem["is_86ed"], menuItem["inventory_86ed"] = false, false
	}
	menuItem["auto_86_when_inventory_empty"] = len(quantities) > 0
	menuItem["updated_at"] = now
	menuData, err := jsonDataItem("ORG#"+orgID, "DATA#items#"+menuItemID, "items", menuItemID, menuItem)
	if err != nil {
		return dataAccessError(err)
	}
	transaction = append(transaction, types.TransactWriteItem{Put: &types.Put{TableName: aws.String(a.table), Item: menuData}})
	if len(transaction) > 100 {
		return errorResponse(409, "la receta tiene demasiados cambios; guardá una versión más pequeña")
	}
	if _, err = a.dynamo.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{TransactItems: transaction}); err != nil {
		return dataAccessError(err)
	}
	if err = a.syncMenuAvailabilityFromRecipes(ctx, orgID, []string{menuItemID}, now); err != nil {
		return dataAccessError(err)
	}
	sort.Slice(created, func(i, j int) bool {
		return displayString(created[i]["inventory_item_id"]) < displayString(created[j]["inventory_item_id"])
	})
	return mustJSONResponse(200, map[string]any{"menu_item_id": menuItemID, "components": created})
}

func inventoryRequirements(orderItems, recipeItems []map[string]any) map[string]float64 {
	menuQuantities := map[string]float64{}
	for _, line := range orderItems {
		quantity, ok := numericValue(line["quantity"])
		if !ok || quantity <= 0 {
			continue
		}
		menuQuantities[displayString(line["item_id"])] += quantity
	}
	requirements := map[string]float64{}
	for _, component := range recipeItems {
		if component["is_active"] == false {
			continue
		}
		menuQuantity := menuQuantities[displayString(component["menu_item_id"])]
		componentQuantity, ok := numericValue(component["quantity"])
		if menuQuantity <= 0 || !ok || componentQuantity <= 0 {
			continue
		}
		inventoryItemID := displayString(component["inventory_item_id"])
		requirements[inventoryItemID] += menuQuantity * componentQuantity
	}
	for inventoryItemID, quantity := range requirements {
		requirements[inventoryItemID] = roundInventoryQuantity(quantity)
	}
	return requirements
}

func (a *application) inventoryAvailability(ctx context.Context, orgID, locationID string, orderItems []map[string]any) (map[string]inventoryRequirement, map[string]map[string]any, error) {
	recipes, err := a.queryDataRows(ctx, orgID, "inventory_recipe_items")
	if err != nil {
		return nil, nil, err
	}
	filteredRecipes := make([]map[string]any, 0, len(recipes))
	for _, recipe := range recipes {
		if displayString(recipe["location_id"]) == locationID {
			filteredRecipes = append(filteredRecipes, recipe)
		}
	}
	required := inventoryRequirements(orderItems, filteredRecipes)
	if len(required) == 0 {
		return map[string]inventoryRequirement{}, map[string]map[string]any{}, nil
	}
	items, err := a.inventoryItemsForLocation(ctx, orgID, locationID, true)
	if err != nil {
		return nil, nil, err
	}
	itemsByID := make(map[string]map[string]any, len(items))
	for _, item := range items {
		itemsByID[displayString(item["id"])] = item
	}
	result := make(map[string]inventoryRequirement, len(required))
	shortages := make([]string, 0)
	for inventoryItemID, quantity := range required {
		item := itemsByID[inventoryItemID]
		if item == nil || item["is_active"] == false {
			return nil, nil, fmt.Errorf("%w: la receta usa un insumo inexistente o inactivo", errInvalidData)
		}
		current, ok := numericValue(item["current_stock"])
		if !ok {
			return nil, nil, fmt.Errorf("%w: el stock de %s es inválido", errInvalidData, displayString(item["name"]))
		}
		result[inventoryItemID] = inventoryRequirement{InventoryItemID: inventoryItemID, Quantity: quantity}
		if current+0.0000001 < quantity {
			shortages = append(shortages, fmt.Sprintf("%s (hay %.3f %s; se necesitan %.3f)", displayString(item["name"]), current, displayString(item["unit"]), quantity))
		}
	}
	if len(shortages) > 0 {
		sort.Strings(shortages)
		return nil, itemsByID, fmt.Errorf("%w: stock insuficiente: %s", errInsufficientInventory, strings.Join(shortages, "; "))
	}
	return result, itemsByID, nil
}

func (a *application) validateInventoryForOrder(ctx context.Context, orgID, locationID string, orderItems []map[string]any) error {
	_, _, err := a.inventoryAvailability(ctx, orgID, locationID, orderItems)
	return err
}

func (a *application) inventoryConsumptionExists(ctx context.Context, orgID, orderID string) bool {
	row, err := a.dataRowByID(ctx, orgID, "inventory_consumptions", orderID)
	return err == nil && displayString(row["id"]) == orderID
}

func (a *application) consumeInventoryForOrder(ctx context.Context, orgID string, order map[string]any, orderItems []map[string]any) error {
	orderID := displayString(order["id"])
	locationID := displayString(order["location_id"])
	if orderID == "" || locationID == "" || a.inventoryConsumptionExists(ctx, orgID, orderID) {
		return nil
	}
	for attempt := 0; attempt < 3; attempt++ {
		requirements, itemsByID, err := a.inventoryAvailability(ctx, orgID, locationID, orderItems)
		if err != nil {
			return err
		}
		if len(requirements) == 0 {
			return nil
		}
		if len(requirements) > 49 {
			return fmt.Errorf("%w: el pedido utiliza demasiados insumos para descontarlos de forma segura", errInvalidData)
		}
		now := time.Now().UTC().Format(time.RFC3339Nano)
		transaction := make([]types.TransactWriteItem, 0, len(requirements)*2+1)
		consumedLines := make([]map[string]any, 0, len(requirements))
		changedItems := make([]map[string]any, 0, len(requirements))
		for inventoryItemID, requirement := range requirements {
			currentItem := itemsByID[inventoryItemID]
			before, _ := numericValue(currentItem["current_stock"])
			after := roundInventoryQuantity(before - requirement.Quantity)
			originalData, marshalErr := jsonDataItem("ORG#"+orgID, "DATA#inventory_items#"+inventoryItemID, "inventory_items", inventoryItemID, currentItem)
			if marshalErr != nil {
				return marshalErr
			}
			updatedItem := cloneDataRow(currentItem)
			updatedItem["current_stock"], updatedItem["updated_at"] = after, now
			updatedData, marshalErr := jsonDataItem("ORG#"+orgID, "DATA#inventory_items#"+inventoryItemID, "inventory_items", inventoryItemID, updatedItem)
			if marshalErr != nil {
				return marshalErr
			}
			transaction = append(transaction, types.TransactWriteItem{Put: &types.Put{
				TableName: aws.String(a.table), Item: updatedData, ConditionExpression: aws.String("#data = :expected"),
				ExpressionAttributeNames:  map[string]string{"#data": "data"},
				ExpressionAttributeValues: map[string]types.AttributeValue{":expected": originalData["data"]},
			}})
			movementID := "sale#" + orderID + "#" + inventoryItemID
			movement := map[string]any{
				"id": movementID, "organization_id": orgID, "inventory_item_id": inventoryItemID,
				"movement_type": "sale_consumption", "quantity": -requirement.Quantity,
				"balance_before": before, "balance_after": after, "reference_id": orderID,
				"performed_by": "system", "notes": "Consumo automático por pedido " + displayString(order["order_number"]),
				"created_at": now, "updated_at": now,
			}
			movementData, marshalErr := jsonDataItem("ORG#"+orgID, "DATA#stock_movements#"+movementID, "stock_movements", movementID, movement)
			if marshalErr != nil {
				return marshalErr
			}
			transaction = append(transaction, types.TransactWriteItem{Put: &types.Put{
				TableName: aws.String(a.table), Item: movementData, ConditionExpression: aws.String("attribute_not_exists(PK)"),
			}})
			consumedLines = append(consumedLines, map[string]any{
				"inventory_item_id": inventoryItemID, "item_name": currentItem["name"], "unit": currentItem["unit"],
				"quantity": requirement.Quantity, "balance_before": before, "balance_after": after,
			})
			changedItems = append(changedItems, updatedItem)
		}
		sort.Slice(consumedLines, func(i, j int) bool {
			return displayString(consumedLines[i]["item_name"]) < displayString(consumedLines[j]["item_name"])
		})
		consumption := map[string]any{
			"id": orderID, "organization_id": orgID, "location_id": locationID, "order_id": orderID,
			"order_number": order["order_number"], "status": "applied", "lines": consumedLines,
			"created_at": now, "updated_at": now,
		}
		consumptionData, marshalErr := jsonDataItem("ORG#"+orgID, "DATA#inventory_consumptions#"+orderID, "inventory_consumptions", orderID, consumption)
		if marshalErr != nil {
			return marshalErr
		}
		transaction = append(transaction, types.TransactWriteItem{Put: &types.Put{
			TableName: aws.String(a.table), Item: consumptionData, ConditionExpression: aws.String("attribute_not_exists(PK)"),
		}})
		if _, err = a.dynamo.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{TransactItems: transaction}); err == nil {
			for _, item := range changedItems {
				_ = a.syncInventoryMenuAvailability(ctx, orgID, item, 1, 0, now)
			}
			return nil
		}
		if a.inventoryConsumptionExists(ctx, orgID, orderID) {
			return nil
		}
	}
	return errConflict
}

func (a *application) syncMenuAvailabilityForInventoryItem(ctx context.Context, orgID string, inventoryItem map[string]any, now string) error {
	itemID := displayString(inventoryItem["id"])
	recipes, err := a.queryDataRows(ctx, orgID, "inventory_recipe_items")
	if err != nil {
		return err
	}
	menuIDs := map[string]bool{}
	for _, recipe := range recipes {
		if recipe["is_active"] != false && displayString(recipe["inventory_item_id"]) == itemID {
			menuIDs[displayString(recipe["menu_item_id"])] = true
		}
	}
	if legacyID := displayString(inventoryItem["link_to_item_id"]); legacyID != "" {
		menuIDs[legacyID] = true
	}
	ids := make([]string, 0, len(menuIDs))
	for menuID := range menuIDs {
		ids = append(ids, menuID)
	}
	return a.syncMenuAvailabilityFromRecipes(ctx, orgID, ids, now)
}

func (a *application) syncMenuAvailabilityFromRecipes(ctx context.Context, orgID string, menuItemIDs []string, now string) error {
	if len(menuItemIDs) == 0 {
		return nil
	}
	recipes, err := a.queryDataRows(ctx, orgID, "inventory_recipe_items")
	if err != nil {
		return err
	}
	inventoryItems, err := a.queryDataRows(ctx, orgID, "inventory_items")
	if err != nil {
		return err
	}
	stockByID := make(map[string]float64, len(inventoryItems))
	for _, item := range inventoryItems {
		stockByID[displayString(item["id"])], _ = numericValue(item["current_stock"])
	}
	seen := map[string]bool{}
	for _, menuItemID := range menuItemIDs {
		if menuItemID == "" || seen[menuItemID] {
			continue
		}
		seen[menuItemID] = true
		menuItem, getErr := a.dataRowByID(ctx, orgID, "items", menuItemID)
		if getErr != nil {
			continue
		}
		hasRecipe, available := false, true
		for _, recipe := range recipes {
			if recipe["is_active"] == false || displayString(recipe["menu_item_id"]) != menuItemID {
				continue
			}
			hasRecipe = true
			quantity, ok := numericValue(recipe["quantity"])
			if !ok || quantity <= 0 || stockByID[displayString(recipe["inventory_item_id"])] < quantity {
				available = false
			}
		}
		if !hasRecipe {
			continue
		}
		should86 := !available
		inventory86ed := menuItem["inventory_86ed"] == true
		if should86 {
			if menuItem["is_86ed"] == true && inventory86ed && menuItem["auto_86_when_inventory_empty"] == true {
				continue
			}
			menuItem["is_86ed"], menuItem["inventory_86ed"] = true, true
		} else {
			if !inventory86ed && menuItem["auto_86_when_inventory_empty"] == true {
				continue
			}
			if inventory86ed {
				menuItem["is_86ed"] = false
			}
			menuItem["inventory_86ed"] = false
		}
		menuItem["auto_86_when_inventory_empty"], menuItem["updated_at"] = true, now
		if err = a.putDataRow(ctx, orgID, "items", menuItem, false); err != nil {
			return err
		}
	}
	return nil
}

func roundInventoryQuantity(value float64) float64 {
	return math.Round(value*1000000) / 1000000
}
