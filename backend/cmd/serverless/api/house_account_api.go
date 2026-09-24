package main

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/events"
)

type houseAccountRoute struct{ name, accountID, resourceID string }

func matchHouseAccountRoute(method, path string) (houseAccountRoute, bool) {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	switch {
	case len(parts) == 1 && parts[0] == "house-accounts" && method == "POST":
		return houseAccountRoute{name: "create"}, true
	case len(parts) == 2 && parts[0] == "house-accounts" && method == "GET":
		return houseAccountRoute{name: "detail", accountID: parts[1]}, true
	case len(parts) == 3 && parts[0] == "house-accounts" && parts[2] == "members" && method == "POST":
		return houseAccountRoute{name: "member_add", accountID: parts[1]}, true
	case len(parts) == 4 && parts[0] == "house-accounts" && parts[2] == "members" && method == "DELETE":
		return houseAccountRoute{name: "member_remove", accountID: parts[1], resourceID: parts[3]}, true
	case len(parts) == 3 && parts[0] == "house-accounts" && parts[2] == "charge" && method == "POST":
		return houseAccountRoute{name: "charge", accountID: parts[1]}, true
	case len(parts) == 4 && parts[0] == "house-accounts" && parts[2] == "invoices" && parts[3] == "generate" && method == "POST":
		return houseAccountRoute{name: "invoice_generate", accountID: parts[1]}, true
	case len(parts) == 3 && parts[0] == "house-accounts" && parts[2] == "invoices" && method == "GET":
		return houseAccountRoute{name: "invoice_list", accountID: parts[1]}, true
	case len(parts) == 4 && parts[0] == "house-accounts" && parts[1] == "invoices" && parts[3] == "pay" && method == "POST":
		return houseAccountRoute{name: "invoice_pay", resourceID: parts[2]}, true
	default:
		return houseAccountRoute{}, false
	}
}

func (a *application) handleHouseAccountAPI(ctx context.Context, request events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, bool, error) {
	route, matched := matchHouseAccountRoute(request.RequestContext.HTTP.Method, request.RawPath)
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
	case "create":
		response = a.createHouseAccount(ctx, claims.UserID, orgID, request.Body)
	case "detail":
		response = a.getHouseAccount(ctx, orgID, route.accountID)
	case "member_add":
		response = a.addHouseAccountMember(ctx, orgID, route.accountID, request.Body)
	case "member_remove":
		response = a.removeHouseAccountMember(ctx, orgID, route.accountID, route.resourceID)
	case "charge":
		response = a.chargeHouseAccount(ctx, orgID, route.accountID, request.Body)
	case "invoice_generate":
		response = a.generateHouseAccountInvoice(ctx, orgID, route.accountID)
	case "invoice_list":
		response = a.listHouseAccountInvoices(ctx, orgID, route.accountID)
	case "invoice_pay":
		response = a.payHouseAccountInvoice(ctx, orgID, route.resourceID, request.Body)
	}
	return response, true, nil
}

func (a *application) createHouseAccount(ctx context.Context, userID, orgID, body string) events.APIGatewayV2HTTPResponse {
	var input map[string]any
	if decodeDataObject(body, &input) != nil {
		return errorResponse(400, "invalid request body")
	}
	if displayString(input["org_id"]) != orgID {
		return errorResponse(400, "org_id is required and must match the active organization")
	}
	name := strings.TrimSpace(displayString(input["name"]))
	if name == "" {
		return errorResponse(400, "name is required")
	}
	var creditLimit any
	if value, exists := input["credit_limit_cents"]; exists && value != nil {
		parsed, ok := integerValue(value)
		if !ok || parsed < 0 {
			return errorResponse(400, "credit_limit_cents must be >= 0")
		}
		creditLimit = parsed
	}
	var netTerms any
	if value, exists := input["net_terms_days"]; exists && value != nil {
		parsed, ok := integerValue(value)
		if !ok || parsed < 0 {
			return errorResponse(400, "net_terms_days must be >= 0")
		}
		netTerms = parsed
	}
	currency := ""
	organizations, err := a.organizationRows(ctx, userID)
	if err != nil {
		return dataAccessError(err)
	}
	for _, organization := range organizations {
		if displayString(organization["id"]) == orgID {
			currency = strings.ToUpper(displayString(organization["default_currency_code"]))
			break
		}
	}
	if len(currency) != 3 {
		return errorResponse(400, "organization has no valid default_currency_code")
	}
	account, err := a.createStoredRow(ctx, orgID, "house_accounts", map[string]any{
		"account_name": name, "contact_name": nullableString(input["contact_name"]),
		"contact_email": nullableString(input["contact_email"]), "contact_phone": nullableString(input["contact_phone"]),
		"billing_address": nullableString(input["billing_address"]), "credit_limit_cents": creditLimit,
		"current_balance_cents": int64(0), "currency": currency, "billing_cycle": "monthly",
		"net_terms_days": netTerms, "is_active": true, "notes": nullableString(input["notes"]),
	})
	if err != nil {
		return dataAccessError(err)
	}
	return mustJSONResponse(201, account)
}

