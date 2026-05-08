# Klifur

一个基于 Next.js 的 2D 物理攀岩小游戏。玩家拖拽手脚抓住岩点，保持支点和体力，完成路线后登顶。

## 本地开发

```bash
npm install
npm run dev
```

默认开发端口是 `3001`，打开 `http://localhost:3001`。

常用检查：

```bash
npm run lint
npm run build
```

## Docker

项目使用 Next.js `standalone` 输出构建生产镜像。

```bash
docker build -t klifur .
docker run --rm -p 3001:3000 -v "$PWD/.data/routes:/data/routes" klifur
```

容器内服务端口是 `3000`。路线 JSON 默认写入 `ROUTES_DIR=/data/routes`，首次启动时会把镜像里的示例路线复制到该目录，避免容器重建后丢失玩家创建的路线。

## CI/CD

仓库包含 `.github/workflows/deploy.yml`：

1. 推送到 `main` 或手动触发 workflow。
2. GitHub Actions 执行 `npm ci` 和 `npm run lint`。
3. Docker build 后推送到 `ghcr.io/<owner>/<repo>:<sha>` 和 `latest`。
4. 通过 SSH 登录云服务器，拉取 GHCR 镜像，用 Docker Compose 启动。

部署目录默认是服务器上的 `/opt/klifur`，路线数据持久化在 `/opt/klifur/routes`。Compose 默认只监听 `127.0.0.1:3001`，建议用 Nginx/Caddy 反向代理到这个端口。

## GitHub Secrets

在仓库 `Settings -> Secrets and variables -> Actions` 添加：

| 名称 | 内容 |
| --- | --- |
| `SERVER_HOST` | 你的服务器 IP，例如 `64.83.38.97` |
| `SERVER_USER` | SSH 登录用户，例如 `root` 或 `deploy` |
| `SERVER_SSH_KEY` | 能登录服务器的 SSH 私钥内容 |
Actions 推送 GHCR 使用内置 `GITHUB_TOKEN`，不需要额外的写入 token。当前 workflow 假设 GHCR package 是 public，所以服务器可以直接 `docker pull`，不需要 GHCR 读取 token。

第一次 workflow 成功推送镜像后，到 GitHub 把 GHCR package 改成 public：

1. 打开 GitHub 个人页或组织页。
2. 进入 `Packages`。
3. 点开 `klifur` 这个 Container package。
4. 右侧进入 `Package settings`。
5. 在底部 `Danger Zone` 里点 `Change visibility`。
6. 选择 `Public` 并确认。

注意：GitHub Packages 改成 public 后不能再改回 private。如果你希望镜像保持 private，需要把 workflow 改回服务器侧 `docker login ghcr.io`，并添加 `GHCR_USERNAME`、`GHCR_READ_TOKEN` 两个 secrets。

## 服务器准备

服务器需要安装 Docker Engine 和 Docker Compose plugin：

```bash
docker --version
docker compose version
```

如果不用 `root` 登录，先创建部署目录并授权给部署用户：

```bash
sudo mkdir -p /opt/klifur/routes
sudo chown -R deploy:deploy /opt/klifur
sudo usermod -aG docker deploy
```

然后重新登录一次，让 `docker` 用户组生效。

生成 SSH key 的一种方式：

```bash
ssh-keygen -t ed25519 -C "github-actions-klifur" -f ~/.ssh/klifur_deploy
ssh-copy-id -i ~/.ssh/klifur_deploy.pub deploy@64.83.38.97
```

把 `~/.ssh/klifur_deploy` 的私钥内容填到 `SERVER_SSH_KEY`。

Nginx 反向代理示例：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

## 不要提交到仓库

`.gitignore` 和 `.dockerignore` 已排除：

- `node_modules/`
- `.next/`
- `.env*`
- 日志、证书、coverage
- 本地截图 `Snipaste_*.png`
- 本地代理/助手目录 `.agents/`、`.codex/`
