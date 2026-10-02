package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/mail"
	"os"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/secretsmanager"
	"github.com/beepbite/backend/pkg/tokens"
	"golang.org/x/crypto/bcrypt"
)

const (
	accessTTL       = 15 * time.Minute
	refreshTTL      = 30 * 24 * time.Hour
	accountHashCost = 12
)

type application struct {
	table          string
	dynamo         *dynamodb.Client
	secrets        *secretsmanager.Client
	s3             *s3.Client
	secretID       string
	uploadsBucket  string
	uploadsBaseURL string
	secretMu       sync.Mutex
	jwtSecret      string
	singleStore    singleStoreConfig
}

type credentialsRequest struct {
	Email           string         `json:"email"`
	Password        string         `json:"password"`
	InvitationToken string         `json:"invitation_token,omitempty"`
	Meta            map[string]any `json:"meta,omitempty"`
}

type refreshRequest struct {
	RefreshToken string `json:"refresh_token"`
}

type user struct {
	ID            string `json:"id"`
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
	PasswordHash  string `json:"-"`
}

type sessionResponse struct {
	User         user      `json:"user"`
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token"`
	ExpiresAt    time.Time `json:"expires_at"`
	TokenType    string    `json:"token_type"`
}

var (
	appOnce sync.Once
	app     *application
	appErr  error
)

func loadApplication(ctx context.Context) (*application, error) {
	appOnce.Do(func() {
		cfg, err := config.LoadDefaultConfig(ctx)
		if err != nil {
			appErr = err
			return
		}
		app = &application{
			table:          os.Getenv("CORE_TABLE"),
			dynamo:         dynamodb.NewFromConfig(cfg),
			secrets:        secretsmanager.NewFromConfig(cfg),
			s3:             s3.NewFromConfig(cfg),
			secretID:       os.Getenv("RUNTIME_SECRET_ID"),
			uploadsBucket:  os.Getenv("UPLOADS_BUCKET"),
			uploadsBaseURL: strings.TrimRight(os.Getenv("UPLOADS_BASE_URL"), "/"),
			singleStore:    loadSingleStoreConfig(),
		}
		if app.table == "" || app.secretID == "" || app.singleStore.validate() != nil {
			appErr = errors.New("runtime is not configured")
		}
	})
	return app, appErr
}

func handler(ctx context.Context, request events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	// HTTP API sends unmatched preflight requests through the $default route.
	// Return a successful empty response so API Gateway can attach its configured
	// Access-Control-* headers for the requesting origin.
	if request.RequestContext.HTTP.Method == "OPTIONS" {
		return events.APIGatewayV2HTTPResponse{StatusCode: 204}, nil
	}

	if request.RequestContext.HTTP.Method == "GET" && (request.RawPath == "/health" || request.RawPath == "/api/health") {
		return jsonResponse(200, map[string]any{
			"service": "beepbite-api", "status": "ok", "architecture": "lambda-dynamodb",
			"time": time.Now().UTC().Format(time.RFC3339),
		})
	}

	application, err := loadApplication(ctx)
	if err != nil {
		return jsonResponse(503, map[string]string{"error": "runtime_not_configured"})
	}

	switch request.RequestContext.HTTP.Method + " " + request.RawPath {
	case "GET /ready", "GET /api/ready":
		return application.ready(ctx)
	case "POST /auth/signup":
		return application.signUp(ctx, request)
	case "POST /auth/signin":
		return application.signIn(ctx, request)
	case "POST /auth/refresh":
		return application.refresh(ctx, request)
	case "POST /auth/signout":
		return application.signOut(ctx, request)
	case "GET /auth/me":
		return application.me(ctx, request)
	case "POST /auth/me/password":
		return application.changeOwnPassword(ctx, request)
	default:
		if response, handled, marketplaceErr := application.handleMarketplaceAPI(ctx, request); handled {
			return response, marketplaceErr
		}
		if response, handled, engagementErr := application.handleMarketplaceEngagementAPI(ctx, request); handled {
			return response, engagementErr
		}
		if response, handled, driverErr := application.handleDriverAPI(ctx, request); handled {
			return response, driverErr
		}
		if response, handled, memberErr := application.handleMemberAPI(ctx, request); handled {
			return response, memberErr
		}
		if response, handled, securityErr := application.handleSecurityAPI(ctx, request); handled {
			return response, securityErr
		}
		if response, handled, platformErr := application.handlePlatformAPI(ctx, request); handled {
			return response, platformErr
		}
		if table, ok := dataTableFromPath(request.RawPath); ok {
			return application.handleData(ctx, request, table)
		}
		if response, handled, operationErr := application.handleOperationalAPI(ctx, request); handled {
			return response, operationErr
		}
		if response, handled, commerceErr := application.handleCommerceAPI(ctx, request); handled {
			return response, commerceErr
		}
		if response, handled, completionErr := application.handlePOSCompletionAPI(ctx, request); handled {
			return response, completionErr
		}
		if response, handled, tableErr := application.handleTableSessionAPI(ctx, request); handled {
			return response, tableErr
		}
		if response, handled, inventoryErr := application.handleInventoryAPI(ctx, request); handled {
			return response, inventoryErr
		}
		if response, handled, balanceErr := application.handleCustomerBalanceAPI(ctx, request); handled {
			return response, balanceErr
		}
		if response, handled, houseAccountErr := application.handleHouseAccountAPI(ctx, request); handled {
			return response, houseAccountErr
		}
		return jsonResponse(404, map[string]string{"error": "not_found"})
	}
}