func (a *application) getHouseAccount(ctx context.Context, orgID, accountID string) events.APIGatewayV2HTTPResponse {
	account, err := a.dataRowByID(ctx, orgID, "house_accounts", accountID)
	if errors.Is(err, errNotFound) {
		return errorResponse(404, "house account not found")
	} else if err != nil {
		return dataAccessError(err)
	}
	members, err := a.houseAccountRows(ctx, orgID, "house_account_members", accountID)
	if err != nil {
		return dataAccessError(err)
	}
	charges, err := a.houseAccountRows(ctx, orgID, "house_account_charges", accountID)
	if err != nil {
		return dataAccessError(err)
	}
	account["members"] = members
	account["outstanding_balance_cents"] = openHouseAccountBalance(charges)
	return mustJSONResponse(200, account)
}

func (a *application) houseAccountRows(ctx context.Context, orgID, table, accountID string) ([]map[string]any, error) {
	rows, err := a.queryDataRows(ctx, orgID, table)
	if err != nil {
		return nil, err
	}
	filtered := make([]map[string]any, 0)
	for _, row := range rows {
		if displayString(row["house_account_id"]) == accountID {
			filtered = append(filtered, row)
		}
	}
	return filtered, nil
}

func openHouseAccountBalance(charges []map[string]any) int64 {
	var total int64
	for _, charge := range charges {
		if displayString(charge["house_account_invoice_id"]) == "" {
			amount, _ := integerValue(charge["amount_cents"])
			total += amount
		}
	}
	return total
}

func (a *application) addHouseAccountMember(ctx context.Context, orgID, accountID, body string) events.APIGatewayV2HTTPResponse {
	account, err := a.dataRowByID(ctx, orgID, "house_accounts", accountID)
	if errors.Is(err, errNotFound) {
		return errorResponse(404, "house account not found")
	} else if err != nil {
		return dataAccessError(err)
	}
	if active, ok := account["is_active"].(bool); ok && !active {
		return errorResponse(409, "house account is closed")
	}
	var input map[string]any
	if decodeDataObject(body, &input) != nil {
		return errorResponse(400, "invalid request body")
	}
	customerID := strings.TrimSpace(displayString(input["customer_id"]))
	if customerID == "" {
		return errorResponse(400, "customer_id is required")
	}
	if _, err := a.dataRowByID(ctx, orgID, "customers", customerID); err != nil {
		return errorResponse(404, "customer not found")
	}
	var spendingLimit any
	if value, exists := input["spending_limit_cents"]; exists && value != nil {
		parsed, ok := integerValue(value)
		if !ok || parsed < 0 {
			return errorResponse(400, "spending_limit_cents must be >= 0")
		}
		spendingLimit = parsed
	}
	members, err := a.houseAccountRows(ctx, orgID, "house_account_members", accountID)
	if err != nil {
		return dataAccessError(err)
	}
	for _, member := range members {
		if displayString(member["customer_id"]) == customerID {
			return errorResponse(409, "customer is already a member of this account")
		}
	}
	member, err := a.createStoredRow(ctx, orgID, "house_account_members", map[string]any{
		"house_account_id": accountID, "customer_id": customerID,
		"spending_limit_cents": spendingLimit, "is_active": true,
	})
	if err != nil {
		return dataAccessError(err)
	}
	return mustJSONResponse(201, member)
}

func (a *application) removeHouseAccountMember(ctx context.Context, orgID, accountID, customerID string) events.APIGatewayV2HTTPResponse {
	members, err := a.houseAccountRows(ctx, orgID, "house_account_members", accountID)
	if err != nil {
		return dataAccessError(err)
	}
	for _, member := range members {
		if displayString(member["customer_id"]) == customerID {
			if err := a.deleteStoredRow(ctx, orgID, "house_account_members", displayString(member["id"])); err != nil {
				return dataAccessError(err)
			}
			return events.APIGatewayV2HTTPResponse{StatusCode: 204}
		}
	}
	return errorResponse(404, "member not found")
}

