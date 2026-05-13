package serverpanel

import (
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"mime"
	"net"
	"net/http"
	"os"
	"path"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

//go:embed static/*
var staticFiles embed.FS

type PanelState struct {
	config       *AppConfig
	runner       *SSHRunner
	metricsStore *MetricsStore
	tokens       map[string]string
}

func Run(configPath string) error {
	config, err := LoadConfig(configPath)
	if err != nil {
		return err
	}

	state, err := NewPanelState(config)
	if err != nil {
		return err
	}

	addr := fmt.Sprintf("%s:%d", config.Bind, config.Port)
	log.Printf("server-panel listening on http://%s", addr)
	log.Printf("config: %s", config.SourcePath)
	if config.KeyManagement.DryRun {
		log.Printf("key management dry_run is enabled; uploaded keys will not be written")
	}

	server := &http.Server{
		Addr:              addr,
		Handler:           NewRouter(state),
		ReadHeaderTimeout: 10 * time.Second,
	}
	return server.ListenAndServe()
}

func NewPanelState(config *AppConfig) (*PanelState, error) {
	if _, err := GetAdminPassword(config.Auth); err != nil {
		return nil, err
	}

	tokens := map[string]string{}
	for _, server := range config.Servers {
		if !server.Enabled {
			continue
		}

		token := server.KomariToken
		if server.KomariTokenEnv != "" {
			if value := os.Getenv(server.KomariTokenEnv); value != "" {
				token = value
			}
		}
		if token == "" {
			return nil, &ConfigError{Message: "every enabled server must define komari_token_env or komari_token"}
		}
		if existing, ok := tokens[token]; ok && existing != server.ID {
			return nil, &ConfigError{Message: "duplicate komari token configured for " + existing + " and " + server.ID}
		}
		tokens[token] = server.ID
	}

	return &PanelState{
		config:       config,
		runner:       NewSSHRunner(config),
		metricsStore: NewMetricsStore(config.Metrics.StorePath),
		tokens:       tokens,
	}, nil
}

func NewRouter(state *PanelState) *gin.Engine {
	router := gin.New()
	router.Use(gin.Recovery())
	router.Use(func(c *gin.Context) {
		if strings.HasPrefix(c.Request.URL.Path, "/api") {
			c.Header("Cache-Control", "no-store")
		}
		c.Next()
	})

	router.GET("/", state.handleIndex)
	router.HEAD("/", state.handleIndex)
	router.GET("/index.html", state.handleIndex)
	router.HEAD("/index.html", state.handleIndex)
	router.GET("/login", state.handleLoginPage)
	router.HEAD("/login", state.handleLoginPage)
	router.GET("/login.html", state.handleLoginPage)
	router.HEAD("/login.html", state.handleLoginPage)
	router.GET("/admin", state.handleAdminPage)
	router.HEAD("/admin", state.handleAdminPage)
	router.GET("/admin.html", state.handleAdminPage)
	router.HEAD("/admin.html", state.handleAdminPage)
	router.GET("/static/*path", state.handleStatic)
	router.HEAD("/static/*path", state.handleStatic)

	router.GET("/api/session", state.handleSession)
	router.GET("/api/public/servers", state.handlePublicServers)
	router.GET("/api/settings", state.handleSettings)
	router.GET("/api/servers", state.handleServers)
	router.GET("/api/clients/report", state.handleClientReportWebSocket)

	router.POST("/api/login", state.handleLogin)
	router.POST("/api/logout", state.handleLogout)
	router.POST("/api/keys/upload", state.handleKeyUpload)
	router.POST("/api/clients/report", state.handleClientReportPost)
	router.POST("/api/clients/uploadBasicInfo", state.handleClientUploadBasicInfo)

	router.NoRoute(func(c *gin.Context) {
		if strings.HasPrefix(c.Request.URL.Path, "/api") {
			panelError(c, http.StatusNotFound, "not found")
			return
		}
		c.String(http.StatusNotFound, "not found")
	})

	return router
}

func (s *PanelState) handleIndex(c *gin.Context) {
	s.servePage(c, "index.html")
}

func (s *PanelState) handleLoginPage(c *gin.Context) {
	s.servePage(c, "login.html")
}

func (s *PanelState) handleAdminPage(c *gin.Context) {
	s.servePage(c, "admin.html")
}

func (s *PanelState) handleStatic(c *gin.Context) {
	relativePath := strings.TrimPrefix(c.Param("path"), "/")
	if relativePath == "" {
		panelError(c, http.StatusNotFound, "not found")
		return
	}
	s.serveStaticFile(c, relativePath)
}

func (s *PanelState) handlePublicServers(c *gin.Context) {
	snapshot := s.metricsStore.Snapshot(s.config)
	servers, _ := snapshot["servers"].([]map[string]any)

	publicServers := make([]map[string]any, 0, len(servers))
	for _, server := range servers {
		publicServers = append(publicServers, map[string]any{
			"id":                 server["id"],
			"name":               server["name"],
			"tags":               server["tags"],
			"enabled":            server["enabled"],
			"status":             server["status"],
			"error":              server["error"],
			"metrics":            server["metrics"],
			"last_report_at":     server["last_report_at"],
			"report_age_seconds": server["report_age_seconds"],
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"generated_at":    snapshot["generated_at"],
		"refresh_seconds": snapshot["refresh_seconds"],
		"collection_mode": snapshot["collection_mode"],
		"servers":         publicServers,
	})
}

func (s *PanelState) handleSession(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"authenticated": s.isAuthenticated(c)})
}

