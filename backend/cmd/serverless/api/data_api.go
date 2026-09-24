package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

const maxMutationRows = 100

type dataFilter struct {
	op     string
	column string
	values []string
}

type dataOrder struct {
	column    string
	ascending bool
}

type dataQuery struct {
	filters []dataFilter
	or      []dataFilter
	orders  []dataOrder
	selects []string
	limit   int
	single  bool
}

func dataTableFromPath(path string) (string, bool) {
	for _, prefix := range []string{"/data/", "/api/v1/data/"} {
		if strings.HasPrefix(path, prefix) {
			table := strings.Trim(strings.TrimPrefix(path, prefix), "/")
			if table != "" && !strings.Contains(table, "/") {
				return table, true
			}
		}
	}
	return "", false
}

func (a *application) handleData(ctx context.Context, request events.APIGatewayV2HTTPRequest, table string) (events.APIGatewayV2HTTPResponse, error) {
	ops, exposed := serverlessDataTables[table]
	if !exposed {
		return errorResponse(404, "table not exposed"), nil
	}
	claims, err := a.authenticate(ctx, request.Headers)
	if err != nil {
		return errorResponse(401, "invalid token"), nil
	}
	query, err := parseDataQuery(request.RawQueryString)
	if err != nil {
		return errorResponse(400, err.Error()), nil
	}

	switch request.RequestContext.HTTP.Method {
	case "GET":
		if !ops.Select {
			return errorResponse(405, "operation not allowed"), nil
		}
		return a.listData(ctx, request, claims.UserID, table, query)
	case "POST":
		if !ops.Insert {
			return errorResponse(405, "operation not allowed"), nil
		}
		return a.insertData(ctx, request, claims.UserID, table)
	case "PATCH":
		if !ops.Update {
			return errorResponse(405, "operation not allowed"), nil
		}
		return a.updateData(ctx, request, claims.UserID, table, query)
	case "DELETE":
		if !ops.Delete {
			return errorResponse(405, "operation not allowed"), nil
		}
		return a.deleteData(ctx, request, claims.UserID, table, query)
	default:
		return errorResponse(405, "method not allowed"), nil
	}
}

func (a *application) listData(ctx context.Context, request events.APIGatewayV2HTTPRequest, userID, table string, query dataQuery) (events.APIGatewayV2HTTPResponse, error) {
	var rows []map[string]any
	var err error
	switch table {
	case "profiles":
		rows, err = a.profileRows(ctx, userID)
	case "organizations":
		rows, err = a.organizationRows(ctx, userID)
	case "organization_members":
		rows, err = a.membershipRows(ctx, request, userID)
	default:
		var orgID string
		orgID, err = a.authorizedOrganization(ctx, request, userID)
		if err == nil {
			rows, err = a.queryDataRows(ctx, orgID, table)
		}
	}
	if err != nil {
		return dataAccessError(err), nil
	}
	return dataRowsResponse(rows, query)
}

func (a *application) insertData(ctx context.Context, request events.APIGatewayV2HTTPRequest, userID, table string) (events.APIGatewayV2HTTPResponse, error) {
	rows, wasArray, err := decodeDataRows(request.Body)
	if err != nil || len(rows) == 0 {
		return errorResponse(400, "valid JSON object or non-empty array required"), nil
	}
	if len(rows) > maxMutationRows {
		return errorResponse(400, "too many rows"), nil
	}

	if table == "organizations" {
		if a.singleStore.Enabled {
			return errorResponse(403, "este sistema está configurado para una sola tienda"), nil
		}
		if len(rows) != 1 {
			return errorResponse(400, "create one organization at a time"), nil
		}
		created, createErr := a.createOrganization(ctx, userID, rows[0])
		if createErr != nil {
			return dataAccessError(createErr), nil
		}
		return jsonResponse(201, created)
	}
	if table == "organization_members" {
		created := make([]map[string]any, 0, len(rows))
		for _, row := range rows {
			member, createErr := a.createMembership(ctx, request, userID, row)
			if createErr != nil {
				return dataAccessError(createErr), nil
			}
			created = append(created, member)
		}
		return dataMutationResponse(201, created, wasArray)
	}
	if table == "profiles" {
		return errorResponse(405, "profiles are created during signup"), nil
	}

	orgID, err := a.authorizedOrganization(ctx, request, userID)
	if err != nil {
		return dataAccessError(err), nil
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	created := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		if _, ok := row["id"].(string); !ok || strings.TrimSpace(fmt.Sprint(row["id"])) == "" {
			id, idErr := randomID()
			if idErr != nil {
				return events.APIGatewayV2HTTPResponse{}, idErr
			}
			row["id"] = id
		}
		// The authenticated membership is authoritative. Never let a caller
		// persist a different tenant identifier inside the scoped partition.
		row["organization_id"] = orgID
		if _, ok := row["created_at"]; !ok {
			row["created_at"] = now
		}
		row["updated_at"] = now
		if err := validateDataRow(table, row); err != nil {
			return errorResponse(400, err.Error()), nil
		}
		if err := a.putDataRow(ctx, orgID, table, row, true); err != nil {
			return dataAccessError(err), nil
		}
		created = append(created, row)
	}
	return dataMutationResponse(201, created, wasArray)
}

