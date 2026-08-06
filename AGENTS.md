# 项目级 Codex 规则

本文件补充本仓库的 `CLAUDE.md`。代码结构、测试、i18n 和数据库迁移规则仍遵循 `CLAUDE.md`；本文件对本 fork 的构建、发布和部署边界具有更具体的约束。

## 构建与发布边界

- 本项目的 Docker 镜像必须由 GitHub Actions 构建并推送到 GHCR，禁止在本机执行 `bun run build`、`docker build`、`docker compose build` 或等价的本地镜像构建。
- 源码变更的发布目标是 `fork` remote 的 `main` 分支（当前为 `https://github.com/CoolKingMM/claude-code-hub.git`）；`origin` 是上游仓库，只用于获取更新，不作为发布推送目标。
- 推送后等待 `.github/workflows/fork-sync-and-image.yml`（以及必要时的 `release.yml`）成功完成，再把 GHCR 的 `latest`、`main` 和 `main-<short_sha>` 标签视为可部署。
- 部署前必须用镜像 manifest、digest 或 OCI revision label 验证新镜像确实对应本次提交；未完成 Actions 或未确认镜像前，不得重启本地或远端服务。

## 本地与远端部署

- 本地和远端只允许拉取 GHCR 镜像并启动 Compose，不得因为更新任务触发本地编译。
- `update.sh` 会执行 `docker compose pull`、停止并重建 Compose 服务；使用它前应说明短暂中断影响，并在完成后检查 `app`、`postgres`、`redis` 健康状态。
- 当前历史远端目标为 `ssh -p 45705 root@23.254.196.77`，目录 `/root/workspace/claude-code-hub`。该目录可能只有 Compose/部署文件而不是 Git 仓库；不得假设可以在远端执行 `git pull`，应以 GHCR 镜像更新为准，并先做只读核对。
- 不得执行全局 Docker 清理或删除其他项目资源；旧镜像清理必须先确认没有容器依赖。

## 验收顺序

1. 只读检查工作树、远端 refs、Actions 工作流和部署目标。
2. 同步并审查上游变更，保留本 fork 的已验证修复。
3. 推送 `fork/main`，等待并核验 GitHub Actions 和 GHCR 镜像。
4. 先更新并验证本地，再更新并验证远端；报告实际 image digest、revision、version 和健康状态。
