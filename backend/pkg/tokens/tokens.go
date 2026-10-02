// Package tokens contains stateless JWT and opaque-token helpers shared by
// the AWS Lambda API and realtime functions. It has no storage dependency.
package tokens

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type Claims struct {
	UserID string `json:"sub"`
	Email  string `json:"email"`
	jwt.RegisteredClaims
}

type ActorClaims struct {
	MemberID     string   `json:"member_id"`
	StaffID      string   `json:"staff_id"`
	LocationID   string   `json:"location_id"`
	Capabilities []string `json:"capabilities"`
	jwt.RegisteredClaims
}

const actorAudience = "actor-overlay"

func IssueAccess(userID, email, secret string, ttl time.Duration) (string, time.Time, error) {
	now := time.Now().UTC()
	expires := now.Add(ttl)
	claims := Claims{UserID: userID, Email: email, RegisteredClaims: jwt.RegisteredClaims{
		Subject: userID, IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(expires), NotBefore: jwt.NewNumericDate(now),
	}}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(secret))
	if err != nil {
		return "", time.Time{}, err
	}
	return signed, expires, nil
}

func Parse(raw, secret string) (*Claims, error) {
	claims := &Claims{}
	_, err := jwt.ParseWithClaims(raw, claims, func(token *jwt.Token) (any, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return []byte(secret), nil
	})
	if err != nil {
		return nil, err
	}
	if claims.UserID == "" {
		return nil, fmt.Errorf("token missing sub")
	}
	return claims, nil
}

func IssueActorToken(memberID, staffID, locationID string, capabilities []string, secret []byte, ttl time.Duration) (string, time.Time, error) {
	now := time.Now().UTC()
	expires := now.Add(ttl)
	claims := ActorClaims{
		MemberID: memberID, StaffID: staffID, LocationID: locationID, Capabilities: capabilities,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject: staffID, Audience: jwt.ClaimStrings{actorAudience}, IssuedAt: jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(expires), NotBefore: jwt.NewNumericDate(now),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString(secret)
	if err != nil {
		return "", time.Time{}, err
	}
	return signed, expires, nil
}

func ParseActorToken(raw string, secret []byte) (*ActorClaims, error) {
	claims := &ActorClaims{}
	_, err := jwt.ParseWithClaims(raw, claims, func(token *jwt.Token) (any, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("actor token: unexpected signing method %v", token.Header["alg"])
		}
		return secret, nil
	}, jwt.WithAudience(actorAudience))
	if err != nil {
		return nil, err
	}
	if claims.StaffID == "" {
		return nil, fmt.Errorf("actor token: missing staff_id")
	}
	return claims, nil
}

func NewRefreshToken() (raw, hashed string, err error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", "", err
	}
	raw = base64.RawURLEncoding.EncodeToString(bytes)
	return raw, HashToken(raw), nil
}

func HashToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}