func (a *application) updateData(ctx context.Context, request events.APIGatewayV2HTTPRequest, userID, table string, query dataQuery) (events.APIGatewayV2HTTPResponse, error) {
	if len(query.filters) == 0 && len(query.or) == 0 {
		return errorResponse(400, "update requires a filter"), nil
	}
	var changes map[string]any
	if err := decodeDataObject(request.Body, &changes); err != nil {
		return errorResponse(400, "valid JSON object required"), nil
	}
	delete(changes, "id")
	delete(changes, "organization_id")
	delete(changes, "created_at")

	if table == "profiles" {
		updated, err := a.updateProfile(ctx, userID, changes)
		if err != nil {
			return dataAccessError(err), nil
		}
		return jsonResponse(200, []map[string]any{updated})
	}
	if table == "organizations" {
		updated, err := a.updateOrganizations(ctx, request, userID, query, changes)
		if err != nil {
			return dataAccessError(err), nil
		}
		return jsonResponse(200, updated)
	}
	if table == "organization_members" {
		updated, err := a.updateMemberships(ctx, request, userID, query, changes)
		if err != nil {
			return dataAccessError(err), nil
		}
		return jsonResponse(200, updated)
	}

	orgID, err := a.authorizedOrganization(ctx, request, userID)
	if err != nil {
		return dataAccessError(err), nil
	}
	rows, err := a.queryDataRows(ctx, orgID, table)
	if err != nil {
		return dataAccessError(err), nil
	}
	rows = applyDataFilters(rows, query)
	if len(rows) > maxMutationRows {
		return errorResponse(409, "update matches too many rows"), nil
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	for _, row := range rows {
		for key, value := range changes {
			row[key] = value
		}
		row["updated_at"] = now
		if err := validateDataRow(table, row); err != nil {
			return errorResponse(400, err.Error()), nil
		}
		if err := a.putDataRow(ctx, orgID, table, row, false); err != nil {
			return dataAccessError(err), nil
		}
	}
	return jsonResponse(200, rows)
}

func (a *application) deleteData(ctx context.Context, request events.APIGatewayV2HTTPRequest, userID, table string, query dataQuery) (events.APIGatewayV2HTTPResponse, error) {
	if len(query.filters) == 0 && len(query.or) == 0 {
		return errorResponse(400, "delete requires a filter"), nil
	}
	if table == "profiles" || table == "organizations" {
		return errorResponse(405, "resource cannot be deleted through the data API"), nil
	}
	if table == "organization_members" {
		if err := a.deleteMemberships(ctx, request, userID, query); err != nil {
			return dataAccessError(err), nil
		}
		return events.APIGatewayV2HTTPResponse{StatusCode: 204}, nil
	}
	orgID, err := a.authorizedOrganization(ctx, request, userID)
	if err != nil {
		return dataAccessError(err), nil
	}
	rows, err := a.queryDataRows(ctx, orgID, table)
	if err != nil {
		return dataAccessError(err), nil
	}
	rows = applyDataFilters(rows, query)
	if len(rows) > maxMutationRows {
		return errorResponse(409, "delete matches too many rows"), nil
	}
	for _, row := range rows {
		id := fmt.Sprint(row["id"])
		_, err = a.dynamo.DeleteItem(ctx, &dynamodb.DeleteItemInput{
			TableName: aws.String(a.table),
			Key:       dataRowKey(orgID, table, id),
		})
		if err != nil {
			return events.APIGatewayV2HTTPResponse{}, err
		}
	}
	return events.APIGatewayV2HTTPResponse{StatusCode: 204}, nil
}

func (a *application) authorizedOrganization(ctx context.Context, request events.APIGatewayV2HTTPRequest, userID string) (string, error) {
	orgID := requestHeader(request.Headers, "x-organization-id")
	if orgID == "" {
		return "", errOrganizationRequired
	}
	if _, err := a.getMembership(ctx, userID, orgID); err != nil {
		return "", errForbidden
	}
	return orgID, nil
}

func (a *application) profileRows(ctx context.Context, userID string) ([]map[string]any, error) {
	result, err := a.dynamo.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(a.table),
		Key: map[string]types.AttributeValue{
			"PK": &types.AttributeValueMemberS{Value: "USER#" + userID},
			"SK": &types.AttributeValueMemberS{Value: "PROFILE"},
		},
	})
	if err != nil || len(result.Item) == 0 {
		return nil, errNotFound
	}
	row := map[string]any{
		"id":             userID,
		"email":          stringValue(result.Item["email"]),
		"email_verified": boolValue(result.Item["email_verified"]),
	}
	if metadata := stringValue(result.Item["metadata"]); metadata != "" {
		var values map[string]any
		if json.Unmarshal([]byte(metadata), &values) == nil {
			for key, value := range values {
				row[key] = value
			}
		}
	}
	return []map[string]any{row}, nil
}