func (a *application) ready(ctx context.Context) (events.APIGatewayV2HTTPResponse, error) {
	if _, err := a.loadJWTSecret(ctx); err != nil {
		return errorResponse(503, "runtime_not_ready"), nil
	}
	if _, err := a.dynamo.DescribeTable(ctx, &dynamodb.DescribeTableInput{TableName: aws.String(a.table)}); err != nil {
		return errorResponse(503, "runtime_not_ready"), nil
	}
	return jsonResponse(200, map[string]string{"service": "beepbite-api", "status": "ready"})
}

func (a *application) signUp(ctx context.Context, request events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	var input credentialsRequest
	if err := decodeBody(request.Body, &input); err != nil {
		return errorResponse(400, "solicitud inválida"), nil
	}
	email, err := normalizeEmail(input.Email)
	if err != nil || !validAccountPassword(input.Password) {
		return errorResponse(400, "se requiere un correo válido y una contraseña de al menos 12 caracteres, con mayúscula, minúscula y número"), nil
	}
	if a.singleStore.Enabled && !strings.EqualFold(email, a.singleStore.OwnerEmail) {
		invited, inviteErr := a.hasPendingStoreInvite(ctx, email, input.InvitationToken)
		if inviteErr != nil {
			return events.APIGatewayV2HTTPResponse{}, inviteErr
		}
		if !invited {
			return errorResponse(403, "la invitación no es válida, no coincide con el correo o ya venció"), nil
		}
	}
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(input.Password), accountHashCost)
	if err != nil {
		return events.APIGatewayV2HTTPResponse{}, err
	}
	userID, err := randomID()
	if err != nil {
		return events.APIGatewayV2HTTPResponse{}, err
	}
	createdAt := time.Now().UTC()
	newUser := user{ID: userID, Email: email, EmailVerified: false, PasswordHash: string(passwordHash)}
	session, refreshItem, err := a.newSession(ctx, newUser, request.Headers["user-agent"], createdAt)
	if err != nil {
		return events.APIGatewayV2HTTPResponse{}, err
	}
	meta, err := json.Marshal(input.Meta)
	if err != nil {
		return errorResponse(400, "metadatos inválidos"), nil
	}
	items := []types.TransactWriteItem{
		{Put: &types.Put{TableName: aws.String(a.table), ConditionExpression: aws.String("attribute_not_exists(PK)"), Item: userItem(newUser, string(meta), createdAt)}},
		{Put: &types.Put{TableName: aws.String(a.table), ConditionExpression: aws.String("attribute_not_exists(PK)"), Item: map[string]types.AttributeValue{
			"PK": &types.AttributeValueMemberS{Value: "EMAIL#" + email}, "SK": &types.AttributeValueMemberS{Value: "LOOKUP"},
			"user_id": &types.AttributeValueMemberS{Value: userID}, "entity_type": &types.AttributeValueMemberS{Value: "email_lookup"},
		}}},
		{Put: &types.Put{TableName: aws.String(a.table), Item: refreshItem}},
	}
	storeItems, err := a.singleStore.signupItems(userID, email, createdAt)
	if err != nil {
		return events.APIGatewayV2HTTPResponse{}, err
	}
	if err := a.bindSingleStoreTable(storeItems); err != nil {
		return events.APIGatewayV2HTTPResponse{}, err
	}
	items = append(items, storeItems...)
	_, err = a.dynamo.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{TransactItems: items})
	if err != nil {
		var cancelled *types.TransactionCanceledException
		if errors.As(err, &cancelled) {
			return errorResponse(409, "el usuario ya existe"), nil
		}
		return events.APIGatewayV2HTTPResponse{}, err
	}
	// Invite acceptance is best-effort so a transient lookup cannot block signup.
	_ = a.acceptMatchingDriverInvites(ctx, userID, email, input.InvitationToken)
	_ = a.acceptMatchingMemberInvites(ctx, userID, email, input.InvitationToken)
	return jsonResponse(201, session)
}

