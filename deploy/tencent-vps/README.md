# 腾讯云轻量服务器部署

目标环境：Ubuntu 22.04 LTS、2 核 2 GB。部署层由 Docker Compose、Node 22 和 Caddy 组成。

## 安全边界

- DeepSeek Key 只写入服务器的 `deploy/tencent-vps/.env`，不进入源码、镜像或浏览器。
- 整个站点默认使用 Caddy 密码保护，避免公开接口盗用共用模型额度。
- 应用容器不直接暴露公网端口，只有 Caddy 可以访问它。
- `/healthz` 与 `/api/deepseek` 只返回是否配置密钥，不返回密钥内容。
- 正式使用必须绑定域名并启用 HTTPS；纯 IP 的 HTTP 地址仅用于首次验证。

## 部署步骤

1. 在服务器安装 Docker Engine 与 Compose 插件。
2. 克隆本仓库并进入 `deploy/tencent-vps`。
3. 复制 `server.env.example` 为 `.env`，在服务器终端中填写密钥和 Caddy 生成的密码哈希。哈希值含 `$` 时用单引号包住。
4. 运行 `docker compose up -d --build`。
5. 访问 `/healthz`，确认 `ok` 和 `managedKey` 均为 `true`。

域名解析到服务器公网 IP 后，将 `APP_HOST` 改为域名并重新启动，Caddy 自动申请和续期 HTTPS 证书。
