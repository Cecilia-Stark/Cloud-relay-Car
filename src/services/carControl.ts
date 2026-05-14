// 小车控制服务 - 通过 HTTP 发送指令到小车

// ⚠️ 小车 IP 地址 - 已通过 Web 界面配置
// 使用本地视频代理解决跨域问题
const CAR_PORT = 8000;
const PROXY_PORT = 8001;

function getRuntimeHost(): string {
  if (typeof window === 'undefined') return 'localhost';
  return window.location.hostname || 'localhost';
}

function getHttpProtocol(): string {
  if (typeof window === 'undefined') return 'http:';
  return window.location.protocol === 'https:' ? 'https:' : 'http:';
}

let CAR_IP = localStorage.getItem('car_ip') || getRuntimeHost();
// 视频流通过服务器上的本地代理转发（解决跨域和远程访问问题）
const VIDEO_URL = `${getHttpProtocol()}//${getRuntimeHost()}:${PROXY_PORT}/`;

function getCloudControlUrl(): string {
  return `${getHttpProtocol()}//${getRuntimeHost()}:8083/vehicle-control`;
}

export interface CarControlState {
  linear: number;
  angular: number;
}

/**
 * 发送控制指令到小车
 */


/**
 * 发送速度指令
 */
export async function sendVelocityCommand(linear: number, angular: number): Promise<void> {
  return sendCarCommand('set_vel', { linear, angular });
}

/**
 * 发送停止指令
 */
export async function sendStopCommand(): Promise<void> {
  return sendCarCommand('stop');
}

/**
 * 切换控制模式 (键盘/G29)
 */
export async function toggleControlMode(): Promise<void> {
  return sendCarCommand('toggle_mode');
}

/**
 * 获取小车 IP 地址
 */
export function getCarIp(): string {
  return CAR_IP;
}

/**
 * 设置小车 IP 地址
 */
export function setCarIp(ip: string): void {
  CAR_IP = ip.trim();
  localStorage.setItem('car_ip', CAR_IP);
}

/**
 * 获取视频流 URL
 */
export function getVideoUrl(): string {
  return VIDEO_URL;
}

import { getAuthToken } from './auth';

export { CAR_IP, VIDEO_URL };

// Update sendCarCommand to include Authorization header
const _origSendCarCommand = async function(type: string, value?: any): Promise<void> {
  try {
    const controlUrl = getCloudControlUrl();
    const token = getAuthToken();
    const headers: any = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const response = await fetch(controlUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ type, value })
    });

    if (!response.ok) {
      console.error('小车控制指令失败:', response.status);
    }
  } catch (error) {
    console.error('发送控制指令错误:', error);
    throw error;
  }
};

// Replace export sendCarCommand
export async function sendCarCommand(type: string, value?: any): Promise<void> {
  return _origSendCarCommand(type, value);
}
