#!/bin/sh
set -eu

cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

LOG_KEEP_DAYS="${LOG_KEEP_DAYS:-14}"
IMAGE_KEEP_COUNT="${IMAGE_KEEP_COUNT:-1}"
IMAGE_PRUNE_SCOPE="${IMAGE_PRUNE_SCOPE:-all}" # all|build
IMAGE_PRUNE_NAMESPACED_ONLY="${IMAGE_PRUNE_NAMESPACED_ONLY:-1}" # 1: 仅对带命名空间(含 /)的镜像做 source 清理
APP_SERVICE="${APP_SERVICE:-app}"
CLAUDE_CODE_HUB_IMAGE="${CLAUDE_CODE_HUB_IMAGE:-ghcr.io/coolkingmm/claude-code-hub:latest}"
export CLAUDE_CODE_HUB_IMAGE
APPLY_HOTFIX_985="${APPLY_HOTFIX_985:-1}" # 1: 基于官方镜像应用 issue #985 运行时补丁
APPLY_HOTFIX_CODEX_CYBER_NOTICE_FILTER="${APPLY_HOTFIX_CODEX_CYBER_NOTICE_FILTER:-1}" # 1: 注入 Codex cyber notice 元数据过滤器（默认开启；CCH_HIDE_CODEX_CYBER_RISK_NOTICE=0/false 可关闭）
APPLY_HOTFIX_PROVIDER_REQUEST_FILTER_ON_FALLBACK="${APPLY_HOTFIX_PROVIDER_REQUEST_FILTER_ON_FALLBACK:-1}" # 1: fallback 切换供应商后重新应用 provider-specific request filters
HOTFIX_RESTART_NEEDED=0

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

apply_hotfix_985() {
  [ "$APPLY_HOTFIX_985" = "1" ] || return 0

  CONTAINER_ID="$(docker compose ps -q "$APP_SERVICE" 2>/dev/null || true)"
  if [ -z "${CONTAINER_ID:-}" ]; then
    log "985 热补丁: 未找到 $APP_SERVICE 容器，跳过"
    return 0
  fi

  log "应用 issue #985 运行时补丁（基于当前官方镜像，无需本地编译）"
  docker exec -u root -i "$CONTAINER_ID" node - <<'NODE'
const fs = require("fs");
const path = require("path");

const chunksDir = "/app/.next/server/chunks";
const marker = "CCH_HOTFIX_985";
const doneDetector =
  'CCH_HOTFIX_985=!o&&n&&i>=200&&i<300&&(()=>{try{for(let e of(0,R.parseSSEData)(r)){if("string"==typeof e.data&&"[DONE]"===e.data.trim())return!0;if(e.data&&"object"==typeof e.data&&!Array.isArray(e.data)){let t=e.data,r=t.response&&"object"==typeof t.response?t.response:t;if(("response.completed"===e.event||"response.completed"===t.type)&&("completed"===r.status||void 0===r.status)&&null==r.error)return!0}}}catch(e){}return!1})();CCH_HOTFIX_985&&(o=!0,n=!1);';
const targets = [
  {
    target:
      "let a,l,u,c=(0,P.consumeDeferredStreamingFinalization)(t),p=t.provider,g=async()=>{t.sessionId&&await h.SessionManager.clearSessionProvider(t.sessionId)},m=c?.providerId??p?.id??null,f=o&&200===i?(0,k.detectUpstreamErrorFromSseOrJsonText)(r):{isError:!1},y=!1;if(f.isError){",
    replacement:
      "let a,l,u,c=(0,P.consumeDeferredStreamingFinalization)(t),p=t.provider,g=async()=>{t.sessionId&&await h.SessionManager.clearSessionProvider(t.sessionId)},m=c?.providerId??p?.id??null," +
      doneDetector +
      "let f=o&&200===i?(0,k.detectUpstreamErrorFromSseOrJsonText)(r):{isError:!1},y=!1;if(f.isError){",
  },
  {
    target:
      "let a,l,u,c=(0,P.consumeDeferredStreamingFinalization)(t),p=t.provider,g=async()=>{t.sessionId&&await h.SessionManager.clearSessionProvider(t.sessionId)},m=c?.providerId??p?.id??null,f=c?.isHedgeWinner===!0,y=c?.billHedgeLosers===!0,_=o&&200===i?(0,k.detectUpstreamErrorFromSseOrJsonText)(r):{isError:!1},v=!1;if(_.isError){",
    replacement:
      "let a,l,u,c=(0,P.consumeDeferredStreamingFinalization)(t),p=t.provider,g=async()=>{t.sessionId&&await h.SessionManager.clearSessionProvider(t.sessionId)},m=c?.providerId??p?.id??null,f=c?.isHedgeWinner===!0,y=c?.billHedgeLosers===!0," +
      doneDetector +
      "let _=o&&200===i?(0,k.detectUpstreamErrorFromSseOrJsonText)(r):{isError:!1},v=!1;if(_.isError){",
  },
];

let patched = 0;
let alreadyPatched = 0;

for (const name of fs.readdirSync(chunksDir)) {
  if (!name.endsWith(".js")) continue;
  const file = path.join(chunksDir, name);
  let text = fs.readFileSync(file, "utf8");

  if (text.includes(marker)) {
    alreadyPatched += 1;
    continue;
  }

  const patch = targets.find(({ target }) => text.includes(target));
  if (!patch) continue;

  text = text.replace(patch.target, patch.replacement);
  fs.writeFileSync(file, text);
  console.log(`patched ${file}`);
  patched += 1;
}

if (patched === 0 && alreadyPatched === 0) {
  throw new Error("issue #985 hotfix target not found in server chunks");
}

if (patched === 0) {
  console.log("issue #985 hotfix already applied");
}
NODE

  HOTFIX_RESTART_NEEDED=1
}

