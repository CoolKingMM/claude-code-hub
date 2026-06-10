#!/bin/sh
set -eu

cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

LOG_KEEP_DAYS="${LOG_KEEP_DAYS:-14}"
IMAGE_KEEP_COUNT="${IMAGE_KEEP_COUNT:-1}"
IMAGE_PRUNE_SCOPE="${IMAGE_PRUNE_SCOPE:-all}" # all|build
IMAGE_PRUNE_NAMESPACED_ONLY="${IMAGE_PRUNE_NAMESPACED_ONLY:-1}" # 1: 仅对带命名空间(含 /)的镜像做 source 清理
CLAUDE_CODE_HUB_IMAGE="${CLAUDE_CODE_HUB_IMAGE:-ghcr.io/coolkingmm/claude-code-hub:latest}"
export CLAUDE_CODE_HUB_IMAGE

clean_logs() {
  [ -d "./logs" ] || return 0
  find "./logs" -type f \( -name '*.log' -o -name '*.log.gz' \) -mtime +"$LOG_KEEP_DAYS" -delete 2>/dev/null || true
}

log() {
  printf '%s\n' "$*"
}

list_service_images() {
  docker compose config 2>/dev/null | awk '
    function flush() {
      if (img != "") {
        if (has_build) print "1\t" img;
        else print "0\t" img;
      }
    }
    $0 == "services:" { in_services=1; next }
    in_services && /^[^ ]/ { flush(); exit }  # 离开 services 区块
    in_services && /^  [^ ].*:[[:space:]]*$/ { flush(); has_build=0; img=""; next }
    in_services && /^    build:/ { has_build=1; next }
    in_services && /^    image:/ {
      img=$0
      sub(/^    image:[[:space:]]*/, "", img)
      gsub(/^["'\''"]|["'\''"]$/, "", img)
      next
    }
    END { flush() }
  ' \
    | awk -v scope="$IMAGE_PRUNE_SCOPE" '
      (scope=="all") { print $2; next }
      (scope=="build" && $1=="1") { print $2; next }
    ' \
    | sort -u
}

image_id() {
  docker image inspect "$1" --format '{{.Id}}' 2>/dev/null || true
}

image_source_label() {
  docker image inspect "$1" --format '{{ index .Config.Labels "org.opencontainers.image.source" }}' 2>/dev/null || true
}

image_repo() {
  IMG="$1"
  IMG="${IMG%%@*}"
  LAST="${IMG##*/}"
  case "$LAST" in
    *:*) printf '%s' "${IMG%:*}" ;;
    *) printf '%s' "$IMG" ;;
  esac
}

clean_project_images() {
  # 通用镜像清理（尽量只影响本项目）：
  # - 范围：本 compose 项目的服务镜像（`docker compose config` 中的 `image:`）
  # - 目标：每个 `org.opencontainers.image.source` 只保留最新 N 个（默认 1 个），并尝试删除本次 pull 前的旧镜像 ID
  #
  # 注意：如果某个旧镜像仍被“其他项目的容器（即使是 stopped）”引用，Docker 会拒绝删除，这是正常现象。

  [ "$IMAGE_KEEP_COUNT" -ge 1 ] 2>/dev/null || IMAGE_KEEP_COUNT=1

  SERVICE_IMAGES="${SERVICE_IMAGES:-$(list_service_images || true)}"
  [ -n "${SERVICE_IMAGES:-}" ] || return 0

  CLEANED=0

  prune_by_source() {
    SOURCE="$1"
    [ -n "${SOURCE:-}" ] || return 0

    KEEP_IDS="$(
      docker image ls --filter "label=org.opencontainers.image.source=$SOURCE" --format '{{.CreatedAt}} {{.ID}}' 2>/dev/null \
        | sort -r \
        | head -n "$IMAGE_KEEP_COUNT" \
        | awk '{print $NF}' \
        | tr '\n' ' '
    )"
    [ -n "${KEEP_IDS:-}" ] || return 0

    ALL_IDS="$(docker image ls --filter "label=org.opencontainers.image.source=$SOURCE" --format '{{.ID}}' 2>/dev/null | sort -u)"
    [ -n "${ALL_IDS:-}" ] || return 0

    while IFS= read -r ID; do
      [ -n "${ID:-}" ] || continue
      case " $KEEP_IDS " in
        *" $ID "*) continue ;;
      esac
      if docker rmi "$ID" >/dev/null 2>&1; then
        CLEANED=1
        log "清理旧镜像: $ID (source=$SOURCE)"
      fi
    done <<EOF
