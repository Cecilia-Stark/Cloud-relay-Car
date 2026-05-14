#!/usr/bin/env node
/**
 * 视频流代理服务器
 * 功能：将小车 192.168.0.5:8000 的视频流转发到本地 8001 端口
 * 解决跨域和网络访问问题
 */

const http = require('http');
const { createProxyMiddleware } = require('http-proxy-middleware');

const TARGET_URL = 'http://192.168.0.5:8000';
const LOCAL_PORT = 8001;

console.log('=' .repeat(60));
console.log('视频流代理服务器');
console.log('=' .repeat(60));
console.log(`目标地址：${TARGET_URL}`);
console.log(`本地端口：${LOCAL_PORT}`);
console.log('=' .repeat(60));

// 创建代理服务器
const proxy = createProxyMiddleware({
  target: TARGET_URL,
  changeOrigin: true,
  ws: true,
  logLevel: 'silent',
  onError: (err, req, res) => {
    console.error('代理错误:', err.message);
    if (res && !res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('视频流代理错误：' + err.message);
    }
  }
});

// 创建 HTTP 服务器
const VIDEO_PROXY_KEY = process.env.VIDEO_PROXY_KEY || '';

const server = http.createServer((req, res) => {
  try {
    const fullUrl = new URL(req.url, `http://${req.headers.host}`);
    const key = fullUrl.searchParams.get('key');
    const authHeader = (req.headers['authorization'] || '').toString();
    console.log(`[${new Date().toLocaleTimeString()}] 请求：${req.url}  key=${key || '<none>'} auth=${authHeader ? '<present>' : '<none>'}`);

    if (VIDEO_PROXY_KEY && !(key === VIDEO_PROXY_KEY || authHeader === `Bearer ${VIDEO_PROXY_KEY}`)) {
      console.warn('拒绝未经授权的视频代理请求');
      res.writeHead(401, { 'Content-Type': 'text/plain' });
      res.end('Unauthorized');
      return;
    }
  } catch {
    console.warn('请求 URL 解析失败，继续代理（兼容旧客户端）');
  }

  proxy(req, res);
});

// 启动服务器
server.listen(LOCAL_PORT, () => {
  console.log('');
  console.log(`✅ 代理服务器已启动`);
  console.log(`📺 视频流地址：http://localhost:${LOCAL_PORT}/`);
  console.log('');
  console.log('现在可以在 Web 平台使用 http://localhost:8001/ 访问视频流');
  console.log('=' .repeat(60));
});

// 错误处理
server.on('error', (err) => {
  console.error('❌ 服务器错误:', err.message);
  if (err.code === 'EADDRINUSE') {
    console.error(`端口 ${LOCAL_PORT} 已被占用，请关闭占用该端口的程序`);
  }
  process.exit(1);
});

// 退出处理
process.on('SIGINT', () => {
  console.log('\n正在关闭代理服务器...');
  server.close(() => {
    console.log('代理服务器已关闭');
    process.exit(0);
  });
});