func (a *application) chargeHouseAccount(ctx context.Context, orgID, accountID, body string) events.APIGatewayV2HTTPResponse {
	account, err := a.dataRowByID(ctx, orgID, "house_accounts", accountID)
	if errors.Is(err, errNotFound) {
		return errorResponse(404, "house account not found")
	} else if err != nil {
		return dataAccessError(err)
	}
	if active, ok := account["is_active"].(bool); ok && !active {
		return errorResponse(409, "house account is closed")
	}
	var input map[string]any
	if decodeDataObject(body, &input) != nil {
		return errorResponse(400, "invalid request body")
	}
	orderID := strings.TrimSpace(displayString(input["order_id"]))
	amount, ok := integerValue(input["amount_cents"])
	if orderID == "" || !ok || amount <= 0 {
		return errorResponse(400, "order_id and amount_cents > 0 are required")
	}
	if _, err := a.dataRowByID(ctx, orgID, "orders", orderID); err != nil {
		return errorResponse(404, "order not found")
	}
	currentBalance, valid := integerValue(account["current_balance_cents"])
	if !valid {
		return errorResponse(409, "house account balance is invalid")
	}
	if limit, exists := integerValue(account["credit_limit_cents"]); exists && currentBalance+amount > limit {
		return errorResponse(422, "charge would exceed credit limit")
	}
	customerID := strings.TrimSpace(displayString(input["charged_by"]))
	if customerID != "" {
		member, found, err := a.houseAccountMember(ctx, orgID, accountID, customerID)
		if err != nil {
			return dataAccessError(err)
		}
		if !found || member["is_active"] == false {
			return errorResponse(422, "customer is not an active account member")
		}
		if limit, exists := integerValue(member["spending_limit_cents"]); exists {
			charges, err := a.houseAccountRows(ctx, orgID, "house_account_charges", accountID)
			if err != nil {
				return dataAccessError(err)
			}
			var customerTotal int64
			for _, charge := range charges {
				if displayString(charge["customer_id"]) == customerID && displayString(charge["house_account_invoice_id"]) == "" {
					value, _ := integerValue(charge["amount_cents"])
					customerTotal += value
				}
			}
			if customerTotal+amount > limit {
				return errorResponse(422, "charge would exceed member spending limit")
			}
		}
	}
	previousUpdated := account["updated_at"]
	account["current_balance_cents"] = currentBalance + amount
	account["updated_at"] = time.Now().UTC().Format(time.RFC3339Nano)
	if err := a.putDataRow(ctx, orgID, "house_accounts", account, false); err != nil {
		return dataAccessError(err)
	}
	charge, err := a.createStoredRow(ctx, orgID, "house_account_charges", map[string]any{
		"house_account_id": accountID, "order_id": orderID, "customer_id": nullableString(customerID),
		"amount_cents": amount, "house_account_invoice_id": nil,
	})
	if err != nil {
		account["current_balance_cents"], account["updated_at"] = currentBalance, previousUpdated
		_ = a.putDataRow(ctx, orgID, "house_accounts", account, false)
		return dataAccessError(err)
	}
	return mustJSONResponse(201, charge)
}

func (a *application) houseAccountMember(ctx context.Context, orgID, accountID, customerID string) (map[string]any, bool, error) {
	members, err := a.houseAccountRows(ctx, orgID, "house_account_members", accountID)
	if err != nil {
		return nil, false, err
	}
	for _, member := range members {
		if displayString(member["customer_id"]) == customerID {
			return member, true, nil
		}
	}
	return nil, false, nil
}

func (a *application) generateHouseAccountInvoice(ctx context.Context, orgID, accountID string) events.APIGatewayV2HTTPResponse {
	account, err := a.dataRowByID(ctx, orgID, "house_accounts", accountID)
	if errors.Is(err, errNotFound) {
		return errorResponse(404, "house account not found")
	} else if err != nil {
		return dataAccessError(err)
	}
	if active, ok := account["is_active"].(bool); ok && !active {
		return errorResponse(409, "house account is closed")
	}
	charges, err := a.houseAccountRows(ctx, orgID, "house_account_charges", accountID)
	if err != nil {
		return dataAccessError(err)
	}
	open := make([]map[string]any, 0)
	for _, charge := range charges {
		if displayString(charge["house_account_invoice_id"]) == "" {
			open = append(open, charge)
		}
	}
	if len(open) == 0 {
		return errorResponse(422, "no open charges to invoice")
	}
	sort.Slice(open, func(i, j int) bool {
		return displayString(open[i]["created_at"]) < displayString(open[j]["created_at"])
	})
	total := openHouseAccountBalance(open)
	now := time.Now().UTC()
	dueDate := any(nil)
	if days, ok := integerValue(account["net_terms_days"]); ok {
		dueDate = now.AddDate(0, 0, int(days)).Format(time.RFC3339)
	}
	prefix := strings.ReplaceAll(accountID, "-", "")
	if len(prefix) > 8 {
		prefix = prefix[:8]
	}
	invoice, err := a.createStoredRow(ctx, orgID, "house_account_invoices", map[string]any{
		"house_account_id": accountID, "invoice_number": fmt.Sprintf("HA-%s-%s", strings.ToUpper(prefix), now.Format("20060102-150405")),
		"period_start":   dateFromTimestamp(displayString(open[0]["created_at"])),
		"period_end":     dateFromTimestamp(displayString(open[len(open)-1]["created_at"])),
		"subtotal_cents": total, "tax_cents": int64(0), "total_cents": total, "status": "sent",
		"due_date": dueDate, "sent_at": now.Format(time.RFC3339Nano), "paid_at": nil,
		"paid_amount_cents": int64(0), "pdf_url": nil, "notes": nil,
	})
	if err != nil {
		return dataAccessError(err)
	}
	updated := make([]map[string]any, 0, len(open))
	for _, charge := range open {
		charge["house_account_invoice_id"] = invoice["id"]
		charge["updated_at"] = now.Format(time.RFC3339Nano)
		if err := a.putDataRow(ctx, orgID, "house_account_charges", charge, false); err != nil {
			for _, previous := range updated {
				previous["house_account_invoice_id"] = nil
				_ = a.putDataRow(ctx, orgID, "house_account_charges", previous, false)
			}
			_ = a.deleteStoredRow(ctx, orgID, "house_account_invoices", displayString(invoice["id"]))
			return dataAccessError(err)
		}
		updated = append(updated, charge)
	}
	return mustJSONResponse(201, invoice)
}

