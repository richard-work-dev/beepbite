package main

import (
	"testing"
	"time"
)

func TestSingleStoreValidation(t *testing.T) {
	valid := singleStoreConfig{
		Enabled: true, OwnerEmail: "owner@example.com", Name: "RikoPollo",
		Country: "Argentina", City: "Aristóbulo del Valle", Address: "Av. Las Américas 650, N3364 Aristóbulo del Valle, Misiones, Argentina",
		TimeZone: "America/Argentina/Cordoba", Currency: "ARS", TaxRate: 21, TaxInclusive: true,
	}
	if err := valid.validate(); err != nil {
		t.Fatalf("valid config rejected: %v", err)
	}
	valid.Currency = "AR"
	if err := valid.validate(); err == nil {
		t.Fatal("invalid currency accepted")
	}
}

func TestSingleStoreOwnerSignupItems(t *testing.T) {
	config := singleStoreConfig{
		Enabled: true, OwnerEmail: "owner@example.com", Name: "RikoPollo",
		Country: "Argentina", City: "Aristóbulo del Valle", Address: "Av. Las Américas 650, N3364 Aristóbulo del Valle, Misiones, Argentina",
		TimeZone: "America/Argentina/Cordoba", Currency: "ARS", TaxRate: 21, TaxInclusive: true,
	}
	items, err := config.signupItems("user-1", "OWNER@example.com", time.Unix(1, 0))
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 4 {
		t.Fatalf("got %d bootstrap items, want 4", len(items))
	}
	location, ok := decodeJSONItem(items[3].Put.Item)
	if !ok || displayString(location["service_style"]) != "takeaway" {
		t.Fatalf("single-store location must default to takeaway: %#v", location["service_style"])
	}
	app := application{table: "core"}
	if err := app.bindSingleStoreTable(items); err != nil {
		t.Fatal(err)
	}
	for _, item := range items {
		if item.Put == nil || item.Put.TableName == nil || *item.Put.TableName != "core" {
			t.Fatal("bootstrap item did not receive the DynamoDB table")
		}
	}
	invitedItems, err := config.signupItems("user-2", "staff@example.com", time.Unix(1, 0))
	if err != nil || len(invitedItems) != 0 {
		t.Fatalf("staff signup should not bootstrap a store: items=%d err=%v", len(invitedItems), err)
	}
}
