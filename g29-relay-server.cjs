const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

function loadEnvFile(file = '.env', override = false) {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...valueParts] = trimmed.split('=');
    if (override || !process.env[key]) {
      process.env[key] = valueParts.join('=').trim().replace(/^['"]|['"]$/g, '');
    }
  }
}

loadEnvFile(path.join(__dirname, '.env'), true);
loadEnvFile();

const WS_PORT = Number(process.env.G29_WS_PORT || 8082);
const HTTP_PORT = Number(process.env.G29_HTTP_PORT || 8083);
const HTTP_HOST = process.env.G29_HTTP_HOST || '0.0.0.0';
const RELAY_TOKEN = String(process.env.G29_RELAY_TOKEN || '').trim();
const ROBOT_RELAY_TOKEN = String(process.env.RELAY_TOKEN || '').trim();
const ROBOT_RELAY_URL =
  process.env.ROBOT_G29_RELAY_URL ||
  `http://127.0.0.1:${Number(process.env.RELAY_HTTP_PORT || 18080)}/api/g29`;
const ROBOT_CONTROL_URL =
  process.env.ROBOT_CONTROL_RELAY_URL ||
  `http://127.0.0.1:${Number(process.env.RELAY_HTTP_PORT || 18080)}/api/control`;
const ROBOT_STOP_URL =
  process.env.ROBOT_STOP_RELAY_URL ||
  `http://127.0.0.1:${Number(process.env.RELAY_HTTP_PORT || 18080)}/api/stop`;
const AUTH_SECRET = String(process.env.AUTH_SECRET || '').trim();
const MAX_BODY_BYTES = 4096;
const FORWARD_TIMEOUT_MS = Number(process.env.G29_FORWARD_TIMEOUT_MS || 700);

if (!RELAY_TOKEN) {
  console.error('G29_RELAY_TOKEN is required. Refusing to start an unauthenticated relay.');
  process.exit(1);
}
if (!AUTH_SECRET) {
  console.error('AUTH_SECRET is required for browser WebSocket relay authorization.');
  process.exit(1);
}
if (!ROBOT_RELAY_TOKEN) {
  console.error('RELAY_TOKEN is required so G29 data can be forwarded to the robot relay.');
  process.exit(1);
}

const wss = new WebSocket.Server({ port: WS_PORT });

let latestData = {
  steering: 0,
  throttle: 0,
  brake: 0
};
let relayState = {
  enabled: false,
  operator: '',
  updatedAt: Date.now(),
  lastForwardAt: 0,
  lastDelivered: false,
  lastForwardError: ''
};

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-G29-Token, X-Relay-Token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  });
  res.end(JSON.stringify(payload));
}

function clampNumber(value, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.min(max, Math.max(min, num));
}

function parseG29Payload(payload) {
  const steering = clampNumber(payload.steering ?? payload.steer, -450, 450);
  const throttle = clampNumber(payload.throttle, 0, 100);
  const brake = clampNumber(payload.brake, 0, 100);

  if (steering === null || throttle === null || brake === null) {
    return null;
  }

  return {
    steering: Math.round(steering * 10) / 10,
    throttle: Math.round(throttle * 10) / 10,
    brake: Math.round(brake * 10) / 10,
    updatedAt: Date.now()
  };
}

function safeStringEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function sign(value) {
  return crypto.createHmac('sha256', AUTH_SECRET).update(value).digest('base64url');
}

