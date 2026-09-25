package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

type singleStoreConfig struct {
	Enabled      bool
	OwnerEmail   string
	Name         string
	Country      string
	City         string
	Address      string
	TimeZone     string
	Currency     string
	TaxRate      float64
	TaxInclusive bool
}

func loadSingleStoreConfig() singleStoreConfig {
	taxRate, _ := strconv.ParseFloat(strings.TrimSpace(os.Getenv("SINGLE_STORE_TAX_RATE")), 64)
	return singleStoreConfig{
		Enabled:      strings.EqualFold(strings.TrimSpace(os.Getenv("SINGLE_STORE_ENABLED")), "true"),
		OwnerEmail:   strings.ToLower(strings.TrimSpace(os.Getenv("SINGLE_STORE_OWNER_EMAIL"))),
		Name:         strings.TrimSpace(os.Getenv("SINGLE_STORE_NAME")),
		Country:      strings.TrimSpace(os.Getenv("SINGLE_STORE_COUNTRY")),
		City:         strings.TrimSpace(os.Getenv("SINGLE_STORE_CITY")),
		Address:      strings.TrimSpace(os.Getenv("SINGLE_STORE_ADDRESS")),
		TimeZone:     strings.TrimSpace(os.Getenv("SINGLE_STORE_TIME_ZONE")),
		Currency:     strings.ToUpper(strings.TrimSpace(os.Getenv("SINGLE_STORE_CURRENCY"))),
		TaxRate:      taxRate,
		TaxInclusive: strings.EqualFold(strings.TrimSpace(os.Getenv("SINGLE_STORE_TAX_INCLUSIVE")), "true"),
	}
}

func (c singleStoreConfig) validate() error {
	if !c.Enabled {
		return nil
	}
	if _, err := normalizeEmail(c.OwnerEmail); err != nil {
		return errors.New("single-store owner email is invalid")
	}
	if len(c.Name) < 2 || c.Country == "" || c.City == "" || c.Address == "" || c.TimeZone == "" || len(c.Currency) != 3 {
		return errors.New("single-store business configuration is incomplete")
	}
	if c.TaxRate < 0 || c.TaxRate > 100 {
		return errors.New("single-store tax rate must be between 0 and 100")
	}
	return nil
}

func (c singleStoreConfig) signupItems(userID, email string, createdAt time.Time) ([]types.TransactWriteItem, error) {
	if !c.Enabled || !strings.EqualFold(c.OwnerEmail, email) {
		return nil, nil
	}
	const orgID = "rikopollo"
	const locationID = "rikopollo-main"
	now := createdAt.UTC().Format(time.RFC3339Nano)
	organization := map[string]any{
		"id": orgID, "name": c.Name, "slug": "rikopollo", "is_active": true,
		"default_currency_code": c.Currency, "country": c.Country, "city": c.City,
		"address": c.Address, "timezone": c.TimeZone, "tax_rate": c.TaxRate,
		"tax_inclusive": c.TaxInclusive, "created_by": userID, "created_at": now, "updated_at": now,
	}
	membership := map[string]any{
		"id": "rikopollo-owner", "organization_id": orgID, "profile_id": userID,
		"role": "owner", "capabilities": memberCapabilities("owner"), "created_at": now, "updated_at": now,
	}
	location := map[string]any{
		"id": locationID, "organization_id": orgID, "name": c.Name, "slug": "rikopollo",
		"country": c.Country, "city": c.City, "address": c.Address, "timezone": c.TimeZone,
		"currency_code": c.Currency, "tax_rate": c.TaxRate, "tax_inclusive": c.TaxInclusive,
		"tax_label": "IVA", "service_style": "takeaway", "is_active": true, "created_at": now, "updated_at": now,
	}
	orgItem, err := jsonDataItem("ORG#"+orgID, "PROFILE", "organization", orgID, organization)
	if err != nil {
		return nil, err
	}
	userMembership, orgMembership, err := membershipItems(userID, orgID, membership)
	if err != nil {
		return nil, err
	}
	locationItem, err := jsonDataItem("ORG#"+orgID, "DATA#locations#"+locationID, "locations", locationID, location)
	if err != nil {
		return nil, err
	}
	condition := aws.String("attribute_not_exists(PK)")
	return []types.TransactWriteItem{
		{Put: &types.Put{TableName: nil, Item: orgItem, ConditionExpression: condition}},
		{Put: &types.Put{TableName: nil, Item: userMembership, ConditionExpression: condition}},
		{Put: &types.Put{TableName: nil, Item: orgMembership, ConditionExpression: condition}},
		{Put: &types.Put{TableName: nil, Item: locationItem, ConditionExpression: condition}},
	}, nil
}

func (a *application) hasPendingStoreInvite(ctx context.Context, email string) (bool, error) {
	rows, err := a.scanDataRowsByEntity(ctx, "organization_invites")
	if err != nil {
		return false, err
	}
	for _, row := range rows {
		if strings.EqualFold(displayString(row["email"]), email) && displayString(row["status"]) == "pending" {
			return true, nil
		}
	}
	return false, nil
}

func (a *application) bindSingleStoreTable(items []types.TransactWriteItem) error {
	for index := range items {
		if items[index].Put == nil {
			return fmt.Errorf("single-store transaction item %d is not a put", index)
		}
		items[index].Put.TableName = aws.String(a.table)
	}
	return nil
}
