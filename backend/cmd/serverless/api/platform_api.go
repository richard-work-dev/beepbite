package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/go-pdf/fpdf"
)

// handlePlatformAPI contains the smaller management contracts that used to
// depend on PostgreSQL. They all use the same tenant partition as /data so a
// development deployment has one authoritative, isolated data model.
func (a *application) handlePlatformAPI(ctx context.Context, request events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, bool, error) {
	method, path := request.RequestContext.HTTP.Method, strings.Trim(request.RawPath, "/")
	public := strings.HasPrefix(path, "legal/") && strings.HasSuffix(path, "/current") || path == "geocode/suggest" || strings.HasPrefix(path, "link-whatsapp/") && method == "GET"
	var userID string
	if !public {
		claims, err := a.authenticate(ctx, request.Headers)
		if err != nil {
			return errorResponse(401, "invalid token"), true, nil
		}
		userID = claims.UserID
	}

	if public {
		return a.handlePublicPlatformAPI(ctx, request, path), true, nil
	}
	if path == "me/preferences" {
		return a.handlePreferences(ctx, request, userID), true, nil
	}
	if strings.HasPrefix(path, "onboarding/") {
		return a.handleOnboarding(ctx, request, userID, path), true, nil
	}
	if strings.HasPrefix(path, "api-keys") {
		return a.handleAPIKeys(ctx, request, userID, strings.Split(path, "/")), true, nil
	}
	if strings.HasPrefix(path, "webhook-endpoints") {
		return a.handleWebhooks(ctx, request, userID, strings.Split(path, "/")), true, nil
	}
	if strings.HasPrefix(path, "delivery-zones") {
		return a.handleSimpleResource(ctx, request, userID, "delivery_zones", strings.Split(path, "/")), true, nil
	}
	if strings.HasPrefix(path, "payroll/") {
		return a.handlePayroll(ctx, request, userID, strings.Split(path, "/")), true, nil
	}
	if strings.HasPrefix(path, "link-whatsapp") {
		return a.handleWhatsAppLink(ctx, request, userID, strings.Split(path, "/")), true, nil
	}
	if strings.HasPrefix(path, "admin/wa-numbers") {
		return a.handleWANumbers(ctx, request, userID, strings.Split(path, "/")[1:]), true, nil
	}
	if strings.HasPrefix(path, "admin/tenants") {
		return a.handleAdminTenants(ctx, request, userID, strings.Split(path, "/")), true, nil
	}
	if strings.HasPrefix(path, "hardware/") {
		return a.handleHardware(ctx, request, userID, strings.Split(path, "/")), true, nil
	}
	if strings.HasPrefix(path, "domains") {
		return a.handleDomains(ctx, request, userID, strings.Split(path, "/")), true, nil
	}
	if strings.HasPrefix(path, "invoicing/") {
		return a.handleInvoicing(ctx, request, userID, strings.Split(path, "/")), true, nil
	}
	if path == "manager/audit" {
		return a.handleAudit(ctx, request, userID), true, nil
	}
	if strings.HasPrefix(path, "stats/") {
		return a.handleStats(ctx, request, userID, path), true, nil
	}
	if path == "legal/accept" {
		return a.handleLegalAccept(ctx, request, userID), true, nil
	}
	if strings.HasPrefix(path, "settings/") {
		return a.handleDataRights(ctx, request, userID, path), true, nil
	}
	if path == "customers/search" {
		return a.handleCustomerSearch(ctx, request, userID), true, nil
	}
	if strings.HasPrefix(path, "quick-coupons") {
		return a.handleQuickCoupons(ctx, request, userID), true, nil
	}
	if path == "specials" || strings.HasPrefix(path, "items/") && strings.HasSuffix(path, "/special") {
		return a.handleSpecials(ctx, request, userID, strings.Split(path, "/")), true, nil
	}
	if strings.HasPrefix(path, "categories/") && (strings.HasSuffix(path, "/eighty-six") || strings.HasSuffix(path, "/un-eighty-six")) {
		return a.handleCategoryAvailability(ctx, request, userID, strings.Split(path, "/")), true, nil
	}
	if strings.HasPrefix(path, "customers/") && (strings.Contains(path, "/favorites") || strings.HasSuffix(path, "/recent-orders")) {
		return a.handleCustomerConvenience(ctx, request, userID, strings.Split(path, "/")), true, nil
	}
	if path == "reservations" || strings.HasPrefix(path, "reservations/") {
		return a.handleReservations(ctx, request, userID, strings.Split(path, "/")), true, nil
	}
	if path == "waitlist" || strings.HasPrefix(path, "waitlist/") {
		return a.handleWaitlist(ctx, request, userID, strings.Split(path, "/")), true, nil
	}
	if path == "chat" || path == "assistant" || strings.HasPrefix(path, "assistant/") || path == "ai/floor" {
		return a.handleAssistant(ctx, request, userID, path), true, nil
	}
	_ = method
	return events.APIGatewayV2HTTPResponse{}, false, nil
}

func (a *application) orgForPlatform(ctx context.Context, request events.APIGatewayV2HTTPRequest, userID string) (string, events.APIGatewayV2HTTPResponse, bool) {
	orgID, err := a.authorizedOrganization(ctx, request, userID)
	if err != nil {
		return "", dataAccessError(err), false
	}
	return orgID, events.APIGatewayV2HTTPResponse{}, true
}

