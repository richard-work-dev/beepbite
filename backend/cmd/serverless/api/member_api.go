package main

import (
	"context"
	"sort"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

type memberRoute struct{ name, id string }

func matchMemberRoute(method, path string) (memberRoute, bool) {
	p := strings.Split(strings.Trim(path, "/"), "/")
	switch {
	case len(p) == 1 && p[0] == "member-invites" && method == "GET":
		return memberRoute{name: "list-invites"}, true
	case len(p) == 1 && p[0] == "member-invites" && method == "POST":
		return memberRoute{name: "create-invite"}, true
	case len(p) == 3 && p[0] == "member-invites" && p[2] == "revoke" && method == "POST":
		return memberRoute{name: "revoke-invite", id: p[1]}, true
	case len(p) == 1 && p[0] == "members" && method == "GET":
		return memberRoute{name: "list-members"}, true
	case len(p) == 2 && p[0] == "members" && method == "DELETE":
		return memberRoute{name: "remove-member", id: p[1]}, true
	default:
		return memberRoute{}, false
	}
}

func (a *application) handleMemberAPI(ctx context.Context, request events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, bool, error) {
	route, ok := matchMemberRoute(request.RequestContext.HTTP.Method, request.RawPath)
	if !ok {
		return events.APIGatewayV2HTTPResponse{}, false, nil
	}
	claims, err := a.authenticate(ctx, request.Headers)
	if err != nil {
		return errorResponse(401, "invalid token"), true, nil
	}
	var response events.APIGatewayV2HTTPResponse
	switch route.name {
	case "list-invites":
		response = a.listMemberInvites(ctx, request, claims.UserID)
	case "create-invite":
		response = a.createMemberInvite(ctx, request, claims.UserID)
	case "revoke-invite":
		response = a.revokeMemberInvite(ctx, request, claims.UserID, route.id)
	case "list-members":
		response = a.listActiveMembers(ctx, request, claims.UserID)
	case "remove-member":
		response = a.removeActiveMember(ctx, request, claims.UserID, route.id)
	}
	return response, true, nil
}

func validMemberInviteRole(role string) bool {
	switch role {
	case "manager", "staff", "kitchen", "pos":
		return true
	}
	return false
}

func memberCapabilities(role string) map[string]any {
	// can_kitchen is retained as a compatibility alias for existing staff
	// records and clients. New permission checks use can_kds consistently.
	c := map[string]any{"can_pos": false, "can_kds": false, "can_kitchen": false, "can_manage_staff": false, "can_manage_menu": false, "can_view_reports": false}
	switch role {
	case "manager", "admin":
		c["can_pos"], c["can_kds"], c["can_kitchen"], c["can_manage_staff"], c["can_manage_menu"], c["can_view_reports"] = true, true, true, true, true, true
	case "staff", "pos":
		c["can_pos"] = true
	case "kitchen":
		c["can_kds"], c["can_kitchen"] = true, true
	}
	return c
}

func (a *application) listMemberInvites(ctx context.Context, request events.APIGatewayV2HTTPRequest, userID string) events.APIGatewayV2HTTPResponse {
	orgID, response, ok := a.managerOrganization(ctx, request, userID)
	if !ok {
		return response
	}
	rows, err := a.queryDataRows(ctx, orgID, "organization_invites")
	if err != nil {
		return dataAccessError(err)
	}
	result := make([]map[string]any, 0)
	for _, row := range rows {
		if validMemberInviteRole(displayString(row["role"])) && displayString(row["status"]) == "pending" {
			result = append(result, row)
		}
	}
	sort.Slice(result, func(i, j int) bool {
		return displayString(result[i]["created_at"]) > displayString(result[j]["created_at"])
	})
	return mustJSONResponse(200, result)
}

func (a *application) createMemberInvite(ctx context.Context, request events.APIGatewayV2HTTPRequest, userID string) events.APIGatewayV2HTTPResponse {
	orgID, response, ok := a.managerOrganization(ctx, request, userID)
	if !ok {
		return response
	}
	var input map[string]any
	if decodeDataObject(request.Body, &input) != nil {
		return errorResponse(400, "invalid request body")
	}
	email, err := normalizeEmail(displayString(input["email"]))
	role := strings.ToLower(strings.TrimSpace(displayString(input["role"])))
	if err != nil || !validMemberInviteRole(role) {
		return errorResponse(400, "valid email and role are required")
	}
	if invited, findErr := a.findUserByEmail(ctx, email); findErr == nil {
		if _, memberErr := a.getMembership(ctx, invited.ID, orgID); memberErr == nil {
			return errorResponse(409, "user is already a member of this organization")
		}
	}
	rows, err := a.queryDataRows(ctx, orgID, "organization_invites")
	if err != nil {
		return dataAccessError(err)
	}
	for _, row := range rows {
		if strings.EqualFold(displayString(row["email"]), email) && displayString(row["status"]) == "pending" {
			return errorResponse(409, "a pending invite already exists for this email")
		}
	}
	invite, err := a.createStoredRow(ctx, orgID, "organization_invites", map[string]any{"email": email, "role": role, "status": "pending", "invited_by": userID})
	if err != nil {
		return dataAccessError(err)
	}
	if invited, findErr := a.findUserByEmail(ctx, email); findErr == nil {
		if err = a.acceptMemberInvite(ctx, invite, invited.ID); err != nil {
			_ = a.deleteStoredRow(ctx, orgID, "organization_invites", displayString(invite["id"]))
			return dataAccessError(err)
		}
	}
	return mustJSONResponse(201, invite)
}

func (a *application) revokeMemberInvite(ctx context.Context, request events.APIGatewayV2HTTPRequest, userID, inviteID string) events.APIGatewayV2HTTPResponse {
	orgID, response, ok := a.managerOrganization(ctx, request, userID)
	if !ok {
		return response
	}
	invite, err := a.dataRowByID(ctx, orgID, "organization_invites", inviteID)
	if err != nil || !validMemberInviteRole(displayString(invite["role"])) || displayString(invite["status"]) != "pending" {
		return errorResponse(404, "invite not found or already processed")
	}
	invite["status"], invite["updated_at"] = "rejected", time.Now().UTC().Format(time.RFC3339Nano)
	if err := a.putDataRow(ctx, orgID, "organization_invites", invite, false); err != nil {
		return dataAccessError(err)
	}
	return events.APIGatewayV2HTTPResponse{StatusCode: 204}
}

func (a *application) listActiveMembers(ctx context.Context, request events.APIGatewayV2HTTPRequest, userID string) events.APIGatewayV2HTTPResponse {
	orgID, response, ok := a.managerOrganization(ctx, request, userID)
	if !ok {
		return response
	}
	rows, err := a.queryJSONRows(ctx, "ORG#"+orgID, "MEMBER#")
	if err != nil {
		return dataAccessError(err)
	}
	result := make([]map[string]any, 0)
	for _, member := range rows {
		if displayString(member["role"]) == "driver" {
			continue
		}
		profileID := displayString(member["profile_id"])
		profiles, profileErr := a.profileRows(ctx, profileID)
		if profileErr == nil && len(profiles) > 0 {
			result = append(result, map[string]any{"profile_id": profileID, "email": profiles[0]["email"], "full_name": valueOr(profiles[0], "full_name", ""), "role": member["role"], "capabilities": valueOr(member, "capabilities", memberCapabilities(displayString(member["role"]))), "joined_at": valueOr(member, "created_at", nil)})
		}
	}
	sort.Slice(result, func(i, j int) bool { return displayString(result[i]["email"]) < displayString(result[j]["email"]) })
	return mustJSONResponse(200, result)
}

func (a *application) removeActiveMember(ctx context.Context, request events.APIGatewayV2HTTPRequest, userID, profileID string) events.APIGatewayV2HTTPResponse {
	orgID, response, ok := a.managerOrganization(ctx, request, userID)
	if !ok {
		return response
	}
	if profileID == userID {
		return errorResponse(400, "cannot remove yourself")
	}
	membership, err := a.getMembership(ctx, profileID, orgID)
	if err != nil || displayString(membership["role"]) == "driver" {
		return errorResponse(404, "member not found in this organization")
	}
	if displayString(membership["role"]) == "owner" {
		rows, queryErr := a.queryJSONRows(ctx, "ORG#"+orgID, "MEMBER#")
		if queryErr != nil {
			return dataAccessError(queryErr)
		}
		owners := 0
		for _, row := range rows {
			if displayString(row["role"]) == "owner" {
				owners++
			}
		}
		if owners <= 1 {
			return errorResponse(409, "organization must retain at least one owner")
		}
	}
	_, err = a.dynamo.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{TransactItems: []types.TransactWriteItem{
		{Delete: &types.Delete{TableName: aws.String(a.table), Key: map[string]types.AttributeValue{"PK": &types.AttributeValueMemberS{Value: "USER#" + profileID}, "SK": &types.AttributeValueMemberS{Value: "MEMBERSHIP#" + orgID}}}},
		{Delete: &types.Delete{TableName: aws.String(a.table), Key: map[string]types.AttributeValue{"PK": &types.AttributeValueMemberS{Value: "ORG#" + orgID}, "SK": &types.AttributeValueMemberS{Value: "MEMBER#" + profileID}}}},
	}})
	if err != nil {
		return dataAccessError(err)
	}
	return events.APIGatewayV2HTTPResponse{StatusCode: 204}
}