apply_hotfix_codex_cyber_notice_filter() {
  [ "$APPLY_HOTFIX_CODEX_CYBER_NOTICE_FILTER" = "1" ] || return 0

  CONTAINER_ID="$(docker compose ps -q "$APP_SERVICE" 2>/dev/null || true)"
  if [ -z "${CONTAINER_ID:-}" ]; then
    log "Codex cyber notice 过滤补丁: 未找到 $APP_SERVICE 容器，跳过"
    return 0
  fi

  log "注入 Codex cyber notice 元数据过滤器（默认开启；CCH_HIDE_CODEX_CYBER_RISK_NOTICE=0/false 可关闭）"
  docker exec -u root -i "$CONTAINER_ID" node - <<'NODE'
const fs = require("fs");
const path = require("path");

const chunksDir = "/app/.next/server/chunks";
const marker = "CCH_HOTFIX_CODEX_CYBER_METADATA_FILTER_V2";
const target =
  "return new Response(u,{status:t.status,statusText:t.statusText,headers:S})}}function W(e){";
const metadataFilterFunction = String.raw`
function CCH_HOTFIX_CODEX_CYBER_METADATA_FILTER_V2(){
  const decoder=new TextDecoder();
  const encoder=new TextEncoder();
  let buffer="";
  function boundary(text){
    const lf=text.indexOf("\n\n");
    const crlf=text.indexOf("\r\n\r\n");
    if(lf<0&&crlf<0)return null;
    if(lf<0)return {index:crlf,length:4};
    if(crlf<0)return {index:lf,length:2};
    return crlf<lf?{index:crlf,length:4}:{index:lf,length:2};
  }
  function isObj(value){return !!value&&typeof value==="object"&&!Array.isArray(value)}
  function cleanMetadata(container){
    if(!isObj(container.metadata))return false;
    const key="openai_verification_recommendation";
    const value=container.metadata[key];
    if(Array.isArray(value)){
      const filtered=value.filter((item)=>item!=="trusted_access_for_cyber");
      if(filtered.length===value.length)return false;
      if(filtered.length>0)container.metadata[key]=filtered;
      else delete container.metadata[key];
      return true;
    }
    if(value==="trusted_access_for_cyber"){
      delete container.metadata[key];
      return true;
    }
    return false;
  }
  function parseEvent(text){
    let eventName=null;
    const dataLines=[];
    for(const raw of text.split(/\r?\n/)){
      const line=raw.trimEnd();
      if(line.startsWith("event:")){
        eventName=line.slice(6).trim();
        continue;
      }
      if(line.startsWith("data:")){
        let value=line.slice(5);
        if(value.startsWith(" "))value=value.slice(1);
        dataLines.push(value);
      }
    }
    return {eventName,dataText:dataLines.length>0?dataLines.join("\n"):null};
  }
  function encode(eventName,data){
    const lines=[];
    if(eventName)lines.push("event: "+eventName);
    lines.push("data: "+JSON.stringify(data),"","");
    return lines.join("\n");
  }
  function filterEvent(text){
    const parsed=parseEvent(text);
    if(!parsed.dataText||parsed.dataText==="[DONE]")return text;
    let data;
    try{data=JSON.parse(parsed.dataText)}catch{return text}
    if(!isObj(data))return text;
    let changed=cleanMetadata(data);
    if(isObj(data.response))changed=cleanMetadata(data.response)||changed;
    return changed?encode(parsed.eventName,data):text;
  }
  return new TransformStream({
    transform(chunk,controller){
      buffer+=decoder.decode(chunk,{stream:true});
      let item=boundary(buffer);
      while(item){
        const end=item.index+item.length;
        const eventText=buffer.slice(0,end);
        buffer=buffer.slice(end);
        const filtered=filterEvent(eventText);
        if(filtered)controller.enqueue(encoder.encode(filtered));
        item=boundary(buffer);
      }
    },
    flush(controller){
      const filtered=filterEvent(buffer+decoder.decode());
      if(filtered)controller.enqueue(encoder.encode(filtered));
    }
  });
}
`;
const replacement =
  'return new Response(("0"!==process.env.CCH_HIDE_CODEX_CYBER_RISK_NOTICE&&"false"!==process.env.CCH_HIDE_CODEX_CYBER_RISK_NOTICE)&&"codex"===e.provider?.providerType?u.pipeThrough(CCH_HOTFIX_CODEX_CYBER_METADATA_FILTER_V2()):u,{status:t.status,statusText:t.statusText,headers:S})}}' +
  metadataFilterFunction +
  "function W(e){";

let patched = 0;
let alreadyPatched = 0;

for (const name of fs.readdirSync(chunksDir)) {
  if (!name.endsWith(".js")) continue;
  const file = path.join(chunksDir, name);
  let text = fs.readFileSync(file, "utf8");

  if (text.includes(marker)) {
    alreadyPatched += 1;
    continue;
  }

  if (!text.includes(target)) continue;

  text = text.replace(target, replacement);
  fs.writeFileSync(file, text);
  console.log(`patched ${file}`);
  patched += 1;
}

if (patched === 0 && alreadyPatched === 0) {
  console.log("Codex cyber notice filter hotfix target not found, skipped");
}

if (patched === 0 && alreadyPatched > 0) {
  console.log("Codex cyber notice filter hotfix already applied");
}
NODE

  HOTFIX_RESTART_NEEDED=1
}

