package serverpanel

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

const (
	defaultBind           = "127.0.0.1"
	defaultPort           = 8787
	defaultRefreshSeconds = 15
	defaultAuditLog       = "data/audit.log"
	defaultMetricsStore   = "data/metrics.json"
)

type SSHConfig struct {
	ConnectTimeoutSeconds int
	KnownHostsMode        string
	IdentityFile          string
	ExtraOptions          []string
}

type AuthConfig struct {
	AdminPasswordEnv  string
	SessionSecretEnv  string
	KeyUploadTokenEnv string
	SessionTTLSeconds int
	SecureCookies     bool
}

type ServerTarget struct {
	ID             string
	Name           string
	Mode           string
	Host           string
	User           string
	Port           int
	Tags           []string
	Enabled        bool
	KomariTokenEnv string
	KomariToken    string
}

func (s ServerTarget) DisplayHost() string {
	if s.Mode == "local" {
		return "localhost"
	}
	if s.User != "" {
		return fmt.Sprintf("%s@%s:%d", s.User, s.Host, s.Port)
	}
	return fmt.Sprintf("%s:%d", s.Host, s.Port)
}

type KeyTarget struct {
	ID             string
	Name           string
	Mode           string
	Host           string
	User           string
	Port           int
	AuthorizedKeys string
}

type KeyManagementConfig struct {
	Enabled                    bool
	DryRun                     bool
	AllowPublicUploadWithToken bool
	AllowedKeyTypes            []string
	AllowSSHRSA                bool
	Targets                    []KeyTarget
}

type MetricsConfig struct {
	StaleSeconds int
	StorePath    string
}

type AppConfig struct {
	Bind          string
	Port          int
	RefreshSeconds int
	AuditLog      string
	SSH           SSHConfig
	Auth          AuthConfig
	Metrics       MetricsConfig
	KeyManagement KeyManagementConfig
	Servers       []ServerTarget
	SourcePath    string
}

func LoadConfig(path string) (*AppConfig, error) {
	resolved, err := resolveConfigPath(path)
	if err != nil {
		return nil, err
	}

	data, err := os.ReadFile(resolved)
	if err != nil {
		return nil, err
	}

	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}

	sshRaw := asMap(raw["ssh"])
	authRaw := asMap(raw["auth"])
	metricsRaw := asMap(raw["metrics"])
	keyRaw := asMap(raw["key_management"])

	cfg := &AppConfig{
		Bind:           firstNonEmpty(asString(raw["bind"]), defaultBind),
		Port:           intValue(raw["port"], defaultPort),
		RefreshSeconds: maxInt(5, intValue(raw["refresh_seconds"], defaultRefreshSeconds)),
		AuditLog:       firstNonEmpty(asString(raw["audit_log"]), defaultAuditLog),
		SSH: SSHConfig{
			ConnectTimeoutSeconds: intValue(sshRaw["connect_timeout_seconds"], 6),
			KnownHostsMode:        firstNonEmpty(asString(sshRaw["known_hosts_mode"]), "accept-new"),
			IdentityFile:          asString(sshRaw["identity_file"]),
			ExtraOptions:          toStringSlice(sshRaw["extra_options"]),
		},
		Auth: AuthConfig{
			AdminPasswordEnv:  firstNonEmpty(asString(authRaw["admin_password_env"]), "SERVER_PANEL_ADMIN_PASSWORD"),
			SessionSecretEnv:  firstNonEmpty(asString(authRaw["session_secret_env"]), "SERVER_PANEL_SESSION_SECRET"),
			KeyUploadTokenEnv: firstNonEmpty(asString(authRaw["key_upload_token_env"]), "SERVER_PANEL_KEY_UPLOAD_TOKEN"),
			SessionTTLSeconds: intValue(authRaw["session_ttl_seconds"], 28800),
			SecureCookies:     boolValue(authRaw["secure_cookies"], false),
		},
		Metrics: MetricsConfig{
			StaleSeconds: maxInt(15, intValue(metricsRaw["stale_seconds"], 90)),
			StorePath:    firstNonEmpty(asString(metricsRaw["store_path"]), defaultMetricsStore),
		},
		KeyManagement: KeyManagementConfig{
			Enabled:                    boolValue(keyRaw["enabled"], true),
			DryRun:                     boolValue(keyRaw["dry_run"], true),
			AllowPublicUploadWithToken: boolValue(keyRaw["allow_public_upload_with_token"], true),
			AllowedKeyTypes:            toStringSlice(keyRaw["allowed_key_types"]),
			AllowSSHRSA:                boolValue(keyRaw["allow_ssh_rsa"], false),
			Targets:                    parseKeyTargets(keyRaw["targets"]),
		},
		Servers:    parseServers(raw["servers"]),
		SourcePath: resolved,
	}

	return cfg, nil
}

