import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Car,
  KeyRound,
  Loader2,
  Lock,
  Moon,
  ShieldCheck,
  Sun,
  User,
  Wifi
} from 'lucide-react';
import { AuthSession, login, registerUser, setAuthToken } from '../services/auth';

interface LoginViewProps {
  onLoginSuccess: (session: AuthSession) => void;
}

type LoginTheme = 'dark' | 'light';

const capabilityCards = [
  { label: '视频链路', icon: Wifi },
  { label: '车辆状态', icon: Car },
  { label: '权限管控', icon: ShieldCheck }
];

function getInviteCodeFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('inviteCode') || params.get('invite') || params.get('code') || params.get('key') || '';
  } catch {
    return '';
  }
}

function getInitialTheme(): LoginTheme {
  try {
    const saved = localStorage.getItem('clouddrive_login_theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // Ignore storage access errors.
  }
  return 'dark';
}

export const LoginView: React.FC<LoginViewProps> = ({ onLoginSuccess }) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [theme, setTheme] = useState<LoginTheme>(getInitialTheme);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [inviteCode, setInviteCode] = useState(getInviteCodeFromUrl);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const isDark = theme === 'dark';
  const ThemeIcon = isDark ? Sun : Moon;
  const modeCopy = useMemo(
    () => ({
      eyebrow: mode === 'login' ? '授权访问' : '操作员注册',
      title: mode === 'login' ? '操作员登录' : '创建操作员账号',
      subtitle: mode === 'login'
        ? '登录后可查看实时视频、方向盘输入、车辆遥测与接管状态。'
        : '使用操作员邀请码注册账号，进入远程驾驶云控平台。',
      submit: mode === 'login' ? '登录系统' : '注册并进入'
    }),
    [mode]
  );

  useEffect(() => {
    try {
      localStorage.setItem('clouddrive_login_theme', theme);
    } catch {
      // Ignore storage access errors.
    }
  }, [theme]);

  const resetMessages = () => {
    setError(null);
    setSuccess(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();

    const safeUsername = username.trim();
    if (!safeUsername || !password) {
      setError('请输入用户名和密码。');
      return;
    }

    if (mode === 'register') {
      if (password.length < 6) {
        setError('密码至少需要 6 位。');
        return;
      }
      if (password !== confirmPassword) {
        setError('两次输入的密码不一致。');
        return;
      }
      if (!inviteCode.trim()) {
        setError('请输入操作员邀请码。');
        return;
      }
    }

    setIsLoading(true);
    try {
      const session = mode === 'login'
        ? await login(safeUsername, password)
        : await registerUser({ username: safeUsername, password, role: 'operator', inviteCode: inviteCode.trim() });

      if (mode === 'register' && session.user.role === 'operator') {
        setAuthToken(inviteCode.trim());
      }

      setSuccess(mode === 'login' ? '登录成功。' : '注册成功。');
      onLoginSuccess(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : '请求失败，请稍后重试。');
    } finally {
      setIsLoading(false);
    }
  };

  const switchMode = (nextMode: 'login' | 'register') => {
    setMode(nextMode);
    resetMessages();
  };

  return (
    <div className="login-page min-h-screen overflow-hidden font-sans" data-theme={theme}>
      <div className="login-backdrop" />
      <div className="login-noise" />

      <header className="login-topbar">
        <button
          type="button"
          className="theme-toggle"
          onClick={() => setTheme(isDark ? 'light' : 'dark')}
          aria-label={isDark ? '切换到白天模式' : '切换到黑夜模式'}
          title={isDark ? '白天模式' : '黑夜模式'}
        >
          <ThemeIcon size={18} />
          <span>{isDark ? '白天' : '黑夜'}</span>
        </button>
      </header>

      <main className="login-stage">
        <section className="login-hero" aria-label="远程驾驶云控平台概览">
          <div className="hero-copy-block">
            <h1>车路云融合<br />远程驾驶</h1>
            <div className="hero-rule" />
            <p className="hero-copy">实时视频、车辆遥测与紧急接管一体化管理。</p>
          </div>

          <div className="route-map" aria-hidden="true">
            <div className="grid-plane" />
            <svg className="route-svg" viewBox="0 0 720 360" preserveAspectRatio="none">
              <path d="M92 292 L238 238 L350 274 L460 156 L616 70" />
              <circle cx="92" cy="292" r="13" />
              <circle cx="238" cy="238" r="13" />
              <circle cx="350" cy="274" r="13" />
              <circle cx="460" cy="156" r="13" />
              <circle className="active-node" cx="616" cy="70" r="13" />
            </svg>
            <span className="vehicle-dot"><Car size={22} /></span>
          </div>
        </section>

        <section className="access-panel" aria-label="操作员身份认证">
          <div className="panel-header">
            <div>
              <p className="section-kicker">{modeCopy.eyebrow}</p>
              <h2>{modeCopy.title}</h2>
              <p>{modeCopy.subtitle}</p>
            </div>
            <ShieldCheck size={42} />
          </div>

          <div className="mode-switch" role="tablist" aria-label="认证方式">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'login'}
              onClick={() => switchMode('login')}
            >
              登录
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'register'}
              onClick={() => switchMode('register')}
            >
              注册
            </button>
          </div>

          {error && <div className="auth-message error">{error}</div>}
          {success && <div className="auth-message success">{success}</div>}

          <form onSubmit={handleSubmit} className="auth-form">
            <label className="field-row">
              <User size={21} />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="用户名"
                autoComplete="username"
              />
            </label>

            <label className="field-row">
              <Lock size={21} />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="密码"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
            </label>

            {mode === 'register' && (
              <>
                <label className="field-row">
                  <Lock size={21} />
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="确认密码"
                    autoComplete="new-password"
                  />
                </label>

                <label className="field-row">
                  <KeyRound size={21} />
                  <input
                    type="password"
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value)}
                    placeholder="操作员邀请码"
                    autoComplete="one-time-code"
                  />
                </label>
              </>
            )}

            {mode === 'login' && (
              <div className="form-tools">
                <label>
                  <input type="checkbox" />
                  <span>记住我</span>
                </label>
                <button type="button">忘记密码？</button>
              </div>
            )}

            <button type="submit" disabled={isLoading} className="submit-button">
              {isLoading ? (
                <Loader2 className="animate-spin" size={22} />
              ) : (
                <>
                  <span>{modeCopy.submit}</span>
                  <ArrowRight size={22} />
                </>
              )}
            </button>
          </form>

          {mode === 'login' && (
            <p className="register-link">
              还没有账号？
              <button type="button" onClick={() => switchMode('register')}>立即注册</button>
            </p>
          )}

          {mode === 'login' && (
            <div className="capability-grid">
              {capabilityCards.map(({ icon: Icon, label }) => (
                <div className="capability-card" key={label}>
                  <Icon size={30} />
                  <span>{label}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
};