func (s *PanelState) handleSettings(c *gin.Context) {
	if !s.requireAuth(c) {
		return
	}

	enabledServers := 0
	for _, item := range s.config.Servers {
		if item.Enabled {
			enabledServers++
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"refresh_seconds":            s.config.RefreshSeconds,
		"server_count":               enabledServers,
		"key_management_enabled":     s.config.KeyManagement.Enabled,
		"key_management_dry_run":     s.config.KeyManagement.DryRun,
		"key_target_count":           len(s.config.KeyManagement.Targets),
		"metrics_mode":               "komari",
		"metrics_stale_seconds":      s.config.Metrics.StaleSeconds,
		"config_path":                s.config.SourcePath,
	})
}

func (s *PanelState) handleServers(c *gin.Context) {
	if !s.requireAuth(c) {
		return
	}
	c.JSON(http.StatusOK, s.metricsStore.Snapshot(s.config))
}

func (s *PanelState) handleLogin(c *gin.Context) {
	body, err := readJSONBody(c)
	if err != nil {
		panelError(c, http.StatusBadRequest, "invalid JSON")
		return
	}

	password := asString(body["password"])
	if !VerifyPassword(s.config.Auth, password) {
		panelError(c, http.StatusUnauthorized, "invalid password")
		return
	}

	cookie, err := MakeSessionCookie(s.config.Auth)
	if err != nil {
		panelError(c, http.StatusInternalServerError, err.Error())
		return
	}
	http.SetCookie(c.Writer, cookie)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (s *PanelState) handleLogout(c *gin.Context) {
	http.SetCookie(c.Writer, ExpiredSessionCookie())
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (s *PanelState) handleKeyUpload(c *gin.Context) {
	body, err := readJSONBody(c)
	if err != nil {
		panelError(c, http.StatusBadRequest, "invalid JSON")
		return
	}

	if !s.canUploadKey(c, body) {
		panelError(c, http.StatusUnauthorized, "authentication or upload token required")
		return
	}

	publicKey, err := ValidatePublicKey(asString(body["public_key"]), s.config.KeyManagement.AllowedKeyTypes, s.config.KeyManagement.AllowSSHRSA)
	if err != nil {
		var keyErr *PublicKeyError
		if errors.As(err, &keyErr) {
			panelError(c, http.StatusBadRequest, keyErr.Error())
			return
		}
		panelError(c, http.StatusInternalServerError, err.Error())
		return
	}

	actor := "upload-token"
	if s.isAuthenticated(c) {
		actor = "admin"
	}

	result, err := DistributePublicKey(s.config, s.runner, publicKey, actor)
	if err != nil {
		var keyErr *PublicKeyError
		if errors.As(err, &keyErr) {
			panelError(c, http.StatusBadRequest, keyErr.Error())
			return
		}
		panelError(c, http.StatusInternalServerError, err.Error())
		return
	}

	c.JSON(http.StatusOK, result)
}

func (s *PanelState) handleClientReportPost(c *gin.Context) {
	body, err := readJSONBody(c)
	if err != nil {
		komariError(c, http.StatusBadRequest, "Invalid JSON")
		return
	}

	serverID := s.ResolveAgentServerID(extractKomariToken(c, body))
	if serverID == "" {
		komariError(c, http.StatusUnauthorized, "Unauthorized.")
		return
	}

	if err := s.metricsStore.Update(serverID, NormalizeKomariReport(body), clientAddress(c)); err != nil {
		komariError(c, http.StatusInternalServerError, err.Error())
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "success"})
}

func (s *PanelState) handleClientUploadBasicInfo(c *gin.Context) {
	body, err := readJSONBody(c)
	if err != nil {
		komariError(c, http.StatusBadRequest, "Invalid JSON")
		return
	}

	if s.ResolveAgentServerID(extractKomariToken(c, body)) == "" {
		komariError(c, http.StatusBadRequest, "Invalid token")
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "success"})
}

