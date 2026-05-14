import { AuthenticatedUser, UserRole } from '../types';

const SESSION_KEY = 'cloudrive_auth_session';

export interface AuthSession {
  token: string;
  user: AuthenticatedUser;
}

export interface RegisterPayload {
  username: string;
  password: string;
  role: UserRole;
  inviteCode: string;
}

interface RelayTokenResponse {
  token: string;
  wsUrl: string;
  expiresAt: string;
}

interface ScopedTokenResponse {
  token: string;
  expiresAt: string;
}

export function getAuthApiBase(): string {
  const host = window.location.hostname || 'localhost';
  const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
  return `${protocol}//${host}:9001`;
}

async function requestJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${getAuthApiBase()}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || '请求失败，请稍后重试。');
  }
  return payload as T;
}

export function getStoredSession(): AuthSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AuthSession;
  } catch {
    clearStoredSession();
    return null;
  }
}

export function saveSession(session: AuthSession) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearStoredSession() {
  sessionStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(SESSION_KEY);
}

export async function login(username: string, password: string): Promise<AuthSession> {
  const session = await requestJson<AuthSession>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });
  saveSession(session);
  return session;
}

export async function registerUser(payload: RegisterPayload): Promise<AuthSession> {
  const session = await requestJson<AuthSession>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  saveSession(session);
  return session;
}

export async function validateStoredSession(): Promise<AuthSession | null> {
  const session = getStoredSession();
  if (!session?.token) return null;

  try {
    const user = await requestJson<AuthenticatedUser>('/auth/me', {
      headers: {
        Authorization: `Bearer ${session.token}`
      }
    });
    const refreshed = { token: session.token, user };
    saveSession(refreshed);
    return refreshed;
  } catch {
    clearStoredSession();
    return null;
  }
}

function authHeaders(): HeadersInit {
  const token = getStoredSession()?.token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function createRelayConnectionUrl(): Promise<string> {
  const payload = await requestJson<RelayTokenResponse>('/control/relay-token', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({})
  });
  return payload.wsUrl;
}

export async function createVideoProxyAccessToken(): Promise<string> {
  const payload = await requestJson<ScopedTokenResponse>('/control/video-proxy-token', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({})
  });
  return payload.token;
}

export function getAuthToken(): string {
  try {
    return getStoredSession()?.token || '';
  } catch {
    // ignore storage errors
  }
  return '';
}

export function setAuthToken(token: string) {
  void token;
}
