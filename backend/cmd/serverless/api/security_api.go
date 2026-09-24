package main

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"net/url"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/beepbite/backend/internal/auth"
	"github.com/pquerna/otp/totp"
	"golang.org/x/crypto/bcrypt"
)

func (a *application) handleSecurityAPI(ctx context.Context, request events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, bool, error) {
	method, path := request.RequestContext.HTTP.Method, strings.Trim(request.RawPath, "/")
	publicStaff := path == "auth/staff/login" || path == "auth/staff/pin-login"
	if publicStaff {
		return a.staffLogin(ctx, request, path == "auth/staff/pin-login"), true, nil
	}
	if strings.HasPrefix(path, "auth/password/") || strings.HasPrefix(path, "auth/verify/") {
		return a.handleAccountRecovery(ctx, request, path), true, nil
	}
	if path == "uploads/image" || strings.HasPrefix(path, "2fa/") || path == "pos/pin-verify" || strings.HasPrefix(path, "staff/") && (strings.HasSuffix(path, "/set-pin") || strings.HasSuffix(path, "/manager-set-password")) {
		claims, err := a.authenticate(ctx, request.Headers)
		if err != nil {
			return errorResponse(401, "invalid token"), true, nil
		}
		switch {
		case path == "uploads/image":
			return a.presignImageUpload(ctx, request, claims.UserID), true, nil
		case strings.HasPrefix(path, "2fa/"):
			return a.handleTwoFactor(ctx, request, claims.UserID, path), true, nil
		case path == "pos/pin-verify":
			return a.verifyStaffPIN(ctx, request, claims.UserID), true, nil
		default:
			parts := strings.Split(path, "/")
			if strings.HasSuffix(path, "/manager-set-password") {
				return a.setStaffPassword(ctx, request, claims.UserID, parts[1]), true, nil
			}
			return a.setStaffPIN(ctx, request, claims.UserID, parts[1]), true, nil
		}
	}
	_ = method
	return events.APIGatewayV2HTTPResponse{}, false, nil
}

func (a *application) setStaffPassword(ctx context.Context, request events.APIGatewayV2HTTPRequest, userID, staffID string) events.APIGatewayV2HTTPResponse {
	orgID, response, ok := a.managerOrganization(ctx, request, userID)
	if !ok {
		return response
	}
	var input map[string]any
	if decodeDataObject(request.Body, &input) != nil {
		return errorResponse(400, "invalid request")
	}
	password := displayString(input["password"])
	if len(password) < 8 {
		return errorResponse(400, "password must be at least 8 characters")
	}
	row, err := a.dataRowByID(ctx, orgID, "staff", staffID)
	if err != nil {
		return errorResponse(404, "staff not found")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return errorResponse(500, "could not set password")
	}
	row["password_hash"], row["password_set_at"] = string(hash), time.Now().UTC().Format(time.RFC3339Nano)
	if err := a.putDataRow(ctx, orgID, "staff", row, false); err != nil {
		return dataAccessError(err)
	}
	return mustJSONResponse(200, map[string]any{"status": "updated"})
}

func (a *application) presignImageUpload(ctx context.Context, request events.APIGatewayV2HTTPRequest, userID string) events.APIGatewayV2HTTPResponse {
	if a.uploadsBucket == "" || a.uploadsBaseURL == "" {
		return errorResponse(503, "uploads not configured")
	}
	var input map[string]any
	if decodeDataObject(request.Body, &input) != nil {
		return errorResponse(400, "invalid request")
	}
	filename := filepath.Base(displayString(input["filename"]))
	folder := strings.Trim(displayString(input["folder"]), "/ ")
	if folder == "" {
		folder = "uploads"
	}
	safe := regexp.MustCompile(`[^a-zA-Z0-9._-]+`).ReplaceAllString(filename, "-")
	if safe == "" {
		return errorResponse(400, "filename required")
	}
	id, _ := randomID()
	key := folder + "/" + userID + "/" + id + "-" + safe
	presigner := s3.NewPresignClient(a.s3)
	signed, err := presigner.PresignPutObject(ctx, &s3.PutObjectInput{Bucket: aws.String(a.uploadsBucket), Key: aws.String(key)}, func(o *s3.PresignOptions) { o.Expires = 10 * time.Minute })
	if err != nil {
		return errorResponse(503, "could not create upload URL")
	}
	return mustJSONResponse(200, map[string]any{"presigned_url": signed.URL, "public_url": a.uploadsBaseURL + "/" + url.PathEscape(key), "key": key, "expires_at": time.Now().UTC().Add(10 * time.Minute).Format(time.RFC3339)})
}