func (a *application) signIn(ctx context.Context, request events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	var input credentialsRequest
	if err := decodeBody(request.Body, &input); err != nil {
		return errorResponse(400, "solicitud inválida"), nil
	}
	email, err := normalizeEmail(input.Email)
	if err != nil {
		return errorResponse(401, "correo o contraseña incorrectos"), nil
	}
	currentUser, err := a.findUserByEmail(ctx, email)
	if err != nil || bcrypt.CompareHashAndPassword([]byte(currentUser.PasswordHash), []byte(input.Password)) != nil {
		return errorResponse(401, "correo o contraseña incorrectos"), nil
	}
	session, refreshItem, err := a.newSession(ctx, currentUser, request.Headers["user-agent"], time.Now().UTC())
	if err != nil {
		return events.APIGatewayV2HTTPResponse{}, err
	}
	_, err = a.dynamo.PutItem(ctx, &dynamodb.PutItemInput{TableName: aws.String(a.table), Item: refreshItem})
	if err != nil {
		return events.APIGatewayV2HTTPResponse{}, err
	}
	return jsonResponse(200, session)
}

func (a *application) refresh(ctx context.Context, request events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	var input refreshRequest
	if decodeBody(request.Body, &input) != nil || input.RefreshToken == "" {
		return errorResponse(400, "refresh_token required"), nil
	}
	oldHash := tokens.HashToken(input.RefreshToken)
	result, err := a.dynamo.GetItem(ctx, &dynamodb.GetItemInput{TableName: aws.String(a.table), ConsistentRead: aws.Bool(true), Key: refreshKey(oldHash)})
	if err != nil || len(result.Item) == 0 || boolValue(result.Item["revoked"]) || numberValue(result.Item["expires_at"]) <= time.Now().Unix() {
		return errorResponse(401, "invalid refresh token"), nil
	}
	userID := stringValue(result.Item["user_id"])
	currentUser, err := a.findUserByID(ctx, userID)
	if err != nil {
		return errorResponse(401, "invalid refresh token"), nil
	}
	session, newItem, err := a.newSession(ctx, currentUser, request.Headers["user-agent"], time.Now().UTC())
	if err != nil {
		return events.APIGatewayV2HTTPResponse{}, err
	}
	_, err = a.dynamo.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{TransactItems: []types.TransactWriteItem{
		{Update: &types.Update{TableName: aws.String(a.table), Key: refreshKey(oldHash), UpdateExpression: aws.String("SET revoked = :true"), ConditionExpression: aws.String("revoked = :false AND expires_at > :now"), ExpressionAttributeValues: map[string]types.AttributeValue{
			":true": &types.AttributeValueMemberBOOL{Value: true}, ":false": &types.AttributeValueMemberBOOL{Value: false}, ":now": &types.AttributeValueMemberN{Value: integerString(time.Now().Unix())},
		}}},
		{Put: &types.Put{TableName: aws.String(a.table), Item: newItem}},
	}})
	if err != nil {
		return errorResponse(401, "invalid refresh token"), nil
	}
	return jsonResponse(200, session)
}

