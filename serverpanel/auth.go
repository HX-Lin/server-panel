package serverpanel

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"time"
)

const sessionCookieName = "server_panel_session"

type SessionClaims struct {
	Subject   string `json:"sub"`
	UserToken string `json:"user_token,omitempty"`
	IssuedAt  int64  `json:"iat"`
	ExpiresAt int64  `json:"exp"`
}

func GetAdminPassword(auth AuthConfig) (string, error) {
	value := os.Getenv(auth.AdminPasswordEnv)
	if value == "" {
		return "", &ConfigError{Message: auth.AdminPasswordEnv + " is required"}
	}
	return value, nil
}

func GetUploadToken(auth AuthConfig) string {
	return os.Getenv(auth.KeyUploadTokenEnv)
}

func VerifyPassword(auth AuthConfig, password string) bool {
	expected, err := GetAdminPassword(auth)
	if err != nil {
		return false
	}
	return hmac.Equal([]byte(expected), []byte(password))
}

func MakeSessionCookie(auth AuthConfig) (*http.Cookie, error) {
	return MakeAdminSessionCookie(auth)
}

func MakeAdminSessionCookie(auth AuthConfig) (*http.Cookie, error) {
	now := time.Now().Unix()
	return makeSessionCookie(auth, SessionClaims{
		Subject:   "admin",
		IssuedAt:  now,
		ExpiresAt: now + int64(auth.SessionTTLSeconds),
	})
}

func MakeUserSessionCookie(auth AuthConfig, userToken string) (*http.Cookie, error) {
	userToken = NormalizeUserToken(userToken)
	if !IsUserTokenFormatValid(userToken) {
		return nil, &ConfigError{Message: "invalid user token"}
	}

	now := time.Now().Unix()
	return makeSessionCookie(auth, SessionClaims{
		Subject:   "user",
		UserToken: userToken,
		IssuedAt:  now,
		ExpiresAt: now + int64(auth.SessionTTLSeconds),
	})
}

func makeSessionCookie(auth AuthConfig, claims SessionClaims) (*http.Cookie, error) {
	secret, err := getSessionSecret(auth)
	if err != nil {
		return nil, err
	}

	body, err := signPayload(claims, secret)
	if err != nil {
		return nil, err
	}

	return &http.Cookie{
		Name:     sessionCookieName,
		Value:    body,
		Path:     "/",
		MaxAge:   auth.SessionTTLSeconds,
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
		Secure:   auth.SecureCookies,
	}, nil
}

func ExpiredSessionCookie() *http.Cookie {
	return &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   0,
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
		Expires:  time.Unix(1, 0),
	}
}

func IsAuthenticated(auth AuthConfig, r *http.Request) bool {
	_, ok := ReadSession(auth, r)
	return ok
}

func ReadSession(auth AuthConfig, r *http.Request) (SessionClaims, bool) {
	cookie, err := r.Cookie(sessionCookieName)
	if err != nil || cookie.Value == "" {
		return SessionClaims{}, false
	}
	secret, err := getSessionSecret(auth)
	if err != nil {
		return SessionClaims{}, false
	}
	return verifyToken(cookie.Value, secret)
}

func getSessionSecret(auth AuthConfig) ([]byte, error) {
	if value := os.Getenv(auth.SessionSecretEnv); value != "" {
		return []byte(value), nil
	}
	password, err := GetAdminPassword(auth)
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256([]byte("server-panel:" + password))
	return digest[:], nil
}

func signPayload(payload SessionClaims, secret []byte) (string, error) {
	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	body := b64(bodyBytes)
	signature := hmac.New(sha256.New, secret)
	signature.Write([]byte(body))
	return body + "." + b64(signature.Sum(nil)), nil
}

func verifyToken(token string, secret []byte) (SessionClaims, bool) {
	parts := strings.SplitN(token, ".", 2)
	if len(parts) != 2 {
		return SessionClaims{}, false
	}

	expectedMAC := hmac.New(sha256.New, secret)
	expectedMAC.Write([]byte(parts[0]))
	expected := b64(expectedMAC.Sum(nil))
	if !hmac.Equal([]byte(parts[1]), []byte(expected)) {
		return SessionClaims{}, false
	}

	body, err := unb64(parts[0])
	if err != nil {
		return SessionClaims{}, false
	}

	var claims SessionClaims
	if err := json.Unmarshal(body, &claims); err != nil {
		return SessionClaims{}, false
	}

	if claims.ExpiresAt < time.Now().Unix() {
		return SessionClaims{}, false
	}

	switch claims.Subject {
	case "admin":
		return claims, true
	case "user":
		if !IsUserTokenFormatValid(claims.UserToken) {
			return SessionClaims{}, false
		}
		return claims, true
	default:
		return SessionClaims{}, false
	}
}

func b64(value []byte) string {
	return strings.TrimRight(base64.URLEncoding.EncodeToString(value), "=")
}

func unb64(value string) ([]byte, error) {
	padding := len(value) % 4
	if padding != 0 {
		value += strings.Repeat("=", 4-padding)
	}
	return base64.URLEncoding.DecodeString(value)
}
