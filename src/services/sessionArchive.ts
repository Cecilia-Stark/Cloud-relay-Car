import { DriveSessionRecord } from '../types';
import { getAuthApiBase, getStoredSession } from './auth';

function authHeaders(): HeadersInit {
  const token = getStoredSession()?.token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function requestJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${getAuthApiBase()}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(options.headers || {})
    }
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || '请求失败，请稍后重试。');
  }
  return payload as T;
}

async function createVideoAccessUrl(sessionId: string, disposition: 'inline' | 'download'): Promise<string> {
  const payload = await requestJson<{ url: string }>(
    `/sessions/${encodeURIComponent(sessionId)}/video-token`,
    {
      method: 'POST',
      body: JSON.stringify({ disposition })
    }
  );
  return payload.url;
}

export function createSessionVideoUrl(sessionId: string): Promise<string> {
  return createVideoAccessUrl(sessionId, 'inline');
}

export function createSessionDownloadUrl(sessionId: string): Promise<string> {
  return createVideoAccessUrl(sessionId, 'download');
}

export async function listDriveSessions(): Promise<DriveSessionRecord[]> {
  return requestJson<DriveSessionRecord[]>('/sessions');
}

export async function startDriveSession(): Promise<DriveSessionRecord> {
  return requestJson<DriveSessionRecord>('/sessions/start', {
    method: 'POST',
    body: JSON.stringify({})
  });
}

export async function stopDriveSession(sessionId: string, events: number): Promise<DriveSessionRecord> {
  return requestJson<DriveSessionRecord>(`/sessions/${encodeURIComponent(sessionId)}/stop`, {
    method: 'POST',
    body: JSON.stringify({ events })
  });
}
