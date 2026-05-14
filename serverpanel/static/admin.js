const adminState = {
  refreshSeconds: 15,
  refreshTimer: null,
  refreshInFlight: false,
  settings: null,
};

document.addEventListener("DOMContentLoaded", () => {
  ServerPanelShared.initTheme();
  document.getElementById("refreshBtn").addEventListener("click", () => refreshAdmin(true));
  document.getElementById("logoutBtn").addEventListener("click", logoutAdmin);
  document.getElementById("adminKeyForm").addEventListener("submit", submitAdminKey);
  bootstrapAdmin();
});

async function bootstrapAdmin() {
  const session = await ServerPanelShared.fetchSession();
  if (!session.authenticated || session.role !== "admin") {
    window.location.replace("/");
    return;
  }
  ServerPanelShared.setSessionBadge("adminSessionBadge", session);
  await refreshAdmin(false);
}

async function refreshAdmin(showToast) {
  if (adminState.refreshInFlight) {
    return;
  }
  adminState.refreshInFlight = true;

  try {
    const [settings, payload] = await Promise.all([
      ServerPanelShared.api("/api/settings"),
      ServerPanelShared.api("/api/servers"),
    ]);
    adminState.settings = settings;
    renderAdminSummary(settings, payload);
    renderAdminServers(payload);
    renderSettingsMeta(settings, payload);
    scheduleAdminRefresh(payload.refresh_seconds || settings.refresh_seconds || 15);

    if (showToast) {
      ServerPanelShared.showToast("success", "刷新完成", "后台监控数据已更新。");
    }
  } catch (error) {
    const session = await ServerPanelShared.fetchSession();
    if (!session.authenticated || session.role !== "admin") {
      window.location.replace("/");
      return;
    }
    ServerPanelShared.showToast("danger", "刷新失败", error.message || "无法获取后台数据。");
  } finally {
    adminState.refreshInFlight = false;
  }
}

function scheduleAdminRefresh(refreshSeconds) {
  adminState.refreshSeconds = Number(refreshSeconds) || 15;
  clearInterval(adminState.refreshTimer);
  adminState.refreshTimer = window.setInterval(() => refreshAdmin(false), adminState.refreshSeconds * 1000);
}

function renderAdminSummary(settings, payload) {
  const servers = Array.isArray(payload.servers) ? payload.servers : [];
  const online = servers.filter((server) => server.status === "online").length;
  const gpuCount = servers.reduce((total, server) => total + ((((server.metrics || {}).gpus) || []).length || 0), 0);

  document.getElementById("summaryServers").textContent = String(servers.length);
  document.getElementById("summaryOnline").textContent = `${online}/${servers.length || 0}`;
  document.getElementById("summaryGpu").textContent = String(gpuCount);
  document.getElementById("summaryRefresh").textContent = `${payload.refresh_seconds || settings.refresh_seconds || 15}s`;
  document.getElementById("summaryStale").textContent = `${settings.metrics_stale_seconds || "-"}s`;
  document.getElementById("summaryKeyMode").textContent = settings.key_management_dry_run ? "dry_run" : "active";
  document.getElementById("lastUpdated").textContent = payload.generated_at
    ? ServerPanelShared.formatDateTime(payload.generated_at)
    : "等待刷新";

  const dryRunBadge = document.getElementById("dryRunBadge");
  if (settings.key_management_dry_run) {
    dryRunBadge.className = "badge text-bg-warning panel-badge";
    dryRunBadge.textContent = "dry_run";
  } else {
    dryRunBadge.className = "badge text-bg-success panel-badge";
    dryRunBadge.textContent = "active";
  }
}

function renderSettingsMeta(settings, payload) {
  const meta = document.getElementById("settingsMeta");
  meta.innerHTML = [
    ["采集模式", payload.collection_mode || settings.metrics_mode || "-"],
    ["刷新周期", `${payload.refresh_seconds || settings.refresh_seconds || 15}s`],
    ["过期阈值", `${settings.metrics_stale_seconds || "-"}s`],
    ["Key 目标数", String(settings.key_target_count || 0)],
    ["Key 管理", settings.key_management_enabled ? "已启用" : "已禁用"],
    ["配置路径", settings.config_path || "-"],
  ].map((pair) => {
    return '<div class="meta-row"><span>' +
      ServerPanelShared.escapeHtml(pair[0]) +
      '</span><span>' +
      ServerPanelShared.escapeHtml(pair[1]) +
      '</span></div>';
  }).join("");
}

function renderAdminServers(payload) {
  const servers = Array.isArray(payload.servers) ? payload.servers : [];
  document.getElementById("serverCardGrid").innerHTML = ServerPanelShared.buildServerCards(servers, {
    publicView: false,
    prefix: "admin",
  });
  ServerPanelShared.bindExpandableRows(document);
  ServerPanelShared.renderMobileCards("mobileServerContainer", servers, { publicView: false });
}

async function submitAdminKey(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const publicKey = document.getElementById("adminPublicKeyInput").value.trim();

  try {
    const result = await ServerPanelShared.api("/api/keys/upload", {
      method: "POST",
      body: { public_key: publicKey },
    });
    form.reset();
    renderAdminKeyResult(result);
    ServerPanelShared.showToast(
      result.dry_run ? "warning" : "success",
      result.dry_run ? "dry_run 模式" : "分发完成",
      result.dry_run ? "本次没有真实写入 authorized_keys。" : "SSH key 已进入分发流程。"
    );
  } catch (error) {
    ServerPanelShared.showToast("danger", "分发失败", error.message || "无法分发 SSH key。");
  }
}

function renderAdminKeyResult(result) {
  const list = document.getElementById("keyResultList");
  const empty = document.getElementById("keyResultEmpty");
  document.getElementById("keyFingerprint").textContent = result.fingerprint || "无";

  const targets = Array.isArray(result.targets) ? result.targets : [];
  if (!targets.length) {
    empty.classList.remove("d-none");
    list.classList.add("d-none");
    list.innerHTML = "";
    return;
  }

  empty.classList.add("d-none");
  list.classList.remove("d-none");
  list.innerHTML = targets.map((target) => {
    const statusClass = target.status === "added" || target.status === "deleted"
      ? "status-online"
      : (target.status === "exists" || target.status === "planned" ? "status-planned" : "status-offline");

    return '' +
      '<div class="result-item">' +
      '  <div>' +
      '    <div class="fw-semibold">' + ServerPanelShared.escapeHtml(target.name || target.id || "未命名目标") + '</div>' +
      '    <span class="result-message">' +
             ServerPanelShared.escapeHtml(target.message || "-") +
             (target.latency_ms ? " · " + ServerPanelShared.escapeHtml(String(target.latency_ms)) + " ms" : "") +
      '    </span>' +
      '  </div>' +
      '  <span class="status-badge ' + statusClass + '">' + ServerPanelShared.escapeHtml(target.status || "unknown") + '</span>' +
      '</div>';
  }).join("");
}

async function logoutAdmin() {
  try {
    await ServerPanelShared.api("/api/logout", { method: "POST" });
  } catch (error) {
    // Ignore logout errors and redirect anyway.
  }
  window.location.replace("/");
}
