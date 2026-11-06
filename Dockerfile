# 小玩具中枢 · 云端镜像
# 部署方式：Coolify 里选 "Dockerfile"，对外端口 3737，持久卷挂到 /app/data
# 镜像里已经装好 ffmpeg（声音转成震动要用），也把声音识别的前端库和模型带进来了，
# 所以跑起来之后不需要再连 Google / jsdelivr 下载任何东西。

FROM node:22-bookworm-slim AS deps
# 国内 npm 镜像：官方源在国内有时很慢
ARG NPM_REGISTRY=https://registry.npmmirror.com
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund --registry=$NPM_REGISTRY

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3737 \
    TOY_HUB_DATA=/app/data

# Debian 官方源在国内很慢（实测 130KB/s，腾讯镜像 1MB/s），装 ffmpeg 会卡很久
RUN set -eux; \
    if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
      sed -i 's|deb.debian.org|mirrors.cloud.tencent.com|g' /etc/apt/sources.list.d/debian.sources; \
    fi; \
    apt-get update; \
    apt-get install -y --no-install-recommends ffmpeg ca-certificates curl; \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# 把 MediaPipe 的音频识别库（约 13MB）塞进镜像：手机端就不用去 jsdelivr 现拉。
# 先用国内镜像源，失败再退回 jsdelivr。
RUN set -eux; \
    mkdir -p public/vendor/mediapipe/wasm; \
    for f in audio_bundle.mjs \
             wasm/audio_wasm_internal.js wasm/audio_wasm_internal.wasm \
             wasm/audio_wasm_nosimd_internal.js wasm/audio_wasm_nosimd_internal.wasm; do \
      curl -fsSL --retry 3 --max-time 180 -o "public/vendor/mediapipe/$f" \
        "https://registry.npmmirror.com/@mediapipe/tasks-audio/1.1.1/files/$f" \
      || curl -fsSL --retry 3 --max-time 180 -o "public/vendor/mediapipe/$f" \
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-audio@1.1.1/$f"; \
    done; \
    ls -l public/vendor/mediapipe public/vendor/mediapipe/wasm

# 语音识别库改成用镜像里自带的那份（源码不动，方便以后同步作者更新）
RUN node docker/patch-ears.js public/ears.js \
 && grep -n "const TASKS" public/ears.js

RUN mkdir -p /app/data

EXPOSE 3737
ENTRYPOINT ["sh", "/app/docker/entrypoint.sh"]
