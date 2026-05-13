const mainState = {
  authenticated: false,
  refreshSeconds: 15,
  refreshTimer: null,
  refreshInFlight: false,
};

document.addEventListener("DOMContentLoaded", () => {
  ServerPanelShared.initTheme();
  document.getElementById("refreshBtn").addEventListener("click", () => refreshHome(true));
  document.getElementById("publicKeyForm").addEventListener("submit", submitPublicKey);
  bootstrapHome();
});

async function bootstrapHome() {
  const session = await ServerPanelShared.fetchSession();
  mainState.authenticated = Boolean(session.authenticated);
  renderSessionState();
  await refreshHome(false);
}

function renderSessionState() {
  ServerPanelShared.setSessionBadge("sessionBadge", mainState.authenticated);

  const adminLink = document.getElementById("adminAuthLink");
  const uploadTokenGroup = document.getElementById("uploadTokenGroup");
  const uploadModeBadge = document.getElementById("uploadModeBadge");

  adminLink.href = mainState.authenticated ? "/admin.html" : "/login.html";
  adminLink.textContent = mainState.authenticated ? "进入后台" : "管理员登录";

  uploadTokenGroup.hidden = mainState.authenticated;
  const tokenInput = document.getElementById("uploadTokenInput");
  if (mainState.authenticated) {
    tokenInput.removeAttribute("required");
    uploadModeBadge.className = "badge text-bg-success panel-badge";
    uploadModeBadge.textContent = "管理员直传";
  } else {
    tokenInput.setAttribute("required", "required");
    uploadModeBadge.className = "badge text-bg-warning panel-badge";
    uploadModeBadge.textContent = "需要 token";
  }
}

async function refreshHome(showToast) {
  if (mainState.refreshInFlight) {
    return;
  }
  mainState.refreshInFlight = true;

  try {
    const endpoint = mainState.authenticated ? "/api/servers" : "/api/public/servers";
    const requests = [ServerPanelShared.api(endpoint)];
    if (mainState.authenticated) {
      requests.push(ServerPanelShared.api("/api/settings"));
    }

    const [payload, settings] = await Promise.all(requests);
    renderHomeMonitor(payload, settings || null);
    scheduleHomeRefresh(payload.refresh_seconds || 15);

    if (showToast) {
      ServerPanelShared.showToast("success", "刷新完成", "监控数据已更新。");
    }
  } catch (error) {
    if (mainState.authenticated) {
      const session = await ServerPanelShared.fetchSession();
      if (!session.authenticated) {
        mainState.authenticated = false;
        renderSessionState();
        window.setTimeout(() => refreshHome(false), 0);
        return;
      }
    }
    ServerPanelShared.showToast("danger", "刷新失败", error.message || "无法获取监控数据。");
  } finally {
    mainState.refreshInFlight = false;
  }
}

function scheduleHomeRefresh(refreshSeconds) {
  mainState.refreshSeconds = Number(refreshSeconds) || 15;
  clearInterval(mainState.refreshTimer);
  mainState.refreshTimer = window.setInterval(() => refreshHome(false), mainState.refreshSeconds * 1000);
}

function renderHomeMonitor(payload, settings) {
  const servers = Array.isArray(payload.servers) ? payload.servers : [];
  const online = servers.filter((server) => server.status === "online").length;
  const gpuCount = servers.reduce((total, server) => total + (((server.metrics || {}).gpus || []).length || 0), 0);

  document.getElementById("summaryServers").textContent = String(servers.length);
  document.getElementById("summaryOnline").textContent = `${online}/${servers.length || 0}`;
  document.getElementById("summaryGpu").textContent = String(gpuCount);
  document.getElementById("summaryRefresh").textContent = `${payload.refresh_seconds || 15}s`;
  document.getElementById("lastUpdated").textContent = payload.generated_at
    ? ServerPanelShared.formatDateTime(payload.generated_at)
    : "等待刷新";

  const modeBadge = document.getElementById("monitorModeBadge");
  if (mainState.authenticated) {
    modeBadge.className = "badge text-bg-success panel-badge";
    modeBadge.textContent = settings && settings.key_management_dry_run ? "管理员视图 / dry_run" : "管理员视图";
  } else {
    modeBadge.className = "badge text-bg-secondary panel-badge";
    modeBadge.textContent = "访客只读";
  }

  const notice = document.getElementById("monitorNotice");
  if (!mainState.authenticated) {
    notice.className = "alert alert-primary subtle-alert mb-4";
    notice.textContent = "当前为访客只读视图。管理员登录后可查看完整节点来源并进入 SSH Key 分发后台。";
  } else if (settings && settings.key_management_dry_run) {
    notice.className = "alert alert-warning subtle-alert mb-4";
    notice.textContent = "当前 key management 处于 dry_run 模式，上传的 SSH key 只会走流程，不会写入 authorized_keys。";
  } else {
    notice.className = "alert subtle-alert d-none mb-4";
    notice.textContent = "";
  }

  document.getElementById("serverCardGrid").innerHTML = ServerPanelShared.buildServerCards(servers, {
    publicView: !mainState.authenticated,
    prefix: "home",
  });
  ServerPanelShared.bindExpandableRows(document);
  ServerPanelShared.renderMobileCards("mobileServerContainer", servers, {
    publicView: !mainState.authenticated,
  });
}

async function submitPublicKey(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const publicKey = document.getElementById("publicKeyInput").value.trim();
  const uploadToken = document.getElementById("uploadTokenInput").value.trim();

  try {
    const body = { public_key: publicKey };
    if (!mainState.authenticated) {
      body.upload_token = uploadToken;
    }
    const result = await ServerPanelShared.api("/api/keys/upload", {
      method: "POST",
      body: body,
    });
    form.reset();
    renderKeyResult(result);
    renderSessionState();
    ServerPanelShared.showToast(
      result.dry_run ? "warning" : "success",
      result.dry_run ? "dry_run 模式" : "提交成功",
      result.dry_run ? "本次没有真实写入 authorized_keys。" : "SSH key 已进入分发流程。"
    );
  } catch (error) {
    ServerPanelShared.showToast("danger", "提交失败", error.message || "无法提交 SSH key。");
  }
}

function renderKeyResult(result) {
  const list = document.getElementById("keyResultList");
  const empty = document.getElementById("keyResultEmpty");
  const fingerprint = document.getElementById("keyFingerprint");
  fingerprint.textContent = result.fingerprint || "无";

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
    const statusClass = target.status === "added"
      ? "status-online"
      : (target.status === "exists" || target.status === "planned" ? "status-planned" : "status-offline");

    return '' +
      '<div class="result-item">' +
      '  <div>' +
      '    <div class="fw-semibold">' + ServerPanelShared.escapeHtml(target.name || target.id || "未命名目标") + '</div>' +
      '    <span class="result-message">' + ServerPanelShared.escapeHtml(target.message || "-") + '</span>' +
      '  </div>' +
      '  <span class="status-badge ' + statusClass + '">' + ServerPanelShared.escapeHtml(target.status || "unknown") + '</span>' +
      '</div>';
  }).join("");
}
