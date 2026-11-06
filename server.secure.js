'use strict';

// 入口文件：作者原版 server.js 的启动逻辑 + 一层面板口令。
// 为什么要另起一个文件：这是作者的仓库，我们不改他的 server.js，
// 只在自己的入口里把 createToyHub 包起来，以后作者更新时冲突最小。
const fs = require('fs');
const path = require('path');
const express = require('express');

// 音色模型钉死：只要设了 ELEVENLABS_MODEL，就无视 AI 自己在工具参数里填的 model。
// 必须在 require('./src/router') 之前改，因为 src/mcp.js 加载时就把 buildVoiceScore 拿走了。
if (process.env.ELEVENLABS_MODEL) {
  const voice = require('./src/voice');
  const build = voice.buildVoiceScore;
  const pinned = process.env.ELEVENLABS_MODEL;
  voice.buildVoiceScore = (args, config, deps) => build({ ...args, model: pinned }, config, deps);
  console.log(`[voice] model pinned to ${pinned}`);
}

const { createToyHub } = require('./src/router');
const { panelGate } = require('./docker/panel-gate');

const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const token = process.env.TOY_HUB_TOKEN;
if (!token) {
  console.error('TOY_HUB_TOKEN is missing. Copy .env.example to .env and set a long random key.');
  process.exit(1);
}

// Voice is optional: without an ElevenLabs key everything else still works.
const voiceConfig = process.env.ELEVENLABS_API_KEY
  ? async () => ({
    apiKey: process.env.ELEVENLABS_API_KEY,
    voice_id: process.env.ELEVENLABS_VOICE_ID,
    baseURL: process.env.ELEVENLABS_BASE_URL,
    toyModel: process.env.ELEVENLABS_MODEL,
  })
  : undefined;

const app = express();
app.set('trust proxy', true); // Coolify 在 Traefik 后面，要能认出 https

// 记一笔 MCP 请求：只记"带没带钥匙 / 长度 / 对不对 / 客户端是谁"，绝不记钥匙本身。
// 排查 401 时看容器日志就能知道是没带、带错、还是客户端握手方式不对。
const crypto = require('crypto');
const sameKey = (a, b) => {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
app.use((req, res, next) => {
  if (!req.path.startsWith('/mcp')) return next();
  const auth = String(req.headers.authorization || '');
  const bearer = auth.replace(/^bearer\s+/i, '');
  const given = bearer || String(req.query.key || '');
  const ua = String(req.headers['user-agent'] || '').slice(0, 40);
  res.on('finish', () => {
    console.log(`[mcp] ${req.method} auth=${auth ? 'yes' : 'no'} keyLen=${String(given).length} match=${sameKey(given, token)} -> ${res.statusCode} ua="${ua}"`);
  });
  next();
});

const gate = panelGate({ password: process.env.PANEL_PASSWORD, key: token });
app.use(gate.router);
app.use(gate.middleware);
app.use('/', createToyHub({ token, voiceConfig }));

const port = Number(process.env.PORT || 3737);
const host = process.env.HOST || '127.0.0.1';
app.listen(port, host, () => {
  console.log(`AI Toy Hub on http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/`);
  console.log(gate.enabled ? 'Panel gate: on' : 'Panel gate: off (PANEL_PASSWORD not set)');
  if (!voiceConfig) console.log('Voice is off: set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID to enable toy_speak and hold-to-talk.');
});
