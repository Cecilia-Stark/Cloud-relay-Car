# 5G 远程驾驶平台 - 重启指南

## 📋 服务运行状态

| 位置 | 服务 | 状态 |
|------|------|------|
| 服务器 (8.149.246.34) | video-proxy、g29-relay、Web前端 | ✅ 长期运行 |
| 你的电脑 | Python G29 脚本 | ⚠️ 按需启动 |
| 小车 (192.168.0.5) | 视频服务、控制服务 | ⚠️ 按需启动 |

---

## 🖥️ 服务器手动重启

### 方法一：一键重启脚本（推荐）

```bash
# SSH 登录服务器后执行
/home/autodrv/5G-Remote-Driving-Cloud-Platform/weekly-restart.sh
```

### 方法二：逐个重启服务

```bash
# 1. 进入项目目录
cd /home/autodrv/5G-Remote-Driving-Cloud-Platform

# 2. 停止所有服务
pkill -f video-proxy-lowlatency.cjs
pkill -f g29-relay-server.cjs
pkill -f "vite preview"

# 等待 2 秒
sleep 2

# 3. 启动 video-proxy（后台运行）
nohup node video-proxy-lowlatency.cjs > video-proxy.log 2>&1 &

# 4. 启动 g29-relay（后台运行）
nohup node g29-relay-server.cjs > g29-relay.log 2>&1 &

# 5. 启动 Web 前端（后台运行）
nohup npm run preview -- --host 0.0.0.0 --port 8080 > web-frontend.log 2>&1 &

# 6. 查看日志
tail -f *.log
```

### 方法三：使用 PM2（如果已安装）

```bash
# 查看所有服务
pm2 list

# 重启所有服务
pm2 restart all

# 重启单个服务
pm2 restart video-proxy
pm2 restart g29-relay
pm2 restart web-frontend
```

---

## 💻 你的电脑 - Python 脚本

### 启动 G29 脚本

```bash
# 进入项目目录
cd E:\OneDrive\桌面\tt\5G-Remote-Driving-Cloud-Platform

# 启动脚本（有 G29 设备）
python send-g29-to-car-and-server.py

# 启动脚本（模拟测试，无 G29 设备）
python send-g29-to-car-and-server.py --simulate
```

### 停止脚本

```
按 Ctrl + C 中断
```

---

## 🚗 小车服务重启

### SSH 登录小车

```bash
ssh user@192.168.0.5
# 输入密码登录
```

### 启动视频服务

```bash
# ROS2 视频流服务（端口 8000）
ros2 run web_video_server web_video_server
```

### 启动控制服务

```bash
# Python 控制服务（端口 6999）
cd ~/robot_control
python3 robot_control.py
```

### 停止服务

```
在服务运行的终端按 Ctrl + C
```

---

## 🔍 检查服务状态

### 服务器检查

```bash
# 查看所有运行服务
ps aux | grep -E "video-proxy|g29-relay|vite" | grep -v grep

# 查看端口监听
ss -tlnp | grep -E "8001|8080|8082|8083"

# 查看日志
tail -f /home/autodrv/5G-Remote-Driving-Cloud-Platform/*.log
```

### 测试服务是否正常

```bash
# 测试视频代理
curl http://localhost:8001/

# 测试 G29 接口
curl -X POST http://localhost:8083/g29 -H "Content-Type: application/json" -d '{"steering":0,"throttle":0,"brake":0}'

# 测试前端
curl http://localhost:8080/
```

---

## ⏰ 自动重启配置

### 查看当前定时任务

```bash
crontab -l
```

### 添加自动重启任务

```bash
# 编辑定时任务
crontab -e

# 添加以下内容（每周日凌晨 3 点执行）
0 3 * * 0 /home/autodrv/5G-Remote-Driving-Cloud-Platform/weekly-restart.sh >> /home/autodrv/5G-Remote-Driving-Cloud-Platform/restart.log 2>&1
```

### 查看重启日志

```bash
tail -f /home/autodrv/5G-Remote-Driving-Cloud-Platform/restart.log
```

---

## 🚨 常见问题

### 服务启动失败

```bash
# 检查端口是否被占用
ss -tlnp | grep 8083

# 杀死占用端口的进程
kill -9 <PID>

# 重新启动服务
```

### 视频流不显示

```bash
# 1. 检查小车视频服务
curl http://192.168.0.5:8000/mjpeg

# 2. 检查视频代理
curl http://localhost:8001/

# 3. 重启视频代理
pkill -f video-proxy-lowlatency.cjs
nohup node video-proxy-lowlatency.cjs > video-proxy.log 2>&1 &
```

### G29 数据不显示

```bash
# 1. 检查 G29 服务
curl -X POST http://localhost:8083/g29 -d '{"steering":0}'

# 2. 检查 Python 脚本是否运行
ps aux | grep send-g29

# 3. 重启 G29 服务
pkill -f g29-relay-server.cjs
nohup node g29-relay-server.cjs > g29-relay.log 2>&1 &
```

---

## 📞 快速命令参考

| 操作 | 命令 |
|------|------|
| 一键重启服务器 | `./weekly-restart.sh` |
| 查看服务状态 | `ps aux \| grep -E "video-proxy\|g29-relay\|vite"` |
| 查看端口 | `ss -tlnp \| grep -E "8001\|8080\|8082\|8083"` |
| 查看日志 | `tail -f *.log` |
| 停止所有服务 | `pkill -f video-proxy; pkill -f g29-relay; pkill -f vite` |
| 编辑定时任务 | `crontab -e` |
| 查看定时任务 | `crontab -l` |

---

## 📝 版本信息

- 文档创建：2026-03-26
- 服务器 IP：8.149.246.34
- 小车 IP：192.168.0.5

---

## ⚠️ 注意事项

1. **服务器重启后**：需要手动启动所有服务（参考"方法二"）
2. **Python 脚本**：不控制时请关闭，避免 G29 过热
3. **小车服务**：使用完毕后请关闭，避免电量耗尽
4. **自动重启**：建议配置 crontab 每周日凌晨 3 点执行