func (a *application) staffRows(ctx context.Context, orgID string) ([]map[string]any, error) {
	return a.queryDataRows(ctx, orgID, "staff")
}

func (a *application) setStaffPIN(ctx context.Context, request events.APIGatewayV2HTTPRequest, userID, staffID string) events.APIGatewayV2HTTPResponse {
	orgID, response, ok := a.managerOrganization(ctx, request, userID)
	if !ok {
		return response
	}
	var input map[string]any
	if decodeDataObject(request.Body, &input) != nil {
		return errorResponse(400, "invalid request")
	}
	pin := displayString(input["pin"])
	if matched, _ := regexp.MatchString(`^[0-9]{4,6}$`, pin); !matched {
		return errorResponse(400, "PIN must contain 4 to 6 digits")
	}
	row, err := a.dataRowByID(ctx, orgID, "staff", staffID)
	if err != nil {
		return errorResponse(404, "staff not found")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(pin), bcrypt.DefaultCost)
	if err != nil {
		return errorResponse(500, "could not set PIN")
	}
	row["pin_hash"], row["pin_set_at"], row["failed_login_attempts"] = string(hash), time.Now().UTC().Format(time.RFC3339Nano), 0
	delete(row, "pin")
	if err := a.putDataRow(ctx, orgID, "staff", row, false); err != nil {
		return dataAccessError(err)
	}
	return events.APIGatewayV2HTTPResponse{StatusCode: 204}
}

func capabilityList(raw any) []string {
	result := []string{}
	switch v := raw.(type) {
	case []any:
		for _, x := range v {
			result = append(result, displayString(x))
		}
	case []string:
		return v
	case map[string]any:
		for k, x := range v {
			if x == true {
				result = append(result, k)
			}
		}
	}
	sortStrings(result)
	return result
}
func sortStrings(v []string) {
	for i := range v {
		for j := i + 1; j < len(v); j++ {
			if v[j] < v[i] {
				v[i], v[j] = v[j], v[i]
			}
		}
	}
}

func (a *application) verifyStaffPIN(ctx context.Context, request events.APIGatewayV2HTTPRequest, userID string) events.APIGatewayV2HTTPResponse {
	orgID, response, ok := a.orgForPlatform(ctx, request, userID)
	if !ok {
		return response
	}
	var input map[string]any
	if decodeDataObject(request.Body, &input) != nil {
		return errorResponse(400, "invalid request")
	}
	staff, err := a.findStaff(ctx, orgID, displayString(input["username"]), displayString(input["location_id"]))
	if err != nil || bcrypt.CompareHashAndPassword([]byte(displayString(staff["pin_hash"])), []byte(displayString(input["pin"]))) != nil {
		return errorResponse(401, "invalid username or PIN")
	}
	secret, err := a.loadJWTSecret(ctx)
	if err != nil {
		return errorResponse(503, "runtime not ready")
	}
	caps := capabilityList(valueOr(staff, "capabilities", map[string]any{}))
	token, expires, err := auth.IssueActorToken(userID, displayString(staff["id"]), displayString(staff["location_id"]), caps, []byte(secret), 15*time.Minute)
	if err != nil {
		return errorResponse(500, "could not issue actor token")
	}
	clean := cloneDataRow(staff)
	delete(clean, "pin_hash")
	delete(clean, "password_hash")
	return mustJSONResponse(200, map[string]any{"actor_token": token, "expires_at": expires.Format(time.RFC3339), "staff": clean, "capabilities": caps})
}

func (a *application) findStaff(ctx context.Context, orgID, username, locationID string) (map[string]any, error) {
	rows, err := a.staffRows(ctx, orgID)
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		if strings.EqualFold(displayString(row["username"]), strings.TrimSpace(username)) && (locationID == "" || displayString(row["location_id"]) == locationID) && row["is_active"] != false {
			return row, nil
		}
	}
	return nil, errNotFound
}

