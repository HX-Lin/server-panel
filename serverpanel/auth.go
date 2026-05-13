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
	secret, err := getSessionSecret(auth)
	if err != nil {
		return nil, err
	}

	now := time.Now().Unix()
	payload := map[string]any{
		"sub": "admin",
		"iat": now,
		"exp": now + int64(auth.SessionTTLSeconds),
	}
	body, err := signPayload(payload, secret)
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
	cookie, err := r.Cookie(sessionCookieName)
	if err != nil || cookie.Value == "" {
		return false
	}
	secret, err := getSessionSecret(auth)
	if err != nil {
		return false
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

func signPayload(payload map[string]any, secret []byte) (string, error) {
	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	body := b64(bodyBytes)
	signature := hmac.New(sha256.New, secret)
	signature.Write([]byte(body))
	return body + "." + b64(signature.Sum(nil)), nil
}

func verifyToken(token string, secret []byte) bool {
	parts := strings.SplitN(token, ".", 2)
	if len(parts) != 2 {
		return false
	}

	expectedMAC := hmac.New(sha256.New, secret)
	expectedMAC.Write([]byte(parts[0]))
	expected := b64(expectedMAC.Sum(nil))
	if !hmac.Equal([]byte(parts[1]), []byte(expected)) {
		return false
	}

	body, err := unb64(parts[0])
	if err != nil {
		return false
	}

	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return false
	}

	exp, ok := payload["exp"].(float64)
	if !ok {
		return false
	}
	return int64(exp) >= time.Now().Unix()
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
