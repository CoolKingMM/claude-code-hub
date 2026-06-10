# Claude Code Hub - CoolKingMM Fork

本项目是基于原仓库 [ding113/claude-code-hub](https://github.com/ding113/claude-code-hub) 的 fork。除这个上游链接外，本文档只描述本 fork 当前维护的内容、补丁和部署方式。

## 项目定位

这个 fork 保留上游的 Claude/OpenAI 兼容代理、provider 管理、负载均衡、限流、日志和监控等基础能力，同时针对当前使用场景维护额外补丁。

当前重点是：

- 提升 Codex provider 在 Codex CLI/TUI 下的兼容性。
- 修复 provider fallback 后 request filter 没有重新应用的问题。
- 使用自制 GHCR 镜像，避免每次更新后手工重新打补丁。
- 保留 `update.sh` 作为直接容器部署和更新入口。

## 默认镜像

本 fork 默认发布并使用以下镜像：

```bash
ghcr.io/coolkingmm/claude-code-hub:latest
```

`docker-compose.yaml` 支持通过 `CLAUDE_CODE_HUB_IMAGE` 覆盖 app 镜像；`update.sh` 默认会导出并使用上面的 fork 镜像。

## 已包含补丁

### Codex cyber notice 过滤

对 Codex provider 的 SSE 响应进行元数据过滤，移除：

```text
openai_verification_recommendation=trusted_access_for_cyber
```

目标是避免 Codex TUI 弹出 Trusted Access for Cyber 风险提示。

默认开启。需要关闭时可以设置：

```bash
CCH_HIDE_CODEX_CYBER_RISK_NOTICE=0
```

或：

```bash
CCH_HIDE_CODEX_CYBER_RISK_NOTICE=false
```

### fallback provider request filter 修复

当一次请求从某个 provider fallback 到另一个 provider 后，会重新对目标 provider 执行 provider-specific request filter。

这个补丁用于避免以下场景：

- 首选 provider 是 `AnyRouter`。
- fallback provider 是 `rawchat`。
- `rawchat` 需要独立的 request filter，例如改写 `client_metadata.x-codex-installation-id`。
- 如果 fallback 后不重新执行 request filter，请求会带着前一个 provider 的形态继续转发，导致上游拒绝。

### update.sh 持久化更新

`update.sh` 是本 fork 推荐的容器更新入口。它默认使用：

```bash
ghcr.io/coolkingmm/claude-code-hub:latest
```

同时保留运行时热补丁开关，用于在需要回退官方镜像或排查问题时继续提供兜底能力。

关键开关：

```bash
APPLY_HOTFIX_985=1
APPLY_HOTFIX_CODEX_CYBER_NOTICE_FILTER=1
APPLY_HOTFIX_PROVIDER_REQUEST_FILTER_ON_FALLBACK=1
```

## 自动化镜像

本 fork 增加了 fork 同步和镜像构建 workflow：

- 支持手动或定时从上游 `main` 同步。
- 同步后构建并推送 GHCR 镜像。
- 发布 tags：
  - `latest`
  - `main`
  - `main-<sha>`

原有 release workflow 在推送源码补丁后也会生成版本镜像，例如当前镜像版本为 `0.8.6`。

## 使用方式

拉取镜像：

```bash
docker pull ghcr.io/coolkingmm/claude-code-hub:latest
```

使用当前目录的更新脚本：

```bash
./update.sh
```

临时切回官方镜像时，可以覆盖镜像变量：

```bash
CLAUDE_CODE_HUB_IMAGE=ghcr.io/ding113/claude-code-hub:latest ./update.sh
```

## 当前验证状态

已确认 `ghcr.io/coolkingmm/claude-code-hub:latest` 可以匿名拉取，并且镜像编译产物中包含：

- Codex cyber notice 过滤逻辑。
- fallback provider request filter 重新应用逻辑。

镜像 label 显示：

```text
source=https://github.com/CoolKingMM/claude-code-hub
revision=e56e4a2eafb5ffeffe7f92f54e497549b2f90598
version=0.8.6
```