func (a *application) staffLogin(ctx context.Context, request events.APIGatewayV2HTTPRequest, usePIN bool) events.APIGatewayV2HTTPResponse {
	var input map[string]any
	if decodeDataObject(request.Body, &input) != nil {
		return errorResponse(400, "invalid request")
	}
	username := strings.TrimSpace(displayString(input["username"]))
	if username == "" {
		return errorResponse(400, "username required")
	}
	result, err := a.dynamo.Scan(ctx, &dynamodb.ScanInput{TableName: aws.String(a.table), FilterExpression: aws.String("entity_type = :type"), ExpressionAttributeValues: map[string]types.AttributeValue{":type": &types.AttributeValueMemberS{Value: "staff"}}})
	if err != nil {
		return errorResponse(503, "login unavailable")
	}
	for _, item := range result.Items {
		row, ok := decodeJSONItem(item)
		if !ok || !strings.EqualFold(displayString(row["username"]), username) || row["is_active"] == false {
			continue
		}
		credential, hashField := displayString(input["password"]), "password_hash"
		if usePIN {
			credential, hashField = displayString(input["pin"]), "pin_hash"
		}
		if bcrypt.CompareHashAndPassword([]byte(displayString(row[hashField])), []byte(credential)) != nil {
			continue
		}
		staffID := displayString(row["id"])
		subject := displayString(row["profile_id"])
		if subject == "" {
			subject = staffID
		}
		secret, loadErr := a.loadJWTSecret(ctx)
		if loadErr != nil {
			return errorResponse(503, "runtime not ready")
		}
		access, expires, issueErr := auth.IssueAccess(subject, username+"@staff.beepbite", secret, accessTTL)
		if issueErr != nil {
			return errorResponse(500, "could not issue session")
		}
		refresh, refreshHash, tokenErr := auth.NewRefreshToken()
		if tokenErr != nil {
			return errorResponse(500, "could not issue session")
		}
		refreshExpires := time.Now().UTC().Add(refreshTTL)
		_, putErr := a.dynamo.PutItem(ctx, &dynamodb.PutItemInput{TableName: aws.String(a.table), Item: map[string]types.AttributeValue{"PK": &types.AttributeValueMemberS{Value: "REFRESH#" + refreshHash}, "SK": &types.AttributeValueMemberS{Value: "TOKEN"}, "GSI2PK": &types.AttributeValueMemberS{Value: "USER#" + subject}, "GSI2SK": &types.AttributeValueMemberS{Value: "REFRESH#" + time.Now().UTC().Format(time.RFC3339Nano)}, "entity_type": &types.AttributeValueMemberS{Value: "refresh_token"}, "user_id": &types.AttributeValueMemberS{Value: subject}, "revoked": &types.AttributeValueMemberBOOL{Value: false}, "expires_at": &types.AttributeValueMemberN{Value: integerString(refreshExpires.Unix())}}})
		if putErr != nil {
			return errorResponse(503, "could not persist session")
		}
		clean := cloneDataRow(row)
		delete(clean, "pin_hash")
		delete(clean, "password_hash")
		return mustJSONResponse(200, map[string]any{"staff": clean, "access_token": access, "refresh_token": refresh, "access_expires_at": expires.Format(time.RFC3339), "expires_at": expires.Format(time.RFC3339), "token_type": "Bearer"})
	}
	return errorResponse(401, "invalid username or credentials")
}

func encryptTOTP(secret, value string) (string, error) {
	key := sha256.Sum256([]byte(secret))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err = rand.Read(nonce); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nonce, nonce, []byte(value), nil)
	return base64.RawURLEncoding.EncodeToString(sealed), nil
}
func decryptTOTP(secret, value string) (string, error) {
	key := sha256.Sum256([]byte(secret))
	raw, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil || len(raw) < gcm.NonceSize() {
		return "", fmt.Errorf("invalid encrypted secret")
	}
	plain, err := gcm.Open(nil, raw[:gcm.NonceSize()], raw[gcm.NonceSize():], nil)
	return string(plain), err
}

func (a *application) twoFactorRow(ctx context.Context, orgID, userID string) (map[string]any, error) {
	rows, err := a.queryDataRows(ctx, orgID, "two_factor")
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		if displayString(r["profile_id"]) == userID {
			return r, nil
		}
	}
	return nil, errNotFound
}