func (a *application) updateProfile(ctx context.Context, userID string, changes map[string]any) (map[string]any, error) {
	rows, err := a.profileRows(ctx, userID)
	if err != nil {
		return nil, err
	}
	profile := rows[0]
	delete(changes, "email")
	delete(changes, "email_verified")
	for key, value := range changes {
		profile[key] = value
	}
	metadata := map[string]any{}
	for key, value := range profile {
		if key != "id" && key != "email" && key != "email_verified" {
			metadata[key] = value
		}
	}
	payload, err := json.Marshal(metadata)
	if err != nil {
		return nil, err
	}
	_, err = a.dynamo.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(a.table),
		Key: map[string]types.AttributeValue{
			"PK": &types.AttributeValueMemberS{Value: "USER#" + userID},
			"SK": &types.AttributeValueMemberS{Value: "PROFILE"},
		},
		UpdateExpression: aws.String("SET metadata = :metadata"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":metadata": &types.AttributeValueMemberS{Value: string(payload)},
		},
	})
	return profile, err
}

func (a *application) createOrganization(ctx context.Context, userID string, row map[string]any) (map[string]any, error) {
	name := strings.TrimSpace(fmt.Sprint(row["name"]))
	if len(name) < 2 || len(name) > 120 {
		return nil, fmt.Errorf("%w: organization name must contain 2 to 120 characters", errInvalidData)
	}
	id, _ := row["id"].(string)
	if id == "" {
		var err error
		id, err = randomID()
		if err != nil {
			return nil, err
		}
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	row["id"] = id
	row["name"] = name
	if strings.TrimSpace(fmt.Sprint(row["slug"])) == "" {
		suffix := strings.ReplaceAll(id, "-", "")
		if len(suffix) > 8 {
			suffix = suffix[:8]
		}
		row["slug"] = slugify(name) + "-" + suffix
	}
	if _, ok := row["is_active"]; !ok {
		row["is_active"] = true
	}
	row["created_at"] = now
	row["updated_at"] = now
	row["created_by"] = userID
	membershipID, err := randomID()
	if err != nil {
		return nil, err
	}
	membership := map[string]any{
		"id": membershipID, "organization_id": id, "profile_id": userID,
		"role": "owner", "created_at": now, "updated_at": now,
	}
	orgItem, err := jsonDataItem("ORG#"+id, "PROFILE", "organization", id, row)
	if err != nil {
		return nil, err
	}
	userMembership, orgMembership, err := membershipItems(userID, id, membership)
	if err != nil {
		return nil, err
	}
	_, err = a.dynamo.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{TransactItems: []types.TransactWriteItem{
		{Put: &types.Put{TableName: aws.String(a.table), Item: orgItem, ConditionExpression: aws.String("attribute_not_exists(PK)")}},
		{Put: &types.Put{TableName: aws.String(a.table), Item: userMembership, ConditionExpression: aws.String("attribute_not_exists(PK)")}},
		{Put: &types.Put{TableName: aws.String(a.table), Item: orgMembership, ConditionExpression: aws.String("attribute_not_exists(PK)")}},
	}})
	if err != nil {
		return nil, errConflict
	}
	return row, nil
}