func (a *application) signOut(ctx context.Context, request events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	var input refreshRequest
	if decodeBody(request.Body, &input) == nil && input.RefreshToken != "" {
		_, _ = a.dynamo.UpdateItem(ctx, &dynamodb.UpdateItemInput{TableName: aws.String(a.table), Key: refreshKey(tokens.HashToken(input.RefreshToken)), UpdateExpression: aws.String("SET revoked = :true"), ExpressionAttributeValues: map[string]types.AttributeValue{
			":true": &types.AttributeValueMemberBOOL{Value: true},
		}})
	}
	return events.APIGatewayV2HTTPResponse{StatusCode: 204}, nil
}

func (a *application) me(ctx context.Context, request events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	claims, err := a.authenticate(ctx, request.Headers)
	if err != nil {
		return errorResponse(401, "invalid token"), nil
	}
	currentUser, err := a.findUserByID(ctx, claims.UserID)
	if err != nil {
		return errorResponse(404, "user not found"), nil
	}
	return jsonResponse(200, currentUser)
}

// changeOwnPassword changes the authenticated account password and revokes all
// refresh tokens for that account. Existing access tokens expire within the
// normal short access-token lifetime.
func (a *application) changeOwnPassword(ctx context.Context, request events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	claims, err := a.authenticate(ctx, request.Headers)
	if err != nil {
		return errorResponse(401, "invalid token"), nil
	}
	var input struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if decodeBody(request.Body, &input) != nil || input.CurrentPassword == "" {
		return errorResponse(400, "current_password and new_password are required"), nil
	}
	if !validAccountPassword(input.NewPassword) {
		return errorResponse(400, "new password must have at least 12 characters, an uppercase letter, a lowercase letter, and a number"), nil
	}
	current, err := a.findUserByID(ctx, claims.UserID)
	if err != nil || bcrypt.CompareHashAndPassword([]byte(current.PasswordHash), []byte(input.CurrentPassword)) != nil {
		return errorResponse(400, "current password is incorrect"), nil
	}
	if bcrypt.CompareHashAndPassword([]byte(current.PasswordHash), []byte(input.NewPassword)) == nil {
		return errorResponse(400, "new password must be different from the current password"), nil
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(input.NewPassword), accountHashCost)
	if err != nil {
		return events.APIGatewayV2HTTPResponse{}, err
	}
	_, err = a.dynamo.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(a.table), Key: map[string]types.AttributeValue{
			"PK": &types.AttributeValueMemberS{Value: "USER#" + claims.UserID},
			"SK": &types.AttributeValueMemberS{Value: "PROFILE"},
		},
		UpdateExpression:    aws.String("SET password_hash = :hash, password_changed_at = :changed"),
		ConditionExpression: aws.String("attribute_exists(PK) AND password_hash = :current"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":hash":    &types.AttributeValueMemberS{Value: string(hash)},
			":current": &types.AttributeValueMemberS{Value: current.PasswordHash},
			":changed": &types.AttributeValueMemberS{Value: time.Now().UTC().Format(time.RFC3339Nano)},
		},
	})
	if err != nil {
		return errorResponse(409, "password changed concurrently; please sign in again"), nil
	}
	// Revoking refresh tokens forces every other device to authenticate again.
	var start map[string]types.AttributeValue
	for {
		page, queryErr := a.dynamo.Query(ctx, &dynamodb.QueryInput{
			TableName: aws.String(a.table), IndexName: aws.String("GSI2"),
			KeyConditionExpression: aws.String("GSI2PK = :user"),
			ExpressionAttributeValues: map[string]types.AttributeValue{
				":user": &types.AttributeValueMemberS{Value: "USER#" + claims.UserID},
			}, ExclusiveStartKey: start,
		})
		if queryErr != nil {
			return events.APIGatewayV2HTTPResponse{}, queryErr
		}
		for _, item := range page.Items {
			if stringValue(item["entity_type"]) != "refresh_token" || boolValue(item["revoked"]) {
				continue
			}
			_, queryErr = a.dynamo.UpdateItem(ctx, &dynamodb.UpdateItemInput{
				TableName: aws.String(a.table), Key: map[string]types.AttributeValue{
					"PK": item["PK"], "SK": item["SK"],
				}, UpdateExpression: aws.String("SET revoked = :true"),
				ExpressionAttributeValues: map[string]types.AttributeValue{":true": &types.AttributeValueMemberBOOL{Value: true}},
			})
			if queryErr != nil {
				return events.APIGatewayV2HTTPResponse{}, queryErr
			}
		}
		if len(page.LastEvaluatedKey) == 0 {
			break
		}
		start = page.LastEvaluatedKey
	}
	return jsonResponse(200, map[string]string{"status": "password_changed"})
}

