package main

import (
	"context"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

type driverRoute struct{ name, id, action string }

func matchDriverRoute(method, path string) (driverRoute, bool) {
	p := strings.Split(strings.Trim(path, "/"), "/")
	switch {
	case len(p) == 1 && p[0] == "driver-invites" && method == "GET":
		return driverRoute{name: "list-invites"}, true
	case len(p) == 1 && p[0] == "driver-invites" && method == "POST":
		return driverRoute{name: "create-invite"}, true
	case len(p) == 3 && p[0] == "driver-invites" && p[2] == "revoke" && method == "POST":
		return driverRoute{name: "revoke-invite", id: p[1]}, true
	case len(p) == 1 && p[0] == "drivers" && method == "GET":
		return driverRoute{name: "list-drivers"}, true
	case len(p) == 2 && p[0] == "drivers" && method == "DELETE":
		return driverRoute{name: "remove-driver", id: p[1]}, true
	case len(p) == 2 && p[0] == "driver" && p[1] == "assignments" && method == "GET":
		return driverRoute{name: "assignments"}, true
	case len(p) == 4 && p[0] == "driver" && p[1] == "assignments" && method == "POST":
		return driverRoute{name: "transition", id: p[2], action: p[3]}, true
	case len(p) == 3 && p[0] == "driver" && p[1] == "shifts" && method == "POST":
		return driverRoute{name: "shift", action: p[2]}, true
	case len(p) == 2 && p[0] == "driver" && p[1] == "pings" && method == "POST":
		return driverRoute{name: "ping"}, true
	default:
		return driverRoute{}, false
	}
}

func (a *application) handleDriverAPI(ctx context.Context, request events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, bool, error) {
	route, matched := matchDriverRoute(request.RequestContext.HTTP.Method, request.RawPath)
	if !matched {
		return events.APIGatewayV2HTTPResponse{}, false, nil
	}
	claims, err := a.authenticate(ctx, request.Headers)
	if err != nil {
		return errorResponse(401, "invalid token"), true, nil
	}
	var response events.APIGatewayV2HTTPResponse
	switch route.name {
	case "list-invites":
		response = a.listDriverInvites(ctx, request, claims.UserID)
	case "create-invite":
		response = a.createDriverInvite(ctx, request, claims.UserID)
	case "revoke-invite":
		response = a.revokeDriverInvite(ctx, request, claims.UserID, route.id)
	case "list-drivers":
		response = a.listActiveDrivers(ctx, request, claims.UserID)
	case "remove-driver":
		response = a.removeActiveDriver(ctx, request, claims.UserID, route.id)
	case "assignments":
		response = a.listDriverAssignments(ctx, claims.UserID)
	case "transition":
		response = a.transitionDriverAssignment(ctx, claims.UserID, route.id, route.action, request.Body)
	case "shift":
		response = a.changeDriverShift(ctx, claims.UserID, route.action)
	case "ping":
		response = a.createDriverPing(ctx, claims.UserID, request.Body)
	}
	return response, true, nil
}

func (a *application) managerOrganization(ctx context.Context, request events.APIGatewayV2HTTPRequest, userID string) (string, events.APIGatewayV2HTTPResponse, bool) {
	orgID, err := a.authorizedOrganization(ctx, request, userID)
	if err != nil {
		return "", dataAccessError(err), false
	}
	membership, err := a.getMembership(ctx, userID, orgID)
	role := displayString(membership["role"])
	if err != nil || !managerRole(role) {
		return "", errorResponse(403, "requires owner, administrator, or manager role"), false
	}
	return orgID, events.APIGatewayV2HTTPResponse{}, true
}

func (a *application) listDriverInvites(ctx context.Context, request events.APIGatewayV2HTTPRequest, userID string) events.APIGatewayV2HTTPResponse {
	orgID, response, ok := a.managerOrganization(ctx, request, userID)
	if !ok {
		return response
	}
	rows, err := a.queryDataRows(ctx, orgID, "organization_invites")
	if err != nil {
		return dataAccessError(err)
	}
	invites := make([]map[string]any, 0)
	for _, row := range rows {
		if displayString(row["role"]) == "driver" && displayString(row["status"]) == "pending" {
			invites = append(invites, row)
		}
	}
	sort.Slice(invites, func(i, j int) bool {
		return displayString(invites[i]["created_at"]) > displayString(invites[j]["created_at"])
	})
	return mustJSONResponse(200, invites)
}

func (a *application) createDriverInvite(ctx context.Context, request events.APIGatewayV2HTTPRequest, userID string) events.APIGatewayV2HTTPResponse {
	orgID, response, ok := a.managerOrganization(ctx, request, userID)
	if !ok {
		return response
	}
	var input map[string]any
	if decodeDataObject(request.Body, &input) != nil {
		return errorResponse(400, "invalid request body")
	}
	email, err := normalizeEmail(displayString(input["email"]))
	if err != nil {
		return errorResponse(400, "invalid email format")
	}
	if invitedUser, findErr := a.findUserByEmail(ctx, email); findErr == nil {
		if _, memberErr := a.getMembership(ctx, invitedUser.ID, orgID); memberErr == nil {
			return errorResponse(409, "user is already a member of this organization")
		}
	}
	rows, err := a.queryDataRows(ctx, orgID, "organization_invites")
	if err != nil {
		return dataAccessError(err)
	}
	for _, row := range rows {
		if strings.EqualFold(displayString(row["email"]), email) && displayString(row["role"]) == "driver" && displayString(row["status"]) == "pending" {
			return errorResponse(409, "a pending driver invite already exists for this email")
		}
	}
	invite, err := a.createStoredRow(ctx, orgID, "organization_invites", map[string]any{
		"email": email, "role": "driver", "status": "pending", "invited_by": userID,
	})
	if err != nil {
		return dataAccessError(err)
	}
	if invitedUser, findErr := a.findUserByEmail(ctx, email); findErr == nil {
		if acceptErr := a.acceptDriverInvite(ctx, invite, invitedUser.ID); acceptErr != nil {
			_ = a.deleteStoredRow(ctx, orgID, "organization_invites", displayString(invite["id"]))
			return dataAccessError(acceptErr)
		}
	}
	return mustJSONResponse(201, invite)
}

func (a *application) revokeDriverInvite(ctx context.Context, request events.APIGatewayV2HTTPRequest, userID, inviteID string) events.APIGatewayV2HTTPResponse {
	orgID, response, ok := a.managerOrganization(ctx, request, userID)
	if !ok {
		return response
	}
	invite, err := a.dataRowByID(ctx, orgID, "organization_invites", inviteID)
	if err != nil || displayString(invite["role"]) != "driver" || displayString(invite["status"]) != "pending" {
		return errorResponse(404, "invite not found or already processed")
	}
	invite["status"], invite["updated_at"] = "rejected", time.Now().UTC().Format(time.RFC3339Nano)
	if err := a.putDataRow(ctx, orgID, "organization_invites", invite, false); err != nil {
		return dataAccessError(err)
	}
	return events.APIGatewayV2HTTPResponse{StatusCode: 204}
}

func (a *application) listActiveDrivers(ctx context.Context, request events.APIGatewayV2HTTPRequest, userID string) events.APIGatewayV2HTTPResponse {
	orgID, response, ok := a.managerOrganization(ctx, request, userID)
	if !ok {
		return response
	}
	members, err := a.queryJSONRows(ctx, "ORG#"+orgID, "MEMBER#")
	if err != nil {
		return dataAccessError(err)
	}
	drivers := make([]map[string]any, 0)
	for _, member := range members {
		if displayString(member["role"]) != "driver" {
			continue
		}
		profileID := displayString(member["profile_id"])
		profiles, profileErr := a.profileRows(ctx, profileID)
		if profileErr == nil && len(profiles) > 0 {
			drivers = append(drivers, map[string]any{"profile_id": profileID, "email": profiles[0]["email"], "full_name": valueOr(profiles[0], "full_name", ""), "joined_at": valueOr(member, "created_at", nil)})
		}
	}
	sort.Slice(drivers, func(i, j int) bool { return displayString(drivers[i]["email"]) < displayString(drivers[j]["email"]) })
	return mustJSONResponse(200, drivers)
}

func (a *application) removeActiveDriver(ctx context.Context, request events.APIGatewayV2HTTPRequest, userID, profileID string) events.APIGatewayV2HTTPResponse {
	orgID, response, ok := a.managerOrganization(ctx, request, userID)
	if !ok {
		return response
	}
	if profileID == userID {
		return errorResponse(400, "cannot remove yourself")
	}
	membership, err := a.getMembership(ctx, profileID, orgID)
	if err != nil || displayString(membership["role"]) != "driver" {
		return errorResponse(404, "driver not found in this organization")
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

func (a *application) driverMemberships(ctx context.Context, userID string) ([]map[string]any, error) {
	rows, err := a.queryJSONRows(ctx, "USER#"+userID, "MEMBERSHIP#")
	if err != nil {
		return nil, err
	}
	drivers := make([]map[string]any, 0)
	for _, row := range rows {
		if displayString(row["role"]) == "driver" {
			drivers = append(drivers, row)
		}
	}
	return drivers, nil
}

func (a *application) listDriverAssignments(ctx context.Context, userID string) events.APIGatewayV2HTTPResponse {
	memberships, err := a.driverMemberships(ctx, userID)
	if err != nil {
		return dataAccessError(err)
	}
	assignments := make([]map[string]any, 0)
	for _, membership := range memberships {
		orgID, memberID := displayString(membership["organization_id"]), displayString(membership["id"])
		rows, queryErr := a.queryDataRows(ctx, orgID, "driver_assignments")
		if queryErr != nil {
			return dataAccessError(queryErr)
		}
		for _, row := range rows {
			status := displayString(row["status"])
			if displayString(row["driver_member_id"]) == memberID && (status == "offered" || status == "accepted" || status == "picked_up") {
				enriched, enrichErr := a.enrichDriverAssignment(ctx, orgID, row)
				if enrichErr != nil {
					return dataAccessError(enrichErr)
				}
				assignments = append(assignments, enriched)
			}
		}
	}
	sort.Slice(assignments, func(i, j int) bool {
		return displayString(assignments[i]["offered_at"]) > displayString(assignments[j]["offered_at"])
	})
	return mustJSONResponse(200, assignments)
}

func (a *application) enrichDriverAssignment(ctx context.Context, orgID string, assignment map[string]any) (map[string]any, error) {
	result := cloneDataRow(assignment)
	order, err := a.dataRowByID(ctx, orgID, "orders", displayString(assignment["order_id"]))
	if err != nil {
		return nil, err
	}
	location, err := a.dataRowByID(ctx, orgID, "locations", displayString(order["location_id"]))
	if err != nil {
		return nil, err
	}
	result["delivery_address"], result["total_cents"], result["store_name"] = valueOr(order, "delivery_address", nil), valueOr(order, "total_cents", int64(0)), valueOr(location, "name", "")
	return result, nil
}

func validDriverTransition(current, action string) (string, bool) {
	switch action {
	case "accept":
		return "accepted", current == "offered"
	case "pickup":
		return "picked_up", current == "accepted"
	case "deliver":
		return "delivered", current == "picked_up"
	case "cancel":
		return "canceled", current == "offered" || current == "accepted" || current == "picked_up"
	default:
		return "", false
	}
}

func (a *application) transitionDriverAssignment(ctx context.Context, userID, assignmentID, action, body string) events.APIGatewayV2HTTPResponse {
	memberships, err := a.driverMemberships(ctx, userID)
	if err != nil {
		return dataAccessError(err)
	}
	for _, membership := range memberships {
		orgID, memberID := displayString(membership["organization_id"]), displayString(membership["id"])
		assignment, findErr := a.dataRowByID(ctx, orgID, "driver_assignments", assignmentID)
		if findErr != nil || displayString(assignment["driver_member_id"]) != memberID {
			continue
		}
		newStatus, valid := validDriverTransition(displayString(assignment["status"]), action)
		if !valid {
			return errorResponse(409, "illegal status transition")
		}
		now := time.Now().UTC().Format(time.RFC3339Nano)
		assignment["status"], assignment["updated_at"] = newStatus, now
		timestamp := map[string]string{"accept": "accepted_at", "pickup": "picked_up_at", "deliver": "delivered_at"}[action]
		if timestamp != "" {
			assignment[timestamp] = now
		} else {
			var input map[string]any
			_ = decodeDataObject(body, &input)
			assignment["canceled_reason"] = nullableString(input["reason"])
		}
		if err := a.putDataRow(ctx, orgID, "driver_assignments", assignment, false); err != nil {
			return dataAccessError(err)
		}
		if action == "pickup" || action == "deliver" {
			order, orderErr := a.dataRowByID(ctx, orgID, "orders", displayString(assignment["order_id"]))
			if orderErr == nil {
				if action == "pickup" {
					order["status"] = "out_for_delivery"
				} else {
					order["status"] = "delivered"
				}
				order["updated_at"] = now
				if putErr := a.putDataRow(ctx, orgID, "orders", order, false); putErr != nil {
					return dataAccessError(putErr)
				}
			}
		}
		enriched, enrichErr := a.enrichDriverAssignment(ctx, orgID, assignment)
		if enrichErr != nil {
			return dataAccessError(enrichErr)
		}
		return mustJSONResponse(200, enriched)
	}
	return errorResponse(404, "not found")
}

func (a *application) changeDriverShift(ctx context.Context, userID, action string) events.APIGatewayV2HTTPResponse {
	if action != "online" && action != "paused" && action != "offline" {
		return errorResponse(404, "not_found")
	}
	memberships, err := a.driverMemberships(ctx, userID)
	if err != nil {
		return dataAccessError(err)
	}
	if len(memberships) == 0 {
		return errorResponse(404, "driver member not found")
	}
	orgID, memberID := displayString(memberships[0]["organization_id"]), displayString(memberships[0]["id"])
	shifts, err := a.queryDataRows(ctx, orgID, "driver_shifts")
	if err != nil {
		return dataAccessError(err)
	}
	var open map[string]any
	for _, shift := range shifts {
		status := displayString(shift["status"])
		if displayString(shift["driver_member_id"]) == memberID && (status == "online" || status == "paused") {
			open = shift
			break
		}
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if action == "online" {
		if open != nil {
			return errorResponse(409, "driver already has an open shift")
		}
		shift, createErr := a.createStoredRow(ctx, orgID, "driver_shifts", map[string]any{"driver_member_id": memberID, "started_at": now, "ended_at": nil, "status": "online", "notes": nil})
		if createErr != nil {
			return dataAccessError(createErr)
		}
		return mustJSONResponse(201, shift)
	}
	if open == nil {
		return errorResponse(404, "no open shift found")
	}
	open["status"], open["updated_at"] = action, now
	if action == "offline" {
		open["ended_at"] = now
	}
	if err := a.putDataRow(ctx, orgID, "driver_shifts", open, false); err != nil {
		return dataAccessError(err)
	}
	return mustJSONResponse(200, open)
}

func (a *application) createDriverPing(ctx context.Context, userID, body string) events.APIGatewayV2HTTPResponse {
	memberships, err := a.driverMemberships(ctx, userID)
	if err != nil {
		return dataAccessError(err)
	}
	if len(memberships) == 0 {
		return errorResponse(404, "driver member not found")
	}
	var input map[string]any
	if decodeDataObject(body, &input) != nil {
		return errorResponse(400, "invalid request body")
	}
	lat, latOK := numericValue(input["lat"])
	lng, lngOK := numericValue(input["lng"])
	if !latOK || lat < -90 || lat > 90 {
		return errorResponse(400, "lat must be between -90 and 90")
	}
	if !lngOK || lng < -180 || lng > 180 {
		return errorResponse(400, "lng must be between -180 and 180")
	}
	orgID, memberID := displayString(memberships[0]["organization_id"]), displayString(memberships[0]["id"])
	active := false
	shifts, err := a.queryDataRows(ctx, orgID, "driver_shifts")
	if err != nil {
		return dataAccessError(err)
	}
	for _, row := range shifts {
		status := displayString(row["status"])
		if displayString(row["driver_member_id"]) == memberID && (status == "online" || status == "paused") {
			active = true
		}
	}
	if !active {
		rows, queryErr := a.queryDataRows(ctx, orgID, "driver_assignments")
		if queryErr != nil {
			return dataAccessError(queryErr)
		}
		for _, row := range rows {
			status := displayString(row["status"])
			if displayString(row["driver_member_id"]) == memberID && (status == "accepted" || status == "picked_up") {
				active = true
			}
		}
	}
	if !active {
		return errorResponse(403, "no active shift or assignment — cannot record location ping")
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	ping, err := a.createStoredRow(ctx, orgID, "driver_location_pings", map[string]any{
		"driver_member_id": memberID, "lat": lat, "lng": lng, "accuracy_m": valueOr(input, "accuracy_m", valueOr(input, "accuracy", nil)),
		"heading_deg": valueOr(input, "heading_deg", nil), "speed_mps": valueOr(input, "speed_mps", nil), "recorded_at": now,
	})
	if err != nil {
		return dataAccessError(err)
	}
	return mustJSONResponse(201, ping)
}

func (a *application) acceptMatchingDriverInvites(ctx context.Context, userID, email string) error {
	rows, err := a.scanDataRowsByEntity(ctx, "organization_invites")
	if err != nil {
		return err
	}
	for _, invite := range rows {
		if strings.EqualFold(displayString(invite["email"]), email) && displayString(invite["role"]) == "driver" && displayString(invite["status"]) == "pending" {
			if err := a.acceptDriverInvite(ctx, invite, userID); err != nil && !errors.Is(err, errConflict) {
				return err
			}
		}
	}
	return nil
}

func (a *application) acceptDriverInvite(ctx context.Context, invite map[string]any, userID string) error {
	orgID := displayString(invite["organization_id"])
	if orgID == "" {
		return errInvalidData
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	invite["status"], invite["updated_at"] = "accepted", now
	if _, err := a.getMembership(ctx, userID, orgID); err == nil {
		return a.putDataRow(ctx, orgID, "organization_invites", invite, false)
	}
	membershipID, err := randomID()
	if err != nil {
		return err
	}
	membership := map[string]any{"id": membershipID, "organization_id": orgID, "profile_id": userID, "role": "driver", "capabilities": map[string]any{"can_drive": true}, "created_at": now, "updated_at": now}
	userItem, orgItem, err := membershipItems(userID, orgID, membership)
	if err != nil {
		return err
	}
	inviteItem, err := jsonDataItem("ORG#"+orgID, "DATA#organization_invites#"+displayString(invite["id"]), "organization_invites", displayString(invite["id"]), invite)
	if err != nil {
		return err
	}
	_, err = a.dynamo.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{TransactItems: []types.TransactWriteItem{
		{Put: &types.Put{TableName: aws.String(a.table), Item: userItem, ConditionExpression: aws.String("attribute_not_exists(PK)")}},
		{Put: &types.Put{TableName: aws.String(a.table), Item: orgItem, ConditionExpression: aws.String("attribute_not_exists(PK)")}},
		{Put: &types.Put{TableName: aws.String(a.table), Item: inviteItem}},
	}})
	if err != nil {
		return errConflict
	}
	return nil
}
