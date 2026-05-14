# Server Panel

跳板机部署的实验室服务器监控与 SSH public key 分发面板。当前版本已经收口成纯 Go 后端，前端页面直接嵌入在 `serverpanel/static/`，不再依赖 Python。

## 能力边界

- 监控 CPU 使用率、load、内存、NVIDIA GPU 利用率、显存、温度和功耗。
- 使用 Komari agent 上报指标，不占用 SSH 登录通道。
- 保持当前前端页面和接口形状不变。
- 支持管理员登录后提交 public key。
- 支持普通用户先用姓名全拼小写 token 登录，再自助查询、提交和删除自己的 key。
- 默认开启 `dry_run`，不会真的修改任何 `authorized_keys`。
- 只接受 OpenSSH public key 单行格式，拒绝 private key 和伪造 key type/body。

## 快速启动

```bash
cp config.example.json config.json
export SERVER_PANEL_ADMIN_PASSWORD='replace-with-a-long-password'
export SERVER_PANEL_SESSION_SECRET='replace-with-random-session-secret'
# Optional legacy shared upload token. Ordinary users can directly use their
# lowercase full-name token on the homepage, so this can stay empty.
export SERVER_PANEL_KEY_UPLOAD_TOKEN=''
export SERVER_PANEL_KOMARI_TOKEN_GPU01='replace-with-gpu01-token'
export SERVER_PANEL_KOMARI_TOKEN_GPU02='replace-with-gpu02-token'
export SERVER_PANEL_KOMARI_TOKEN_GPU03='replace-with-gpu03-token'
go run . panel --config config.json
```

如果你习惯先编译：

```bash
go build -o server-panel .
./server-panel panel --config config.json
```

浏览器访问：

```text
http://127.0.0.1:8787
```

如果三台服务器要直接向跳板机上报，`bind` 不能只监听 `127.0.0.1`，要么监听跳板机内网 IP，要么由 Nginx/Caddy 反代到 Go 服务。

## Docker 部署

如果你准备和 `Nginx Proxy Manager` 一起部署，推荐直接把 `server-panel` 也做成容器，并加入和 `NPM` 相同的 Docker network。这样 `NPM` 可以直接反代到容器名，不用再绕宿主机端口。

仓库里已经补了这些文件：

- 镜像构建文件：`Dockerfile`
- GitHub Actions 工作流：`.github/workflows/build-server-panel.yml`
- 容器配置模板：`config.docker.example.json`
- 环境变量模板：`server-panel.env.example`
- Compose 示例：`docker-compose.server-panel.example.yml`
- 正式部署 compose：`docker-compose.server-panel.yml`

建议这样准备：

```bash
cp .env.example .env
cp server-panel.env.example server-panel.env
cp config.docker.example.json config.docker.json
mkdir -p data ssh
```

然后把你给三台服务器分发 SSH key 用的私钥放到：

```text
./ssh/id_ed25519_panel
```

再根据跳板机实际情况修改 `config.docker.json`：

- `bind` 保持 `0.0.0.0`
- `audit_log` 和 `metrics.store_path` 保持 `/app/data/...`
- `ssh.identity_file` 保持 `/root/.ssh/id_ed25519_panel`
- 如果要给跳板机本机追加 key，`key_management.targets[0].authorized_keys` 必须写容器内挂载路径，例如 `/host-ssh/bastion_authorized_keys`

启动：

```bash
docker compose -f docker-compose.server-panel.example.yml up -d --build
```

如果你准备用 GitHub Actions 构建后直接从 `GHCR` 拉镜像，建议改用根目录下的 `docker-compose.server-panel.yml`。它默认读取：

- `.env`
- `SERVER_PANEL_IMAGE`
- `SERVER_PANEL_BASTION_AUTHORIZED_KEYS`

例如：

```bash
cp .env.example .env
sed -i 's#REPLACE_ME#<your-user-or-org>#' .env
docker compose -f docker-compose.server-panel.yml pull
docker compose -f docker-compose.server-panel.yml up -d
```

### 和 Nginx Proxy Manager 一起用

建议直接分两个子域名：

- `npm.example.com` -> `Nginx Proxy Manager`
- `panel.example.com` -> `server-panel`

先确保 `NPM` 和 `server-panel` 在同一个 Docker network。你现在如果是用 `docker compose` 在 `npm/` 目录起的 `Nginx Proxy Manager`，默认网络大概率叫 `npm_default`。先查：

```bash
docker network ls
```

如果没有这张网络，再手动创建一张你准备共用的网络，例如：

```bash
docker network create npm_default
```

然后让 `NPM` 和 `server-panel` 都挂到这张网络上。之后在 `Nginx Proxy Manager` 里给 `panel.example.com` 新建一条代理：

- Forward Hostname / IP: `server-panel`
- Forward Port: `8787`
- Scheme: `http`
- Websockets Support: `开启`
- Block Common Exploits: `开启`
- SSL: 直接用域名申请证书

