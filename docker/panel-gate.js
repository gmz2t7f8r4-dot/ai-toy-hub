'use strict';

// 面板的"门"：只有输对口令才看得到遥控面板。
// 中继页（bridge.html）、/api、/mcp 不受影响——它们照旧用玩具钥匙，这样：
//   - 小奥走 MCP 不用改配置
//   - 安卓手机开中继页也不用先过这道门
// 口令由服务器变量 PANEL_PASSWORD 提供；没设就整个门不生效（方便本地调试）。
const crypto = require('crypto');
const express = require('express');

const COOKIE = 'toyhub_gate';
const MAX_AGE_DAYS = 30;
const MAX_TRIES = 8;
const WINDOW_MS = 10 * 60 * 1000;
const MIN_LENGTH = 8;

const sign = (secret, payload) => crypto.createHmac('sha256', secret).update(payload).digest('base64url');

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1));
  }
  return '';
}

const isHttps = (req) => req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';

function panelGate({ password, key } = {}) {
  const enabled = Boolean(password) && String(password).length >= MIN_LENGTH;
  const secret = String(password || crypto.randomBytes(16).toString('hex'));
  const attempts = new Map(); // ip -> { count, firstAt }

  const mint = () => {
    const ts = Date.now().toString(36);
    return `${ts}.${sign(secret, ts)}`;
  };
  const accept = (value) => {
    const [ts, mac] = String(value || '').split('.');
    if (!ts || !mac) return false;
    if (!safeEqual(mac, sign(secret, ts))) return false;
    const at = parseInt(ts, 36);
    return Number.isFinite(at) && Date.now() - at < MAX_AGE_DAYS * 864e5;
  };

  function throttled(ip) {
    const rec = attempts.get(ip);
    if (!rec) return false;
    if (Date.now() - rec.firstAt > WINDOW_MS) { attempts.delete(ip); return false; }
    return rec.count >= MAX_TRIES;
  }
  function countFail(ip) {
    const rec = attempts.get(ip);
    if (!rec || Date.now() - rec.firstAt > WINDOW_MS) attempts.set(ip, { count: 1, firstAt: Date.now() });
    else rec.count += 1;
  }

  const router = express.Router();

  router.post('/api/panel-login', express.json({ limit: '4kb' }), (req, res) => {
    if (!enabled) return res.status(503).json({ error: '还没设置面板口令' });
    const ip = String(req.ip || req.socket?.remoteAddress || 'unknown');
    if (throttled(ip)) return res.status(429).json({ error: 'too many attempts' });

    const given = String(req.body?.password ?? '');
    if (!safeEqual(given, String(password))) {
      countFail(ip);
      return res.status(401).json({ error: 'bad password' });
    }

    attempts.delete(ip);
    res.cookie(COOKIE, mint(), {
      httpOnly: true,
      sameSite: 'lax',
      secure: isHttps(req),
      maxAge: MAX_AGE_DAYS * 864e5,
      path: '/',
    });
    // 面板自己的 API 还要玩具钥匙，进了门就顺手交给它，省得再问一遍
    res.json({ ok: true, key: key || undefined });
  });

  router.post('/api/panel-logout', (_req, res) => {
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  // 面板和中继页都要过这道门；/api 和 /mcp 仍然只认玩具钥匙（小奥和手机中继要用）。
  const guarded = new Set(['/', '/index.html', '/panel.html', '/bridge.html']);

  function middleware(req, res, next) {
    if (!enabled) return next();
    const path = req.path;
    const ok = accept(readCookie(req, COOKIE));
    if (path === '/login.html') {
      if (ok) return res.redirect(302, '/');
      return next();
    }
    if (!guarded.has(path)) return next();
    if (ok) return next();
    const back = encodeURIComponent(req.originalUrl || '/');
    res.redirect(302, `/login.html?next=${back}`);
  }

  return { enabled, router, middleware };
}

module.exports = { panelGate };
