const fs = require('fs');
const http = require('http');
const path = require('path');

const PORT = Number(process.env.PORT || 80);
const HOST = process.env.HOST || '0.0.0.0';
const DIST_DIR = path.join(__dirname, 'dist');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.map': 'application/json; charset=utf-8'
};

function send(res, status, headers, body) {
  if (res.headersSent || res.writableEnded) {
    if (!res.writableEnded) res.end();
    return;
  }
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-G29-Token, X-Relay-Token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    ...headers
  });
  res.end(body);
}

function proxy(req, res, target) {
  let upstreamStarted = false;
  const requestOptions = {
    hostname: target.hostname,
    port: target.port,
    path: target.path,
    method: req.method,
    headers: {
      ...req.headers,
      host: `${target.hostname}:${target.port}`
    }
  };
  if (target.timeoutMs !== 0) {
    requestOptions.timeout = target.timeoutMs || 10000;
  }

  const upstream = http.request(
    requestOptions,
    (upstreamRes) => {
      upstreamStarted = true;
      res.writeHead(upstreamRes.statusCode || 502, {
        ...upstreamRes.headers,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-G29-Token, X-Relay-Token',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
      });
      upstreamRes.pipe(res);
    }
  );

  upstream.on('timeout', () => {
    upstream.destroy(new Error('proxy_timeout'));
  });

  upstream.on('error', (error) => {
    if (upstreamStarted || res.headersSent || res.writableEnded) {
      if (!res.writableEnded) res.end();
      return;
    }
    send(res, 502, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({
      error: 'proxy_failed',
      detail: error.message
    }));
  });

  req.on('aborted', () => {
    upstream.destroy();
  });

  req.pipe(upstream);
}

function serveStatic(req, res) {
  const url = new URL(req.url || '/', 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';

  const requestedPath = path.normalize(path.join(DIST_DIR, pathname));
  const distRoot = path.normalize(DIST_DIR + path.sep);
  const filePath = requestedPath.startsWith(distRoot) ? requestedPath : path.join(DIST_DIR, 'index.html');
  const finalPath = fs.existsSync(filePath) && fs.statSync(filePath).isFile()
    ? filePath
    : path.join(DIST_DIR, 'index.html');

  fs.readFile(finalPath, (error, content) => {
    if (error) {
      send(res, 500, { 'Content-Type': 'text/plain; charset=utf-8' }, 'frontend_not_available');
      return;
    }

    const ext = path.extname(finalPath).toLowerCase();
    send(res, 200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable'
    }, content);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    send(res, 204, {}, '');
    return;
  }

  const url = new URL(req.url || '/', 'http://localhost');

  if (url.pathname === '/g29-status') {
    proxy(req, res, { hostname: '127.0.0.1', port: 8083, path: '/status' });
    return;
  }

  if (url.pathname === '/g29') {
    proxy(req, res, { hostname: '127.0.0.1', port: 8083, path: '/g29' });
    return;
  }

  if (url.pathname === '/relay-control') {
    proxy(req, res, { hostname: '127.0.0.1', port: 8083, path: '/relay-control' });
    return;
  }

  if (url.pathname === '/vehicle-control') {
    proxy(req, res, { hostname: '127.0.0.1', port: 8083, path: '/vehicle-control' });
    return;
  }

  if (url.pathname === '/api/status') {
    proxy(req, res, { hostname: '127.0.0.1', port: 18080, path: '/api/status' });
    return;
  }

  if (url.pathname === '/api/telemetry') {
    proxy(req, res, { hostname: '127.0.0.1', port: 18080, path: '/api/telemetry' });
    return;
  }

  if (url.pathname.startsWith('/live/')) {
    proxy(req, res, { hostname: '127.0.0.1', port: 8088, path: `${url.pathname}${url.search}`, timeoutMs: 0 });
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`web proxy listening on http://${HOST}:${PORT}`);
});
