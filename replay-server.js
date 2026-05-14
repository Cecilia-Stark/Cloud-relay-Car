import express from 'express';
import fs from 'fs';
import path from 'path';
import cors from 'cors';
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import process from 'node:process';

const app = express();
app.use(cors());
app.use(express.json());

const DATA_DIR = path.resolve('./replay-data');
const LOG_FILE = path.join(DATA_DIR, 'logs.json');
const VIDEO_DIR = path.join(DATA_DIR, 'videos');

function loadEnvFile(file = '.env') {
  if (!fs.existsSync(file)) return;

  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) return;

    const [key, ...valueParts] = trimmed.split('=');
    const value = valueParts.join('=').trim().replace(/^['"]|['"]$/g, '');
    if (!process.env[key]) process.env[key] = value;
  });
}

loadEnvFile();

const AUTH_SECRET = String(process.env.AUTH_SECRET || '').trim();
const INSECURE_AUTH_SECRETS = new Set([
  'cloudrive-dev-secret-change-me',
  'change-this-session-signing-secret'
]);
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const RELAY_TOKEN_TTL_MS = 1000 * 60 * 2;
const VIDEO_PROXY_TOKEN_TTL_MS = 1000 * 60 * 2;
const VIDEO_TOKEN_TTL_MS = 1000 * 60 * 5;
const VALID_ROLES = new Set(['operator']);

if (!AUTH_SECRET || INSECURE_AUTH_SECRETS.has(AUTH_SECRET)) {
  console.error('AUTH_SECRET must be set to a private, non-default value before starting replay-server.');
  process.exit(1);
}

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, '[]', 'utf8');
if (!fs.existsSync(VIDEO_DIR)) fs.mkdirSync(VIDEO_DIR, { recursive: true });

const mysqlConfig = {
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'cloud_drive',
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true
};

let db = null;
let mysqlLoadError = null;
const activeRecordings = new Map();

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) || fallback;
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function readLogs() {
  return readJson(LOG_FILE, []);
}

function writeLogs(logs) {
  writeJson(LOG_FILE, logs);
}

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const passwordHash = crypto.pbkdf2Sync(String(password), salt, 120000, 64, 'sha512').toString('hex');
  return { salt, passwordHash };
}

function verifyPassword(password, user) {
  const { passwordHash } = hashPassword(password, user.salt);
  return crypto.timingSafeEqual(Buffer.from(passwordHash, 'hex'), Buffer.from(user.passwordHash, 'hex'));
}


function readRuntimeEnvFile(file = '.env') {
  if (!fs.existsSync(file)) return {};

  const values = {};
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) return;

    const [key, ...valueParts] = trimmed.split('=');
    values[key.trim()] = valueParts.join('=').trim().replace(/^['"]|['"]$/g, '');
  });
  return values;
}

function runtimeConfigValue(key) {
  const envFile = readRuntimeEnvFile();
  return envFile[key] || process.env[key] || '';
}

function configuredInviteCodesForRole(role) {
  const sharedCodes = [
    runtimeConfigValue('PLATFORM_INVITE_CODE'),
    runtimeConfigValue('INVITE_CODE')
  ];
  const roleCodes = {
    operator: [runtimeConfigValue('OPERATOR_INVITE_CODE')],
    dispatcher: [runtimeConfigValue('DISPATCHER_INVITE_CODE')],
    viewer: [runtimeConfigValue('VIEWER_INVITE_CODE')]
  };

  return [...(roleCodes[role] || []), ...sharedCodes]
    .filter(Boolean)
    .map((code) => String(code).trim())
    .filter(Boolean);
}

function safeStringEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function isInviteCodeValid(role, inviteCode) {
  const candidate = String(inviteCode || '').trim();
  if (!candidate) return false;
  return configuredInviteCodesForRole(role).some((code) => safeStringEqual(candidate, code));
}

function inviteCodeFromSearchParams(params) {
  return params.get('inviteCode') || params.get('invite') || params.get('code') || params.get('key') || '';
}