func (a *application) organizationRows(ctx context.Context, userID string) ([]map[string]any, error) {
	memberships, err := a.queryJSONRows(ctx, "USER#"+userID, "MEMBERSHIP#")
	if err != nil {
		return nil, err
	}
	rows := make([]map[string]any, 0, len(memberships))
	for _, membership := range memberships {
		orgID := fmt.Sprint(membership["organization_id"])
		result, getErr := a.dynamo.GetItem(ctx, &dynamodb.GetItemInput{
			TableName: aws.String(a.table),
			Key: map[string]types.AttributeValue{
				"PK": &types.AttributeValueMemberS{Value: "ORG#" + orgID},
				"SK": &types.AttributeValueMemberS{Value: "PROFILE"},
			},
		})
		if getErr != nil {
			return nil, getErr
		}
		if row, ok := decodeJSONItem(result.Item); ok {
			rows = append(rows, row)
		}
	}
	return rows, nil
}

func (a *application) updateOrganizations(ctx context.Context, request events.APIGatewayV2HTTPRequest, userID string, query dataQuery, changes map[string]any) ([]map[string]any, error) {
	orgID, err := a.authorizedOrganization(ctx, request, userID)
	if err != nil {
		return nil, err
	}
	membership, err := a.getMembership(ctx, userID, orgID)
	if err != nil || !managerRole(fmt.Sprint(membership["role"])) {
		return nil, errForbidden
	}
	rows, err := a.organizationRows(ctx, userID)
	if err != nil {
		return nil, err
	}
	rows = applyDataFilters(rows, query)
	updated := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		if fmt.Sprint(row["id"]) != orgID {
			continue
		}
		for key, value := range changes {
			row[key] = value
		}
		row["updated_at"] = time.Now().UTC().Format(time.RFC3339Nano)
		item, itemErr := jsonDataItem("ORG#"+orgID, "PROFILE", "organization", orgID, row)
		if itemErr != nil {
			return nil, itemErr
		}
		if _, itemErr = a.dynamo.PutItem(ctx, &dynamodb.PutItemInput{TableName: aws.String(a.table), Item: item}); itemErr != nil {
			return nil, itemErr
		}
		updated = append(updated, row)
	}
	return updated, nil
}

func (a *application) membershipRows(ctx context.Context, request events.APIGatewayV2HTTPRequest, userID string) ([]map[string]any, error) {
	orgID := requestHeader(request.Headers, "x-organization-id")
	if orgID == "" {
		return a.queryJSONRows(ctx, "USER#"+userID, "MEMBERSHIP#")
	}
	if _, err := a.getMembership(ctx, userID, orgID); err != nil {
		return nil, errForbidden
	}
	return a.queryJSONRows(ctx, "ORG#"+orgID, "MEMBER#")
}

func (a *application) createMembership(ctx context.Context, request events.APIGatewayV2HTTPRequest, requesterID string, row map[string]any) (map[string]any, error) {
	orgID := strings.TrimSpace(fmt.Sprint(row["organization_id"]))
	profileID := strings.TrimSpace(fmt.Sprint(row["profile_id"]))
	if orgID == "" || profileID == "" {
		return nil, fmt.Errorf("%w: organization_id and profile_id are required", errInvalidData)
	}
	if existing, existingErr := a.getMembership(ctx, profileID, orgID); existingErr == nil {
		if profileID == requesterID {
			return existing, nil
		}
		requester, requesterErr := a.getMembership(ctx, requesterID, orgID)
		if requesterErr != nil || !managerRole(fmt.Sprint(requester["role"])) {
			return nil, errForbidden
		}
		return existing, nil
	}
	requester, err := a.getMembership(ctx, requesterID, orgID)
	if err != nil || !managerRole(fmt.Sprint(requester["role"])) {
		return nil, errForbidden
	}
	role := strings.ToLower(strings.TrimSpace(fmt.Sprint(row["role"])))
	if role == "" {
		role = "member"
	}
	if !validOrganizationRole(role) {
		return nil, fmt.Errorf("%w: invalid organization role", errInvalidData)
	}
	id, _ := row["id"].(string)
	if id == "" {
		id, err = randomID()
		if err != nil {
			return nil, err
		}
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	row["id"] = id
	row["organization_id"] = orgID
	row["profile_id"] = profileID
	row["role"] = role
	row["created_at"] = now
	row["updated_at"] = now
	userItem, orgItem, err := membershipItems(profileID, orgID, row)
	if err != nil {
		return nil, err
	}
	_, err = a.dynamo.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{TransactItems: []types.TransactWriteItem{
		{Put: &types.Put{TableName: aws.String(a.table), Item: userItem, ConditionExpression: aws.String("attribute_not_exists(PK)")}},
		{Put: &types.Put{TableName: aws.String(a.table), Item: orgItem, ConditionExpression: aws.String("attribute_not_exists(PK)")}},
	}})
	if err != nil {
		return nil, errConflict
	}
	return row, nil
}

