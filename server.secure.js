'use strict';

// 入口文件：作者原版 server.js 的启动逻辑 + 一层面板口令。
// 为什么要另起一个文件：这是作者的仓库，我们不改他的 server.js，
// 只在自己的入口里把 createToyHub 包起来，以后作者更新时冲突最小。
const fs = require('fs');
const path = require('path');
const express = require('express');
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
