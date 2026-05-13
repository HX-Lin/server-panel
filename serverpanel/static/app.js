const state = {
  authenticated: false,
  refreshSeconds: 15,
  refreshTimer: null,
  refreshInFlight: false,
  settings: null,
};

const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", () => {
  $("loginForm").addEventListener("submit", login);
  $("logoutBtn").addEventListener("click", logout);
  $("refreshBtn").addEventListener("click", () => refreshAll(true));
  $("publicKeyForm").addEventListener("submit", uploadKey);
  $("adminKeyForm").addEventListener("submit", uploadKey);
  bootstrap();
});

async function bootstrap() {
  const session = await api("/api/session", { authOptional: true });
  setAuthenticated(Boolean(session.authenticated));
  if (state.authenticated) {
    await refreshAll(true);
  }
}

async function login(event) {
  event.preventDefault();
  const password = $("passwordInput").value;
  try {
    await api("/api/login", {
      method: "POST",
      body: { password },
      authOptional: true,
    });
    $("passwordInput").value = "";
    setAuthenticated(true);
    await refreshAll(true);
  } catch (error) {
    showToast(error.message || "登录失败");
  }
}

async function logout() {
  await api("/api/logout", { method: "POST", authOptional: true });
  setAuthenticated(false);
  clearInterval(state.refreshTimer);
}

function setAuthenticated(value) {
  state.authenticated = value;
  $("entryPanel").hidden = value;
  $("dashboard").hidden = !value;
  $("logoutBtn").hidden = !value;
  $("sessionState").textContent = value ? "已登录" : "未登录";
  $("sessionState").className = value ? "pill ok" : "pill muted";
}

async function refreshAll(force) {
  if (!state.authenticated) return;
  if (state.refreshInFlight) return;
  state.refreshInFlight = true;
  try {
    const [settings, metrics] = await Promise.all([
      api("/api/settings"),
      api("/api/servers"),
    ]);
    state.settings = settings;
    state.refreshSeconds = Number(metrics.refresh_seconds || settings.refresh_seconds || 15);
    renderSettings(settings);
    renderServers(metrics);
    scheduleRefresh();
    if (force) showToast("资源状态已刷新");
  } catch (error) {
    showToast(error.message || "刷新失败");
    if (String(error.message).includes("login required")) {
      setAuthenticated(false);
    }
  } finally {
    state.refreshInFlight = false;
  }
}

function scheduleRefresh() {
  clearInterval(state.refreshTimer);
  state.refreshTimer = setInterval(() => refreshAll(false), state.refreshSeconds * 1000);
}

function renderSettings(settings) {
  $("summaryKeyMode").textContent = settings.key_management_dry_run ? "dry_run" : "active";
  $("dryRunBadge").textContent = settings.key_management_dry_run ? "dry_run" : "active";
  $("dryRunBadge").className = settings.key_management_dry_run ? "pill warning" : "pill ok";
}

function renderServers(payload) {
  const servers = payload.servers || [];
  const online = servers.filter((server) => server.status === "online").length;
  const gpuCount = servers.reduce((total, server) => total + ((server.metrics && server.metrics.gpus) ? server.metrics.gpus.length : 0), 0);
  $("summaryServers").textContent = String(servers.length);
  $("summaryOnline").textContent = `${online}/${servers.length}`;
  $("summaryGpu").textContent = String(gpuCount);
  $("lastUpdated").textContent = `刷新于 ${formatTime(payload.generated_at)}`;

  $("serverGrid").innerHTML = servers.map(renderServerCard).join("");
}

