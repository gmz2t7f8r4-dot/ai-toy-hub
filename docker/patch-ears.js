// 打包时把「语音识别库」的地址改成镜像里自带的那一份（/vendor/mediapipe）。
//
// 为什么不直接改 public/ears.js：这个仓库是作者仓库的 fork，源码保持和作者一模一样，
// 以后作者更新时点一下 Sync fork 就能合进来，不会因为这一行冲突。改动只在构建镜像时发生。
//
// 用法：node docker/patch-ears.js [文件路径]
const fs = require('fs');

const file = process.argv[2] || 'public/ears.js';
const src = fs.readFileSync(file, 'utf8');
const replacement = "const TASKS = HUB + '/vendor/mediapipe';";
const out = src.replace(/^const TASKS = .*$/m, replacement);

if (out === src) {
  console.error('[patch-ears] 没找到 const TASKS 那一行 —— 作者可能改过 ears.js，需要在 Dockerfile 里调整');
  process.exit(1);
}

fs.writeFileSync(file, out);
console.log('[patch-ears] 语音识别库地址已指向 /vendor/mediapipe');