func (a *application) handlePublicPlatformAPI(ctx context.Context, request events.APIGatewayV2HTTPRequest, path string) events.APIGatewayV2HTTPResponse {
	if path == "geocode/suggest" {
		return mustJSONResponse(200, map[string]any{"suggestions": []any{}})
	}
	if strings.HasPrefix(path, "link-whatsapp/") {
		return errorResponse(410, "link token expired or unavailable")
	}
	kind := strings.Split(path, "/")[1]
	if kind != "terms" && kind != "privacy" {
		return errorResponse(404, "legal document not found")
	}
	return mustJSONResponse(200, map[string]any{"id": "builtin-" + kind, "kind": kind, "version": "1.0", "title": strings.Title(kind), "content": "BeepBite development terms. Replace with the approved production document before launch.", "effective_at": "2026-01-01T00:00:00Z"})
}

func (a *application) handlePayroll(ctx context.Context, request events.APIGatewayV2HTTPRequest, userID string, parts []string) events.APIGatewayV2HTTPResponse {
	orgID, response, ok := a.managerOrganization(ctx, request, userID)
	if !ok {
		return response
	}
	rows, err := a.queryDataRows(ctx, orgID, "staff_pay_rates")
	if err != nil {
		return dataAccessError(err)
	}
	method := request.RequestContext.HTTP.Method
	if len(parts) == 4 && parts[1] == "staff" && parts[3] == "rates" {
		staffID := parts[2]
		if method == "GET" {
			out := rows[:0]
			for _, row := range rows {
				if displayString(row["staff_id"]) == staffID {
					out = append(out, row)
				}
			}
			return mustJSONResponse(200, out)
		}
		if method == "POST" {
			var input map[string]any
			if decodeDataObject(request.Body, &input) != nil {
				return errorResponse(400, "invalid request")
			}
			input["staff_id"] = staffID
			row, createErr := a.createStoredRow(ctx, orgID, "staff_pay_rates", input)
			if createErr != nil {
				return dataAccessError(createErr)
			}
			return mustJSONResponse(201, row)
		}
	}
	if len(parts) == 3 && parts[1] == "rates" && method == "PATCH" {
		row, getErr := a.dataRowByID(ctx, orgID, "staff_pay_rates", parts[2])
		if getErr != nil {
			return errorResponse(404, "pay rate not found")
		}
		var input map[string]any
		if decodeDataObject(request.Body, &input) != nil {
			return errorResponse(400, "invalid request")
		}
		for k, v := range input {
			if k != "id" && k != "staff_id" {
				row[k] = v
			}
		}
		row["updated_at"] = time.Now().UTC().Format(time.RFC3339Nano)
		if putErr := a.putDataRow(ctx, orgID, "staff_pay_rates", row, false); putErr != nil {
			return dataAccessError(putErr)
		}
		return mustJSONResponse(200, row)
	}
	return errorResponse(405, "method not allowed")
}

func (a *application) handleWhatsAppLink(ctx context.Context, request events.APIGatewayV2HTTPRequest, userID string, parts []string) events.APIGatewayV2HTTPResponse {
	orgID, response, ok := a.orgForPlatform(ctx, request, userID)
	if !ok {
		return response
	}
	rows, err := a.queryDataRows(ctx, orgID, "whatsapp_links")
	if err != nil {
		return dataAccessError(err)
	}
	if len(parts) == 1 {
		out := rows[:0]
		for _, row := range rows {
			if displayString(row["profile_id"]) == userID && displayString(row["status"]) == "bound" {
				out = append(out, row)
			}
		}
		return mustJSONResponse(200, map[string]any{"links": out})
	}
	if request.RequestContext.HTTP.Method == "POST" {
		for _, row := range rows {
			if displayString(row["token"]) == parts[1] && displayString(row["status"]) == "pending" {
				row["status"], row["profile_id"], row["bound_at"] = "bound", userID, time.Now().UTC().Format(time.RFC3339Nano)
				_ = a.putDataRow(ctx, orgID, "whatsapp_links", row, false)
				return mustJSONResponse(200, row)
			}
		}
		return errorResponse(410, "link token expired or consumed")
	}
	return errorResponse(404, "not found")
}

func (a *application) handleWANumbers(ctx context.Context, request events.APIGatewayV2HTTPRequest, userID string, parts []string) events.APIGatewayV2HTTPResponse {
	return a.handleSimpleResource(ctx, request, userID, "wa_numbers", parts)
}

func (a *application) handleAdminTenants(ctx context.Context, request events.APIGatewayV2HTTPRequest, userID string, parts []string) events.APIGatewayV2HTTPResponse {
	// The development admin view is intentionally scoped to memberships of the
	// caller until a dedicated platform-admin identity provider is configured.
	orgs, err := a.organizationRows(ctx, userID)
	if err != nil {
		return dataAccessError(err)
	}
	if len(parts) == 2 {
		q := strings.ToLower(request.QueryStringParameters["q"])
		out := orgs[:0]
		for _, org := range orgs {
			if q == "" || strings.Contains(strings.ToLower(displayString(org["name"])), q) {
				out = append(out, org)
			}
		}
		return mustJSONResponse(200, out)
	}
	for _, org := range orgs {
		if displayString(org["id"]) == parts[2] {
			if len(parts) == 4 && request.RequestContext.HTTP.Method == "POST" {
				paused := parts[3] == "pause"
				org["is_active"] = !paused
				if paused {
					org["paused_at"] = time.Now().UTC().Format(time.RFC3339Nano)
				} else {
					org["paused_at"] = nil
				}
				return mustJSONResponse(200, org)
			}
			org["alarms"] = []any{}
			return mustJSONResponse(200, org)
		}
	}
	return errorResponse(404, "tenant not found")
}

