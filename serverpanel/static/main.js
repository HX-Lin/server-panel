const mainState = {
  authenticated: false,
  sessionRole: "guest",
  isAdmin: false,
  userToken: "",
  refreshSeconds: 15,
  refreshTimer: null,
  refreshInFlight: false,
  ownedKeysTimer: null,
  ownedKeysBusy: false,
};

document.addEventListener("DOMContentLoaded", () => {
  ServerPanelShared.initTheme();
  document.getElementById("refreshBtn").addEventListener("click", () => refreshHome(true));
  document.getElementById("publicKeyForm").addEventListener("submit", submitPublicKey);
  document.getElementById("publicKeyInput").addEventListener("input", queueOwnedKeysRefresh);
  document.getElementById("ownedKeysRefreshBtn").addEventListener("click", () => refreshOwnedKeys(true));
  document.getElementById("ownedKeysList").addEventListener("click", handleOwnedKeysAction);
  document.getElementById("userAuthButton").addEventListener("click", toggleUserLoginPopover);
  document.getElementById("userLoginForm").addEventListener("submit", submitUserLogin);
  document.getElementById("userLoginClose").addEventListener("click", closeUserLoginPopover);
  document.getElementById("adminAuthButton").addEventListener("click", handleAdminEntryClick);
  document.getElementById("adminLoginForm").addEventListener("submit", submitAdminLogin);
  document.getElementById("adminLoginClose").addEventListener("click", closeAdminLoginPopover);
  document.getElementById("sessionLogoutButton").addEventListener("click", logoutSession);
  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("keydown", handleDocumentKeydown);
  bootstrapHome();
});

async function bootstrapHome() {
  applySession(await ServerPanelShared.fetchSession());
  renderSessionState();
  await refreshHome(false);
}

function applySession(session) {
  mainState.authenticated = Boolean(session && session.authenticated);
  mainState.sessionRole = session && typeof session.role === "string" ? session.role : "guest";
  mainState.isAdmin = mainState.sessionRole === "admin";
  mainState.userToken = session && typeof session.user_token === "string" ? session.user_token : "";
}

function renderSessionState() {
  ServerPanelShared.setSessionBadge("sessionBadge", {
    role: mainState.sessionRole,
  });

  const keySection = document.getElementById("keyManagementSection");
  const userButton = document.getElementById("userAuthButton");
  const adminButton = document.getElementById("adminAuthButton");
  const logoutButton = document.getElementById("sessionLogoutButton");
  const uploadModeBadge = document.getElementById("uploadModeBadge");
  const uploadTokenDisplay = document.getElementById("uploadTokenDisplay");
  const publicKeyInput = document.getElementById("publicKeyInput");

  closeUserLoginPopover();
  closeAdminLoginPopover();

  keySection.classList.toggle("d-none", mainState.sessionRole !== "user");
  logoutButton.classList.toggle("d-none", !mainState.authenticated);

  if (mainState.sessionRole === "admin") {
    userButton.classList.add("d-none");
    adminButton.textContent = "进入后台";
    uploadModeBadge.className = "badge text-bg-success panel-badge";
    uploadModeBadge.textContent = "管理员会话";
    uploadTokenDisplay.value = "";
    publicKeyInput.value = "";
    resetOwnedKeysState("管理员请进入后台管理 SSH Key。");
    return;
  }

  adminButton.textContent = "管理员登录";

  if (mainState.sessionRole === "user") {
    userButton.classList.add("d-none");
    uploadModeBadge.className = "badge text-bg-primary panel-badge";
    uploadModeBadge.textContent = "用户已登录";
    uploadTokenDisplay.value = mainState.userToken || "-";
    resetOwnedKeysState("正在读取当前用户已经登记的 SSH Key。");
    queueOwnedKeysRefresh();
    return;
  }

  userButton.classList.remove("d-none");
  uploadModeBadge.className = "badge text-bg-secondary panel-badge";
  uploadModeBadge.textContent = "需先登录";
  uploadTokenDisplay.value = "";
  publicKeyInput.value = "";
  resetOwnedKeysState("普通用户先登录，登录后才能查看、提交和删除 SSH Key。");
}

function handleAdminEntryClick() {
  if (mainState.isAdmin) {
    window.location.assign("/admin.html");
    return;
  }
  toggleAdminLoginPopover();
}

function toggleUserLoginPopover() {
  if (mainState.authenticated) {
    return;
  }

  const popover = document.getElementById("userLoginPopover");
  const tokenInput = document.getElementById("userLoginToken");
  const shouldOpen = popover.classList.contains("d-none");

  closeAdminLoginPopover();
  popover.classList.toggle("d-none", !shouldOpen);
  popover.setAttribute("aria-hidden", shouldOpen ? "false" : "true");

  if (shouldOpen) {
    window.setTimeout(() => tokenInput.focus(), 0);
  }
}

