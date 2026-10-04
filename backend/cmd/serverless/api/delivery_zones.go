package main

import (
	"context"
	"errors"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/aws/aws-lambda-go/events"
)

type deliverySelection struct {
	id, name          string
	fee, minimum, eta int64
}

func deliveryZonesForLocation(zones []map[string]any, locationID string) []map[string]any {
	result := []map[string]any{}
	for _, zone := range zones {
		if displayString(zone["location_id"]) == locationID {
			result = append(result, zone)
		}
	}
	return result
}

func readDeliveryZone(zone map[string]any) (deliverySelection, bool) {
	s := deliverySelection{id: displayString(zone["id"]), name: strings.TrimSpace(displayString(zone["name"]))}
	fee, feeOK := integerValue(zone["delivery_fee_cents"])
	minimum, minOK := integerValue(valueOr(zone, "min_order_cents", int64(0)))
	s.fee, s.minimum, s.eta = fee, minimum, integerOr(zone, "estimated_eta_minutes", 30)
	return s, boolOr(zone, "is_active", true) && s.id != "" && s.name != "" && feeOK && minOK && fee >= 0 && minimum >= 0 && fee <= 1e12 && minimum <= 1e12
}

// Public customers select their barrio/zone; the address remains required.
// Never expose management metadata or accept a price supplied by a browser.
func publicDeliveryZones(zones []map[string]any, locationID string) ([]map[string]any, bool) {
	local := deliveryZonesForLocation(zones, locationID)
	result := []map[string]any{}
	for _, zone := range local {
		if s, ok := readDeliveryZone(zone); ok {
			result = append(result, map[string]any{"id": s.id, "name": s.name, "delivery_fee_cents": s.fee, "min_order_cents": s.minimum, "estimated_eta_minutes": s.eta})
		}
	}
	sort.Slice(result, func(i, j int) bool { return displayString(result[i]["name"]) < displayString(result[j]["name"]) })
	// Even when every zone is paused, never fall back to a cheaper global fee.
	return result, len(local) > 0
}

func priceDelivery(input, location map[string]any, zones []map[string]any, subtotal int64) (deliverySelection, error) {
	s := deliverySelection{}
	if displayString(valueOr(input, "fulfillment_type", input["order_type"])) != "delivery" {
		return s, nil
	}
	local := deliveryZonesForLocation(zones, displayString(location["id"]))
	id := strings.TrimSpace(displayString(input["delivery_zone_id"]))
	if len(local) > 0 || id != "" {
		found := false
		for _, zone := range local {
			if displayString(zone["id"]) == id {
				s, found = readDeliveryZone(zone)
				break
			}
		}
		if !found {
			return s, errors.New("Elegí una zona de entrega habilitada para este local. Actualizá el menú si la zona ya no aparece.")
		}
		if subtotal < s.minimum {
			return s, errors.New("El pedido no alcanza el mínimo de productos para esta zona. Agregá productos para continuar.")
		}
	} else {
		// Existing stores without zones keep their explicitly configured base fee.
		currency := displayString(valueOr(location, "currency_code", location["default_currency_code"]))
		s.fee = publicOrderMoney(location["delivery_fee"], currency)
	}
	currency := displayString(valueOr(location, "currency_code", location["default_currency_code"]))
	threshold := publicOrderMoney(location["free_delivery_threshold"], currency)
	if threshold > 0 && subtotal >= threshold {
		s.fee = 0
	}
	return s, nil
}

func setDeliverySnapshot(order map[string]any, s deliverySelection) {
	order["delivery_fee_cents"] = s.fee
	order["delivery_zone_id"], order["delivery_zone_name"] = nullableString(s.id), nullableString(s.name)
}

func validateDeliveryZone(zone map[string]any) error {
	name := strings.TrimSpace(displayString(zone["name"]))
	if name == "" || utf8.RuneCountInString(name) > 100 || strings.TrimSpace(displayString(zone["location_id"])) == "" {
		return errors.New("La zona necesita un nombre de hasta 100 caracteres y un local válido.")
	}
	zone["name"] = name
	for _, field := range []string{"delivery_fee_cents", "min_order_cents"} {
		value, ok := integerValue(valueOr(zone, field, int64(0)))
		if !ok || value < 0 || value > 1e12 {
			return errors.New("El costo de envío y el pedido mínimo deben ser importes válidos, no negativos.")
		}
		zone[field] = value
	}
	eta, ok := integerValue(valueOr(zone, "estimated_eta_minutes", int64(30)))
	if !ok || eta < 1 || eta > 1440 {
		return errors.New("El tiempo estimado debe estar entre 1 y 1440 minutos.")
	}
	priority, ok := integerValue(valueOr(zone, "priority", int64(0)))
	if !ok || priority < -10000 || priority > 10000 {
		return errors.New("La prioridad no es válida.")
	}
	active, ok := valueOr(zone, "is_active", true).(bool)
	if !ok {
		return errors.New("El estado de la zona no es válido.")
	}
	zone["estimated_eta_minutes"], zone["priority"], zone["is_active"] = eta, priority, active
	return nil
}

func (a *application) handleDeliveryZones(ctx context.Context, request events.APIGatewayV2HTTPRequest, userID string, parts []string) events.APIGatewayV2HTTPResponse {
	method := request.RequestContext.HTTP.Method
	if method == "GET" {
		return a.handleSimpleResource(ctx, request, userID, "delivery_zones", parts)
	}
	orgID, response, ok := a.managerOrganization(ctx, request, userID)
	if !ok {
		return response
	}
	if len(parts) < 1 || len(parts) > 2 {
		return errorResponse(404, "Zona no encontrada.")
	}
	if method == "DELETE" && len(parts) == 2 {
		if _, err := a.dataRowByID(ctx, orgID, "delivery_zones", parts[1]); err != nil {
			return dataAccessError(err)
		}
		if err := a.deleteStoredRow(ctx, orgID, "delivery_zones", parts[1]); err != nil {
			return dataAccessError(err)
		}
		return events.APIGatewayV2HTTPResponse{StatusCode: 204}
	}
	if !(method == "POST" && len(parts) == 1 || (method == "PATCH" || method == "PUT") && len(parts) == 2) {
		return errorResponse(405, "Método no permitido.")
	}
	var input map[string]any
	if len(request.Body) > 128*1024 || decodeDataObject(request.Body, &input) != nil {
		return errorResponse(400, "No pudimos leer la zona.")
	}
	row := map[string]any{}
	if len(parts) == 2 {
		var err error
		row, err = a.dataRowByID(ctx, orgID, "delivery_zones", parts[1])
		if err != nil {
			return dataAccessError(err)
		}
	}
	for _, key := range []string{"location_id", "name", "delivery_fee_cents", "min_order_cents", "estimated_eta_minutes", "is_active", "priority", "polygon"} {
		if value, exists := input[key]; exists {
			row[key] = value
		}
	}
	if err := validateDeliveryZone(row); err != nil {
		return errorResponse(400, err.Error())
	}
	if _, err := a.dataRowByID(ctx, orgID, "locations", displayString(row["location_id"])); err != nil {
		return errorResponse(400, "El local no pertenece a esta organización.")
	}
	if len(parts) == 1 {
		created, err := a.createStoredRow(ctx, orgID, "delivery_zones", row)
		if err != nil {
			return dataAccessError(err)
		}
		return mustJSONResponse(201, created)
	}
	row["updated_at"] = time.Now().UTC().Format(time.RFC3339Nano)
	if err := a.putDataRow(ctx, orgID, "delivery_zones", row, false); err != nil {
		return dataAccessError(err)
	}
	return mustJSONResponse(200, row)
}