function renderServerCard(server) {
  const metrics = server.metrics;
  const statusClass = server.status === "online" ? "ok" : "bad";
  const cpu = metrics && metrics.cpu ? metrics.cpu.usage_percent : null;
  const memory = metrics && metrics.memory ? metrics.memory.usage_percent : null;
  const gpus = metrics && Array.isArray(metrics.gpus) ? metrics.gpus : [];

  return `
    <article class="server-card">
      <div class="server-card-header">
        <div>
          <h3 class="server-name">${escapeHtml(server.name)}</h3>
          <div class="server-host">${escapeHtml(server.display_host || server.host || "")}</div>
        </div>
        <span class="pill ${statusClass}">${server.status === "online" ? "online" : "offline"}</span>
      </div>
      <div class="server-body">
        ${server.status !== "online" ? `<div class="offline">${escapeHtml(server.error || "连接失败")}</div>` : ""}
        ${metricBar("CPU", cpu)}
        ${metricBar("内存", memory)}
        <div class="metric-row">
          <div class="metric-line">
            <span>Uptime</span>
            <strong>${metrics ? formatDuration(metrics.uptime_seconds) : "-"}</strong>
          </div>
          <div class="metric-line">
            <span>Load</span>
            <strong>${metrics && metrics.cpu ? formatLoad(metrics.cpu) : "-"}</strong>
          </div>
        </div>
        <div class="gpu-list">
          ${gpus.length ? gpus.map(renderGpu).join("") : `<div class="metric-line"><span>GPU</span><strong>未检测到 NVIDIA GPU</strong></div>`}
        </div>
      </div>
    </article>`;
}

function renderGpu(gpu) {
  const memPercent = percent(gpu.memory_used_bytes, gpu.memory_total_bytes);
  return `
    <div class="gpu-item">
      <div class="gpu-title">
        <strong>${escapeHtml(gpu.name || `GPU ${gpu.index}`)}</strong>
        <span>${formatBytes(gpu.memory_used_bytes)} / ${formatBytes(gpu.memory_total_bytes)}</span>
      </div>
      ${metricBar("显存", memPercent)}
      ${metricBar("GPU 利用率", gpu.utilization_percent)}
      <div class="metric-line">
        <span>温度 / 功耗</span>
        <strong>${valueOrDash(gpu.temperature_c, "°C")} / ${valueOrDash(gpu.power_watts, "W")}</strong>
      </div>
    </div>`;
}

function metricBar(label, value) {
  const clean = typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
  const klass = clean === null ? "" : clean >= 90 ? "bad" : clean >= 75 ? "warn" : "";
  return `
    <div class="metric-row">
      <div class="metric-line">
        <span>${label}</span>
        <strong>${clean === null ? "-" : `${clean.toFixed(1)}%`}</strong>
      </div>
      <div class="bar"><span class="${klass}" style="width: ${clean === null ? 0 : clean}%"></span></div>
    </div>`;
}

async function uploadKey(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const publicKey = String(data.get("public_key") || "").trim();
  const uploadToken = String(data.get("upload_token") || "").trim();
  try {
    const result = await api("/api/keys/upload", {
      method: "POST",
      body: {
        public_key: publicKey,
        upload_token: uploadToken,
      },
    });
    form.reset();
    renderKeyResult(result);
    showToast(result.dry_run ? "dry_run：未写入 authorized_keys" : "SSH key 已分发");
  } catch (error) {
    showToast(error.message || "提交失败");
  }
}

function renderKeyResult(result) {
  $("keyFingerprint").textContent = result.fingerprint || "无";
  const targets = result.targets || [];
  $("keyResult").className = "result-list";
  $("keyResult").innerHTML = targets.map((target) => {
    const statusClass = target.status === "added" ? "ok" : target.status === "exists" || target.status === "planned" ? "warning" : "bad";
    return `
      <div class="result-item">
        <span>${escapeHtml(target.name)}</span>
        <span class="pill ${statusClass}">${escapeHtml(target.status)}</span>
      </div>`;
  }).join("");
}

async function api(path, options = {}) {
  const init = {
    method: options.method || "GET",
    headers: {},
  };
  if (options.body) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }
  const response = await fetch(path, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `${response.status} ${response.statusText}`);
  }
  return data;
}

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    toast.hidden = true;
  }, 2600);
}

function formatTime(seconds) {
  if (!seconds) return "-";
  return new Date(seconds * 1000).toLocaleTimeString("zh-CN", { hour12: false });
}

function formatDuration(seconds) {
  if (!seconds) return "-";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h`;
  return `${hours}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function formatLoad(cpu) {
  const values = [cpu.load1, cpu.load5, cpu.load15].filter((item) => typeof item === "number");
  return values.length ? values.map((item) => item.toFixed(2)).join(" / ") : "-";
}

function formatBytes(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function percent(used, total) {
  if (!used || !total) return null;
  return used * 100 / total;
}

function valueOrDash(value, suffix) {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(0)}${suffix}` : "-";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