function inviteCodeFromRequest(req) {
  const bodyCode = String(req.body?.inviteCode || '').trim();
  if (bodyCode) return bodyCode;

  const queryCode = inviteCodeFromSearchParams(new URLSearchParams(req.query || {}));
  if (queryCode) return queryCode;

  const referer = String(req.headers.referer || '');
  if (!referer) return '';

  try {
    return inviteCodeFromSearchParams(new URL(referer).searchParams);
  } catch {
    return '';
  }
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    createdAt: user.createdAt instanceof Date ? user.createdAt.toISOString() : user.createdAt
  };
}

function base64UrlEncode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function sign(value) {
  return crypto.createHmac('sha256', AUTH_SECRET).update(value).digest('base64url');
}

function isSignatureValid(value, signature) {
  return safeStringEqual(signature, sign(value));
}

function createToken(user) {
  const payload = {
    type: 'auth',
    sub: user.id,
    username: user.username,
    role: user.role,
    iat: Date.now(),
    exp: Date.now() + TOKEN_TTL_MS
  };
  const encodedPayload = base64UrlEncode(payload);
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [encodedPayload, signature] = token.split('.');
  if (!isSignatureValid(encodedPayload, signature)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function createScopedToken(payload, ttlMs) {
  const encodedPayload = base64UrlEncode({
    ...payload,
    iat: Date.now(),
    exp: Date.now() + ttlMs
  });
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

function createRelayAccessToken(user) {
  return createScopedToken({
    type: 'relay',
    sub: user.id,
    username: user.username,
    role: user.role
  }, RELAY_TOKEN_TTL_MS);
}

function createVideoProxyAccessToken(user) {
  return createScopedToken({
    type: 'video_proxy',
    sub: user.id,
    username: user.username,
    role: user.role
  }, VIDEO_PROXY_TOKEN_TTL_MS);
}

function createVideoAccessToken({ user, sessionId, disposition }) {
  return createScopedToken({
    type: 'video',
    sub: user.id,
    sessionId,
    disposition
  }, VIDEO_TOKEN_TTL_MS);
}

function verifyVideoAccessToken(token, { sessionId, disposition }) {
  const payload = verifyToken(token);
  if (!payload || payload.type !== 'video') return null;
  if (payload.sessionId !== sessionId) return null;
  if (payload.disposition !== disposition) return null;
  return payload;
}

async function initDatabase() {
  let mysqlModule;
  try {
    mysqlModule = await import('mysql2/promise');
  } catch (err) {
    mysqlLoadError = err;
    console.error('mysql2 dependency is missing. Run: npm install mysql2');
    return false;
  }

  const mysql = mysqlModule.default || mysqlModule;
  const bootstrapDb = mysql.createPool({
    ...mysqlConfig,
    database: undefined,
    connectionLimit: 1
  });

  await bootstrapDb.query(
    `CREATE DATABASE IF NOT EXISTS \`${mysqlConfig.database}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await bootstrapDb.end();

  db = mysql.createPool(mysqlConfig);
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id CHAR(36) PRIMARY KEY,
      username VARCHAR(64) NOT NULL UNIQUE,
      role ENUM('operator', 'dispatcher', 'viewer') NOT NULL,
      salt VARCHAR(64) NOT NULL,
      password_hash VARCHAR(128) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_users_role (role)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS drive_sessions (
      id VARCHAR(64) PRIMARY KEY,
      operator VARCHAR(64) NOT NULL,
      role ENUM('operator', 'dispatcher', 'viewer') NOT NULL,
      start_time DATETIME NOT NULL,
      end_time DATETIME NULL,
      duration_seconds DECIMAL(10,2) NULL,
      events INT NOT NULL DEFAULT 0,
      status ENUM('recording', 'completed', 'aborted', 'recording_error') NOT NULL DEFAULT 'recording',
      video_path VARCHAR(512) NULL,
      video_filename VARCHAR(255) NULL,
      video_size BIGINT NOT NULL DEFAULT 0,
      error_message TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_drive_sessions_start_time (start_time),
      INDEX idx_drive_sessions_operator (operator)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  return true;
}

function ensureDatabaseReady(res) {
  if (db) return true;

  const detail = mysqlLoadError
    ? '服务端缺少 mysql2 依赖，请在项目目录执行 npm install mysql2。'
    : 'MySQL 连接尚未初始化，请检查 MYSQL_HOST / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE。';

  res.status(503).json({ error: detail });
  return false;
}

function mapUserRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    salt: row.salt,
    passwordHash: row.password_hash,
    createdAt: row.created_at
  };
}

async function findUserById(id) {
  if (!db) return null;
  const [rows] = await db.execute('SELECT * FROM users WHERE id = ? LIMIT 1', [id]);
  return mapUserRow(rows[0]);
}

async function findUserByUsername(username) {
  if (!db) return null;
  const [rows] = await db.execute('SELECT * FROM users WHERE username = ? LIMIT 1', [username]);
  return mapUserRow(rows[0]);
}

async function createUser({ username, password, role }) {
  const { salt, passwordHash } = hashPassword(password);
  const user = {
    id: crypto.randomUUID(),
    username,
    role,
    salt,
    passwordHash,
    createdAt: new Date().toISOString()
  };

  await db.execute(
    'INSERT INTO users (id, username, role, salt, password_hash) VALUES (?, ?, ?, ?, ?)',
    [user.id, user.username, user.role, user.salt, user.passwordHash]
  );

  return user;
}

async function requireAuth(req, res, next) {
  const authHeader = String(req.headers.authorization || '');
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const payload = verifyToken(token);
  if (!payload || (payload.type && payload.type !== 'auth')) {
    res.status(401).json({ error: '登录已失效，请重新登录。' });
    return;
  }

  try {
    if (!ensureDatabaseReady(res)) return;

    const user = await findUserById(payload.sub);
    if (!user) {
      res.status(401).json({ error: '账号不存在，请重新登录。' });
      return;
    }

    req.user = user;
    next();
  } catch (err) {
    console.error('MySQL auth lookup failed:', err);
    res.status(500).json({ error: '数据库查询失败。' });
  }
}

function requireOperator(req, res, next) {
  if (req.user?.role !== 'operator') {
    res.status(403).json({ error: 'Only operator accounts can control recording sessions.' });
    return;
  }
  next();
}

function makeSessionId() {
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '_');
  return `RC_${stamp}_${crypto.randomBytes(3).toString('hex')}`;
}

function sanitizeFilenamePart(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'operator';
}

function getRecordingInputUrl() {
  return process.env.RECORDING_INPUT_URL || 'http://127.0.0.1:8088/live/car.flv';
}

function fileSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function mapSessionRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    operator: row.operator,
    role: row.role,
    startTime: row.start_time instanceof Date ? row.start_time.toISOString() : row.start_time,
    endTime: row.end_time instanceof Date ? row.end_time.toISOString() : row.end_time,
    durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
    events: Number(row.events || 0),
    status: row.status,
    videoPath: row.video_path,
    videoFilename: row.video_filename,
    videoSize: Number(row.video_size || 0),
    errorMessage: row.error_message
  };
}

async function findSessionById(id) {
  const [rows] = await db.execute('SELECT * FROM drive_sessions WHERE id = ? LIMIT 1', [id]);
  return mapSessionRow(rows[0]);
}

function startRecordingProcess({ sessionId, outputPath }) {
  const inputUrl = getRecordingInputUrl();
  const ffmpeg = spawn('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'warning',
    '-i',
    inputUrl,
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    outputPath
  ], {
    stdio: ['pipe', 'ignore', 'pipe']
  });

  let errorOutput = '';
  ffmpeg.stderr.on('data', (chunk) => {
    errorOutput += chunk.toString();
    if (errorOutput.length > 4000) errorOutput = errorOutput.slice(-4000);
  });

  ffmpeg.on('exit', async (code, signal) => {
    const active = activeRecordings.get(sessionId);
    activeRecordings.delete(sessionId);

    if (active?.stopping) return;

    console.error(`Recording ${sessionId} exited early`, { code, signal, errorOutput });
    if (!db) return;

    try {
      await db.execute(
        `UPDATE drive_sessions
         SET status = 'recording_error', error_message = ?, video_size = ?
         WHERE id = ? AND status = 'recording'`,
        [errorOutput || `ffmpeg exited with code ${code}`, fileSize(outputPath), sessionId]
      );
    } catch (err) {
      console.error('Failed to update recording_error session:', err);
    }
  });

  activeRecordings.set(sessionId, {
    process: ffmpeg,
    outputPath,
    startedAt: Date.now(),
    stopping: false,
    errorOutput
  });
}

function stopRecordingProcess(sessionId) {
  const active = activeRecordings.get(sessionId);
  if (!active) return Promise.resolve();

  active.stopping = true;
  const proc = active.process;

  return new Promise((resolve) => {
    const finish = () => {
      activeRecordings.delete(sessionId);
      resolve();
    };

    const killTimer = setTimeout(() => {
      if (!proc.killed) proc.kill('SIGKILL');
      finish();
    }, 7000);

    proc.once('exit', () => {
      clearTimeout(killTimer);
      finish();
    });

    try {
      proc.stdin.write('q');
      proc.stdin.end();
    } catch {
      proc.kill('SIGINT');
    }
  });
}

app.get('/logs', (req, res) => {
  res.json(readLogs());
});

app.post('/logs', (req, res) => {
  const logs = readLogs();
  const entry = req.body;
  if (entry && entry.id) {
    logs.unshift(entry);
    writeLogs(logs);
    res.status(201).json({ ok: true });
  } else {
    res.status(400).json({ ok: false, error: 'invalid payload' });
  }
});

app.post('/auth/register', async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = String(req.body?.password || '');
  const role = String(req.body?.role || '');
  const inviteCode = inviteCodeFromRequest(req);

  if (!username || username.length < 2) {
    res.status(400).json({ error: '账号至少需要 2 个字符。' });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: '密码至少需要 6 位。' });
    return;
  }
  if (!VALID_ROLES.has(role)) {
    res.status(400).json({ error: '请选择有效身份。' });
    return;
  }
  if (configuredInviteCodesForRole(role).length === 0) {
    res.status(500).json({ error: '??????????????????' });
    return;
  }
  if (!isInviteCodeValid(role, inviteCode)) {
    res.status(403).json({ error: '???????????????' });
    return;
  }

  try {
    if (!ensureDatabaseReady(res)) return;

    const existing = await findUserByUsername(username);
    if (existing) {
      res.status(409).json({ error: '账号已存在，请直接登录。' });
      return;
    }

    const user = await createUser({ username, password, role });
    res.status(201).json({
      token: createToken(user),
      user: publicUser(user)
    });
  } catch (err) {
    console.error('MySQL register failed:', err);
    res.status(500).json({ error: '注册失败，请检查 MySQL 服务。' });
  }
});

app.post('/auth/login', async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = String(req.body?.password || '');

  try {
    if (!ensureDatabaseReady(res)) return;

    const user = await findUserByUsername(username);
    if (!user || !verifyPassword(password, user)) {
      res.status(401).json({ error: '账号或密码错误。' });
      return;
    }

    res.json({
      token: createToken(user),
      user: publicUser(user)
    });
  } catch (err) {
    console.error('MySQL login failed:', err);
    res.status(500).json({ error: '登录失败，请检查 MySQL 服务。' });
  }
});

app.get('/auth/me', requireAuth, (req, res) => {
  res.json(publicUser(req.user));
});

app.post('/control/relay-token', requireAuth, requireOperator, (req, res) => {
  const token = createRelayAccessToken(req.user);
  const wsProtocol = req.protocol === 'https' ? 'wss:' : 'ws:';
  res.json({
    token,
    wsUrl: `${wsProtocol}//${req.get('host')?.replace(/:\d+$/, '') || req.hostname}:8082?relayToken=${encodeURIComponent(token)}`,
    expiresAt: new Date(Date.now() + RELAY_TOKEN_TTL_MS).toISOString()
  });
});

app.post('/control/video-proxy-token', requireAuth, (req, res) => {
  const token = createVideoProxyAccessToken(req.user);
  res.json({
    token,
    expiresAt: new Date(Date.now() + VIDEO_PROXY_TOKEN_TTL_MS).toISOString()
  });
});

app.get('/sessions', requireAuth, async (req, res) => {
  try {
    if (!ensureDatabaseReady(res)) return;

    const [rows] = await db.execute(
      `SELECT * FROM drive_sessions
       ORDER BY start_time DESC
       LIMIT 200`
    );

    res.json(rows.map(mapSessionRow));
  } catch (err) {
    console.error('Failed to list drive sessions:', err);
    res.status(500).json({ error: 'Failed to load drive sessions.' });
  }
});

app.post('/sessions/start', requireAuth, requireOperator, async (req, res) => {
  let hasLock = false;
  try {
    if (!ensureDatabaseReady(res)) return;

    const [lockRows] = await db.execute("SELECT GET_LOCK('cloudrive_active_recording', 5) AS acquired");
    hasLock = Number(lockRows[0]?.acquired) === 1;
    if (!hasLock) {
      res.status(409).json({ error: 'Another recording session is starting. Please retry shortly.' });
      return;
    }

    const [activeRows] = await db.execute(
      `SELECT * FROM drive_sessions
       WHERE status = 'recording'
       ORDER BY start_time DESC
       LIMIT 1`
    );
    const activeSession = mapSessionRow(activeRows[0]);
    if (activeSession || activeRecordings.size > 0) {
      res.status(409).json({
        error: 'A recording session is already active.',
        session: activeSession
      });
      return;
    }

    const id = makeSessionId();
    const operator = req.user.username;
    const role = req.user.role;
    const safeOperator = sanitizeFilenamePart(operator);
    const day = new Date().toISOString().slice(0, 10);
    const dayDir = path.join(VIDEO_DIR, day);
    if (!fs.existsSync(dayDir)) fs.mkdirSync(dayDir, { recursive: true });

    const videoFilename = `${id}_${safeOperator}.mp4`;
    const videoPath = path.join(dayDir, videoFilename);
    const relativeVideoPath = path.relative(process.cwd(), videoPath);

    await db.execute(
      `INSERT INTO drive_sessions
       (id, operator, role, start_time, status, video_path, video_filename)
       VALUES (?, ?, ?, NOW(), 'recording', ?, ?)`,
      [id, operator, role, relativeVideoPath, videoFilename]
    );

    startRecordingProcess({ sessionId: id, outputPath: videoPath });

    const session = await findSessionById(id);
    res.status(201).json(session);
  } catch (err) {
    console.error('Failed to start drive session:', err);
    res.status(500).json({ error: 'Failed to start recording session.' });
  } finally {
    if (hasLock) {
      try {
        await db.execute("SELECT RELEASE_LOCK('cloudrive_active_recording')");
      } catch (err) {
        console.error('Failed to release recording start lock:', err);
      }
    }
  }
});

app.post('/sessions/:id/stop', requireAuth, requireOperator, async (req, res) => {
  try {
    if (!ensureDatabaseReady(res)) return;

    const session = await findSessionById(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Drive session not found.' });
      return;
    }
    if (session.status !== 'recording') {
      res.status(409).json({ error: 'Drive session is not recording and cannot be stopped again.' });
      return;
    }

    await stopRecordingProcess(session.id);

    const absoluteVideoPath = session.videoPath
      ? path.resolve(session.videoPath)
      : '';
    const videoSize = absoluteVideoPath ? fileSize(absoluteVideoPath) : 0;
    const events = Number.isFinite(Number(req.body?.events)) ? Number(req.body.events) : session.events;
    const status = videoSize > 0 ? 'completed' : 'recording_error';
    const errorMessage = videoSize > 0 ? null : 'Recording file is empty or missing.';

    await db.execute(
      `UPDATE drive_sessions
       SET end_time = NOW(),
           duration_seconds = TIMESTAMPDIFF(MICROSECOND, start_time, NOW()) / 1000000,
           events = ?,
           status = ?,
           video_size = ?,
           error_message = ?
       WHERE id = ? AND status = 'recording'`,
      [events, status, videoSize, errorMessage, session.id]
    );

    const updated = await findSessionById(session.id);
    res.json(updated);
  } catch (err) {
    console.error('Failed to stop drive session:', err);
    res.status(500).json({ error: 'Failed to stop recording session.' });
  }
});

app.post('/sessions/:id/video-token', requireAuth, async (req, res) => {
  try {
    if (!ensureDatabaseReady(res)) return;

    const disposition = req.body?.disposition === 'download' ? 'download' : 'inline';
    const session = await findSessionById(req.params.id);
    if (!session?.videoPath) {
      res.status(404).json({ error: 'Video not found.' });
      return;
    }

    const token = createVideoAccessToken({
      user: req.user,
      sessionId: req.params.id,
      disposition
    });
    const suffix = disposition === 'download' ? 'video/download' : 'video';
    const url = `${req.protocol}://${req.get('host')}/sessions/${encodeURIComponent(req.params.id)}/${suffix}?videoToken=${encodeURIComponent(token)}`;

    res.json({
      url,
      expiresAt: new Date(Date.now() + VIDEO_TOKEN_TTL_MS).toISOString()
    });
  } catch (err) {
    console.error('Failed to create video access token:', err);
    res.status(500).json({ error: 'Failed to create video link.' });
  }
});

function requireVideoAccess(disposition) {
  return (req, res, next) => {
    const token = typeof req.query.videoToken === 'string' ? req.query.videoToken : '';
    const payload = verifyVideoAccessToken(token, {
      sessionId: req.params.id,
      disposition
    });

    if (!payload) {
      res.status(401).json({ error: 'Video link expired or invalid.' });
      return;
    }

    req.videoAccess = payload;
    next();
  };
}

app.get('/sessions/:id/video', requireVideoAccess('inline'), async (req, res) => {
  try {
    if (!ensureDatabaseReady(res)) return;

    const session = await findSessionById(req.params.id);
    if (!session?.videoPath) {
      res.status(404).json({ error: 'Video not found.' });
      return;
    }

    const absoluteVideoPath = path.resolve(session.videoPath);
    if (!fs.existsSync(absoluteVideoPath)) {
      res.status(404).json({ error: 'Video file is missing.' });
      return;
    }

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `inline; filename="${session.videoFilename || `${session.id}.mp4`}"`);
    res.sendFile(absoluteVideoPath);
  } catch (err) {
    console.error('Failed to stream session video:', err);
    res.status(500).json({ error: 'Failed to stream video.' });
  }
});