func (a *application) handlePreferences(ctx context.Context, request events.APIGatewayV2HTTPRequest, userID string) events.APIGatewayV2HTTPResponse {
	orgID, response, ok := a.orgForPlatform(ctx, request, userID)
	if !ok {
		return response
	}
	rows, err := a.queryDataRows(ctx, orgID, "user_preferences")
	if err != nil {
		return dataAccessError(err)
	}
	for _, row := range rows {
		if displayString(row["profile_id"]) == userID {
			if request.RequestContext.HTTP.Method == "GET" {
				return mustJSONResponse(200, row)
			}
			var changes map[string]any
			if decodeDataObject(request.Body, &changes) != nil {
				return errorResponse(400, "invalid request")
			}
			for k, v := range changes {
				if k == "last_view_pos" || k == "last_view_kds" {
					row[k] = v
				}
			}
			row["updated_at"] = time.Now().UTC().Format(time.RFC3339Nano)
			if err := a.putDataRow(ctx, orgID, "user_preferences", row, false); err != nil {
				return dataAccessError(err)
			}
			return mustJSONResponse(200, row)
		}
	}
	if request.RequestContext.HTTP.Method == "GET" {
		return mustJSONResponse(200, map[string]any{"profile_id": userID, "last_view_pos": "full", "last_view_kds": "station"})
	}
	var input map[string]any
	_ = decodeDataObject(request.Body, &input)
	input["profile_id"] = userID
	created, err := a.createStoredRow(ctx, orgID, "user_preferences", input)
	if err != nil {
		return dataAccessError(err)
	}
	return mustJSONResponse(200, created)
}

func (a *application) handleOnboarding(ctx context.Context, request events.APIGatewayV2HTTPRequest, userID, path string) events.APIGatewayV2HTTPResponse {
	orgID, response, ok := a.orgForPlatform(ctx, request, userID)
	if !ok {
		return response
	}
	if path == "onboarding/status" {
		locations, _ := a.queryDataRows(ctx, orgID, "locations")
		items, _ := a.queryDataRows(ctx, orgID, "items")
		staff, _ := a.queryDataRows(ctx, orgID, "staff")
		orders, _ := a.queryDataRows(ctx, orgID, "orders")
		activeItems := 0
		for _, r := range items {
			if v, exists := r["is_active"]; !exists || v == true {
				activeItems++
			}
		}
		completed := false
		for _, r := range orders {
			s := displayString(r["status"])
			if s == "completed" || s == "delivered" {
				completed = true
			}
		}
		return mustJSONResponse(200, map[string]any{"has_location": len(locations) > 0, "has_five_items": activeItems >= 5, "has_staff_or_driver": len(staff) > 0, "has_order": completed})
	}
	rows, err := a.queryDataRows(ctx, orgID, "onboarding_progress")
	if err != nil {
		return dataAccessError(err)
	}
	if request.RequestContext.HTTP.Method == "GET" {
		if len(rows) == 0 {
			return mustJSONResponse(200, map[string]any{"org_id": orgID, "step": 0, "completed_steps": []any{}})
		}
		return mustJSONResponse(200, rows[0])
	}
	var input map[string]any
	if decodeDataObject(request.Body, &input) != nil {
		return errorResponse(400, "invalid request")
	}
	if len(rows) > 0 {
		for k, v := range input {
			rows[0][k] = v
		}
		rows[0]["updated_at"] = time.Now().UTC().Format(time.RFC3339Nano)
		if err := a.putDataRow(ctx, orgID, "onboarding_progress", rows[0], false); err != nil {
			return dataAccessError(err)
		}
		return mustJSONResponse(200, rows[0])
	}
	input["org_id"] = orgID
	row, err := a.createStoredRow(ctx, orgID, "onboarding_progress", input)
	if err != nil {
		return dataAccessError(err)
	}
	return mustJSONResponse(200, row)
}

func (a *application) handleSimpleResource(ctx context.Context, request events.APIGatewayV2HTTPRequest, userID, table string, parts []string) events.APIGatewayV2HTTPResponse {
	orgID, response, ok := a.orgForPlatform(ctx, request, userID)
	if !ok {
		return response
	}
	method := request.RequestContext.HTTP.Method
	if len(parts) == 1 {
		if method == "GET" {
			rows, err := a.queryDataRows(ctx, orgID, table)
			if err != nil {
				return dataAccessError(err)
			}
			for key, value := range request.QueryStringParameters {
				filtered := rows[:0]
				for _, r := range rows {
					if displayString(r[key]) == value {
						filtered = append(filtered, r)
					}
				}
				rows = filtered
			}
			return mustJSONResponse(200, rows)
		}
		if method == "POST" {
			var input map[string]any
			if decodeDataObject(request.Body, &input) != nil {
				return errorResponse(400, "invalid request")
			}
			row, err := a.createStoredRow(ctx, orgID, table, input)
			if err != nil {
				return dataAccessError(err)
			}
			return mustJSONResponse(201, row)
		}
	}
	if len(parts) >= 2 {
		row, err := a.dataRowByID(ctx, orgID, table, parts[1])
		if err != nil {
			return errorResponse(404, "not found")
		}
		switch method {
		case "GET":
			return mustJSONResponse(200, row)
		case "PATCH", "PUT":
			var input map[string]any
			if decodeDataObject(request.Body, &input) != nil {
				return errorResponse(400, "invalid request")
			}
			for k, v := range input {
				if k != "id" && k != "organization_id" {
					row[k] = v
				}
			}
			row["updated_at"] = time.Now().UTC().Format(time.RFC3339Nano)
			if err := a.putDataRow(ctx, orgID, table, row, false); err != nil {
				return dataAccessError(err)
			}
			return mustJSONResponse(200, row)
		case "DELETE":
			if err := a.deleteStoredRow(ctx, orgID, table, parts[1]); err != nil {
				return dataAccessError(err)
			}
			return events.APIGatewayV2HTTPResponse{StatusCode: 204}
		}
	}
	return errorResponse(405, "method not allowed")
}