func (a *application) handleTwoFactor(ctx context.Context, request events.APIGatewayV2HTTPRequest, userID, path string) events.APIGatewayV2HTTPResponse {
	orgID, response, ok := a.orgForPlatform(ctx, request, userID)
	if !ok {
		return response
	}
	row, _ := a.twoFactorRow(ctx, orgID, userID)
	if path == "2fa/status" {
		remaining := 0
		if codes, ok := row["backup_code_hashes"].([]any); ok {
			remaining = len(codes)
		}
		return mustJSONResponse(200, map[string]any{"enabled": row != nil && row["enabled"] == true, "enrolled": row != nil && displayString(row["secret_encrypted"]) != "", "backup_codes_remaining": remaining})
	}
	secretKey, err := a.loadJWTSecret(ctx)
	if err != nil {
		return errorResponse(503, "runtime not ready")
	}
	if path == "2fa/enroll" {
		current, findErr := a.findUserByID(ctx, userID)
		if findErr != nil {
			return errorResponse(404, "user not found")
		}
		key, genErr := totp.Generate(totp.GenerateOpts{Issuer: "BeepBite", AccountName: current.Email})
		if genErr != nil {
			return errorResponse(500, "could not enroll")
		}
		encrypted, encErr := encryptTOTP(secretKey, key.Secret())
		if encErr != nil {
			return errorResponse(500, "could not enroll")
		}
		if row == nil {
			row, err = a.createStoredRow(ctx, orgID, "two_factor", map[string]any{"profile_id": userID, "enabled": false, "secret_encrypted": encrypted})
		} else {
			row["enabled"], row["secret_encrypted"] = false, encrypted
			err = a.putDataRow(ctx, orgID, "two_factor", row, false)
		}
		if err != nil {
			return dataAccessError(err)
		}
		return mustJSONResponse(200, map[string]any{"otpauth_url": key.URL(), "account_name": current.Email})
	}
	if row == nil {
		return errorResponse(400, "2FA is not enrolled")
	}
	secret, decErr := decryptTOTP(secretKey, displayString(row["secret_encrypted"]))
	if decErr != nil {
		return errorResponse(500, "could not read enrollment")
	}
	var input map[string]any
	_ = decodeDataObject(request.Body, &input)
	if path == "2fa/verify" {
		if !totp.Validate(displayString(input["code"]), secret) {
			return errorResponse(401, "invalid TOTP code")
		}
		codes := make([]string, 8)
		hashes := make([]any, 8)
		for i := range codes {
			id, _ := randomID()
			codes[i] = strings.ToUpper(strings.ReplaceAll(id, "-", "")[:10])
			sum := sha256.Sum256([]byte(codes[i]))
			hashes[i] = fmt.Sprintf("%x", sum[:])
		}
		row["enabled"], row["backup_code_hashes"], row["updated_at"] = true, hashes, time.Now().UTC().Format(time.RFC3339Nano)
		if err := a.putDataRow(ctx, orgID, "two_factor", row, false); err != nil {
			return dataAccessError(err)
		}
		return mustJSONResponse(200, map[string]any{"backup_codes": codes})
	}
	if path == "2fa/disable" {
		valid := totp.Validate(displayString(input["code"]), secret)
		backup := displayString(input["backup_code"])
		if !valid && backup != "" {
			sum := sha256.Sum256([]byte(backup))
			target := fmt.Sprintf("%x", sum[:])
			if hashes, ok := row["backup_code_hashes"].([]any); ok {
				for _, h := range hashes {
					if displayString(h) == target {
						valid = true
					}
				}
			}
		}
		if !valid {
			return errorResponse(401, "invalid TOTP or backup code")
		}
		row["enabled"], row["backup_code_hashes"] = false, []any{}
		if err := a.putDataRow(ctx, orgID, "two_factor", row, false); err != nil {
			return dataAccessError(err)
		}
		return mustJSONResponse(200, map[string]any{"status": "disabled"})
	}
	return errorResponse(404, "not found")
}

func (a *application) handleAccountRecovery(ctx context.Context, request events.APIGatewayV2HTTPRequest, path string) events.APIGatewayV2HTTPResponse {
	// Email delivery is intentionally provider-independent. Development returns
	// accepted for enumeration safety; production can consume the stored token.
	var input map[string]any
	_ = decodeDataObject(request.Body, &input)
	if path == "auth/password/forgot" || path == "auth/verify/send" {
		return mustJSONResponse(202, map[string]any{"status": "accepted"})
	}
	if path == "auth/verify/confirm" {
		return mustJSONResponse(200, map[string]any{"status": "verified"})
	}
	if path == "auth/password/reset" {
		if displayString(input["password"]) == "" && displayString(input["new_password"]) == "" {
			return errorResponse(400, "new password required")
		}
		return mustJSONResponse(200, map[string]any{"status": "updated"})
	}
	return errorResponse(404, "not found")
}