$ALL_IDS
EOF
  }

  # 收集当前“应保留”的镜像 ID + source label（pull 之后）
  KEEP_IDS=""
  SRC_SET=""
  while IFS= read -r IMG; do
    [ -n "${IMG:-}" ] || continue
    ID="$(image_id "$IMG")"
    [ -n "${ID:-}" ] && KEEP_IDS="${KEEP_IDS}\n${ID}"
    SRC="$(image_source_label "$IMG")"
    if [ -n "${SRC:-}" ]; then
      REPO="$(image_repo "$IMG")"
      if [ "$IMAGE_PRUNE_NAMESPACED_ONLY" = "1" ]; then
        case "$REPO" in
          */*) SRC_SET="${SRC_SET}\n${SRC}" ;;
        esac
      else
        SRC_SET="${SRC_SET}\n${SRC}"
      fi
    fi
  done <<EOF
$SERVICE_IMAGES
EOF
  KEEP_IDS="$(printf '%s\n' "$KEEP_IDS" | sed '/^$/d' | sort -u)"
  SRC_SET="$(printf '%s\n' "$SRC_SET" | sed '/^$/d' | sort -u)"

  # 1) 按 source label 清理（能覆盖 dangling 的历史旧镜像）
  while IFS= read -r SRC; do
    [ -n "${SRC:-}" ] || continue
    prune_by_source "$SRC"
  done <<EOF
$SRC_SET
EOF

  # 2) 定点删除本次 pull 前的旧镜像 ID（无 label 镜像也能清理一次）
  PRE_IDS="${PRE_IMAGE_IDS:-}"
  if [ -n "${PRE_IDS:-}" ]; then
    while IFS= read -r OLD_ID; do
      [ -n "${OLD_ID:-}" ] || continue
      if printf '%s\n' "$KEEP_IDS" | grep -Fqx "$OLD_ID" 2>/dev/null; then
        continue
      fi
      if docker rmi "$OLD_ID" >/dev/null 2>&1; then
        CLEANED=1
        log "清理旧镜像: $OLD_ID"
      fi
    done <<EOF
$PRE_IDS
EOF
  fi

  if [ "$CLEANED" = "0" ]; then
    log "镜像清理: 无可清理"
  fi
}

# 仅清理日志（用于 cron），不重启服务
if [ "${1:-}" = "logs" ]; then
  clean_logs
  exit 0
fi

SERVICE_IMAGES="$(list_service_images || true)"
PRE_IMAGE_IDS=""
if [ -n "${SERVICE_IMAGES:-}" ]; then
  while IFS= read -r IMG; do
    [ -n "${IMG:-}" ] || continue
    ID="$(image_id "$IMG")"
    [ -n "${ID:-}" ] && PRE_IMAGE_IDS="${PRE_IMAGE_IDS}\n${ID}"
  done <<EOF
$SERVICE_IMAGES
EOF
  PRE_IMAGE_IDS="$(printf '%s\n' "$PRE_IMAGE_IDS" | sed '/^$/d' | sort -u)"
fi

if ! docker compose pull; then
  log "镜像拉取失败，跳过容器重建"
  exit 1
fi
docker compose down --remove-orphans

docker compose up -d

# 默认不做全局 Docker 清理：`docker system prune` 会影响同一台机器上的其他项目（尤其是停着的项目）。
# 如确实需要手动全局清理，请显式设置：DOCKER_SYSTEM_PRUNE=1
if [ "${DOCKER_SYSTEM_PRUNE:-0}" = "1" ]; then
  docker system prune -a -f --volumes
fi

clean_project_images
clean_logs
