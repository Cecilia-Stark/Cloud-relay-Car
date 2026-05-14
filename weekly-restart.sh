#!/bin/bash
# 每周自动重启脚本
# 用法：./weekly-restart.sh

cd /home/autodrv/5G-Remote-Driving-Cloud-Platform

echo "[$(date)] 开始重启服务..."

# 重启 video-proxy
echo "重启 video-proxy..."
pkill -f video-proxy-lowlatency.cjs
sleep 2
node video-proxy-lowlatency.cjs &

# 重启 g29-relay
echo "重启 g29-relay..."
pkill -f g29-relay-server.cjs
sleep 2
node g29-relay-server.cjs &

# 重启前端
echo "重启 web-frontend..."
pkill -f "vite preview"
sleep 2
npm run preview -- --host 0.0.0.0 --port 8080 &

echo "[$(date)] 重启完成!"
