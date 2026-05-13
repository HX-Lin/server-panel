(function () {
  var THEME_KEY = "server-panel-theme";

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function currentTheme() {
    return document.documentElement.getAttribute("data-bs-theme") === "dark" ? "dark" : "light";
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-bs-theme", theme === "dark" ? "dark" : "light");
    localStorage.setItem(THEME_KEY, currentTheme());
    syncThemeIcons();
  }

  function syncThemeIcons() {
    var icons = document.querySelectorAll("#themeToggler i");
    icons.forEach(function (icon) {
      if (currentTheme() === "dark") {
        icon.className = "bi bi-sun-fill";
      } else {
        icon.className = "bi bi-moon-stars-fill";
      }
    });
  }

  function initTheme() {
    syncThemeIcons();
    var toggler = document.getElementById("themeToggler");
    if (!toggler || toggler.dataset.bound === "true") {
      return;
    }
    toggler.dataset.bound = "true";
    toggler.addEventListener("click", function () {
      applyTheme(currentTheme() === "dark" ? "light" : "dark");
    });
  }

  function ensureToastContainer() {
    var container = document.getElementById("toastContainer");
    if (!container) {
      container = document.createElement("div");
      container.id = "toastContainer";
      container.className = "toast-stack";
      document.body.appendChild(container);
    }
    return container;
  }

  function showToast(type, title, message) {
    var container = ensureToastContainer();
    var toast = document.createElement("div");
    toast.className = "custom-toast toast-" + type;
    toast.innerHTML =
      "<strong>" + escapeHtml(title) + "</strong>" +
      "<div>" + escapeHtml(message) + "</div>";
    container.appendChild(toast);
    window.setTimeout(function () {
      toast.remove();
    }, 3200);
  }

  async function api(path, options) {
    var opts = options || {};
    var init = {
      method: opts.method || "GET",
      headers: {
        Accept: "application/json",
      },
      credentials: "same-origin",
    };

    if (opts.body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }

    var response = await fetch(path, init);
    var data = {};
    try {
      data = await response.json();
    } catch (error) {
      data = {};
    }

    if (!response.ok) {
      throw new Error(data.error || data.message || (response.status + " " + response.statusText));
    }
    return data;
  }

  async function fetchSession() {
    try {
      return await api("/api/session");
    } catch (error) {
      return { authenticated: false };
    }
  }

  function setSessionBadge(targetId, authenticated) {
    var badge = document.getElementById(targetId);
    if (!badge) {
      return;
    }
    badge.className = "badge panel-badge " + (authenticated ? "text-bg-success" : "text-bg-secondary");
    badge.textContent = authenticated ? "管理员会话" : "访客模式";
  }

  function formatBytes(bytes) {
    if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) {
      return "-";
    }
    var units = ["B", "KiB", "MiB", "GiB", "TiB"];
    var size = bytes;
    var unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit += 1;
    }
    var digits = size >= 100 || unit === 0 ? 0 : 1;
    return size.toFixed(digits) + " " + units[unit];
  }

  function formatPercent(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return "-";
    }
    return clamp(value, 0, 100).toFixed(1) + "%";
  }

  function formatDuration(seconds) {
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
      return "-";
    }
    var days = Math.floor(seconds / 86400);
    var hours = Math.floor((seconds % 86400) / 3600);
    var minutes = Math.floor((seconds % 3600) / 60);
    if (days > 0) {
      return days + "d " + hours + "h";
    }
    if (hours > 0) {
      return hours + "h " + minutes + "m";
    }
    return minutes + "m";
  }

  function formatDateTime(seconds) {
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
      return "-";
    }
    return new Date(seconds * 1000).toLocaleString("zh-CN", { hour12: false });
  }

  function formatRelativeSeconds(seconds) {
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) {
      return "-";
    }
    if (seconds < 60) {
      return seconds + " 秒前";
    }
    if (seconds < 3600) {
      return Math.floor(seconds / 60) + " 分钟前";
    }
    if (seconds < 86400) {
      return Math.floor(seconds / 3600) + " 小时前";
    }
    return Math.floor(seconds / 86400) + " 天前";
  }

  function averageGpuUtil(server) {
    var gpus = (((server || {}).metrics || {}).gpus) || [];
    if (!Array.isArray(gpus) || gpus.length === 0) {
      return null;
    }
    var values = gpus
      .map(function (gpu) { return gpu.utilization_percent; })
      .filter(function (value) { return typeof value === "number" && Number.isFinite(value); });
    if (!values.length) {
      return null;
    }
    return values.reduce(function (sum, value) { return sum + value; }, 0) / values.length;
  }

  function averageGpuMemory(server) {
    var gpus = (((server || {}).metrics || {}).gpus) || [];
    if (!Array.isArray(gpus) || gpus.length === 0) {
      return null;
    }
    var totalUsed = 0;
    var totalMemory = 0;
    gpus.forEach(function (gpu) {
      if (typeof gpu.memory_used_bytes === "number" && typeof gpu.memory_total_bytes === "number" && gpu.memory_total_bytes > 0) {
        totalUsed += gpu.memory_used_bytes;
        totalMemory += gpu.memory_total_bytes;
      }
    });
    if (totalMemory === 0) {
      return null;
    }
    return (totalUsed / totalMemory) * 100;
  }

  function metricTone(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return "bg-secondary";
    }
    if (value >= 90) {
      return "bg-danger";
    }
    if (value >= 75) {
      return "bg-warning";
    }
    return "bg-success";
  }

  function renderMetricBar(value, caption) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return '<div class="text-body-secondary">-</div>';
    }
    var width = clamp(value, 0, 100);
    var label = formatPercent(width);
    return '' +
      '<div class="progress metric-progress">' +
      '  <div class="progress-bar ' + metricTone(width) + '" style="width:' + width.toFixed(1) + '%">' + label + '</div>' +
      '</div>' +
      (caption ? '<div class="metric-caption">' + escapeHtml(caption) + '</div>' : '');
  }

  function statusBadge(server) {
    if (server.status === "online") {
      return '<span class="status-badge status-online"><i class="bi bi-circle-fill"></i>在线</span>';
    }
    if (server.status === "planned") {
      return '<span class="status-badge status-planned"><i class="bi bi-hourglass-split"></i>预检</span>';
    }
    return '<span class="status-badge status-offline"><i class="bi bi-circle-fill"></i>离线</span>';
  }

  function detailCard(label, value) {
    return '' +
      '<div class="detail-card">' +
      '  <span class="detail-label">' + escapeHtml(label) + '</span>' +
      '  <div class="detail-value">' + escapeHtml(value || "-") + '</div>' +
      '</div>';
  }

  function renderGpuCards(gpus) {
    if (!Array.isArray(gpus) || gpus.length === 0) {
      return '<div class="detail-card"><span class="detail-label">GPU</span><div class="detail-value">未检测到 NVIDIA GPU</div></div>';
    }

    return gpus.map(function (gpu, index) {
      var name = gpu.name || ("GPU " + index);
      var memPercent = null;
      if (typeof gpu.memory_used_bytes === "number" && typeof gpu.memory_total_bytes === "number" && gpu.memory_total_bytes > 0) {
        memPercent = (gpu.memory_used_bytes / gpu.memory_total_bytes) * 100;
      }

      return '' +
        '<div class="gpu-card">' +
        '  <div class="gpu-title">' +
        '    <strong>' + escapeHtml(name) + '</strong>' +
        '    <span class="text-body-secondary small">' + escapeHtml(formatBytes(gpu.memory_used_bytes)) + ' / ' + escapeHtml(formatBytes(gpu.memory_total_bytes)) + '</span>' +
        '  </div>' +
        renderMetricBar(gpu.utilization_percent, 'GPU 利用率') +
        '<div class="mt-3">' + renderMetricBar(memPercent, '显存占用') + '</div>' +
        '  <div class="gpu-meta">' +
        '    <div><span class="gpu-meta-label">温度</span><strong>' + escapeHtml((typeof gpu.temperature_c === "number" ? gpu.temperature_c.toFixed(1) + " °C" : "-")) + '</strong></div>' +
        '    <div><span class="gpu-meta-label">功耗</span><strong>' + escapeHtml((typeof gpu.power_watts === "number" ? gpu.power_watts.toFixed(1) + " W" : "-")) + '</strong></div>' +
        '  </div>' +
        '</div>';
    }).join("");
  }

  function renderServerDetailContent(server, options) {
    var publicView = Boolean((options || {}).publicView);
    var metrics = server.metrics || {};
    var cpu = metrics.cpu || {};
    var memory = metrics.memory || {};
    var tags = Array.isArray(server.tags) && server.tags.length ? server.tags.join(", ") : "-";
    var detailParts = [
      detailCard("主机名", metrics.hostname || "-"),
      detailCard("Kernel", metrics.kernel || "-"),
      detailCard("Load", [cpu.load1, cpu.load5, cpu.load15].filter(function (value) { return typeof value === "number"; }).map(function (value) { return value.toFixed(2); }).join(" / ") || "-"),
      detailCard("内存详情", formatBytes(memory.used_bytes) + " / " + formatBytes(memory.total_bytes)),
      detailCard("标签", tags),
      detailCard("上报年龄", formatRelativeSeconds(server.report_age_seconds)),
    ];

    if (!publicView) {
      detailParts.push(detailCard("节点地址", server.display_host || server.host || "-"));
      detailParts.push(detailCard("上报来源", server.source_addr || "-"));
    }

    return '' +
      '<div class="detail-grid">' + detailParts.join("") + '</div>' +
      '<div class="gpu-grid">' + renderGpuCards(metrics.gpus || []) + '</div>';
  }

  function buildServerCards(servers, options) {
    var publicView = Boolean((options || {}).publicView);
    var prefix = (options && options.prefix) || "server";

    if (!Array.isArray(servers) || servers.length === 0) {
      return '' +
        '<div class="server-card-empty">' +
        '  <i class="bi bi-hdd-network"></i>' +
        '  <div>暂无服务器数据</div>' +
        '</div>';
    }

    return servers.map(function (server, index) {
      var detailId = prefix + "-card-detail-" + index;
      var metrics = server.metrics || {};
      var cpu = metrics.cpu || {};
      var memory = metrics.memory || {};
      var gpus = Array.isArray(metrics.gpus) ? metrics.gpus : [];
      var gpuUtil = averageGpuUtil(server);
      var gpuMem = averageGpuMemory(server);
      var tags = Array.isArray(server.tags) && server.tags.length
        ? '<div class="server-tags">' + server.tags.map(function (tag) {
            return '<span class="tag-chip">' + escapeHtml(tag) + '</span>';
          }).join("") + '</div>'
        : "";

      var gpuSummary = gpus.length
        ? gpus.length + " 张 GPU" + (gpuMem == null ? "" : " · 显存 " + formatPercent(gpuMem))
        : "未检测到 GPU";

      return '' +
        '<article class="server-monitor-card">' +
        '  <div class="server-monitor-card-header">' +
        '    <div class="server-monitor-card-title">' +
        '      <div class="server-name">' + escapeHtml(server.name || "未命名节点") + '</div>' +
               tags +
        '    </div>' +
        '    ' + statusBadge(server) +
        '  </div>' +
        '  <div class="server-monitor-card-metrics">' +
        '    <div class="server-monitor-metric">' +
        '      <span class="server-monitor-metric-label">CPU</span>' +
               renderMetricBar(cpu.usage_percent, "Load " + ([cpu.load1, cpu.load5, cpu.load15].filter(function (value) { return typeof value === "number"; }).map(function (value) { return value.toFixed(2); }).join(" / ") || "-")) +
        '    </div>' +
        '    <div class="server-monitor-metric">' +
        '      <span class="server-monitor-metric-label">内存</span>' +
               renderMetricBar(memory.usage_percent, formatBytes(memory.used_bytes) + " / " + formatBytes(memory.total_bytes)) +
        '    </div>' +
        '    <div class="server-monitor-metric">' +
        '      <span class="server-monitor-metric-label">GPU</span>' +
               renderMetricBar(gpuUtil, gpuSummary) +
        '    </div>' +
        '  </div>' +
        '  <div class="server-monitor-card-meta">' +
        '    <div><span>运行时长</span><strong>' + escapeHtml(formatDuration(metrics.uptime_seconds)) + '</strong></div>' +
        '    <div><span>最后更新</span><strong>' + escapeHtml(formatDateTime(server.last_report_at)) + '</strong></div>' +
             (publicView
               ? '<div><span>上报年龄</span><strong>' + escapeHtml(formatRelativeSeconds(server.report_age_seconds)) + '</strong></div>'
               : '<div><span>节点地址</span><strong>' + escapeHtml(server.display_host || server.host || "-") + '</strong></div>') +
        '  </div>' +
        '  <button type="button" class="btn btn-outline-secondary btn-sm server-card-toggle" data-detail-target="' + detailId + '" data-detail-title="' + escapeHtml(server.name || "未命名节点") + '" aria-expanded="false">' +
        '    <i class="bi bi-arrows-fullscreen"></i><span class="toggle-label ms-2">查看详情</span>' +
        '  </button>' +
        '  <div id="' + detailId + '" class="server-card-detail d-none">' + renderServerDetailContent(server, { publicView: publicView }) + '</div>' +
        '</article>';
    }).join("");
  }

  var detailModalState = {
    element: null,
    title: null,
    body: null,
    instance: null,
  };

  function ensureDetailModal() {
    if (detailModalState.element && document.body.contains(detailModalState.element)) {
      if (!detailModalState.instance && window.bootstrap && window.bootstrap.Modal) {
        detailModalState.instance = window.bootstrap.Modal.getOrCreateInstance(detailModalState.element);
      }
      return detailModalState;
    }

    var modal = document.createElement("div");
    modal.className = "modal fade server-detail-modal";
    modal.id = "serverDetailModal";
    modal.tabIndex = -1;
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML = '' +
      '<div class="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">' +
      '  <div class="modal-content">' +
      '    <div class="modal-header">' +
      '      <div>' +
      '        <div class="modal-title h5 mb-1">节点详情</div>' +
      '        <div class="text-body-secondary small">完整资源与 GPU 信息</div>' +
      '      </div>' +
      '      <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>' +
      '    </div>' +
      '    <div class="modal-body"></div>' +
      '  </div>' +
      '</div>';

    document.body.appendChild(modal);
    detailModalState.element = modal;
    detailModalState.title = modal.querySelector(".modal-title");
    detailModalState.body = modal.querySelector(".modal-body");
    detailModalState.instance = window.bootstrap && window.bootstrap.Modal
      ? window.bootstrap.Modal.getOrCreateInstance(modal)
      : null;

    modal.addEventListener("hidden.bs.modal", function () {
      if (detailModalState.body) {
        detailModalState.body.innerHTML = "";
      }
    });

    return detailModalState;
  }

  function showServerDetailModal(title, content) {
    var modal = ensureDetailModal();
    if (!modal.element || !modal.body) {
      return;
    }
    modal.title.textContent = title || "节点详情";
    modal.body.innerHTML = content || "";
    if (modal.instance) {
      modal.instance.show();
    }
  }

  function buildServerRows(servers, options) {
    var publicView = Boolean((options || {}).publicView);
    var prefix = (options && options.prefix) || "server";

    if (!Array.isArray(servers) || servers.length === 0) {
      return '<tr><td colspan="7" class="text-center py-5 text-body-secondary">暂无服务器数据</td></tr>';
    }

    return servers.map(function (server, index) {
      var detailId = prefix + "-detail-" + index;
      var metrics = server.metrics || {};
      var cpu = metrics.cpu || {};
      var memory = metrics.memory || {};
      var gpuUtil = averageGpuUtil(server);
      var gpuMem = averageGpuMemory(server);
      var gpuCaption = Array.isArray(metrics.gpus) && metrics.gpus.length
        ? metrics.gpus.length + " 张卡，显存 " + (gpuMem == null ? "-" : formatPercent(gpuMem))
        : "未检测到 GPU";
      var tags = Array.isArray(server.tags) && server.tags.length
        ? '<div class="server-tags">' + server.tags.map(function (tag) {
            return '<span class="tag-chip">' + escapeHtml(tag) + '</span>';
          }).join("") + '</div>'
        : "";

      return '' +
        '<tr class="server-row-clickable" data-detail-target="' + detailId + '">' +
        '  <td><div class="server-name">' + escapeHtml(server.name || "未命名节点") + '</div>' + tags + '</td>' +
        '  <td>' + statusBadge(server) + '</td>' +
        '  <td>' + renderMetricBar(cpu.usage_percent, "Load " + ([cpu.load1, cpu.load5, cpu.load15].filter(function (value) { return typeof value === "number"; }).map(function (value) { return value.toFixed(2); }).join(" / ") || "-")) + '</td>' +
        '  <td>' + renderMetricBar(memory.usage_percent, formatBytes(memory.used_bytes) + " / " + formatBytes(memory.total_bytes)) + '</td>' +
        '  <td>' + renderMetricBar(gpuUtil, gpuCaption) + '</td>' +
        '  <td class="text-nowrap">' + escapeHtml(formatDuration(metrics.uptime_seconds)) + '</td>' +
        '  <td class="text-nowrap">' + escapeHtml(formatDateTime(server.last_report_at)) + '</td>' +
        '</tr>' +
        '<tr id="' + detailId + '" class="server-detail-row d-none"><td colspan="7">' + renderServerDetailContent(server, { publicView: publicView }) + '</td></tr>';
    }).join("");
  }

  function bindExpandableRows(rootElement) {
    var root = rootElement || document;
    root.querySelectorAll("[data-detail-target]").forEach(function (trigger) {
      if (trigger.dataset.bound === "true") {
        return;
      }
      trigger.dataset.bound = "true";
      trigger.addEventListener("click", function () {
        var detailId = trigger.getAttribute("data-detail-target");
        if (!detailId) {
          return;
        }
        var detailNode = document.getElementById(detailId);
        if (trigger.classList.contains("server-card-toggle")) {
          if (detailNode) {
            showServerDetailModal(trigger.getAttribute("data-detail-title"), detailNode.innerHTML);
          }
          return;
        }
        if (detailNode) {
          detailNode.classList.toggle("d-none");
          var expanded = !detailNode.classList.contains("d-none");
          trigger.setAttribute("aria-expanded", expanded ? "true" : "false");
        }
      });
    });
  }

  function renderMobileCards(containerId, servers, options) {
    var container = document.getElementById(containerId);
    if (!container) {
      return;
    }

    if (!Array.isArray(servers) || servers.length === 0) {
      container.innerHTML = '' +
        '<div class="mobile-skeleton-card">' +
        '  <div class="text-center text-body-secondary py-5">暂无服务器数据</div>' +
        '</div>';
      return;
    }

    var publicView = Boolean((options || {}).publicView);
    container.innerHTML = servers.map(function (server) {
      var metrics = server.metrics || {};
      var cpu = metrics.cpu || {};
      var memory = metrics.memory || {};
      var gpus = Array.isArray(metrics.gpus) ? metrics.gpus : [];
      var tags = Array.isArray(server.tags) && server.tags.length
        ? '<div class="server-tags">' + server.tags.map(function (tag) { return '<span class="tag-chip">' + escapeHtml(tag) + '</span>'; }).join("") + '</div>'
        : "";

      return '' +
        '<div class="mobile-server-card">' +
        '  <div class="mobile-card-header">' +
        '    <div>' +
        '      <div class="server-name">' + escapeHtml(server.name || "未命名节点") + '</div>' +
               tags +
        '    </div>' +
        '    ' + statusBadge(server) +
        '  </div>' +
        '  <div class="mobile-card-body">' +
        '    <div class="mobile-card-metrics">' +
               renderMetricBar(cpu.usage_percent, "CPU") +
               renderMetricBar(memory.usage_percent, "内存 " + formatBytes(memory.used_bytes) + " / " + formatBytes(memory.total_bytes)) +
               renderMetricBar(averageGpuUtil(server), gpus.length ? gpus.length + " 张 GPU" : "未检测到 GPU") +
        '    </div>' +
        '    <div class="mobile-card-meta">' +
        '      <div>运行时长 <strong>' + escapeHtml(formatDuration(metrics.uptime_seconds)) + '</strong></div>' +
        '      <div>最后更新 <strong>' + escapeHtml(formatDateTime(server.last_report_at)) + '</strong></div>' +
              (!publicView ? '<div>节点地址 <strong>' + escapeHtml(server.display_host || server.host || "-") + '</strong></div>' : '') +
        '    </div>' +
        '    <div class="mobile-gpu-list">' + renderGpuCards(gpus) + '</div>' +
        '  </div>' +
        '</div>';
    }).join("");
  }

  window.ServerPanelShared = {
    api: api,
    fetchSession: fetchSession,
    initTheme: initTheme,
    applyTheme: applyTheme,
    showToast: showToast,
    setSessionBadge: setSessionBadge,
    escapeHtml: escapeHtml,
    formatBytes: formatBytes,
    formatPercent: formatPercent,
    formatDuration: formatDuration,
    formatDateTime: formatDateTime,
    formatRelativeSeconds: formatRelativeSeconds,
    averageGpuUtil: averageGpuUtil,
    averageGpuMemory: averageGpuMemory,
    buildServerCards: buildServerCards,
    buildServerRows: buildServerRows,
    bindExpandableRows: bindExpandableRows,
    renderMobileCards: renderMobileCards,
  };

  document.addEventListener("DOMContentLoaded", initTheme);
})();
