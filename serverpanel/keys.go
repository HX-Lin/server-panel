package serverpanel

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode"
)

var defaultAllowedKeyTypes = []string{
	"ssh-ed25519",
	"ecdsa-sha2-nistp256",
	"ecdsa-sha2-nistp384",
	"ecdsa-sha2-nistp521",
	"sk-ssh-ed25519@openssh.com",
	"sk-ecdsa-sha2-nistp256@openssh.com",
}

type PublicKey struct {
	Normalized  string
	KeyType     string
	Comment     string
	Fingerprint string
}

type PublicKeyError struct {
	Message string
}

func (e *PublicKeyError) Error() string {
	return e.Message
}

func ValidatePublicKey(raw string, allowedTypes []string, allowSSHRSA bool) (PublicKey, error) {
	text := strings.TrimSpace(raw)
	if text == "" {
		return PublicKey{}, &PublicKeyError{Message: "public key is empty"}
	}
	if strings.ContainsAny(text, "\r\n") {
		return PublicKey{}, &PublicKeyError{Message: "public key must be exactly one line"}
	}
	if len(text) > 8192 {
		return PublicKey{}, &PublicKeyError{Message: "public key is too long"}
	}
	if strings.Contains(strings.ToUpper(text), "PRIVATE KEY") {
		return PublicKey{}, &PublicKeyError{Message: "private keys are not accepted"}
	}

	parts := strings.Fields(text)
	if len(parts) < 2 {
		return PublicKey{}, &PublicKeyError{Message: "public key must contain a key type and base64 body"}
	}

	keyType := parts[0]
	encoded := parts[1]
	allowed := map[string]struct{}{}
	base := allowedTypes
	if len(base) == 0 {
		base = defaultAllowedKeyTypes
	}
	for _, item := range base {
		allowed[item] = struct{}{}
	}
	if allowSSHRSA {
		allowed["ssh-rsa"] = struct{}{}
	}
	if _, ok := allowed[keyType]; !ok {
		return PublicKey{}, &PublicKeyError{Message: "unsupported key type: " + keyType}
	}

	blob, err := base64.StdEncoding.Strict().DecodeString(encoded)
	if err != nil {
		return PublicKey{}, &PublicKeyError{Message: "public key body is not valid base64"}
	}

	embeddedType, err := readSSHString(blob)
	if err != nil {
		return PublicKey{}, err
	}
	if embeddedType != keyType {
		return PublicKey{}, &PublicKeyError{Message: "public key type does not match its encoded body"}
	}

	comment := sanitizeComment(strings.Join(parts[2:], " "))
	normalized := keyType + " " + encoded
	if comment != "" {
		normalized += " " + comment
	}

	digest := sha256.Sum256(blob)
	fingerprint := "SHA256:" + strings.TrimRight(base64.StdEncoding.EncodeToString(digest[:]), "=")

	return PublicKey{
		Normalized:  normalized,
		KeyType:     keyType,
		Comment:     comment,
		Fingerprint: fingerprint,
	}, nil
}

func DistributePublicKey(config *AppConfig, runner *SSHRunner, publicKey PublicKey, actor string) (map[string]any, error) {
	if !config.KeyManagement.Enabled {
		return nil, &PublicKeyError{Message: "key management is disabled"}
	}
	if len(config.KeyManagement.Targets) == 0 {
		return nil, &PublicKeyError{Message: "no key targets configured"}
	}

	results := make([]map[string]any, 0, len(config.KeyManagement.Targets))
	for _, target := range config.KeyManagement.Targets {
		if config.KeyManagement.DryRun {
			results = append(results, map[string]any{
				"id":      target.ID,
				"name":    target.Name,
				"status":  "planned",
				"message": "dry_run enabled; authorized_keys was not changed",
			})
			continue
		}

		script := buildAuthorizedKeysScript(target, publicKey)
		result := runner.RunKeyScript(target, script)
		stdout := strings.TrimSpace(result.Stdout)
		status := "failed"
		if result.OK && (stdout == "added" || stdout == "exists") {
			status = stdout
		}

		message := stdout
		if !result.OK {
			message = firstNonEmpty(strings.TrimSpace(result.Stderr), stdout)
		}

		results = append(results, map[string]any{
			"id":         target.ID,
			"name":       target.Name,
			"status":     status,
			"message":    truncateString(message, 300),
			"latency_ms": result.LatencyMS,
		})
	}

	if err := writeAuditLog(config, publicKey, actor, results); err != nil {
		return nil, err
	}

	return map[string]any{
		"fingerprint": publicKey.Fingerprint,
		"key_type":    publicKey.KeyType,
		"dry_run":     config.KeyManagement.DryRun,
		"targets":     results,
	}, nil
}

func buildAuthorizedKeysScript(target KeyTarget, publicKey PublicKey) string {
	quotedPath := shellQuote(target.AuthorizedKeys)
	quotedKey := shellQuote(publicKey.Normalized)
	return `
set -eu
AUTH_FILE=` + quotedPath + `
KEY_LINE=` + quotedKey + `
case "$AUTH_FILE" in
  "~/"*) AUTH_FILE="$HOME/${AUTH_FILE#~/}" ;;
esac
AUTH_DIR=$(dirname "$AUTH_FILE")
umask 077
mkdir -p "$AUTH_DIR"
touch "$AUTH_FILE"
chmod 700 "$AUTH_DIR" 2>/dev/null || true
chmod 600 "$AUTH_FILE" 2>/dev/null || true
if grep -Fqx "$KEY_LINE" "$AUTH_FILE" 2>/dev/null; then
  printf 'exists\n'
else
  if [ -s "$AUTH_FILE" ] && [ "$(tail -c 1 "$AUTH_FILE" 2>/dev/null || true)" != "" ]; then
    printf '\n' >> "$AUTH_FILE"
  fi
  printf '%s\n' "$KEY_LINE" >> "$AUTH_FILE"
  printf 'added\n'
fi
`
}

func readSSHString(blob []byte) (string, error) {
	if len(blob) < 4 {
		return "", &PublicKeyError{Message: "public key body is malformed"}
	}
	length := binary.BigEndian.Uint32(blob[:4])
	if length == 0 || int(length)+4 > len(blob) {
		return "", &PublicKeyError{Message: "public key body is malformed"}
	}
	return string(blob[4 : 4+length]), nil
}

func sanitizeComment(comment string) string {
	var builder strings.Builder
	for _, r := range comment {
		if unicode.IsPrint(r) {
			builder.WriteRune(r)
		}
		if builder.Len() >= 200 {
			break
		}
	}
	return strings.TrimSpace(builder.String())
}

func writeAuditLog(config *AppConfig, publicKey PublicKey, actor string, results []map[string]any) error {
	if config.AuditLog == "" {
		return nil
	}

	path := filepath.Clean(config.AuditLog)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}

	statusParts := make([]string, 0, len(results))
	for _, item := range results {
		id, _ := item["id"].(string)
		status, _ := item["status"].(string)
		statusParts = append(statusParts, id+":"+status)
	}

	line := time.Now().Format("2006-01-02T15:04:05-0700") +
		"\tactor=" + actor +
		"\tfingerprint=" + publicKey.Fingerprint +
		"\ttype=" + publicKey.KeyType +
		"\tcomment=" + publicKey.Comment +
		"\ttargets=" + strings.Join(statusParts, ",") + "\n"

	file, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer file.Close()

	_, err = file.WriteString(line)
	return err
}

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", `'"'"'`) + "'"
}

func truncateString(value string, limit int) string {
	if len(value) <= limit {
		return value
	}
	return value[:limit]
}