func (a *application) handleAPIKeys(ctx context.Context, request events.APIGatewayV2HTTPRequest, userID string, parts []string) events.APIGatewayV2HTTPResponse {
	orgID, response, ok := a.managerOrganization(ctx, request, userID)
	if !ok {
		return response
	}
	rows, err := a.queryDataRows(ctx, orgID, "api_keys")
	if err != nil {
		return dataAccessError(err)
	}
	if len(parts) == 1 && request.RequestContext.HTTP.Method == "GET" {
		for _, r := range rows {
			delete(r, "key_hash")
		}
		return mustJSONResponse(200, rows)
	}
	if len(parts) == 1 && request.RequestContext.HTTP.Method == "POST" {
		var input map[string]any
		if decodeDataObject(request.Body, &input) != nil || displayString(input["name"]) == "" {
			return errorResponse(400, "name required")
		}
		id, _ := randomID()
		secret, _ := randomID()
		plain := "bb_" + displayString(input["environment"]) + "_" + strings.ReplaceAll(id, "-", "") + strings.ReplaceAll(secret, "-", "")
		sum := sha256.Sum256([]byte(plain))
		input["key_hash"] = hex.EncodeToString(sum[:])
		input["prefix_visible"] = plain[:min(12, len(plain))]
		row, err := a.createStoredRow(ctx, orgID, "api_keys", input)
		if err != nil {
			return dataAccessError(err)
		}
		delete(row, "key_hash")
		row["key"] = plain
		return mustJSONResponse(201, row)
	}
	if len(parts) == 3 && parts[2] == "revoke" && request.RequestContext.HTTP.Method == "POST" {
		row, err := a.dataRowByID(ctx, orgID, "api_keys", parts[1])
		if err != nil {
			return errorResponse(404, "api key not found")
		}
		row["revoked_at"] = time.Now().UTC().Format(time.RFC3339Nano)
		_ = a.putDataRow(ctx, orgID, "api_keys", row, false)
		return events.APIGatewayV2HTTPResponse{StatusCode: 204}
	}
	return errorResponse(405, "method not allowed")
}

func (a *application) handleWebhooks(ctx context.Context, request events.APIGatewayV2HTTPRequest, userID string, parts []string) events.APIGatewayV2HTTPResponse {
	if len(parts) == 3 && parts[2] == "deliveries" {
		orgID, response, ok := a.managerOrganization(ctx, request, userID)
		if !ok {
			return response
		}
		rows, err := a.queryDataRows(ctx, orgID, "webhook_deliveries")
		if err != nil {
			return dataAccessError(err)
		}
		out := rows[:0]
		for _, r := range rows {
			if displayString(r["endpoint_id"]) == parts[1] {
				out = append(out, r)
			}
		}
		return mustJSONResponse(200, out)
	}
	resp := a.handleSimpleResource(ctx, request, userID, "webhook_endpoints", parts)
	if len(parts) == 1 && request.RequestContext.HTTP.Method == "POST" && resp.StatusCode == 201 {
		var row map[string]any
		_ = decodeBody(resp.Body, &row)
		secret, _ := randomID()
		row["signing_secret"] = "whsec_" + strings.ReplaceAll(secret, "-", "")
		resp = mustJSONResponse(201, row)
	}
	return resp
}

func (a *application) handleHardware(ctx context.Context, request events.APIGatewayV2HTTPRequest, userID string, parts []string) events.APIGatewayV2HTTPResponse {
	if len(parts) >= 2 && parts[1] == "printers" {
		if len(parts) == 4 && parts[3] == "test" {
			return mustJSONResponse(200, map[string]any{"printer_id": parts[2], "status": "queued"})
		}
		return a.handleSimpleResource(ctx, request, userID, "hardware_printers", append([]string{"printers"}, parts[2:]...))
	}
	if len(parts) >= 2 && parts[1] == "print" {
		return mustJSONResponse(202, []map[string]any{{"status": "queued", "job_id": mustRandomID()}})
	}
	return errorResponse(404, "not found")
}

func mustRandomID() string { id, _ := randomID(); return id }

func (a *application) handleDomains(ctx context.Context, request events.APIGatewayV2HTTPRequest, userID string, parts []string) events.APIGatewayV2HTTPResponse {
	if len(parts) == 3 && parts[2] == "verify" {
		orgID, response, ok := a.managerOrganization(ctx, request, userID)
		if !ok {
			return response
		}
		row, err := a.dataRowByID(ctx, orgID, "custom_domains", parts[1])
		if err != nil {
			return errorResponse(404, "domain not found")
		}
		row["status"] = "pending_dns"
		row["verification_name"] = "_beepbite." + displayString(row["domain"])
		row["verification_value"] = "verify-" + parts[1]
		row["updated_at"] = time.Now().UTC().Format(time.RFC3339Nano)
		_ = a.putDataRow(ctx, orgID, "custom_domains", row, false)
		return mustJSONResponse(200, row)
	}
	return a.handleSimpleResource(ctx, request, userID, "custom_domains", parts)
}

func invoiceTotals(input map[string]any) {
	subtotal := int64(0)
	if lines, ok := input["lines"].([]any); ok {
		for _, raw := range lines {
			if line, ok := raw.(map[string]any); ok {
				qty, _ := strconv.ParseFloat(fmt.Sprint(line["qty"]), 64)
				unit, _ := strconv.ParseInt(fmt.Sprint(line["unit_cents"]), 10, 64)
				total := int64(qty * float64(unit))
				line["line_total_cents"] = total
				subtotal += total
			}
		}
	}
	rate, _ := strconv.ParseFloat(fmt.Sprint(valueOr(input, "vat_rate_pct", 0)), 64)
	vat := int64(float64(subtotal) * rate / 100)
	input["subtotal_cents"], input["vat_cents"], input["total_cents"], input["vat_applied"] = subtotal, vat, subtotal+vat, vat > 0
}

