#!/usr/bin/env node

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');

function loadEnvFile(file = '.env') {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...valueParts] = trimmed.split('=');
    if (!process.env[key]) {
      process.env[key] = valueParts.join('=').trim().replace(/^['"]|['"]$/g, '');
    }
  }
}

loadEnvFile();

const TARGET_HOST = process.env.CAR_IP || '192.168.0.5';
const TARGET_PORT = Number(process.env.CAR_PORT || 8000);
const LOCAL_PORT = Number(process.env.VIDEO_PROXY_PORT || 8001);
const BIND_HOST = process.env.VIDEO_BIND_HOST || '0.0.0.0';
const REQUEST_TIMEOUT_MS = Number(process.env.VIDEO_PROXY_TIMEOUT_MS || 30000);
const VIDEO_PROXY_KEY = String(process.env.VIDEO_PROXY_KEY || '').trim();
const AUTH_SECRET = String(process.env.AUTH_SECRET || '').trim();

if (!VIDEO_PROXY_KEY && !AUTH_SECRET) {
  console.error('VIDEO_PROXY_KEY or AUTH_SECRET is required. Refusing to start an unauthenticated video proxy.');
  process.exit(1);
}

function safeStringEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function sign(value) {
  return crypto.createHmac('sha256', AUTH_SECRET).update(value).digest('base64url');
}

function verifyScopedToken(token, expectedType) {
  if (!AUTH_SECRET || !token || !token.includes('.')) return false;
  const [encodedPayload, signature] = token.split('.');
  if (!safeStringEqual(signature, sign(encodedPayload))) return false;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    return payload.type === expectedType && payload.exp && payload.exp >= Date.now();
  } catch {
    return false;
  }
}

function isAuthorized(req, fullUrl) {
  const key = fullUrl.searchParams.get('key') || '';
  const videoProxyToken = fullUrl.searchParams.get('videoProxyToken') || '';
  const authHeader = (req.headers['authorization'] || '').toString();
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (VIDEO_PROXY_KEY && (safeStringEqual(key, VIDEO_PROXY_KEY) || safeStringEqual(bearer, VIDEO_PROXY_KEY))) {
    return true;
  }
  return verifyScopedToken(videoProxyToken || bearer, 'video_proxy');
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
}

function sendError(res, status, message) {
  if (!res.headersSent) {
    setCorsHeaders(res);
    res.writeHead(status, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store'
    });
  }
  res.end(message);
}

const server = http.createServer((req, res) => {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const fullUrl = new URL(req.url, `http://${req.headers.host}`);
  if (req.method !== 'GET' || (fullUrl.pathname !== '/' && fullUrl.pathname !== '/mjpeg')) {
    sendError(res, 404, 'Not Found');
    return;
  }

  if (!isAuthorized(req, fullUrl)) {
    sendError(res, 401, 'Unauthorized');
    return;
  }

  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  const proxyHeaders = {
    Connection: 'keep-alive',
    'Cache-Control': 'no-cache'
  };
  // propagate Authorization header if present
  if (req.headers['authorization']) proxyHeaders['authorization'] = req.headers['authorization'];

  const proxy = http.request({
    hostname: TARGET_HOST,
    port: TARGET_PORT,
    path: fullUrl.pathname === '/mjpeg' ? '/mjpeg' : '/',
    method: 'GET',
    headers: proxyHeaders,
    agent: false
  }, (proxyRes) => {
    res.writeHead(200, {
      'Content-Type': proxyRes.headers['content-type'] || 'multipart/x-mixed-replace',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Access-Control-Allow-Origin': '*',
      Connection: 'keep-alive',
      Pragma: 'no-cache',
      Expires: '0'
    });

    proxyRes.on('data', (chunk) => {
      if (!res.destroyed) res.write(chunk);
    });

    proxyRes.on('end', () => {
      if (!res.destroyed) res.end();
    });
  });

  proxy.on('error', (err) => {
    console.error(`[video-proxy] ${err.message}`);
    if (!res.destroyed) sendError(res, 502, 'Video upstream unavailable');
  });

  proxy.setTimeout(REQUEST_TIMEOUT_MS, () => {
    proxy.destroy(new Error('upstream timeout'));
  });

  req.on('close', () => {
    proxy.destroy();
  });

  proxy.end();
});

server.listen(LOCAL_PORT, BIND_HOST, () => {
  console.log(`Video proxy listening on http://${BIND_HOST}:${LOCAL_PORT}/`);
  console.log(`Video upstream http://${TARGET_HOST}:${TARGET_PORT}/mjpeg`);
});