func dateFromTimestamp(value string) string {
	if parsed, err := time.Parse(time.RFC3339Nano, value); err == nil {
		return parsed.UTC().Format("2006-01-02")
	}
	if len(value) >= 10 {
		return value[:10]
	}
	return time.Now().UTC().Format("2006-01-02")
}

func (a *application) listHouseAccountInvoices(ctx context.Context, orgID, accountID string) events.APIGatewayV2HTTPResponse {
	if _, err := a.dataRowByID(ctx, orgID, "house_accounts", accountID); errors.Is(err, errNotFound) {
		return errorResponse(404, "house account not found")
	} else if err != nil {
		return dataAccessError(err)
	}
	invoices, err := a.houseAccountRows(ctx, orgID, "house_account_invoices", accountID)
	if err != nil {
		return dataAccessError(err)
	}
	sort.Slice(invoices, func(i, j int) bool {
		return displayString(invoices[i]["created_at"]) > displayString(invoices[j]["created_at"])
	})
	return mustJSONResponse(200, invoices)
}

func (a *application) payHouseAccountInvoice(ctx context.Context, orgID, invoiceID, body string) events.APIGatewayV2HTTPResponse {
	var input map[string]any
	if decodeDataObject(body, &input) != nil {
		return errorResponse(400, "invalid request body")
	}
	payment, ok := integerValue(input["payment_cents"])
	if !ok || payment <= 0 {
		return errorResponse(400, "payment_cents must be > 0")
	}
	invoice, err := a.dataRowByID(ctx, orgID, "house_account_invoices", invoiceID)
	if errors.Is(err, errNotFound) {
		return errorResponse(404, "invoice not found")
	} else if err != nil {
		return dataAccessError(err)
	}
	total, totalOK := integerValue(invoice["total_cents"])
	paid, paidOK := integerValue(invoice["paid_amount_cents"])
	if !totalOK || !paidOK {
		return errorResponse(409, "invoice balance is invalid")
	}
	if displayString(invoice["status"]) == "paid" || paid >= total {
		return errorResponse(409, "invoice is already paid")
	}
	if payment > total-paid {
		return errorResponse(422, "payment exceeds invoice balance")
	}
	accountID := displayString(invoice["house_account_id"])
	account, err := a.dataRowByID(ctx, orgID, "house_accounts", accountID)
	if err != nil {
		return dataAccessError(err)
	}
	currentBalance, valid := integerValue(account["current_balance_cents"])
	if !valid {
		return errorResponse(409, "house account balance is invalid")
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	newPaid := paid + payment
	previousStatus, previousPaidAt, previousInvoiceUpdated := invoice["status"], invoice["paid_at"], invoice["updated_at"]
	invoice["paid_amount_cents"], invoice["updated_at"] = newPaid, now
	if newPaid == total {
		invoice["status"], invoice["paid_at"] = "paid", now
	} else {
		invoice["status"] = "partial"
	}
	if err := a.putDataRow(ctx, orgID, "house_account_invoices", invoice, false); err != nil {
		return dataAccessError(err)
	}
	newBalance := currentBalance - payment
	if newBalance < 0 {
		newBalance = 0
	}
	account["current_balance_cents"], account["updated_at"] = newBalance, now
	if err := a.putDataRow(ctx, orgID, "house_accounts", account, false); err != nil {
		invoice["paid_amount_cents"], invoice["updated_at"] = paid, previousInvoiceUpdated
		invoice["status"], invoice["paid_at"] = previousStatus, previousPaidAt
		_ = a.putDataRow(ctx, orgID, "house_account_invoices", invoice, false)
		return dataAccessError(err)
	}
	return mustJSONResponse(200, invoice)
}
