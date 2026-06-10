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

- Prevents the Codex TUI from showing the Trusted Access for Cyber notice.
- Avoids missing target-provider request handling after provider fallback.
- Keeps `update.sh` using this fork's custom image by default after updates.

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

- Codex TUI notice handling patch.
- Provider fallback request handling patch.

Image labels:

```text
source=https://github.com/CoolKingMM/claude-code-hub
revision=e56e4a2eafb5ffeffe7f92f54e497549b2f90598
version=0.8.6
```