func (a *application) handleInvoicing(ctx context.Context, request events.APIGatewayV2HTTPRequest, userID string, parts []string) events.APIGatewayV2HTTPResponse {
	orgID, response, ok := a.managerOrganization(ctx, request, userID)
	if !ok {
		return response
	}
	method := request.RequestContext.HTTP.Method
	if len(parts) == 2 && parts[1] == "tax-profile" {
		rows, _ := a.queryDataRows(ctx, orgID, "tax_profiles")
		if method == "GET" {
			if len(rows) == 0 {
				return errorResponse(404, "tax profile not configured")
			}
			return mustJSONResponse(200, rows[0])
		}
		var input map[string]any
		if decodeDataObject(request.Body, &input) != nil {
			return errorResponse(400, "invalid request")
		}
		if len(rows) > 0 {
			for k, v := range input {
				rows[0][k] = v
			}
			rows[0]["updated_at"] = time.Now().UTC().Format(time.RFC3339Nano)
			_ = a.putDataRow(ctx, orgID, "tax_profiles", rows[0], false)
			return mustJSONResponse(200, rows[0])
		}
		row, err := a.createStoredRow(ctx, orgID, "tax_profiles", input)
		if err != nil {
			return dataAccessError(err)
		}
		return mustJSONResponse(200, row)
	}
	if len(parts) >= 2 && parts[1] == "invoices" {
		if len(parts) == 2 && method == "POST" {
			var input map[string]any
			if decodeDataObject(request.Body, &input) != nil {
				return errorResponse(400, "invalid request")
			}
			invoiceTotals(input)
			input["status"] = "draft"
			input["invoice_number"] = "DEV-" + time.Now().UTC().Format("20060102-150405")
			row, err := a.createStoredRow(ctx, orgID, "invoices", input)
			if err != nil {
				return dataAccessError(err)
			}
			return mustJSONResponse(201, row)
		}
		if len(parts) == 2 {
			return a.handleSimpleResource(ctx, request, userID, "invoices", []string{"invoices"})
		}
		id := strings.TrimSuffix(parts[2], ".pdf")
		row, err := a.dataRowByID(ctx, orgID, "invoices", id)
		if err != nil {
			return errorResponse(404, "invoice not found")
		}
		if strings.HasSuffix(parts[2], ".pdf") {
			pdf := fpdf.New("P", "mm", "A4", "")
			pdf.SetMargins(20, 20, 20)
			pdf.AddPage()
			pdf.SetFont("Helvetica", "B", 22)
			pdf.Cell(0, 12, "INVOICE")
			pdf.Ln(18)
			pdf.SetFont("Helvetica", "", 11)
			pdf.Cell(0, 7, "Invoice #: "+displayString(row["invoice_number"]))
			pdf.Ln(9)
			pdf.Cell(0, 7, "Bill to: "+displayString(row["recipient_name"]))
			pdf.Ln(7)
			pdf.MultiCell(0, 6, displayString(row["recipient_address"]), "", "L", false)
			pdf.Ln(5)
			pdf.SetFont("Helvetica", "B", 12)
			pdf.Cell(0, 8, fmt.Sprintf("Total: %.2f %s", float64(int64Value(row["total_cents"]))/100, strings.ToUpper(displayString(valueOr(row, "currency", "USD")))))
			var buf bytes.Buffer
			if err := pdf.Output(&buf); err != nil {
				return errorResponse(500, "could not generate invoice PDF")
			}
			return events.APIGatewayV2HTTPResponse{StatusCode: 200, Headers: map[string]string{"content-type": "application/pdf", "content-disposition": "attachment; filename=invoice-" + id + ".pdf"}, Body: base64.StdEncoding.EncodeToString(buf.Bytes()), IsBase64Encoded: true}
		}
		if len(parts) == 4 && method == "POST" {
			next := map[string]string{"issue": "sent", "pay": "paid", "void": "void"}[parts[3]]
			if next == "" {
				return errorResponse(404, "not found")
			}
			row["status"] = next
			if next == "sent" {
				row["issued_at"] = time.Now().UTC().Format(time.RFC3339Nano)
			}
			row["updated_at"] = time.Now().UTC().Format(time.RFC3339Nano)
			_ = a.putDataRow(ctx, orgID, "invoices", row, false)
			return mustJSONResponse(200, row)
		}
		if method == "PATCH" {
			var input map[string]any
			_ = decodeDataObject(request.Body, &input)
			for k, v := range input {
				row[k] = v
			}
			invoiceTotals(row)
			_ = a.putDataRow(ctx, orgID, "invoices", row, false)
			return mustJSONResponse(200, row)
		}
		if method == "DELETE" {
			if displayString(row["status"]) != "draft" {
				return errorResponse(409, "only draft invoices can be deleted")
			}
			_ = a.deleteStoredRow(ctx, orgID, "invoices", id)
			return events.APIGatewayV2HTTPResponse{StatusCode: 204}
		}
		return mustJSONResponse(200, row)
	}
	return errorResponse(404, "not found")
}

func (a *application) handleAudit(ctx context.Context, request events.APIGatewayV2HTTPRequest, userID string) events.APIGatewayV2HTTPResponse {
	orgID, response, ok := a.managerOrganization(ctx, request, userID)
	if !ok {
		return response
	}
	rows, err := a.queryDataRows(ctx, orgID, "audit_log")
	if err != nil {
		return dataAccessError(err)
	}
	sort.Slice(rows, func(i, j int) bool {
		return displayString(rows[i]["created_at"]) > displayString(rows[j]["created_at"])
	})
	return mustJSONResponse(200, map[string]any{"data": rows, "total": len(rows)})
}

