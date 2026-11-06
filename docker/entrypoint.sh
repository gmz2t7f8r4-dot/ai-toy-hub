#!/bin/sh
# 启动前把声音识别模型放进数据目录（第一次启动时复制，之后不再覆盖）。
# 模型本来要服务端去 Google 下载，国内服务器连不上，所以随镜像带一份。
set -e

DATA="${TOY_HUB_DATA:-/app/data}"
mkdir -p "$DATA/models"

if [ ! -f "$DATA/models/yamnet.tflite" ]; then
  cp /app/vendor/models/yamnet.tflite "$DATA/models/yamnet.tflite"
  echo "[entrypoint] copied yamnet.tflite into $DATA/models"
fi

exec node server.secure.js