app.get('/sessions/:id/video/download', requireVideoAccess('download'), async (req, res) => {
  try {
    if (!ensureDatabaseReady(res)) return;

    const session = await findSessionById(req.params.id);
    if (!session?.videoPath) {
      res.status(404).json({ error: 'Video not found.' });
      return;
    }

    const absoluteVideoPath = path.resolve(session.videoPath);
    if (!fs.existsSync(absoluteVideoPath)) {
      res.status(404).json({ error: 'Video file is missing.' });
      return;
    }

    res.download(absoluteVideoPath, session.videoFilename || `${session.id}.mp4`);
  } catch (err) {
    console.error('Failed to download session video:', err);
    res.status(500).json({ error: 'Failed to download video.' });
  }
});

const PORT = process.env.REPLAY_PORT || 9001;

initDatabase()
  .then((isMysqlReady) => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Replay/auth server listening on http://0.0.0.0:${PORT}`);
      if (isMysqlReady) {
        console.log(`MySQL users table ready: ${mysqlConfig.host}:${mysqlConfig.port}/${mysqlConfig.database}`);
      } else {
        console.log('MySQL auth is not ready because mysql2 is not installed.');
      }
    });
  })
  .catch((err) => {
    console.error('Failed to initialize MySQL database.');
    console.error('Set MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE before starting replay-server.');
    console.error(err);
    process.exit(1);
  });