func int64Value(value any) int64 {
	switch v := value.(type) {
	case int64:
		return v
	case int:
		return int64(v)
	case float64:
		return int64(v)
	case float32:
		return int64(v)
	}
	n, _ := strconv.ParseInt(fmt.Sprint(value), 10, 64)
	return n
}

type statsKPI struct {
	GrossSalesCents    int64 `json:"gross_sales_cents"`
	NetSalesCents      int64 `json:"net_sales_cents"`
	OrderCount         int64 `json:"order_count"`
	AvgOrderValueCents int64 `json:"avg_order_value_cents"`
	NewCustomers       int64 `json:"new_customers"`
}

func statsRange(period string, now time.Time) (time.Time, time.Time) {
	end := now.UTC()
	switch period {
	case "day":
		return time.Date(end.Year(), end.Month(), end.Day(), 0, 0, 0, 0, time.UTC), end
	case "month":
		return time.Date(end.Year(), end.Month(), 1, 0, 0, 0, 0, time.UTC), end
	case "year":
		return time.Date(end.Year(), 1, 1, 0, 0, 0, 0, time.UTC), end
	default:
		start := time.Date(end.Year(), end.Month(), end.Day(), 0, 0, 0, 0, time.UTC)
		for start.Weekday() != time.Monday {
			start = start.AddDate(0, 0, -1)
		}
		return start, end
	}
}
func orderTime(row map[string]any) (time.Time, bool) {
	for _, key := range []string{"completed_at", "created_at"} {
		if raw := displayString(row[key]); raw != "" {
			if parsed, err := time.Parse(time.RFC3339Nano, raw); err == nil {
				return parsed.UTC(), true
			}
			if parsed, err := time.Parse(time.RFC3339, raw); err == nil {
				return parsed.UTC(), true
			}
		}
	}
	return time.Time{}, false
}
func aggregateStats(rows []map[string]any, from, to time.Time, location string) (statsKPI, map[string]map[string]int64) {
	k := statsKPI{}
	series := map[string]map[string]int64{}
	customers := map[string]bool{}
	for _, r := range rows {
		if location != "" && displayString(r["location_id"]) != location {
			continue
		}
		s := displayString(r["status"])
		if s != "completed" && s != "delivered" {
			continue
		}
		at, ok := orderTime(r)
		if !ok || at.Before(from) || !at.Before(to) {
			continue
		}
		gross := int64Value(r["total_cents"])
		net := int64Value(r["subtotal_cents"])
		if net == 0 {
			net = gross - int64Value(r["tax_cents"])
		}
		k.GrossSalesCents += gross
		k.NetSalesCents += net
		k.OrderCount++
		if c := displayString(r["customer_id"]); c != "" {
			customers[c] = true
		}
		bucket := at.Format("2006-01-02")
		if series[bucket] == nil {
			series[bucket] = map[string]int64{}
		}
		series[bucket]["sales"] += gross
		series[bucket]["orders"]++
	}
	if k.OrderCount > 0 {
		k.AvgOrderValueCents = k.GrossSalesCents / k.OrderCount
	}
	k.NewCustomers = int64(len(customers))
	return k, series
}

func (a *application) handleStats(ctx context.Context, request events.APIGatewayV2HTTPRequest, userID, path string) events.APIGatewayV2HTTPResponse {
	orgID, response, ok := a.orgForPlatform(ctx, request, userID)
	if !ok {
		return response
	}
	rows, err := a.queryDataRows(ctx, orgID, "orders")
	if err != nil {
		return dataAccessError(err)
	}
	location := request.QueryStringParameters["location_id"]
	if strings.HasSuffix(path, "heatmap") {
		weeks, _ := strconv.Atoi(request.QueryStringParameters["weeks"])
		if weeks < 1 {
			weeks = 12
		}
		from := time.Now().UTC().AddDate(0, 0, -7*weeks)
		cells := map[string]map[string]any{}
		for _, r := range rows {
			if location != "" && displayString(r["location_id"]) != location {
				continue
			}
			s := displayString(r["status"])
			if s != "completed" && s != "delivered" {
				continue
			}
			at, valid := orderTime(r)
			if !valid || at.Before(from) {
				continue
			}
			key := fmt.Sprintf("%d-%d", at.Weekday(), at.Hour())
			cell := cells[key]
			if cell == nil {
				cell = map[string]any{"dow": int(at.Weekday()), "hour": at.Hour(), "order_count": int64(0), "sales_cents": int64(0)}
				cells[key] = cell
			}
			cell["order_count"] = int64Value(cell["order_count"]) + 1
			cell["sales_cents"] = int64Value(cell["sales_cents"]) + int64Value(r["total_cents"])
		}
		out := make([]map[string]any, 0, len(cells))
		for _, cell := range cells {
			out = append(out, cell)
		}
		sort.Slice(out, func(i, j int) bool {
			return int64Value(out[i]["dow"])*24+int64Value(out[i]["hour"]) < int64Value(out[j]["dow"])*24+int64Value(out[j]["hour"])
		})
		return mustJSONResponse(200, map[string]any{"cells": out})
	}
	period := request.QueryStringParameters["period"]
	if period == "" {
		period = "week"
	}
	from, to := statsRange(period, time.Now().UTC())
	duration := to.Sub(from)
	previousFrom, previousTo := from.Add(-duration), from
	kpis, seriesMap := aggregateStats(rows, from, to, location)
	previous, _ := aggregateStats(rows, previousFrom, previousTo, location)
	series := make([]map[string]any, 0, len(seriesMap))
	for bucket, values := range seriesMap {
		series = append(series, map[string]any{"bucket": bucket, "sales_cents": values["sales"], "order_count": values["orders"]})
	}
	sort.Slice(series, func(i, j int) bool { return displayString(series[i]["bucket"]) < displayString(series[j]["bucket"]) })
	return mustJSONResponse(200, map[string]any{"period": period, "range": map[string]any{"from": from.Format("2006-01-02"), "to": to.Format("2006-01-02")}, "kpis": kpis, "previous": previous, "series": series})
}