function parseSignedToken(token) {
  if (!token || !token.includes('.')) return null;
  const [encodedPayload, signature] = token.split('.');
  if (!safeStringEqual(signature, sign(encodedPayload))) return null;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function verifyScopedToken(token, expectedType) {
  const payload = parseSignedToken(token);
  return Boolean(payload && payload.type === expectedType);
}

function verifyControlToken(token) {
  const payload = parseSignedToken(token);
  if (!payload) return null;
  if ((payload.type === 'relay' || payload.type === 'auth') && payload.role === 'operator') {
    return payload;
  }
  return null;
}

function websocketTokenFromRequest(req) {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const queryToken = url.searchParams.get('relayToken') || '';
  const authHeader = (req.headers['authorization'] || '').toString();
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  return queryToken || bearer;
}

function bearerToken(req) {
  const authHeader = (req.headers['authorization'] || '').toString();
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
}

function requestJson(url, payload) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const target = new URL(url);
    const req = http.request(
      {
        hostname: target.hostname,
        port: target.port || 80,
        path: `${target.pathname}${target.search}`,
        method: 'POST',
        timeout: FORWARD_TIMEOUT_MS,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'X-Relay-Token': ROBOT_RELAY_TOKEN
        }
      },
      (res) => {
        let responseBody = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          responseBody += chunk;
        });
        res.on('end', () => {
          try {
            resolve({
              ok: res.statusCode >= 200 && res.statusCode < 300,
              payload: responseBody ? JSON.parse(responseBody) : {}
            });
          } catch {
            resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, payload: {} });
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('forward_timeout'));
    });
    req.on('error', (error) => {
      resolve({ ok: false, payload: { error: error.message } });
    });
    req.write(body);
    req.end();
  });
}

async function forwardG29ToRobot(data) {
  const result = await requestJson(ROBOT_RELAY_URL, {
    type: 'g29',
    source: 'g29',
    steering: data.steering,
    throttle: data.throttle,
    brake: data.brake
  });

  relayState = {
    ...relayState,
    lastForwardAt: Date.now(),
    lastDelivered: Boolean(result.ok && result.payload?.delivered),
    lastForwardError: result.ok ? '' : String(result.payload?.error || 'forward_failed')
  };
  return relayState.lastDelivered;
}

async function forwardStopToRobot() {
  const result = await requestJson(ROBOT_STOP_URL, {});
  relayState = {
    ...relayState,
    lastForwardAt: Date.now(),
    lastDelivered: Boolean(result.ok && result.payload?.delivered),
    lastForwardError: result.ok ? '' : String(result.payload?.error || 'stop_failed')
  };
  return relayState.lastDelivered;
}

async function forwardVelocityToRobot(value) {
  const result = await requestJson(ROBOT_CONTROL_URL, {
    source: 'web',
    linear: value?.linear || 0,
    angular: value?.angular || 0
  });
  relayState = {
    ...relayState,
    lastForwardAt: Date.now(),
    lastDelivered: Boolean(result.ok && result.payload?.delivered),
    lastForwardError: result.ok ? '' : String(result.payload?.error || 'control_failed')
  };
  return relayState.lastDelivered;
}