func (s *PanelState) handleClientReportWebSocket(c *gin.Context) {
	if !websocket.IsWebSocketUpgrade(c.Request) {
		komariError(c, http.StatusBadRequest, "Require WebSocket upgrade")
		return
	}

	serverID := s.ResolveAgentServerID(extractKomariToken(c, map[string]any{}))
	if serverID == "" {
		komariError(c, http.StatusUnauthorized, "Unauthorized.")
		return
	}

	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}

	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	timeout := time.Duration(maxInt(15, s.config.Metrics.StaleSeconds)) * time.Second
	conn.SetReadLimit(64 << 10)
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(timeout))
	})

	sourceAddr := clientAddress(c)
	for {
		conn.SetReadDeadline(time.Now().Add(timeout))
		_, message, err := conn.ReadMessage()
		if err != nil {
			return
		}

		var body map[string]any
		if err := json.Unmarshal(message, &body); err != nil {
			conn.WriteJSON(gin.H{"status": "error", "error": "Invalid JSON"})
			continue
		}

		if err := s.metricsStore.Update(serverID, NormalizeKomariReport(body), sourceAddr); err != nil {
			conn.WriteJSON(gin.H{"status": "error", "error": err.Error()})
		}
	}
}

func (s *PanelState) ResolveAgentServerID(token string) string {
	if token == "" {
		return ""
	}
	return s.tokens[token]
}

func (s *PanelState) serveStaticFile(c *gin.Context, relativePath string) {
	cleanPath := path.Clean(strings.TrimPrefix(relativePath, "/"))
	if cleanPath == "." || cleanPath == "" || strings.HasPrefix(cleanPath, "../") {
		panelError(c, http.StatusBadRequest, "invalid path")
		return
	}

	staticFS, err := fs.Sub(staticFiles, "static")
	if err != nil {
		panelError(c, http.StatusInternalServerError, "static filesystem unavailable")
		return
	}

	data, err := fs.ReadFile(staticFS, cleanPath)
	if err != nil {
		panelError(c, http.StatusNotFound, "not found")
		return
	}

	contentType := mime.TypeByExtension(path.Ext(cleanPath))
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	c.Header("Content-Type", contentType)
	if path.Ext(cleanPath) == ".html" {
		c.Header("Cache-Control", "no-cache")
	} else {
		c.Header("Cache-Control", "public, max-age=3600")
	}
	c.Header("Content-Length", itoa(len(data)))

	if c.Request.Method == http.MethodHead {
		c.Status(http.StatusOK)
		return
	}
	c.Data(http.StatusOK, contentType, data)
}

func (s *PanelState) servePage(c *gin.Context, page string) {
	s.serveStaticFile(c, page)
}

func (s *PanelState) isAuthenticated(c *gin.Context) bool {
	return IsAuthenticated(s.config.Auth, c.Request)
}

func (s *PanelState) requireAuth(c *gin.Context) bool {
	if s.isAuthenticated(c) {
		return true
	}
	panelError(c, http.StatusUnauthorized, "login required")
	return false
}

func (s *PanelState) canUploadKey(c *gin.Context, body map[string]any) bool {
	if s.isAuthenticated(c) {
		return true
	}
	if !s.config.KeyManagement.AllowPublicUploadWithToken {
		return false
	}

	expected := GetUploadToken(s.config.Auth)
	supplied := asString(body["upload_token"])
	return expected != "" && secureEqual(expected, supplied)
}

func readJSONBody(c *gin.Context) (map[string]any, error) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.UseNumber()

	var body map[string]any
	if err := decoder.Decode(&body); err != nil {
		if errors.Is(err, io.EOF) {
			return map[string]any{}, nil
		}
		return nil, err
	}
	return body, nil
}

func extractKomariToken(c *gin.Context, body map[string]any) string {
	if token := c.Query("token"); token != "" {
		return token
	}
	if authHeader := c.GetHeader("Authorization"); strings.HasPrefix(authHeader, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer "))
	}
	return asString(body["token"])
}

func clientAddress(c *gin.Context) string {
	for _, header := range []string{"X-Forwarded-For", "X-Real-IP"} {
		value := strings.TrimSpace(c.GetHeader(header))
		if value == "" {
			continue
		}
		if header == "X-Forwarded-For" {
			parts := strings.Split(value, ",")
			if len(parts) > 0 {
				value = strings.TrimSpace(parts[0])
			}
		}
		if value != "" {
			return value
		}
	}

	remoteAddr := c.Request.RemoteAddr
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		return remoteAddr
	}
	return host
}

func panelError(c *gin.Context, status int, message string) {
	c.JSON(status, gin.H{"ok": false, "error": message})
}

func komariError(c *gin.Context, status int, message string) {
	c.JSON(status, gin.H{"status": "error", "error": message})
}