func (a *application) acceptMemberInvite(ctx context.Context, invite map[string]any, userID string) error {
	role, orgID := displayString(invite["role"]), displayString(invite["organization_id"])
	if !validMemberInviteRole(role) || orgID == "" {
		return errInvalidData
	}
	if _, err := a.getMembership(ctx, userID, orgID); err == nil {
		return errConflict
	}
	id, err := randomID()
	if err != nil {
		return err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	membership := map[string]any{"id": id, "organization_id": orgID, "profile_id": userID, "role": role, "capabilities": memberCapabilities(role), "created_at": now, "updated_at": now}
	userItem, orgItem, err := membershipItems(userID, orgID, membership)
	if err != nil {
		return err
	}
	invite["status"], invite["accepted_by"], invite["accepted_at"], invite["updated_at"] = "accepted", userID, now, now
	inviteItem, err := jsonDataItem("ORG#"+orgID, "DATA#organization_invites#"+displayString(invite["id"]), "organization_invites", displayString(invite["id"]), invite)
	if err != nil {
		return err
	}
	_, err = a.dynamo.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{TransactItems: []types.TransactWriteItem{{Put: &types.Put{TableName: aws.String(a.table), Item: userItem, ConditionExpression: aws.String("attribute_not_exists(PK)")}}, {Put: &types.Put{TableName: aws.String(a.table), Item: orgItem, ConditionExpression: aws.String("attribute_not_exists(PK)")}}, {Put: &types.Put{TableName: aws.String(a.table), Item: inviteItem}}}})
	return err
}

func (a *application) acceptMatchingMemberInvites(ctx context.Context, userID, email string) error {
	result, err := a.dynamo.Scan(ctx, &dynamodb.ScanInput{TableName: aws.String(a.table), FilterExpression: aws.String("entity_type = :type"), ExpressionAttributeValues: map[string]types.AttributeValue{":type": &types.AttributeValueMemberS{Value: "organization_invites"}}})
	if err != nil {
		return err
	}
	for _, item := range result.Items {
		row, ok := decodeJSONItem(item)
		if !ok || !strings.EqualFold(displayString(row["email"]), email) || displayString(row["status"]) != "pending" || !validMemberInviteRole(displayString(row["role"])) {
			continue
		}
		if err := a.acceptMemberInvite(ctx, row, userID); err != nil && err != errConflict {
			return err
		}
	}
	return nil
}