function broadcast(data) {
  latestData = data;
  const message = JSON.stringify({
    type: 'g29_data',
    ...data,
    relayEnabled: relayState.enabled,
    robotDelivered: relayState.lastDelivered
  });

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

wss.on('connection', (ws, req) => {
  try {
    const token = websocketTokenFromRequest(req);
    if (!verifyScopedToken(token, 'relay')) {
      console.warn('拒绝未经授权的 WebSocket 连接');
      try { ws.send(JSON.stringify({ error: 'unauthorized' })); } catch {}
      ws.close();
      return;
    }
  } catch (e) {
    // 如果解析失败则拒绝连接
    console.warn('无法解析 WebSocket 请求 URL，拒绝连接');
    try { ws.send(JSON.stringify({ error: 'invalid_request' })); } catch {}
    ws.close();
    return;
  }

  ws.send(JSON.stringify({
    type: 'g29_data',
    ...latestData,
    relayEnabled: relayState.enabled,
    robotDelivered: relayState.lastDelivered
  }));

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });
});

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  if (req.method === 'GET' && url.pathname === '/status') {
    sendJson(res, 200, { latestData, relayState });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/relay-control') {
    const tokenPayload = verifyControlToken(bearerToken(req) || url.searchParams.get('relayToken') || '');
    if (!tokenPayload) {
      sendJson(res, 401, { error: 'unauthorized' });
      return;
    }

    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', async () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        const action = parsed.action === 'disable' ? 'disable' : 'enable';
        relayState = {
          ...relayState,
          enabled: action === 'enable',
          operator: action === 'enable' ? String(tokenPayload.username || tokenPayload.sub || '') : '',
          updatedAt: Date.now()
        };

        let delivered = relayState.lastDelivered;
        if (action === 'disable') {
          delivered = await forwardStopToRobot();
        }

        broadcast(latestData);
        sendJson(res, 200, { status: 'ok', relayState, delivered });
      } catch {
        sendJson(res, 400, { error: 'invalid_json' });
      }
    });
    req.on('error', (err) => {
      console.error('Relay control request error:', err);
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/vehicle-control') {
    const tokenPayload = verifyControlToken(bearerToken(req));
    if (!tokenPayload) {
      sendJson(res, 401, { error: 'unauthorized' });
      return;
    }

    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', async () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        const type = String(parsed.type || '');
        let delivered = false;

        if (type === 'TAKEOVER_REQUEST') {
          relayState = {
            ...relayState,
            enabled: true,
            operator: String(tokenPayload.username || tokenPayload.sub || ''),
            updatedAt: Date.now()
          };
        } else if (type === 'CONTROL_RELEASE') {
          relayState = { ...relayState, enabled: false, operator: '', updatedAt: Date.now() };
          delivered = await forwardStopToRobot();
        } else if (type === 'stop') {
          delivered = await forwardStopToRobot();
        } else if (type === 'set_vel') {
          delivered = await forwardVelocityToRobot(parsed.value || {});
        } else {
          sendJson(res, 400, { error: 'unsupported_command' });
          return;
        }

        broadcast(latestData);
        sendJson(res, 200, { status: 'ok', relayState, delivered });
      } catch {
        sendJson(res, 400, { error: 'invalid_json' });
      }
    });
    req.on('error', (err) => {
      console.error('Vehicle control request error:', err);
    });
    return;
  }

  if (req.method !== 'POST' || url.pathname !== '/g29') {
    sendJson(res, 404, { error: 'not_found' });
    return;
  }

  const authHeader = (req.headers['authorization'] || '').toString();
  if (!(
    req.headers['x-g29-token'] === RELAY_TOKEN ||
    req.headers['x-relay-token'] === RELAY_TOKEN ||
    authHeader === `Bearer ${RELAY_TOKEN}`
  )) {
    sendJson(res, 401, { error: 'unauthorized' });
    return;
  }

  let body = '';
  let tooLarge = false;

  req.on('data', (chunk) => {
    body += chunk;
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
      tooLarge = true;
      req.destroy();
    }
  });

  req.on('end', async () => {
    if (tooLarge) {
      sendJson(res, 413, { error: 'payload_too_large' });
      return;
    }

    try {
      const parsed = JSON.parse(body);
      const data = parseG29Payload(parsed);
      if (!data) {
        sendJson(res, 400, { error: 'invalid_g29_payload' });
        return;
      }

      broadcast(data);
      const delivered = relayState.enabled ? await forwardG29ToRobot(data) : false;
      broadcast(data);
      sendJson(res, 200, { status: 'ok', relayEnabled: relayState.enabled, delivered });
    } catch {
      sendJson(res, 400, { error: 'invalid_json' });
    }
  });

  req.on('error', (err) => {
    console.error('HTTP request error:', err);
  });
});

server.listen(HTTP_PORT, HTTP_HOST, () => {
  console.log('G29 relay started');
  console.log(`HTTP ingest: http://${HTTP_HOST}:${HTTP_PORT}/g29`);
  console.log(`WebSocket feed: ws://0.0.0.0:${WS_PORT}`);
  console.log(`Robot relay target: ${ROBOT_RELAY_URL}`);
});