func (a *application) handleLegalAccept(ctx context.Context, request events.APIGatewayV2HTTPRequest, userID string) events.APIGatewayV2HTTPResponse {
	orgID, response, ok := a.orgForPlatform(ctx, request, userID)
	if !ok {
		return response
	}
	var input map[string]any
	if decodeDataObject(request.Body, &input) != nil {
		return errorResponse(400, "invalid request")
	}
	input["profile_id"] = userID
	row, err := a.createStoredRow(ctx, orgID, "legal_acceptances", input)
	if err != nil {
		return dataAccessError(err)
	}
	return mustJSONResponse(201, row)
}

func (a *application) handleDataRights(ctx context.Context, request events.APIGatewayV2HTTPRequest, userID, path string) events.APIGatewayV2HTTPResponse {
	orgID, response, ok := a.managerOrganization(ctx, request, userID)
	if !ok {
		return response
	}
	switch path {
	case "settings/data-export":
		tables := []string{"organizations", "locations", "staff", "customers", "items", "orders"}
		data := map[string]any{}
		for _, table := range tables {
			rows, _ := a.queryDataRows(ctx, orgID, table)
			data[table] = rows
		}
		return mustJSONResponse(200, map[string]any{"organization_id": orgID, "exported_at": time.Now().UTC().Format(time.RFC3339Nano), "data": data})
	case "settings/account":
		return mustJSONResponse(202, map[string]any{"status": "scheduled", "message": "Account deletion scheduled; use restore before the retention window expires."})
	case "settings/account/restore":
		return mustJSONResponse(200, map[string]any{"status": "restored"})
	}
	return errorResponse(404, "not found")
}

func (a *application) handleCustomerSearch(ctx context.Context, request events.APIGatewayV2HTTPRequest, userID string) events.APIGatewayV2HTTPResponse {
	orgID, response, ok := a.orgForPlatform(ctx, request, userID)
	if !ok {
		return response
	}
	rows, err := a.queryDataRows(ctx, orgID, "customers")
	if err != nil {
		return dataAccessError(err)
	}
	q := strings.ToLower(request.QueryStringParameters["q"])
	out := rows[:0]
	for _, r := range rows {
		if q == "" || strings.Contains(strings.ToLower(displayString(r["name"])+" "+displayString(r["email"])+" "+displayString(r["phone"])), q) {
			out = append(out, r)
		}
	}
	return mustJSONResponse(200, map[string]any{"customers": out})
}

func (a *application) handleQuickCoupons(ctx context.Context, request events.APIGatewayV2HTTPRequest, userID string) events.APIGatewayV2HTTPResponse {
	orgID, response, ok := a.managerOrganization(ctx, request, userID)
	if !ok {
		return response
	}
	if request.RequestContext.HTTP.Method == "GET" {
		rows, err := a.queryDataRows(ctx, orgID, "quick_coupons")
		if err != nil {
			return dataAccessError(err)
		}
		customer := request.QueryStringParameters["customer_id"]
		if customer != "" {
			out := rows[:0]
			for _, r := range rows {
				if displayString(r["customer_id"]) == customer {
					out = append(out, r)
				}
			}
			rows = out
		}
		return mustJSONResponse(200, rows)
	}
	var input map[string]any
	if decodeDataObject(request.Body, &input) != nil {
		return errorResponse(400, "invalid request")
	}
	code, _ := randomID()
	input["code"] = "BB-" + strings.ToUpper(strings.ReplaceAll(code, "-", "")[:8])
	input["is_active"] = true
	row, err := a.createStoredRow(ctx, orgID, "quick_coupons", input)
	if err != nil {
		return dataAccessError(err)
	}
	return mustJSONResponse(201, row)
}

func (a *application) handleSpecials(ctx context.Context, request events.APIGatewayV2HTTPRequest, userID string, parts []string) events.APIGatewayV2HTTPResponse {
	orgID, response, ok := a.orgForPlatform(ctx, request, userID)
	if !ok {
		return response
	}
	if len(parts) == 1 {
		rows, err := a.queryDataRows(ctx, orgID, "items")
		if err != nil {
			return dataAccessError(err)
		}
		out := rows[:0]
		for _, r := range rows {
			if r["is_daily_special"] == true && (request.QueryStringParameters["location_id"] == "" || displayString(r["location_id"]) == request.QueryStringParameters["location_id"]) {
				out = append(out, r)
			}
		}
		return mustJSONResponse(200, out)
	}
	row, err := a.dataRowByID(ctx, orgID, "items", parts[1])
	if err != nil {
		return errorResponse(404, "item not found")
	}
	var input map[string]any
	if decodeDataObject(request.Body, &input) != nil {
		return errorResponse(400, "invalid request")
	}
	for k, v := range input {
		row[k] = v
	}
	_ = a.putDataRow(ctx, orgID, "items", row, false)
	return mustJSONResponse(200, map[string]any{"item_id": parts[1], "is_daily_special": row["is_daily_special"]})
}

func (a *application) handleCategoryAvailability(ctx context.Context, request events.APIGatewayV2HTTPRequest, userID string, parts []string) events.APIGatewayV2HTTPResponse {
	orgID, response, ok := a.managerOrganization(ctx, request, userID)
	if !ok {
		return response
	}
	disabled := parts[2] == "eighty-six"
	items, _ := a.queryDataRows(ctx, orgID, "items")
	count := 0
	for _, r := range items {
		if displayString(r["category_id"]) == parts[1] {
			r["is_86ed"] = disabled
			_ = a.putDataRow(ctx, orgID, "items", r, false)
			count++
		}
	}
	return mustJSONResponse(200, map[string]any{"category_id": parts[1], "is_86ed": disabled, "updated_items": count})
}