apply_hotfix_provider_request_filter_on_fallback() {
  [ "$APPLY_HOTFIX_PROVIDER_REQUEST_FILTER_ON_FALLBACK" = "1" ] || return 0

  CONTAINER_ID="$(docker compose ps -q "$APP_SERVICE" 2>/dev/null || true)"
  if [ -z "${CONTAINER_ID:-}" ]; then
    log "fallback provider request filter 热补丁: 未找到 $APP_SERVICE 容器，跳过"
    return 0
  fi

  log "注入 fallback 后重新应用 provider-specific request filters 的运行时补丁"
  docker exec -u root -i "$CONTAINER_ID" node - <<'NODE'
const fs = require("fs");
const path = require("path");

const chunksDir = "/app/.next/server/chunks";
const marker = "CCH_HOTFIX_PROVIDER_FILTER_ON_FALLBACK_V1";

function listChunkFiles() {
  return fs
    .readdirSync(chunksDir)
    .filter((name) => name.endsWith(".js"))
    .map((name) => path.join(chunksDir, name));
}

function findModuleId(files, predicate) {
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    const starts = [...text.matchAll(/},(\d+),e=>\{"use strict";/g)];
    for (let i = 0; i < starts.length; i += 1) {
      const start = starts[i].index ?? 0;
      const end = starts[i + 1]?.index ?? text.length;
      const body = text.slice(start, end);
      if (predicate(body)) return starts[i][1];
    }
  }
  return null;
}