func (a *application) getMembership(ctx context.Context, userID, orgID string) (map[string]any, error) {
	result, err := a.dynamo.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(a.table),
		Key: map[string]types.AttributeValue{
			"PK": &types.AttributeValueMemberS{Value: "USER#" + userID},
			"SK": &types.AttributeValueMemberS{Value: "MEMBERSHIP#" + orgID},
		},
		ConsistentRead: aws.Bool(true),
	})
	if err != nil {
		return nil, err
	}
	row, ok := decodeJSONItem(result.Item)
	if !ok {
		return nil, errNotFound
	}
	return row, nil
}

func membershipItems(userID, orgID string, row map[string]any) (map[string]types.AttributeValue, map[string]types.AttributeValue, error) {
	userItem, err := jsonDataItem("USER#"+userID, "MEMBERSHIP#"+orgID, "organization_membership", fmt.Sprint(row["id"]), row)
	if err != nil {
		return nil, nil, err
	}
	orgItem, err := jsonDataItem("ORG#"+orgID, "MEMBER#"+userID, "organization_member", fmt.Sprint(row["id"]), row)
	return userItem, orgItem, err
}

func (a *application) updateMemberships(ctx context.Context, request events.APIGatewayV2HTTPRequest, requesterID string, query dataQuery, changes map[string]any) ([]map[string]any, error) {
	orgID, err := a.authorizedOrganization(ctx, request, requesterID)
	if err != nil {
		return nil, err
	}
	requester, err := a.getMembership(ctx, requesterID, orgID)
	if err != nil || !managerRole(fmt.Sprint(requester["role"])) {
		return nil, errForbidden
	}
	delete(changes, "profile_id")
	if role, changed := changes["role"]; changed && !validOrganizationRole(strings.ToLower(strings.TrimSpace(fmt.Sprint(role)))) {
		return nil, fmt.Errorf("%w: invalid organization role", errInvalidData)
	}
	rows, err := a.queryJSONRows(ctx, "ORG#"+orgID, "MEMBER#")
	if err != nil {
		return nil, err
	}
	targets := applyDataFilters(rows, query)
	if len(targets) > maxMutationRows {
		return nil, errConflict
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	for _, row := range targets {
		for key, value := range changes {
			if key == "role" {
				value = strings.ToLower(strings.TrimSpace(fmt.Sprint(value)))
			}
			row[key] = value
		}
		row["updated_at"] = now
	}
	if !hasOrganizationOwner(rows) {
		return nil, fmt.Errorf("%w: an organization must retain at least one owner", errInvalidData)
	}
	for _, row := range targets {
		profileID := strings.TrimSpace(fmt.Sprint(row["profile_id"]))
		userItem, orgItem, itemErr := membershipItems(profileID, orgID, row)
		if itemErr != nil {
			return nil, itemErr
		}
		_, itemErr = a.dynamo.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{TransactItems: []types.TransactWriteItem{
			{Put: &types.Put{TableName: aws.String(a.table), Item: userItem}},
			{Put: &types.Put{TableName: aws.String(a.table), Item: orgItem}},
		}})
		if itemErr != nil {
			return nil, itemErr
		}
	}
	return targets, nil
}

