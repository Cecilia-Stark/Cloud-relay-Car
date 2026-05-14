#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
G29 方向盘数据发送端
- 发送到小车：TCP 控制指令
- 发送到服务器：HTTP (用于前端显示)
"""
import socket
import hid
import time
import sys
import json
import os
import urllib.request

SIMULATE = len(sys.argv) > 1 and sys.argv[1] == '--simulate'

def load_env_file(path='.env'):
    if not os.path.exists(path):
        return
    with open(path, encoding='utf-8') as env_file:
        for line in env_file:
            stripped = line.strip()
            if not stripped or stripped.startswith('#') or '=' not in stripped:
                continue
            key, value = stripped.split('=', 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"\''))

# 配置
CAR_IP = '192.168.0.5'
CAR_PORT = 6999

# 服务器 HTTP 接口 (用于前端显示)
SERVER_HTTP = os.environ.get('SERVER_HTTP', 'http://8.149.246.34:8083/g29')
load_env_file()
G29_RELAY_TOKEN = os.environ.get('G29_RELAY_TOKEN', '').strip()
if not G29_RELAY_TOKEN:
    print("错误：缺少 G29_RELAY_TOKEN，请在环境变量或 .env 中配置。")
    sys.exit(1)

RECONNECT_DELAY = 2.0

print("=" * 60)
print("🎮 G29 方向盘发送端")
print("=" * 60)
print(f"小车地址：{CAR_IP}:{CAR_PORT}")
print(f"服务器 HTTP: {SERVER_HTTP}")
print("=" * 60)

print("\n[1] 查找 G29 方向盘...")
if SIMULATE:
    print(" [模拟模式] 使用虚拟方向盘数据")
    device = None
else:
    devices = hid.enumerate()
    if not devices:
        print(" 错误：未找到任何 HID 设备")
        print(" 请检查 G29 是否已连接，或使用 --simulate 参数模拟测试")
        sys.exit(1)

    g29_device = None
    for dev in devices:
        if dev.get('vendor_id') == 0x046D and dev.get('product_id') == 0xC24F:
            g29_device = dev
            break

    if not g29_device:
        print(f" 错误：未找到 G29 (找到 {len(devices)} 个 HID 设备)")
        sys.exit(1)

    print(f" 找到 G29: {g29_device.get('manufacturer_string')} {g29_device.get('product_string')}")
    print("\n[2] 连接 G29...")
    try:
        device = hid.device()
        device.open(0x046D, 0xC24F)
        device.set_nonblocking(False)
        print(" G29 连接成功。")
    except Exception as e:
        print(f" 错误：无法连接 G29: {e}")
        sys.exit(1)

def connect_to_car():
    print(f"\n[连接] 连接小车 {CAR_IP}:{CAR_PORT}...")
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(5.0)
    try:
        s.connect((CAR_IP, CAR_PORT))
        s.setblocking(False)
        print(" 小车连接成功！")
        return s
    except Exception as e:
        print(f" 错误：{e}")
        s.close()
        return None

def send_to_server(steering, throttle, brake):
    """发送数据到服务器 HTTP 接口"""
    try:
        data = json.dumps({
            'steering': round(steering, 1),
            'throttle': round(throttle, 1),
            'brake': round(brake, 1)
        }).encode()
        req = urllib.request.Request(
            SERVER_HTTP,
            data=data,
            headers={
                'Content-Type': 'application/json',
                'X-G29-Token': G29_RELAY_TOKEN
            },
            method='POST'
        )
        with urllib.request.urlopen(req, timeout=2) as response:
            pass
    except Exception as e:
        # 静默失败，不影响主流程
        pass

def main():
    car_socket = None
    send_count = 0
    http_send_count = 0
    
    while True:
        # 连接小车
        if car_socket is None:
            car_socket = connect_to_car()
            if car_socket is None:
                print(f" {RECONNECT_DELAY} 秒后重试...\n")
                time.sleep(RECONNECT_DELAY)
                continue
        
        # 读取 G29 数据
        if SIMULATE:
            import math
            t = time.time()
            steering = math.sin(t) * 200
            throttle = (math.cos(t * 0.5) + 1) / 2 * 100
            brake = 0
            buffer = [0] * 64
        else:
            try:
                buffer = device.read(64, timeout_ms=100)
            except Exception as e:
                print(f" 读取 G29 错误：{e}")
                time.sleep(0.1)
                continue
            if len(buffer) < 8:
                continue

            steeringRaw = buffer[4] | (buffer[5] << 8)
            steeringSigned = steeringRaw - 32768
            steering = steeringSigned / 32768.0 * 450.0

            throttleRaw = buffer[6]
            throttle = (255 - throttleRaw) / 255.0 * 100.0

            brakeRaw = buffer[7]
            brake = (255 - brakeRaw) / 255.0 * 100.0

        # 发送到小车
        cmd = f"CMD:steer={steering:.2f},throttle={throttle:.2f},brake={brake:.2f}\n"
        try:
            car_socket.send(cmd.encode())
            send_count += 1
            
            # 尝试读取小车响应
            try:
                response = car_socket.recv(1024).decode().strip()
                if response and response != "OK":
                    print(f" 收到小车：{response}")
            except BlockingIOError:
                pass
            except Exception:
                pass
        except (socket.error, BrokenPipeError, ConnectionResetError) as e:
            print(f"\n 小车连接断开：{e}")
            car_socket.close()
            car_socket = None
            time.sleep(RECONNECT_DELAY)
            continue
        
        # 发送到服务器 (每 10 帧发送一次，减少网络压力)
        if send_count % 10 == 0:
            send_to_server(steering, throttle, brake)
            http_send_count += 1
        
        # 打印进度
        if send_count % 100 == 0:
            print(f" 已发送 {send_count} 条 | steer={steering:.1f}°, throttle={throttle:.1f}%, brake={brake:.1f}%")
        
        time.sleep(0.05)

if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n用户中断，退出...")
    finally:
        if car_socket:
            car_socket.close()
        print("\n连接已关闭。")