func (a *application) authenticate(ctx context.Context, headers map[string]string) (*tokens.Claims, error) {
	header := headers["authorization"]
	if header == "" {
		header = headers["Authorization"]
	}
	parts := strings.Fields(header)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return nil, errors.New("missing bearer token")
	}
	secret, err := a.loadJWTSecret(ctx)
	if err != nil {
		return nil, err
	}
	return tokens.Parse(parts[1], secret)
}

func (a *application) newSession(ctx context.Context, currentUser user, userAgent string, now time.Time) (sessionResponse, map[string]types.AttributeValue, error) {
	secret, err := a.loadJWTSecret(ctx)
	if err != nil {
		return sessionResponse{}, nil, err
	}
	accessToken, expiresAt, err := tokens.IssueAccess(currentUser.ID, currentUser.Email, secret, accessTTL)
	if err != nil {
		return sessionResponse{}, nil, err
	}
	refreshToken, refreshHash, err := tokens.NewRefreshToken()
	if err != nil {
		return sessionResponse{}, nil, err
	}
	refreshExpires := now.Add(refreshTTL)
	item := map[string]types.AttributeValue{
		"PK":          &types.AttributeValueMemberS{Value: "REFRESH#" + refreshHash},
		"SK":          &types.AttributeValueMemberS{Value: "TOKEN"},
		"GSI2PK":      &types.AttributeValueMemberS{Value: "USER#" + currentUser.ID},
		"GSI2SK":      &types.AttributeValueMemberS{Value: "REFRESH#" + now.Format(time.RFC3339Nano)},
		"entity_type": &types.AttributeValueMemberS{Value: "refresh_token"},
		"user_id":     &types.AttributeValueMemberS{Value: currentUser.ID},
		"user_agent":  &types.AttributeValueMemberS{Value: userAgent},
		"revoked":     &types.AttributeValueMemberBOOL{Value: false},
		"expires_at":  &types.AttributeValueMemberN{Value: integerString(refreshExpires.Unix())},
	}
	return sessionResponse{User: publicUser(currentUser), AccessToken: accessToken, RefreshToken: refreshToken, ExpiresAt: expiresAt, TokenType: "Bearer"}, item, nil
}

func (a *application) findUserByEmail(ctx context.Context, email string) (user, error) {
	lookup, err := a.dynamo.GetItem(ctx, &dynamodb.GetItemInput{TableName: aws.String(a.table), ConsistentRead: aws.Bool(true), Key: map[string]types.AttributeValue{
		"PK": &types.AttributeValueMemberS{Value: "EMAIL#" + email}, "SK": &types.AttributeValueMemberS{Value: "LOOKUP"},
	}})
	if err != nil || len(lookup.Item) == 0 {
		return user{}, errors.New("user not found")
	}
	return a.findUserByID(ctx, stringValue(lookup.Item["user_id"]))
}

func (a *application) findUserByID(ctx context.Context, userID string) (user, error) {
	result, err := a.dynamo.GetItem(ctx, &dynamodb.GetItemInput{TableName: aws.String(a.table), ConsistentRead: aws.Bool(true), Key: map[string]types.AttributeValue{
		"PK": &types.AttributeValueMemberS{Value: "USER#" + userID}, "SK": &types.AttributeValueMemberS{Value: "PROFILE"},
	}})
	if err != nil || len(result.Item) == 0 {
		return user{}, errors.New("user not found")
	}
	return user{ID: userID, Email: stringValue(result.Item["email"]), EmailVerified: boolValue(result.Item["email_verified"]), PasswordHash: stringValue(result.Item["password_hash"])}, nil
}

func (a *application) loadJWTSecret(ctx context.Context) (string, error) {
	a.secretMu.Lock()
	defer a.secretMu.Unlock()
	if a.jwtSecret != "" {
		return a.jwtSecret, nil
	}
	result, err := a.secrets.GetSecretValue(ctx, &secretsmanager.GetSecretValueInput{SecretId: aws.String(a.secretID)})
	if err != nil || result.SecretString == nil {
		return "", errors.New("runtime secret unavailable")
	}
	payload := bytes.TrimPrefix([]byte(*result.SecretString), []byte{0xef, 0xbb, 0xbf})
	var values map[string]string
	if json.Unmarshal(payload, &values) != nil || values["JWT_SECRET"] == "" {
		return "", errors.New("JWT_SECRET unavailable")
	}
	a.jwtSecret = values["JWT_SECRET"]
	return a.jwtSecret, nil
}

