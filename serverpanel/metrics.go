package serverpanel

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

type storedReport struct {
	ServerID   string         `json:"server_id"`
	ReceivedAt int64          `json:"received_at"`
	SourceAddr string         `json:"source_addr"`
	Metrics    map[string]any `json:"metrics"`
}

type MetricsStore struct {
	path    string
	mu      sync.Mutex
	reports map[string]storedReport
}

func NewMetricsStore(path string) *MetricsStore {
	store := &MetricsStore{
		path:    filepath.Clean(path),
		reports: map[string]storedReport{},
	}
	store.load()
	return store
}

func (m *MetricsStore) Update(serverID string, metrics map[string]any, sourceAddr string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.reports[serverID] = storedReport{
		ServerID:   serverID,
		ReceivedAt: time.Now().Unix(),
		SourceAddr: sourceAddr,
		Metrics:    metrics,
	}
	return m.saveLocked()
}

func (m *MetricsStore) Snapshot(config *AppConfig) map[string]any {
	now := time.Now().Unix()

	m.mu.Lock()
	reports := make(map[string]storedReport, len(m.reports))
	for key, value := range m.reports {
		reports[key] = value
	}
	m.mu.Unlock()

	servers := make([]map[string]any, 0, len(config.Servers))
	for _, server := range config.Servers {
		if !server.Enabled {
			continue
		}
		servers = append(servers, m.serverSnapshot(server, reports[server.ID], now, config.Metrics.StaleSeconds))
	}

	sort.Slice(servers, func(i, j int) bool {
		left, _ := servers[i]["name"].(string)
		right, _ := servers[j]["name"].(string)
		return left < right
	})

	return map[string]any{
		"generated_at":     now,
		"refresh_seconds":  config.RefreshSeconds,
		"collection_mode":  "komari",
		"servers":          servers,
	}
}

func (m *MetricsStore) serverSnapshot(server ServerTarget, report storedReport, now int64, staleSeconds int) map[string]any {
	base := map[string]any{
		"id":           server.ID,
		"name":         server.Name,
		"mode":         server.Mode,
		"host":         server.Host,
		"user":         server.User,
		"port":         server.Port,
		"tags":         server.Tags,
		"enabled":      server.Enabled,
		"display_host": server.DisplayHost(),
		"latency_ms":   nil,
	}

	if report.ReceivedAt == 0 {
		base["status"] = "offline"
		base["error"] = "waiting for agent report"
		base["metrics"] = nil
		base["last_report_at"] = nil
		base["report_age_seconds"] = nil
		return base
	}

	age := now - report.ReceivedAt
	if age < 0 {
		age = 0
	}
	stale := age > int64(staleSeconds)

	base["status"] = "online"
	base["error"] = ""
	base["metrics"] = report.Metrics
	base["last_report_at"] = report.ReceivedAt
	base["report_age_seconds"] = age
	base["source_addr"] = report.SourceAddr
	if stale {
		base["status"] = "offline"
		base["error"] = "agent report is stale (" + itoa64(age) + "s)"
		base["metrics"] = nil
	}
	return base
}

func (m *MetricsStore) load() {
	data, err := os.ReadFile(m.path)
	if err != nil {
		return
	}

	var payload struct {
		Reports map[string]storedReport `json:"reports"`
	}
	if err := json.Unmarshal(data, &payload); err != nil {
		m.reports = map[string]storedReport{}
		return
	}
	if payload.Reports != nil {
		m.reports = payload.Reports
	}
}

func (m *MetricsStore) saveLocked() error {
	if err := os.MkdirAll(filepath.Dir(m.path), 0o755); err != nil {
		return err
	}

	payload := struct {
		Reports map[string]storedReport `json:"reports"`
	}{
		Reports: m.reports,
	}

	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	tmpPath := m.path + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmpPath, m.path)
}