如果你的域名托管在 Cloudflare，这套没问题。Cloudflare 负责外层入口和证书，`NPM` 负责反代，`server-panel` 容器只需要在 Docker 网络里提供 `8787` 服务。

三台服务器上的 Komari agent，这时候就直接把 server URL 填成：

```text
https://panel.example.com
```

### 容器部署时的坑

1. `mode=local` 默认只会写容器文件系统，不会碰宿主机。想改跳板机本地 `authorized_keys`，必须像 compose 示例那样把宿主机文件 bind mount 进容器。
2. SSH 分发依赖容器里的 `ssh` 命令，所以运行镜像里已经装了 `openssh-client`，别再手动阉割镜像。
3. 如果你后面把 `key_management.dry_run` 改成 `false`，先确认挂载路径和目标账号都对，不然第一脚就可能把 key 写错地方，挺喜感。

## 使用 Komari Agent

本项目兼容 Komari agent 的这三条链路：

```text
POST /api/clients/report?token=<client-token>
POST /api/clients/uploadBasicInfo?token=<client-token>
GET  /api/clients/report?token=<client-token>  # 最小 WebSocket 兼容
```

`config.json` 的 `servers` 里，每台机器都要配置自己的 `komari_token_env` 或 `komari_token`。推荐统一走环境变量：

```json
{
  "id": "gpu-01",
  "name": "GPU Server 01",
  "mode": "komari",
  "host": "10.10.0.11",
  "port": 22,
  "tags": ["A100", "CUDA"],
  "komari_token_env": "SERVER_PANEL_KOMARI_TOKEN_GPU01",
  "enabled": true
}
```

然后在跳板机上设置：

```bash
export SERVER_PANEL_KOMARI_TOKEN_GPU01='komari-agent-client-token-for-gpu01'
```

Komari agent 的 server URL 填跳板机 panel 地址，例如：

```text
http://10.10.0.1:8787
```

注意，这里只是复用了 Komari agent 的上报协议，不会启动 Komari 原生前端、数据库、终端、任务下发那一大坨功能。你现在要的是轻面板，不是再养一头大象。

## 配置 SSH Key 分发

`key_management.targets` 里至少要有跳板机本地和三台服务器：

```json
{
  "id": "gpu-01",
  "name": "GPU Server 01",
  "mode": "ssh",
  "host": "10.10.0.11",
  "user": "lab",
  "port": 22,
  "authorized_keys": "~/.ssh/authorized_keys"
}
```

确认脚本路径和账号没写歪之后，再把 `dry_run` 改成 `false`：

```json
{
  "key_management": {
    "dry_run": false
  }
}
```

首页现在支持普通用户自助管理自己的 key，规则别写飞了：

1. 普通用户 token 使用“姓名全拼小写”，例如 `hanxiaolin`。
2. public key comment 的 owner 前缀优先推荐直接写 token，例如 `hanxiaolin-2024-key1`。
3. 如果你们历史 key 注释已经是中文姓名，例如 `韩晓林-2024-key1`，就在 `key_management.user_aliases` 里配映射，例如 `"hanxiaolin": ["韩晓林"]`。
4. 首页访客只看服务器状态；用户登录后，页面会自动读取当前用户已经存在的 key，并允许删除旧 key。
5. `SERVER_PANEL_KEY_UPLOAD_TOKEN` 仍保留在配置里兼容旧版本部署，但当前页面主流程已经不依赖它。

如果实验室里还有老旧客户端必须用 RSA，可以把 `allow_ssh_rsa` 改成 `true`。正常情况建议统一 `ssh-ed25519`，别抱着陈年老 key 不撒手。

## 运行方式

- Go 入口：`main.go`
- 后端实现：`serverpanel/`
- 前端静态资源：`serverpanel/static/`
- 配置文件默认查找：`config.json`、`config.example.json`、`../config.json`、`../config.example.json`

## 安全建议

当前这种“用户 key 同时进跳板机和所有服务器”的方案能跑，但权限边界比较糙。问题不在 SSH key 本身，而在于一把 key 进了多台机器，回收和审计成本会直线上去。

更稳妥的做法：

1. Komari client token 和用户上传 token 分开，不要混用。
2. `/api/clients/report` 和 `/api/clients/uploadBasicInfo` 只开放给内网或指定源地址。
3. 当前“姓名全拼小写 token”本质上是弱身份标识，不是强认证。内网实验室先这么跑可以，真要长期上线，建议换成每人独立随机 token、OIDC 或 SSO。
4. 给实验室成员单独系统用户或至少单独 group，别大家共用一个高权限账户。
5. 审计日志必须保留 fingerprint、提交人、分发目标和时间。
6. WireGuard 适合控“谁能进内网”，SSH key 适合控“谁能登录主机”；两者是组合拳，不是谁替代谁。