const files = listChunkFiles();
const providerRequestFilterModuleId = findModuleId(
  files,
  (body) => body.includes("ProxyProviderRequestFilter") && body.includes("applyForProvider")
);

if (!providerRequestFilterModuleId) {
  throw new Error("ProxyProviderRequestFilter module not found in server chunks");
}

let patched = 0;
let alreadyPatched = 0;

for (const file of files) {
  let text = fs.readFileSync(file, "utf8");

  if (!text.includes("ProxyForwarder: Switched to alternative provider")) continue;

  if (text.includes(marker)) {
    alreadyPatched += 1;
    continue;
  }

  const switchLogIndex = text.indexOf("ProxyForwarder: Switched to alternative provider");
  const moduleStart = text.lastIndexOf("=>e.a(async", switchLogIndex);
  const importStart =
    moduleStart >= 0 ? text.indexOf("try{var ", moduleStart) : text.lastIndexOf("try{var ", switchLogIndex);

  if (importStart < 0 || importStart > switchLogIndex) {
    throw new Error(`forwarder module import block not found in ${file}`);
  }

  const importInsertionPoint = importStart + "try{var ".length;
  text =
    text.slice(0, importInsertionPoint) +
    `${marker}=e.i(${providerRequestFilterModuleId}),` +
    text.slice(importInsertionPoint);

  const switchPattern =
    /([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*)\.setProvider\(\1\),([A-Za-z_$][\w$]*)\.logger\.info\("ProxyForwarder: Switched to alternative provider"/;
  const match = text.match(switchPattern);
  if (!match) {
    throw new Error(`provider switch target not found in ${file}`);
  }

  text = text.replace(
    switchPattern,
    `${match[1]}=${match[2]},${match[3]}.setProvider(${match[1]}),await ${marker}.ProxyProviderRequestFilter.ensure(${match[3]}),${match[4]}.logger.info("ProxyForwarder: Switched to alternative provider"`
  );

  fs.writeFileSync(file, text);
  console.log(`patched ${file}`);
  patched += 1;
}

if (patched === 0 && alreadyPatched === 0) {
  throw new Error("fallback provider request filter hotfix target not found in server chunks");
}

if (patched === 0) {
  console.log("fallback provider request filter hotfix already applied");
}
NODE

  HOTFIX_RESTART_NEEDED=1
}

restart_if_hotfix_applied() {
  if [ "$HOTFIX_RESTART_NEEDED" = "1" ]; then
    log "重启 $APP_SERVICE 以加载运行时补丁"
    docker compose restart "$APP_SERVICE"
  fi
}

# 仅清理日志（用于 cron），不重启服务
if [ "${1:-}" = "logs" ]; then
  clean_logs
  exit 0
fi

WAS_RUNNING=0
RUNNING_IDS="$(docker compose ps -q --status running 2>/dev/null || docker compose ps -q 2>/dev/null || true)"
if [ -n "${RUNNING_IDS:-}" ]; then
  WAS_RUNNING=1
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
  if [ "$WAS_RUNNING" = "1" ]; then
    apply_hotfix_985
    apply_hotfix_codex_cyber_notice_filter
    apply_hotfix_provider_request_filter_on_fallback
    restart_if_hotfix_applied
  fi
  exit 1
fi
docker compose down --remove-orphans

docker compose up -d
apply_hotfix_985
apply_hotfix_codex_cyber_notice_filter
apply_hotfix_provider_request_filter_on_fallback
restart_if_hotfix_applied

# 默认不做全局 Docker 清理：`docker system prune` 会影响同一台机器上的其他项目（尤其是停着的项目）。
# 如确实需要手动全局清理，请显式设置：DOCKER_SYSTEM_PRUNE=1
if [ "${DOCKER_SYSTEM_PRUNE:-0}" = "1" ]; then
  docker system prune -a -f --volumes
fi

clean_project_images
clean_logs