function closeUserLoginPopover() {
  const popover = document.getElementById("userLoginPopover");
  const form = document.getElementById("userLoginForm");
  popover.classList.add("d-none");
  popover.setAttribute("aria-hidden", "true");
  form.reset();
}

function toggleAdminLoginPopover() {
  if (mainState.isAdmin) {
    return;
  }

  const popover = document.getElementById("adminLoginPopover");
  const passwordInput = document.getElementById("adminLoginPassword");
  const shouldOpen = popover.classList.contains("d-none");

  closeUserLoginPopover();
  popover.classList.toggle("d-none", !shouldOpen);
  popover.setAttribute("aria-hidden", shouldOpen ? "false" : "true");

  if (shouldOpen) {
    window.setTimeout(() => passwordInput.focus(), 0);
  }
}

function closeAdminLoginPopover() {
  const popover = document.getElementById("adminLoginPopover");
  const form = document.getElementById("adminLoginForm");
  popover.classList.add("d-none");
  popover.setAttribute("aria-hidden", "true");
  form.reset();
}

function handleDocumentClick(event) {
  const userAnchor = document.querySelector(".user-login-anchor");
  const userPopover = document.getElementById("userLoginPopover");
  if (userAnchor && !userPopover.classList.contains("d-none") && !userAnchor.contains(event.target)) {
    closeUserLoginPopover();
  }

  const adminAnchor = document.querySelector(".admin-login-anchor");
  const adminPopover = document.getElementById("adminLoginPopover");
  if (adminAnchor && !adminPopover.classList.contains("d-none") && !adminAnchor.contains(event.target)) {
    closeAdminLoginPopover();
  }
}

function handleDocumentKeydown(event) {
  if (event.key === "Escape") {
    closeUserLoginPopover();
    closeAdminLoginPopover();
  }
}

async function submitUserLogin(event) {
  event.preventDefault();
  const tokenInput = document.getElementById("userLoginToken");
  const userToken = normalizeUserToken(tokenInput.value);

  if (!isValidUserToken(userToken)) {
    ServerPanelShared.showToast("danger", "登录失败", "用户 token 需要使用姓名全拼小写，例如 hanxiaolin。");
    tokenInput.select();
    return;
  }

  try {
    await ServerPanelShared.api("/api/login/user", {
      method: "POST",
      body: { user_token: userToken },
    });
    applySession(await ServerPanelShared.fetchSession());
    renderSessionState();
    await refreshOwnedKeys(false);
    ServerPanelShared.showToast("success", "登录成功", "现在可以管理你自己的 SSH Key 了。");
  } catch (error) {
    ServerPanelShared.showToast("danger", "登录失败", error.message || "无法建立用户会话。");
    tokenInput.select();
  }
}

async function submitAdminLogin(event) {
  event.preventDefault();
  const passwordInput = document.getElementById("adminLoginPassword");
  const password = passwordInput.value;

  try {
    await ServerPanelShared.api("/api/login", {
      method: "POST",
      body: { password: password },
    });
    applySession(await ServerPanelShared.fetchSession());
    renderSessionState();
    ServerPanelShared.showToast("success", "登录成功", "正在进入管理后台。");
    window.setTimeout(() => {
      window.location.assign("/admin.html");
    }, 220);
  } catch (error) {
    ServerPanelShared.showToast("danger", "登录失败", error.message || "管理员口令不正确。");
    passwordInput.select();
  }
}

async function logoutSession() {
  try {
    await ServerPanelShared.api("/api/logout", { method: "POST" });
  } catch (error) {
    // Ignore logout errors and continue resetting local state.
  }

  applySession({ authenticated: false, role: "guest", is_admin: false, user_token: "" });
  renderSessionState();
  renderKeyResult({ fingerprint: "无", targets: [] });
  await refreshHome(false);
}