func (a *application) handleCustomerConvenience(ctx context.Context, request events.APIGatewayV2HTTPRequest, userID string, parts []string) events.APIGatewayV2HTTPResponse {
	orgID, response, ok := a.orgForPlatform(ctx, request, userID)
	if !ok {
		return response
	}
	customerID := parts[1]
	if len(parts) == 3 && parts[2] == "recent-orders" {
		orders, _ := a.queryDataRows(ctx, orgID, "orders")
		out := orders[:0]
		for _, r := range orders {
			if displayString(r["customer_id"]) == customerID {
				out = append(out, r)
			}
		}
		return mustJSONResponse(200, out)
	}
	rows, _ := a.queryDataRows(ctx, orgID, "customer_favorites")
	if request.RequestContext.HTTP.Method == "GET" {
		out := rows[:0]
		for _, r := range rows {
			if displayString(r["customer_id"]) == customerID {
				out = append(out, r)
			}
		}
		return mustJSONResponse(200, out)
	}
	if request.RequestContext.HTTP.Method == "POST" {
		var input map[string]any
		_ = decodeDataObject(request.Body, &input)
		input["customer_id"] = customerID
		row, err := a.createStoredRow(ctx, orgID, "customer_favorites", input)
		if err != nil {
			return dataAccessError(err)
		}
		return mustJSONResponse(201, row)
	}
	if len(parts) == 4 {
		for _, r := range rows {
			if displayString(r["customer_id"]) == customerID && displayString(r["item_id"]) == parts[3] {
				_ = a.deleteStoredRow(ctx, orgID, "customer_favorites", displayString(r["id"]))
			}
		}
		return events.APIGatewayV2HTTPResponse{StatusCode: 204}
	}
	return errorResponse(405, "method not allowed")
}

func (a *application) handleReservations(ctx context.Context, request events.APIGatewayV2HTTPRequest, userID string, parts []string) events.APIGatewayV2HTTPResponse {
	if len(parts) == 1 {
		return a.handleSimpleResource(ctx, request, userID, "reservations", parts)
	}
	if len(parts) == 3 && request.RequestContext.HTTP.Method == "POST" {
		orgID, response, ok := a.orgForPlatform(ctx, request, userID)
		if !ok {
			return response
		}
		row, err := a.dataRowByID(ctx, orgID, "reservations", parts[1])
		if err != nil {
			return errorResponse(404, "reservation not found")
		}
		row["status"] = parts[2]
		row["updated_at"] = time.Now().UTC().Format(time.RFC3339Nano)
		_ = a.putDataRow(ctx, orgID, "reservations", row, false)
		return mustJSONResponse(200, row)
	}
	return a.handleSimpleResource(ctx, request, userID, "reservations", parts)
}

func (a *application) handleWaitlist(ctx context.Context, request events.APIGatewayV2HTTPRequest, userID string, parts []string) events.APIGatewayV2HTTPResponse {
	if len(parts) == 3 && parts[2] == "seat" {
		orgID, response, ok := a.orgForPlatform(ctx, request, userID)
		if !ok {
			return response
		}
		row, err := a.dataRowByID(ctx, orgID, "waitlist", parts[1])
		if err != nil {
			return errorResponse(404, "waitlist entry not found")
		}
		row["status"] = "seated"
		row["seated_at"] = time.Now().UTC().Format(time.RFC3339Nano)
		_ = a.putDataRow(ctx, orgID, "waitlist", row, false)
		return mustJSONResponse(200, row)
	}
	return a.handleSimpleResource(ctx, request, userID, "waitlist", parts)
}

func (a *application) handleAssistant(ctx context.Context, request events.APIGatewayV2HTTPRequest, userID, path string) events.APIGatewayV2HTTPResponse {
	orgID, response, ok := a.orgForPlatform(ctx, request, userID)
	if !ok {
		return response
	}
	if path == "chat" {
		return mustJSONResponse(200, map[string]any{"reply": "El asistente de desarrollo está conectado. Puedes explorar tiendas y menús desde el marketplace.", "tool_results": []any{}})
	}
	if path == "ai/floor" {
		var input map[string]any
		_ = decodeDataObject(request.Body, &input)
		return mustJSONResponse(200, map[string]any{"sections": valueOr(input, "sections", []any{}), "tables": valueOr(input, "tables", []any{}), "status": "generated"})
	}
	parts := strings.Split(path, "/")
	if len(parts) >= 3 && parts[1] == "draft" {
		if request.RequestContext.HTTP.Method == "DELETE" {
			_ = a.deleteStoredRow(ctx, orgID, "assistant_drafts", parts[2])
			return events.APIGatewayV2HTTPResponse{StatusCode: 204}
		}
		row, err := a.dataRowByID(ctx, orgID, "assistant_drafts", parts[2])
		if err != nil {
			return errorResponse(404, "draft not found")
		}
		if len(parts) == 4 && parts[3] == "commit" {
			row["status"] = "committed"
			_ = a.putDataRow(ctx, orgID, "assistant_drafts", row, false)
		}
		return mustJSONResponse(200, row)
	}
	var input map[string]any
	_ = decodeDataObject(request.Body, &input)
	draft, err := a.createStoredRow(ctx, orgID, "assistant_drafts", map[string]any{"request": input, "status": "draft"})
	if err != nil {
		return dataAccessError(err)
	}
	return mustJSONResponse(200, map[string]any{"reply": "Borrador creado para revisión.", "draft_id": draft["id"], "draft": draft})
}
