# Claude Code Hub - CoolKingMM Fork

This project is a fork of the upstream repository [ding113/claude-code-hub](https://github.com/ding113/claude-code-hub). Apart from this upstream link, this document only describes the maintained changes, patches, and deployment flow in this fork.

## Purpose

This fork keeps the upstream Claude/OpenAI-compatible proxy, provider management, load balancing, rate limiting, logging, and observability capabilities, while maintaining additional patches for the current deployment.

Current focus:

- Improve Codex provider compatibility with Codex CLI/TUI.
- Fix provider-specific request filters after provider fallback.
- Use a custom GHCR image so updates do not require manual patching.
- Keep `update.sh` as the direct container deployment and update entrypoint.

## Default Image

This fork publishes and uses:

```bash
ghcr.io/coolkingmm/claude-code-hub:latest
```

`docker-compose.yaml` supports overriding the app image with `CLAUDE_CODE_HUB_IMAGE`; `update.sh` exports and uses the fork image by default.

## Included Patches

### Codex cyber notice filtering

For Codex provider SSE responses, this patch removes the metadata value:

```text
openai_verification_recommendation=trusted_access_for_cyber
```

The goal is to prevent the Codex TUI from showing the Trusted Access for Cyber notice.

Enabled by default. To disable it, set:

```bash
CCH_HIDE_CODEX_CYBER_RISK_NOTICE=0
```

or:

```bash
CCH_HIDE_CODEX_CYBER_RISK_NOTICE=false
```

### Fallback provider request filter fix

When a request falls back from one provider to another, the target provider's provider-specific request filter is applied again.

This avoids the following failure mode:

- The preferred provider is `AnyRouter`.
- The fallback provider is `rawchat`.
- `rawchat` requires its own request filter, such as rewriting `client_metadata.x-codex-installation-id`.
- Without reapplying the request filter after fallback, the request keeps the previous provider's shape and may be rejected upstream.

### Persistent update.sh deployment

`update.sh` is the recommended container update entrypoint for this fork. It uses:

```bash
ghcr.io/coolkingmm/claude-code-hub:latest
```

It also keeps runtime hotfix toggles as a fallback when temporarily switching back to the upstream image or debugging deployment issues.

Important toggles:

```bash
APPLY_HOTFIX_985=1
APPLY_HOTFIX_CODEX_CYBER_NOTICE_FILTER=1
APPLY_HOTFIX_PROVIDER_REQUEST_FILTER_ON_FALLBACK=1
```

## Image Automation

This fork adds a fork sync and image build workflow:

- Supports manual or scheduled sync from upstream `main`.
- Builds and pushes the GHCR image after sync.
- Publishes tags:
  - `latest`
  - `main`
  - `main-<sha>`

The existing release workflow also publishes a versioned image after source patch pushes. The current image version is `0.8.6`.

## Usage

Pull the image:

```bash
docker pull ghcr.io/coolkingmm/claude-code-hub:latest
```

Run the update script from this directory:

```bash
./update.sh
```

To temporarily switch back to the upstream image:

```bash
CLAUDE_CODE_HUB_IMAGE=ghcr.io/ding113/claude-code-hub:latest ./update.sh
```

## Current Verification

`ghcr.io/coolkingmm/claude-code-hub:latest` has been verified as anonymously pullable, and the compiled image output contains:

- Codex cyber notice filtering logic.
- Fallback provider request filter reapplication logic.

Image labels:

```text
source=https://github.com/CoolKingMM/claude-code-hub
revision=e56e4a2eafb5ffeffe7f92f54e497549b2f90598
version=0.8.6
```