func (a *application) deleteMemberships(ctx context.Context, request events.APIGatewayV2HTTPRequest, requesterID string, query dataQuery) error {
	orgID, err := a.authorizedOrganization(ctx, request, requesterID)
	if err != nil {
		return err
	}
	requester, err := a.getMembership(ctx, requesterID, orgID)
	if err != nil || !managerRole(fmt.Sprint(requester["role"])) {
		return errForbidden
	}
	rows, err := a.queryJSONRows(ctx, "ORG#"+orgID, "MEMBER#")
	if err != nil {
		return err
	}
	targets := applyDataFilters(rows, query)
	if len(targets) > maxMutationRows {
		return errConflict
	}
	removed := make(map[string]bool, len(targets))
	for _, row := range targets {
		removed[fmt.Sprint(row["profile_id"])] = true
	}
	remaining := make([]map[string]any, 0, len(rows)-len(targets))
	for _, row := range rows {
		if !removed[fmt.Sprint(row["profile_id"])] {
			remaining = append(remaining, row)
		}
	}
	if !hasOrganizationOwner(remaining) {
		return fmt.Errorf("%w: an organization must retain at least one owner", errInvalidData)
	}
	for _, row := range targets {
		profileID := strings.TrimSpace(fmt.Sprint(row["profile_id"]))
		_, err = a.dynamo.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{TransactItems: []types.TransactWriteItem{
			{Delete: &types.Delete{TableName: aws.String(a.table), Key: map[string]types.AttributeValue{
				"PK": &types.AttributeValueMemberS{Value: "USER#" + profileID},
				"SK": &types.AttributeValueMemberS{Value: "MEMBERSHIP#" + orgID},
			}}},
			{Delete: &types.Delete{TableName: aws.String(a.table), Key: map[string]types.AttributeValue{
				"PK": &types.AttributeValueMemberS{Value: "ORG#" + orgID},
				"SK": &types.AttributeValueMemberS{Value: "MEMBER#" + profileID},
			}}},
		}})
		if err != nil {
			return err
		}
	}
	return nil
}

func hasOrganizationOwner(rows []map[string]any) bool {
	for _, row := range rows {
		if strings.EqualFold(fmt.Sprint(row["role"]), "owner") {
			return true
		}
	}
	return false
}

func (a *application) queryDataRows(ctx context.Context, orgID, table string) ([]map[string]any, error) {
	return a.queryJSONRows(ctx, "ORG#"+orgID, "DATA#"+table+"#")
}

func (a *application) queryJSONRows(ctx context.Context, partition, prefix string) ([]map[string]any, error) {
	rows := []map[string]any{}
	var startKey map[string]types.AttributeValue
	for {
		result, err := a.dynamo.Query(ctx, &dynamodb.QueryInput{
			TableName:              aws.String(a.table),
			KeyConditionExpression: aws.String("PK = :pk AND begins_with(SK, :prefix)"),
			ExpressionAttributeValues: map[string]types.AttributeValue{
				":pk":     &types.AttributeValueMemberS{Value: partition},
				":prefix": &types.AttributeValueMemberS{Value: prefix},
			},
			ExclusiveStartKey: startKey,
			ConsistentRead:    aws.Bool(true),
		})
		if err != nil {
			return nil, err
		}
		for _, item := range result.Items {
			if row, ok := decodeJSONItem(item); ok {
				rows = append(rows, row)
			}
		}
		if len(result.LastEvaluatedKey) == 0 {
			break
		}
		startKey = result.LastEvaluatedKey
	}
	return rows, nil
}

func (a *application) putDataRow(ctx context.Context, orgID, table string, row map[string]any, create bool) error {
	id := strings.TrimSpace(fmt.Sprint(row["id"]))
	if id == "" {
		return errors.New("row id required")
	}
	item, err := jsonDataItem("ORG#"+orgID, "DATA#"+table+"#"+id, table, id, row)
	if err != nil {
		return err
	}
	input := &dynamodb.PutItemInput{TableName: aws.String(a.table), Item: item}
	if create {
		input.ConditionExpression = aws.String("attribute_not_exists(PK)")
	}
	_, err = a.dynamo.PutItem(ctx, input)
	if err != nil && create {
		return errConflict
	}
	return err
}

func jsonDataItem(pk, sk, entityType, rowID string, row map[string]any) (map[string]types.AttributeValue, error) {
	payload, err := json.Marshal(row)
	if err != nil {
		return nil, err
	}
	return map[string]types.AttributeValue{
		"PK":          &types.AttributeValueMemberS{Value: pk},
		"SK":          &types.AttributeValueMemberS{Value: sk},
		"entity_type": &types.AttributeValueMemberS{Value: entityType},
		"row_id":      &types.AttributeValueMemberS{Value: rowID},
		"data":        &types.AttributeValueMemberS{Value: string(payload)},
	}, nil
}

func decodeJSONItem(item map[string]types.AttributeValue) (map[string]any, bool) {
	if len(item) == 0 {
		return nil, false
	}
	payload := stringValue(item["data"])
	if payload == "" {
		return nil, false
	}
	var row map[string]any
	decoder := json.NewDecoder(strings.NewReader(payload))
	decoder.UseNumber()
	if decoder.Decode(&row) != nil {
		return nil, false
	}
	return row, true
}