async function refreshHome(showToast) {
  if (mainState.refreshInFlight) {
    return;
  }
  mainState.refreshInFlight = true;

  try {
    const endpoint = mainState.isAdmin ? "/api/servers" : "/api/public/servers";
    const requests = [ServerPanelShared.api(endpoint)];
    if (mainState.isAdmin) {
      requests.push(ServerPanelShared.api("/api/settings"));
    }

    const [payload, settings] = await Promise.all(requests);
    renderHomeMonitor(payload, settings || null);
    scheduleHomeRefresh(payload.refresh_seconds || 15);

    if (showToast) {
      ServerPanelShared.showToast("success", "刷新完成", "监控数据已更新。");
    }
  } catch (error) {
    if (mainState.isAdmin) {
      const session = await ServerPanelShared.fetchSession();
      if (!session.authenticated || session.role !== "admin") {
        applySession(session);
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
  if (mainState.isAdmin) {
    modeBadge.className = "badge text-bg-success panel-badge";
    modeBadge.textContent = settings && settings.key_management_dry_run ? "管理员视图 / dry_run" : "管理员视图";
  } else if (mainState.sessionRole === "user") {
    modeBadge.className = "badge text-bg-primary panel-badge";
    modeBadge.textContent = "用户视图";
  } else {
    modeBadge.className = "badge text-bg-secondary panel-badge";
    modeBadge.textContent = "访客只读";
  }

  const notice = document.getElementById("monitorNotice");
  if (mainState.isAdmin && settings && settings.key_management_dry_run) {
    notice.className = "alert alert-warning subtle-alert mb-4";
    notice.textContent = "当前 key management 处于 dry_run 模式，上传的 SSH key 只会走流程，不会写入 authorized_keys。";
  } else if (mainState.isAdmin) {
    notice.className = "alert alert-success subtle-alert mb-4";
    notice.textContent = "当前为管理员视图，完整节点来源和后台能力已开放。";
  } else if (mainState.sessionRole === "user") {
    notice.className = "alert alert-primary subtle-alert mb-4";
    notice.textContent = "当前为用户视图。服务器监控保持只读，SSH Key 管理已在下方开放给当前登录用户。";
  } else {
    notice.className = "alert alert-primary subtle-alert mb-4";
    notice.textContent = "当前为访客只读视图。登录后才能查看和管理 SSH Key。";
  }

  document.getElementById("serverCardGrid").innerHTML = ServerPanelShared.buildServerCards(servers, {
    publicView: !mainState.isAdmin,
    prefix: "home",
  });
  ServerPanelShared.bindExpandableRows(document);
  ServerPanelShared.renderMobileCards("mobileServerContainer", servers, {
    publicView: !mainState.isAdmin,
  });
}

async function submitPublicKey(event) {
  event.preventDefault();
  if (mainState.sessionRole !== "user") {
    ServerPanelShared.showToast("danger", "提交失败", "请先登录用户会话。");
    return;
  }

  const form = event.currentTarget;
  const publicKey = document.getElementById("publicKeyInput").value.trim();

  try {
    const result = await ServerPanelShared.api("/api/keys/upload", {
      method: "POST",
      body: { public_key: publicKey },
    });
    form.reset();
    renderSessionState();
    renderKeyResult(result);
    await refreshOwnedKeys(false);
    ServerPanelShared.showToast(
      result.dry_run ? "warning" : "success",
      result.dry_run ? "dry_run 模式" : "提交成功",
      result.dry_run ? "本次没有真实写入 authorized_keys。" : "SSH key 已进入分发流程。"
    );
  } catch (error) {
    ServerPanelShared.showToast("danger", "提交失败", error.message || "无法提交 SSH key。");
  }
}

function queueOwnedKeysRefresh() {
  if (mainState.sessionRole !== "user") {
    return;
  }
  window.clearTimeout(mainState.ownedKeysTimer);
  mainState.ownedKeysTimer = window.setTimeout(() => {
    refreshOwnedKeys(false);
  }, 220);
}

async function refreshOwnedKeys(showToast) {
  if (mainState.sessionRole !== "user" || mainState.ownedKeysBusy) {
    return;
  }

  const publicKey = document.getElementById("publicKeyInput").value.trim();
  mainState.ownedKeysBusy = true;

  try {
    const payload = {};
    if (looksLikePublicKey(publicKey)) {
      payload.public_key = publicKey;
    }

    const result = await ServerPanelShared.api("/api/keys/inspect", {
      method: "POST",
      body: payload,
    });
    renderOwnedKeys(result);

    if (showToast) {
      ServerPanelShared.showToast("success", "读取完成", "当前用户已有的 SSH key 已刷新。");
    }
  } catch (error) {
    resetOwnedKeysState(error.message || "无法读取当前用户的 SSH key。");
    if (showToast) {
      ServerPanelShared.showToast("danger", "读取失败", error.message || "无法读取当前用户的 SSH key。");
    }
  } finally {
    mainState.ownedKeysBusy = false;
  }
}

function resetOwnedKeysState(message) {
  const hint = document.getElementById("ownedKeysHint");
  const empty = document.getElementById("ownedKeysEmpty");
  const list = document.getElementById("ownedKeysList");

  hint.className = "alert alert-info subtle-alert mb-3";
  hint.textContent = message;
  empty.classList.remove("d-none");
  list.classList.add("d-none");
  list.innerHTML = "";
}

function renderOwnedKeys(result) {
  const hint = document.getElementById("ownedKeysHint");
  const empty = document.getElementById("ownedKeysEmpty");
  const list = document.getElementById("ownedKeysList");
  const keys = Array.isArray(result.keys) ? result.keys : [];
  const scanResults = Array.isArray(result.scan_results) ? result.scan_results : [];
  const failedScans = scanResults.filter((item) => item.status !== "ok");

  if (failedScans.length) {
    hint.className = "alert alert-warning subtle-alert mb-3";
    hint.textContent = "部分目标读取失败，下面展示的是目前成功扫到的 key，覆盖情况可能不完整。";
  } else if (keys.length) {
    hint.className = "alert alert-success subtle-alert mb-3";
    hint.textContent = "这些就是当前属于你的 key。看着不用的旧 key，直接删，别在服务器里攒电子化石。";
  } else {
    hint.className = "alert alert-info subtle-alert mb-3";
    hint.textContent = "当前还没有识别到属于这个用户的 SSH key。";
  }

  if (!keys.length) {
    empty.classList.remove("d-none");
    list.classList.add("d-none");
    list.innerHTML = "";
    return;
  }

  empty.classList.add("d-none");
  list.classList.remove("d-none");
  list.innerHTML = keys.map((item) => {
    const presentOn = Array.isArray(item.present_on) ? item.present_on : [];
    const coverage = Number(item.present_on_count) || 0;
    const expected = Number(item.expected_target_count) || presentOn.length || 0;
    const coverageStatus = item.fully_distributed ? "status-online" : "status-planned";
    const duplicateBadge = item.duplicate_of_submitted
      ? '<span class="status-badge status-planned">与当前输入相同</span>'
      : "";

    return '' +
      '<div class="result-item owned-key-item">' +
      '  <div class="owned-key-main">' +
      '    <div class="owned-key-header">' +
      '      <div class="fw-semibold">' + ServerPanelShared.escapeHtml(item.comment || "未命名 key") + '</div>' +
      '      <div class="owned-key-badges">' +
      '        <span class="status-badge ' + coverageStatus + '">已同步 ' + coverage + '/' + expected + '</span>' +
               duplicateBadge +
      '      </div>' +
      '    </div>' +
      '    <div class="result-message owned-key-meta">' +
      '      <div><span class="owned-key-meta-label">Fingerprint</span>' + ServerPanelShared.escapeHtml(item.fingerprint || "-") + '</div>' +
      '      <div><span class="owned-key-meta-label">位置</span>' + ServerPanelShared.escapeHtml(presentOn.map((target) => target.name || target.id || "未命名目标").join("、") || "-") + '</div>' +
      '    </div>' +
      '  </div>' +
      '  <div class="owned-key-actions">' +
      '    <button class="btn btn-outline-danger btn-sm" type="button" data-delete-fingerprint="' + ServerPanelShared.escapeHtml(item.fingerprint || "") + '" data-delete-comment="' + ServerPanelShared.escapeHtml(item.comment || "") + '">' +
      '      <i class="bi bi-trash3 me-1"></i>删除' +
      '    </button>' +
      '  </div>' +
      '</div>';
  }).join("");
}

async function handleOwnedKeysAction(event) {
  const button = event.target.closest("[data-delete-fingerprint]");
  if (!button || mainState.sessionRole !== "user") {
    return;
  }

  const fingerprint = button.getAttribute("data-delete-fingerprint") || "";
  const comment = button.getAttribute("data-delete-comment") || "这把 key";

  if (!fingerprint) {
    return;
  }

  if (!window.confirm('确定删除 "' + comment + '" 吗？这会同步从跳板机和目标服务器的 authorized_keys 里移除。')) {
    return;
  }

  try {
    button.disabled = true;
    const result = await ServerPanelShared.api("/api/keys/delete", {
      method: "POST",
      body: {
        fingerprint: fingerprint,
      },
    });
    renderKeyResult(result);
    await refreshOwnedKeys(false);
    ServerPanelShared.showToast(
      result.dry_run ? "warning" : "success",
      result.dry_run ? "dry_run 模式" : "删除完成",
      result.dry_run ? "本次没有真实删除 authorized_keys 内容。" : "对应 SSH key 已从目标侧执行删除。"
    );
  } catch (error) {
    ServerPanelShared.showToast("danger", "删除失败", error.message || "无法删除当前 SSH key。");
  } finally {
    button.disabled = false;
  }
}

function normalizeUserToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

function isValidUserToken(value) {
  return /^[a-z]{2,64}$/.test(value);
}

function looksLikePublicKey(value) {
  const text = String(value || "").trim();
  if (!text || text.includes("\n") || text.includes("\r")) {
    return false;
  }
  const parts = text.split(/\s+/);
  return parts.length >= 2 && /^(ssh-|ecdsa-|sk-)/.test(parts[0]);
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
    const statusClass = target.status === "added" || target.status === "deleted"
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