func resolveConfigPath(path string) (string, error) {
	candidates := []string{}
	if path != "" {
		candidates = append(candidates, path)
	} else if envPath := os.Getenv("SERVER_PANEL_CONFIG"); envPath != "" {
		candidates = append(candidates, envPath)
	} else {
		candidates = append(candidates, "config.json", "config.example.json", "../config.json", "../config.example.json")
	}

	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		if _, err := os.Stat(candidate); err == nil {
			return filepath.Clean(candidate), nil
		}
	}

	if path != "" {
		return "", fmt.Errorf("config file not found: %s", path)
	}
	return "", fmt.Errorf("config.json not found and config.example.json is missing")
}

func parseServers(value any) []ServerTarget {
	items := asList(value)
	servers := make([]ServerTarget, 0, len(items))
	for _, item := range items {
		raw := asMap(item)
		id := asString(raw["id"])
		if id == "" {
			continue
		}
		servers = append(servers, ServerTarget{
			ID:             id,
			Name:           firstNonEmpty(asString(raw["name"]), id),
			Mode:           firstNonEmpty(asString(raw["mode"]), "komari"),
			Host:           asString(raw["host"]),
			User:           asString(raw["user"]),
			Port:           intValue(raw["port"], 22),
			Tags:           toStringSlice(raw["tags"]),
			Enabled:        boolValue(raw["enabled"], true),
			KomariTokenEnv: firstNonEmpty(asString(raw["komari_token_env"]), asString(raw["agent_token_env"])),
			KomariToken:    firstNonEmpty(asString(raw["komari_token"]), asString(raw["agent_token"])),
		})
	}
	return servers
}

func parseKeyTargets(value any) []KeyTarget {
	items := asList(value)
	targets := make([]KeyTarget, 0, len(items))
	for _, item := range items {
		raw := asMap(item)
		id := asString(raw["id"])
		if id == "" {
			continue
		}
		targets = append(targets, KeyTarget{
			ID:             id,
			Name:           firstNonEmpty(asString(raw["name"]), id),
			Mode:           firstNonEmpty(asString(raw["mode"]), "ssh"),
			Host:           asString(raw["host"]),
			User:           asString(raw["user"]),
			Port:           intValue(raw["port"], 22),
			AuthorizedKeys: firstNonEmpty(asString(raw["authorized_keys"]), "~/.ssh/authorized_keys"),
		})
	}
	return targets
}

func asMap(value any) map[string]any {
	if result, ok := value.(map[string]any); ok {
		return result
	}
	return map[string]any{}
}

func asList(value any) []any {
	if result, ok := value.([]any); ok {
		return result
	}
	return []any{}
}

func toStringSlice(value any) []string {
	items := asList(value)
	result := make([]string, 0, len(items))
	for _, item := range items {
		text := asString(item)
		if text != "" {
			result = append(result, text)
		}
	}
	return result
}

func asString(value any) string {
	if text, ok := value.(string); ok {
		return text
	}
	return ""
}

func asInt(value any) (int, bool) {
	switch typed := value.(type) {
	case float64:
		return int(typed), true
	case float32:
		return int(typed), true
	case int:
		return typed, true
	case int64:
		return int(typed), true
	case json.Number:
		number, err := typed.Int64()
		if err == nil {
			return int(number), true
		}
	}
	return 0, false
}

func asBool(value any) (bool, bool) {
	if typed, ok := value.(bool); ok {
		return typed, true
	}
	return false, false
}

func intValue(value any, fallback int) int {
	return defaultInt(asInt(value), fallback)
}

func boolValue(value any, fallback bool) bool {
	return defaultBool(asBool(value), fallback)
}

func defaultInt(value int, ok bool, fallback int) int {
	if ok && value != 0 {
		return value
	}
	return fallback
}

func defaultBool(value bool, ok bool, fallback bool) bool {
	if ok {
		return value
	}
	return fallback
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
