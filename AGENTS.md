# 项目级 Codex 规则

本文件补充本仓库的 `CLAUDE.md`。代码结构、测试、i18n 和数据库迁移规则仍遵循 `CLAUDE.md`；本文件对本 fork 的构建、发布和部署边界具有更具体的最高约束。

## 核心红线：严禁本地编译，必须走 GitHub Actions

**本仓库绝对禁止在本地宿主机或远端服务器执行任何形式的编译与镜像构建！**

1. **禁止本地任何形式的编译与打包**：
   - 严禁执行 `bun run build`、`next build`、`tsgo`、`tsc` 或任何前端/后端编译、打包、预编译命令。
   - 严禁为了“本地验证编译”而执行 `bun install`、生成 `bun.lock`、生成 `tsconfig.tsbuildinfo` 或产生 `.next/` 目录。
   - 宿主机仅存放源码与轻量配置文件，任何构建中间件或编译产物绝对不允许留在宿主机上；若误生成必须立即彻底清理。

2. **禁止本地构建 Docker 镜像**：
   - 严禁在本地或远端执行 `docker build`、`docker compose build`、`docker buildx` 或等价的镜像构建命令。

3. **镜像构建与发布唯一合法途径：GitHub Actions**：
   - 本项目所有 Docker 镜像**必须且只能由 GitHub Actions 工作流**（`.github/workflows/fork-sync-and-image.yml`）在云端构建并自动推送到 GHCR。
   - 代码变更、上游同步或配置修改完成后，唯一合法的发布流程是：提交源码并推送到 `fork` 远端（`https://github.com/CoolKingMM/claude-code-hub.git`）的 `main` 分支，等待 Actions 触发构建。
   - 本地与远端环境均为纯运行环境，**只允许拉取 GHCR 镜像**（`docker compose pull`）并启动 Compose 服务。

## 构建与发布边界

- 源码变更的发布目标是 `fork` remote 的 `main` 分支；`origin` 是上游仓库，只用于获取更新，不作为发布推送目标。
- 推送后等待 `.github/workflows/fork-sync-and-image.yml`（以及必要时的 `release.yml`）成功完成，再把 GHCR 的 `latest`、`main` 和 `main-<short_sha>` 标签视为可部署。
- 部署前必须用镜像 manifest、digest 或 OCI revision label 验证新镜像确实对应本次提交；未完成 Actions 或未确认镜像前，不得重启本地或远端服务。

## 本地与远端部署

- 本地和远端只允许拉取 GHCR 镜像并启动 Compose，严禁因更新或部署任务触发本地编译。
- `update.sh` 会执行 `docker compose pull`、停止并重建 Compose 服务；使用它前应说明短暂中断影响，并在完成后检查 `app`、`postgres`、`redis` 健康状态。
- 当前历史远端目标为 `ssh -p 45705 root@23.254.196.77`，目录 `/root/workspace/claude-code-hub`。该目录可能只有 Compose/部署文件而不是 Git 仓库；不得假设可以在远端执行 `git pull`，应以 GHCR 镜像更新为准，并先做只读核对。
- 不得执行全局 Docker 清理或删除其他项目资源；旧镜像清理必须先确认没有容器依赖。

## 验收顺序

1. 只读检查工作树、远端 refs、Actions 工作流和部署目标。
2. 同步并审查上游变更，保留本 fork 的已验证修复。
3. 提交并推送到 `fork/main`（注意：无需触发镜像构建的文档/规则变更可追加 `[skip ci]`，需要构建镜像的代码变更正常推送）。
4. 监控并核验 GitHub Actions 和 GHCR 镜像产出（检查 digest/revision label）。
5. 先更新并验证本地，再更新并验证远端；报告实际 image digest、revision、version 和健康状态。
6. 检查并确保本地工作区无任何本地编译产物残留。