func dataRowKey(orgID, table, id string) map[string]types.AttributeValue {
	return map[string]types.AttributeValue{
		"PK": &types.AttributeValueMemberS{Value: "ORG#" + orgID},
		"SK": &types.AttributeValueMemberS{Value: "DATA#" + table + "#" + id},
	}
}

func parseDataQuery(raw string) (dataQuery, error) {
	query := dataQuery{}
	values, err := url.ParseQuery(raw)
	if err != nil {
		return query, errors.New("invalid query string")
	}
	for _, op := range []string{"eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "in", "is"} {
		for _, encoded := range values[op] {
			parts := strings.Split(encoded, ",")
			if len(parts) < 2 || strings.TrimSpace(parts[0]) == "" {
				return query, fmt.Errorf("invalid %s filter", op)
			}
			query.filters = append(query.filters, dataFilter{op: op, column: strings.TrimSpace(parts[0]), values: parts[1:]})
		}
	}
	for _, encoded := range values["or"] {
		for _, expression := range strings.Split(encoded, ",") {
			parts := strings.SplitN(expression, ".", 3)
			if len(parts) != 3 {
				return query, errors.New("invalid or filter")
			}
			query.or = append(query.or, dataFilter{column: parts[0], op: parts[1], values: []string{parts[2]}})
		}
	}
	for _, encoded := range values["order"] {
		parts := strings.Split(encoded, ".")
		query.orders = append(query.orders, dataOrder{column: parts[0], ascending: len(parts) < 2 || !strings.EqualFold(parts[1], "desc")})
	}
	if selected := strings.TrimSpace(values.Get("select")); selected != "" && selected != "*" {
		for _, column := range strings.Split(selected, ",") {
			if column = strings.TrimSpace(column); column != "" {
				query.selects = append(query.selects, column)
			}
		}
	}
	if rawLimit := values.Get("limit"); rawLimit != "" {
		query.limit, err = strconv.Atoi(rawLimit)
		if err != nil || query.limit < 0 || query.limit > 1000 {
			return query, errors.New("invalid limit")
		}
	}
	query.single = strings.EqualFold(values.Get("single"), "true")
	return query, nil
}

func applyDataFilters(rows []map[string]any, query dataQuery) []map[string]any {
	filtered := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		matches := true
		for _, filter := range query.filters {
			if !matchesDataFilter(row, filter) {
				matches = false
				break
			}
		}
		if matches && len(query.or) > 0 {
			matches = false
			for _, filter := range query.or {
				if matchesDataFilter(row, filter) {
					matches = true
					break
				}
			}
		}
		if matches {
			filtered = append(filtered, row)
		}
	}
	for index := len(query.orders) - 1; index >= 0; index-- {
		order := query.orders[index]
		sort.SliceStable(filtered, func(i, j int) bool {
			comparison := compareDataValues(filtered[i][order.column], filtered[j][order.column])
			if order.ascending {
				return comparison < 0
			}
			return comparison > 0
		})
	}
	if query.limit > 0 && len(filtered) > query.limit {
		filtered = filtered[:query.limit]
	}
	return filtered
}

func matchesDataFilter(row map[string]any, filter dataFilter) bool {
	value, exists := row[filter.column]
	if filter.op == "is" && len(filter.values) > 0 {
		switch strings.ToLower(filter.values[0]) {
		case "null":
			return !exists || value == nil
		case "true":
			return value == true
		case "false":
			return value == false
		}
	}
	if !exists || len(filter.values) == 0 {
		return false
	}
	actual := normalizedDataValue(value)
	if filter.op == "in" {
		for _, expected := range filter.values {
			if actual == expected {
				return true
			}
		}
		return false
	}
	expected := strings.Join(filter.values, ",")
	switch filter.op {
	case "eq":
		return actual == expected
	case "neq":
		return actual != expected
	case "like", "ilike":
		if filter.op == "ilike" {
			actual, expected = strings.ToLower(actual), strings.ToLower(expected)
		}
		expected = strings.Trim(expected, "%")
		return strings.Contains(actual, expected)
	case "gt", "gte", "lt", "lte":
		comparison := compareDataValues(value, expected)
		switch filter.op {
		case "gt":
			return comparison > 0
		case "gte":
			return comparison >= 0
		case "lt":
			return comparison < 0
		default:
			return comparison <= 0
		}
	}
	return false
}

func normalizedDataValue(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case bool:
		return strconv.FormatBool(typed)
	case json.Number:
		return typed.String()
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	default:
		return fmt.Sprint(typed)
	}
}