func userItem(currentUser user, meta string, createdAt time.Time) map[string]types.AttributeValue {
	return map[string]types.AttributeValue{
		"PK": &types.AttributeValueMemberS{Value: "USER#" + currentUser.ID}, "SK": &types.AttributeValueMemberS{Value: "PROFILE"},
		"entity_type": &types.AttributeValueMemberS{Value: "user"}, "email": &types.AttributeValueMemberS{Value: currentUser.Email},
		"password_hash": &types.AttributeValueMemberS{Value: currentUser.PasswordHash}, "email_verified": &types.AttributeValueMemberBOOL{Value: currentUser.EmailVerified},
		"metadata": &types.AttributeValueMemberS{Value: meta}, "created_at": &types.AttributeValueMemberS{Value: createdAt.Format(time.RFC3339Nano)},
	}
}

func refreshKey(hash string) map[string]types.AttributeValue {
	return map[string]types.AttributeValue{"PK": &types.AttributeValueMemberS{Value: "REFRESH#" + hash}, "SK": &types.AttributeValueMemberS{Value: "TOKEN"}}
}

func publicUser(value user) user {
	value.PasswordHash = ""
	return value
}

func normalizeEmail(value string) (string, error) {
	value = strings.ToLower(strings.TrimSpace(value))
	parsed, err := mail.ParseAddress(value)
	if err != nil || parsed.Address != value {
		return "", errors.New("invalid email")
	}
	return value, nil
}

func validAccountPassword(value string) bool {
	if len(value) < 12 || len(value) > 128 {
		return false
	}
	var hasUpper, hasLower, hasDigit bool
	for _, character := range value {
		switch {
		case unicode.IsUpper(character):
			hasUpper = true
		case unicode.IsLower(character):
			hasLower = true
		case unicode.IsDigit(character):
			hasDigit = true
		}
	}
	return hasUpper && hasLower && hasDigit
}

func randomID() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	encoded := hex.EncodeToString(value[:])
	return encoded[0:8] + "-" + encoded[8:12] + "-" + encoded[12:16] + "-" + encoded[16:20] + "-" + encoded[20:32], nil
}

func stringValue(value types.AttributeValue) string {
	if typed, ok := value.(*types.AttributeValueMemberS); ok {
		return typed.Value
	}
	return ""
}

func boolValue(value types.AttributeValue) bool {
	if typed, ok := value.(*types.AttributeValueMemberBOOL); ok {
		return typed.Value
	}
	return false
}

func numberValue(value types.AttributeValue) int64 {
	if typed, ok := value.(*types.AttributeValueMemberN); ok {
		var parsed int64
		for _, digit := range typed.Value {
			if digit < '0' || digit > '9' {
				return 0
			}
			parsed = parsed*10 + int64(digit-'0')
		}
		return parsed
	}
	return 0
}

func integerString(value int64) string {
	if value == 0 {
		return "0"
	}
	var digits [20]byte
	index := len(digits)
	for value > 0 {
		index--
		digits[index] = byte('0' + value%10)
		value /= 10
	}
	return string(digits[index:])
}

func decodeBody(body string, value any) error {
	decoder := json.NewDecoder(strings.NewReader(body))
	decoder.DisallowUnknownFields()
	return decoder.Decode(value)
}

func errorResponse(status int, message string) events.APIGatewayV2HTTPResponse {
	response, _ := jsonResponse(status, map[string]string{"error": message})
	return response
}

func jsonResponse(status int, value any) (events.APIGatewayV2HTTPResponse, error) {
	body, err := json.Marshal(value)
	if err != nil {
		return events.APIGatewayV2HTTPResponse{}, err
	}
	return events.APIGatewayV2HTTPResponse{StatusCode: status, Headers: map[string]string{"content-type": "application/json; charset=utf-8"}, Body: string(body)}, nil
}

func main() {
	lambda.Start(handler)
}
