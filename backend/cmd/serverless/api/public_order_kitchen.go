package main

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"time"
)

// Add kitchen tickets and ingredient reservations to the SAME checkout commit.
// A customer must not receive confirmation for an order that cannot reach
// kitchen or reserve its stock. No rollback writes can overwrite another sale.
func (a *application) preparePublicOrderKitchen(
	ctx context.Context, orgID string, order map[string]any, lines []map[string]any, now time.Time,
	add func(string, map[string]any, map[string]any) error,
) error {
	locationID, orderID := displayString(order["location_id"]), displayString(order["id"])
	requirements, inventory, err := a.inventoryAvailability(ctx, orgID, locationID, lines)
	if err != nil {
		return err
	}
	consumed := []map[string]any{}
	for id, requirement := range requirements {
		current := inventory[id]
		before, _ := numericValue(current["current_stock"])
		after := roundInventoryQuantity(before - requirement.Quantity)
		updated := cloneDataRow(current)
		updated["current_stock"] = after
		if err := add("inventory_items", updated, current); err != nil {
			return err
		}
		movement := map[string]any{
			"id": "sale#" + orderID + "#" + id, "inventory_item_id": id,
			"movement_type": "sale_consumption", "quantity": -requirement.Quantity,
			"balance_before": before, "balance_after": after, "reference_id": orderID,
			"performed_by": "system", "notes": "Consumo por pedido web " + displayString(order["order_number"]),
		}
		if err := add("stock_movements", movement, nil); err != nil {
			return err
		}
		consumed = append(consumed, map[string]any{"inventory_item_id": id, "item_name": current["name"], "unit": current["unit"], "quantity": requirement.Quantity, "balance_before": before, "balance_after": after})
	}
	if len(consumed) > 0 {
		if err := add("inventory_consumptions", map[string]any{
			"id": orderID, "location_id": locationID, "order_id": orderID, "order_number": order["order_number"],
			"status": "applied", "lines": consumed,
		}, nil); err != nil {
			return err
		}
	}
	stations, err := a.queryDataRows(ctx, orgID, "kitchen_stations")
	if err != nil {
		return err
	}
	stationIDs := []string{}
	validStation := map[string]bool{}
	for _, station := range stations {
		if displayString(station["location_id"]) == locationID && station["is_active"] != false {
			id := displayString(station["id"])
			stationIDs = append(stationIDs, id)
			validStation[id] = true
		}
	}
	sort.Strings(stationIDs)
	if len(stationIDs) == 0 {
		id := "web-kitchen-" + locationID
		if _, err := a.dataRowByID(ctx, orgID, "kitchen_stations", id); err == nil {
			// A previously created default station may have been deactivated.
			// Avoid colliding with that record or silently reactivating it.
			var idErr error
			id, idErr = randomID()
			if idErr != nil {
				return idErr
			}
		} else if !errors.Is(err, errNotFound) {
			return err
		}
		// A new default station is part of the transaction as well. Concurrent
		// first orders conflict safely and can retry against the created station.
		if err := add("kitchen_stations", map[string]any{"id": id, "location_id": locationID, "name": "Cocina principal", "is_active": true}, nil); err != nil {
			return err
		}
		stationIDs = append(stationIDs, id)
		validStation[id] = true
	}
	itemRoutes, err := a.queryDataRows(ctx, orgID, "item_station_routing")
	if err != nil {
		return err
	}
	categoryRoutes, err := a.queryDataRows(ctx, orgID, "category_station_routing")
	if err != nil {
		return err
	}
	grouped := map[string][]map[string]any{}
	for _, line := range lines {
		stationID := ""
		for _, route := range itemRoutes {
			id := displayString(route["station_id"])
			if displayString(route["item_id"]) == displayString(line["item_id"]) && route["is_primary"] != false && validStation[id] {
				stationID = id
				break
			}
		}
		if stationID == "" {
			for _, route := range categoryRoutes {
				id := displayString(route["station_id"])
				if displayString(route["category_id"]) == displayString(line["category_id"]) && route["is_primary"] != false && validStation[id] {
					stationID = id
					break
				}
			}
		}
		if stationID == "" {
			stationID = stationIDs[0]
		}
		grouped[stationID] = append(grouped[stationID], line)
	}
	for id, stationLines := range grouped {
		ticketID := orderID + "-" + id
		if err := add("kds_tickets", map[string]any{
			"id": ticketID, "order_id": orderID, "station_id": id, "ticket_number": now.UnixMilli(),
			"status": "fired", "fired_at": now.Format(time.RFC3339Nano), "started_at": nil, "ready_at": nil, "bumped_at": nil,
			"bumped_by": nil, "course_number": nil, "priority": 0, "notes": order["notes"],
		}, nil); err != nil {
			return err
		}
		for _, line := range stationLines {
			if err := add("kds_ticket_items", map[string]any{
				"id": fmt.Sprint(line["id"]) + "-kitchen", "ticket_id": ticketID, "order_item_id": line["id"],
				"item_id": line["item_id"], "item_name": line["item_name"], "quantity": line["quantity"],
				"item_status": "fired", "notes": line["special_instructions"], "modifiers": []any{}, "variations": []any{},
			}, nil); err != nil {
				return err
			}
		}
	}
	return nil
}