func compareDataValues(left, right any) int {
	leftText, rightText := normalizedDataValue(left), normalizedDataValue(right)
	leftNumber, leftErr := strconv.ParseFloat(leftText, 64)
	rightNumber, rightErr := strconv.ParseFloat(rightText, 64)
	if leftErr == nil && rightErr == nil {
		switch {
		case leftNumber < rightNumber:
			return -1
		case leftNumber > rightNumber:
			return 1
		default:
			return 0
		}
	}
	return strings.Compare(leftText, rightText)
}

func dataRowsResponse(rows []map[string]any, query dataQuery) (events.APIGatewayV2HTTPResponse, error) {
	rows = applyDataFilters(rows, query)
	if len(query.selects) > 0 {
		projected := make([]map[string]any, 0, len(rows))
		for _, row := range rows {
			value := map[string]any{}
			for _, column := range query.selects {
				if field, ok := row[column]; ok {
					value[column] = field
				}
			}
			projected = append(projected, value)
		}
		rows = projected
	}
	if query.single {
		if len(rows) == 0 {
			return errorResponse(404, "row not found"), nil
		}
		if len(rows) > 1 {
			return errorResponse(409, "multiple rows returned"), nil
		}
		return jsonResponse(200, rows[0])
	}
	return jsonResponse(200, rows)
}

func dataMutationResponse(status int, rows []map[string]any, wasArray bool) (events.APIGatewayV2HTTPResponse, error) {
	if !wasArray && len(rows) == 1 {
		return jsonResponse(status, rows[0])
	}
	return jsonResponse(status, rows)
}

func decodeDataRows(body string) ([]map[string]any, bool, error) {
	decoder := json.NewDecoder(strings.NewReader(body))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, false, err
	}
	switch typed := value.(type) {
	case map[string]any:
		return []map[string]any{typed}, false, nil
	case []any:
		rows := make([]map[string]any, 0, len(typed))
		for _, entry := range typed {
			row, ok := entry.(map[string]any)
			if !ok {
				return nil, true, errors.New("array entries must be objects")
			}
			rows = append(rows, row)
		}
		return rows, true, nil
	default:
		return nil, false, errors.New("body must be an object or array")
	}
}

func decodeDataObject(body string, target *map[string]any) error {
	decoder := json.NewDecoder(strings.NewReader(body))
	decoder.UseNumber()
	return decoder.Decode(target)
}

func requestHeader(headers map[string]string, name string) string {
	for key, value := range headers {
		if strings.EqualFold(key, name) {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func validateDataRow(table string, row map[string]any) error {
	if table == "staff" {
		if _, forbidden := row["pin_hash"]; forbidden {
			return errors.New("pin_hash cannot be written through the data API")
		}
		if _, forbidden := row["password_hash"]; forbidden {
			return errors.New("password_hash cannot be written through the data API")
		}
	}
	return nil
}

func managerRole(role string) bool {
	return role == "owner" || role == "manager" || role == "admin"
}

func validOrganizationRole(role string) bool {
	switch role {
	case "owner", "manager", "staff", "admin", "kitchen", "pos", "driver":
		return true
	default:
		return false
	}
}

func slugify(value string) string {
	var builder strings.Builder
	lastHyphen := false
	for _, character := range strings.ToLower(value) {
		if unicode.IsLetter(character) || unicode.IsDigit(character) {
			builder.WriteRune(character)
			lastHyphen = false
		} else if !lastHyphen && builder.Len() > 0 {
			builder.WriteByte('-')
			lastHyphen = true
		}
	}
	return strings.Trim(builder.String(), "-")
}

var (
	errForbidden            = errors.New("forbidden")
	errNotFound             = errors.New("not found")
	errConflict             = errors.New("conflict")
	errInvalidData          = errors.New("invalid data")
	errOrganizationRequired = errors.New("organization context required")
)

func dataAccessError(err error) events.APIGatewayV2HTTPResponse {
	switch {
	case errors.Is(err, errForbidden):
		return errorResponse(403, "forbidden")
	case errors.Is(err, errNotFound):
		return errorResponse(404, "not found")
	case errors.Is(err, errConflict):
		return errorResponse(409, "conflict")
	case errors.Is(err, errInvalidData):
		message := strings.TrimSpace(strings.TrimPrefix(err.Error(), errInvalidData.Error()+":"))
		return errorResponse(400, message)
	case errors.Is(err, errOrganizationRequired):
		return errorResponse(400, "organization context required")
	default:
		return errorResponse(500, "data operation failed")
	}
}
