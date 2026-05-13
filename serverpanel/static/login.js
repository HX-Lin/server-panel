document.addEventListener("DOMContentLoaded", () => {
  ServerPanelShared.initTheme();
  document.getElementById("loginForm").addEventListener("submit", handleLogin);
  bootstrapLogin();
});

async function bootstrapLogin() {
  const session = await ServerPanelShared.fetchSession();
  if (session.authenticated) {
    window.location.replace("/admin.html");
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const passwordInput = document.getElementById("passwordInput");
  const password = passwordInput.value;

  try {
    await ServerPanelShared.api("/api/login", {
      method: "POST",
      body: { password: password },
    });
    passwordInput.value = "";
    ServerPanelShared.showToast("success", "登录成功", "正在跳转到管理后台。");
    window.setTimeout(() => {
      window.location.replace("/admin.html");
    }, 350);
  } catch (error) {
    ServerPanelShared.showToast("danger", "登录失败", error.message || "管理员口令不正确。");
  }
}
