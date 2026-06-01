import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Car, Eye, Keyboard, LogOut, Moon, ShieldCheck, Sun } from 'lucide-react';
import { vehicleService } from './services/vehicleConnection';
import { AuthSession, clearStoredSession, getStoredSession, validateStoredSession } from './services/auth';
import { AuthenticatedUser, DriveSessionLog, VehicleStatus, VehicleTelemetry, ViewMode } from './types';
import { ControlView } from './views/ControlView';
import { HistoryView } from './views/HistoryView';
import { LoginView } from './views/LoginView';
import { MonitorView } from './views/MonitorView';

const roleMeta = {
  operator: {
    label: '操作员',
    description: '可接管、可控制、可结束接管',
    icon: ShieldCheck,
    badgeClass: 'bg-emerald-500/15 text-emerald-200 border-emerald-400/30'
  },
  dispatcher: {
    label: '观察员',
    description: '只读查看视频、地图和回放',
    icon: Eye,
    badgeClass: 'bg-slate-500/15 text-slate-200 border-slate-400/30'
  },
  viewer: {
    label: '观察员',
    description: '只读查看视频、地图和回放',
    icon: Eye,
    badgeClass: 'bg-slate-500/15 text-slate-200 border-slate-400/30'
  }
};

const operatorKeyHelpItems = [
  { key: 'G', action: '启动远程接管，进入驾驶舱并开始录制视频' },
  { key: 'A', action: '在主视角和广角摄像头之间切换' },
  { key: 'M', action: '停止远程接管，结束录制并归档' }
];

const readonlyKeyHelpItems = [
  { key: '只读', action: '当前身份不能发送接管或车辆控制指令' },
  { key: '历史', action: '可查看已归档的接管记录和视频回放' },
  { key: '监控', action: '可查看实时视频、地图和遥测数据' }
];

function getInitialViewMode(user: AuthenticatedUser): ViewMode {
  return user.role === 'viewer' ? 'HISTORY' : 'MONITOR';
}

type AppTheme = 'dark' | 'light';

function getInitialTheme(): AppTheme {
  try {
    const saved = localStorage.getItem('clouddrive_login_theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // Ignore storage access errors.
  }
  return 'dark';
}

const App: React.FC = () => {
  const [authChecked, setAuthChecked] = useState(false);
  const [currentUser, setCurrentUser] = useState<AuthenticatedUser | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('LOGIN');
  const [telemetry, setTelemetry] = useState<VehicleTelemetry | null>(null);
  const [showKeyHelp, setShowKeyHelp] = useState(false);
  const [theme, setTheme] = useState<AppTheme>(getInitialTheme);
  const [activeSessionStats, setActiveSessionStats] = useState({ startTime: 0, eventCount: 0 });

  const [historyLogs, setHistoryLogs] = useState<DriveSessionLog[]>(() => {
    const saved = localStorage.getItem('drive_history_logs');
    return saved ? JSON.parse(saved) : [];
  });

  const sessionStartTimeRef = useRef<number>(0);
  const sessionEventCountRef = useRef<number>(0);
  const controlStartTimeRef = useRef<number>(0);
  const lastStatusRef = useRef<VehicleStatus>(VehicleStatus.NORMAL);
  const viewModeRef = useRef<ViewMode>(viewMode);
  const telemetryBufferRef = useRef<VehicleTelemetry[]>([]);

  const canControl = currentUser?.role === 'operator';
  const roleInfo = currentUser ? roleMeta[currentUser.role] : null;
  const RoleIcon = roleInfo?.icon || ShieldCheck;
  const ThemeIcon = theme === 'dark' ? Sun : Moon;

  const keyHelpItems = useMemo(
    () => canControl ? operatorKeyHelpItems : readonlyKeyHelpItems,
    [canControl]
  );

  useEffect(() => {
    validateStoredSession()
      .then((session) => {
        if (session?.user) {
          setCurrentUser(session.user);
          setViewMode(getInitialViewMode(session.user));
          sessionStartTimeRef.current = Date.now();
          setActiveSessionStats({ startTime: sessionStartTimeRef.current, eventCount: 0 });
        }
      })
      .finally(() => setAuthChecked(true));
  }, []);

  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

  useEffect(() => {
    try {
      localStorage.setItem('clouddrive_login_theme', theme);
    } catch {
      // Ignore storage access errors.
    }
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('drive_history_logs', JSON.stringify(historyLogs));
  }, [historyLogs]);

  const handleLoginSuccess = (session: AuthSession) => {
    setCurrentUser(session.user);
    setViewMode(getInitialViewMode(session.user));
    sessionStartTimeRef.current = Date.now();
    sessionEventCountRef.current = 0;
    setActiveSessionStats({ startTime: sessionStartTimeRef.current, eventCount: 0 });
    lastStatusRef.current = VehicleStatus.NORMAL;
  };

  const handleLogout = () => {
    clearStoredSession();
    setCurrentUser(null);
    setViewMode('LOGIN');
    setTelemetry(null);
    setActiveSessionStats({ startTime: 0, eventCount: 0 });
    telemetryBufferRef.current = [];
    vehicleService.disconnect();
  };

  const handleStartControl = useCallback(async () => {
    if (!canControl) return;

    telemetryBufferRef.current = [];
    sessionEventCountRef.current = 0;
    setActiveSessionStats((prev) => ({ ...prev, eventCount: 0 }));

    try {
      await vehicleService.triggerManualTakeover();
    } catch (err) {
      console.warn('接管请求接口暂不可用，先进入本地接管状态:', err);
    }
    controlStartTimeRef.current = Date.now();
    setViewMode('CONTROL');
  }, [canControl]);

  const handleExitControl = useCallback(async () => {
    if (!canControl) return;

    vehicleService.triggerControlRelease();

    const endTime = Date.now();
    const startTime = controlStartTimeRef.current || sessionStartTimeRef.current;
    const durationSeconds = (endTime - startTime) / 1000;
    const eventCount = sessionEventCountRef.current > 0 ? sessionEventCountRef.current : 1;

    const sessionId = `LOCAL_${Date.now().toString().slice(-8)}`;

    const newLog: DriveSessionLog = {
      id: sessionId,
      startTime: new Date(startTime).toLocaleString(),
      endTime: new Date(endTime).toLocaleString(),
      operator: currentUser?.username || 'operator',
      events: eventCount,
      status: 'Completed',
      telemetrySamples: telemetryBufferRef.current.slice()
    };

    setHistoryLogs((prev) => [newLog, ...prev]);

    try {
      const host = window.location.hostname || 'localhost';
      const replayUrl = `${window.location.protocol}//${host}:9001/logs`;
      const token = getStoredSession()?.token;
      fetch(replayUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(newLog)
      }).catch((err) => console.warn('无法推送回放到 replay-server', err));
    } catch {
      // ignore network/storage issues
    }

    sessionEventCountRef.current = 0;
    telemetryBufferRef.current = [];
    setActiveSessionStats((prev) => ({ ...prev, eventCount: 0 }));

    alert(`接管结束。\n持续时间: ${durationSeconds.toFixed(1)}秒\n本次数据与视频已归档。`);
    setViewMode('MONITOR');
  }, [canControl, currentUser?.username]);

  useEffect(() => {
    if (!currentUser) return;

    console.log('正在订阅遥测数据...');
    vehicleService.connect();

    const unsubscribe = vehicleService.subscribe((data) => {
      setTelemetry(data);

      if (viewModeRef.current === 'CONTROL') {
        telemetryBufferRef.current.push(data);
      }

      if (data.status === VehicleStatus.CRITICAL && lastStatusRef.current !== VehicleStatus.CRITICAL) {
        sessionEventCountRef.current += 1;
        setActiveSessionStats((prev) => ({ ...prev, eventCount: sessionEventCountRef.current }));
        console.warn('记录事件: 检测到异常');
      }
      lastStatusRef.current = data.status;

    });

    return () => {
      unsubscribe();
      vehicleService.disconnect();
    };
  }, [currentUser, canControl, handleStartControl]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!canControl) return;
      if (e.repeat) return;

      const active = document.activeElement && (document.activeElement as HTMLElement).tagName;
      if (active === 'INPUT' || active === 'TEXTAREA' || active === 'SELECT' || active === 'BUTTON') return;

      const key = e.key.toLowerCase();
      if (key === 'g') {
        e.preventDefault();
        if (viewModeRef.current !== 'CONTROL') handleStartControl();
      }
      if (key === 'm') {
        e.preventDefault();
        if (viewModeRef.current === 'CONTROL') handleExitControl();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [canControl, handleExitControl, handleStartControl]);

  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#050510] text-blue-300">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
          <span className="font-tech text-lg tracking-widest">正在验证登录状态...</span>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return <LoginView onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="app-shell flex flex-col h-screen overflow-hidden font-sans" data-theme={theme}>
      <div className="app-topbar h-16 backdrop-blur-md flex items-center justify-between px-6 shrink-0 z-50 shadow-lg">
        <div className="flex items-center gap-3 min-w-0">
          <div className="app-brand-mark w-8 h-8 rounded flex items-center justify-center shrink-0">
            <Car className="text-white" size={20} />
          </div>
          <div className="min-w-0">
            <h1 className="app-brand-title font-tech text-xl font-bold tracking-wider leading-none truncate">
              车路云融合远程驾驶
            </h1>
            <span className="app-brand-subtitle text-[10px] font-mono tracking-widest block mt-0.5">5G 远程驾驶控制平台</span>
            <span className="text-[10px] text-gray-500 font-mono tracking-widest block mt-0.5">5G 远程驾驶云控平台</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
            className="app-theme-button hidden sm:flex items-center gap-2 px-3 py-2 rounded-md text-sm font-tech font-bold transition-all"
            title={theme === 'dark' ? '白天模式' : '黑夜模式'}
          >
            <ThemeIcon size={16} /> {theme === 'dark' ? '白天' : '黑夜'}
          </button>

          <div className={`app-role-badge hidden md:flex items-center gap-2 border px-3 py-1.5 rounded-md ${roleInfo?.badgeClass}`}>
            <RoleIcon size={15} />
            <span className="text-xs font-bold">{currentUser.username}</span>
            <span className="text-[10px] opacity-70">{roleInfo?.label}</span>
          </div>

          <div className="app-tabs flex rounded-md overflow-hidden">
            <button
              onClick={() => setViewMode('MONITOR')}
              data-label="监控"
              className={`app-tab px-3 py-2 text-xs md:text-sm rounded-none ${viewMode === 'MONITOR' ? 'is-active' : ''}`}
            >
              监控
            </button>
            <button
              onClick={() => setViewMode('HISTORY')}
              data-label="历史"
              className={`app-tab px-3 py-2 text-xs md:text-sm rounded-none ${viewMode === 'HISTORY' ? 'is-active' : ''}`}
            >
              历史
            </button>
          </div>

          <button
            onClick={() => setShowKeyHelp(true)}
            data-label="按键"
            className="app-action-button key-help-button hidden sm:flex items-center gap-2 px-3 py-2 rounded-md text-sm font-tech font-bold transition-all"
          >
            <Keyboard size={16} /> 按键
          </button>

          <button
            onClick={handleLogout}
            data-label="退出"
            className="app-logout-button flex items-center gap-2 px-3 py-2 rounded-md text-sm font-bold transition-all"
          >
            <LogOut size={16} /> 退出
          </button>
        </div>
      </div>

      <div className="app-main flex-1 overflow-auto relative">
        {!telemetry && viewMode !== 'HISTORY' ? (
          <div className="flex h-full flex-col items-center justify-center text-blue-400 gap-4">
            <div className="w-12 h-12 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
            <span className="font-tech text-xl tracking-widest">正在建立 V2X 连接...</span>
          </div>
        ) : (
          <>
            {viewMode === 'MONITOR' && telemetry && (
              <MonitorView
                telemetry={telemetry}
                onTakeover={handleStartControl}
                canTakeover={canControl}
                roleLabel={roleInfo?.label || ''}
              />
            )}
            {viewMode === 'CONTROL' && telemetry && canControl && (
              <ControlView
                telemetry={telemetry}
                onExitControl={handleExitControl}
              />
            )}
            {viewMode === 'CONTROL' && !canControl && (
              <div className="h-full flex items-center justify-center text-slate-300">
                当前身份为{roleInfo?.label}，不能进入远程驾驶控制舱。
              </div>
            )}
            {viewMode === 'HISTORY' && (
              <HistoryView
                logs={historyLogs}
                activeSession={{
                  startTime: activeSessionStats.startTime,
                  eventCount: activeSessionStats.eventCount,
                  operator: currentUser.username
                }}
              />
            )}
          </>
        )}
      </div>

      {showKeyHelp && (
        <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center px-4">
          <div className="w-full max-w-lg bg-[#0a0a16] border border-blue-500/30 rounded-xl shadow-[0_0_50px_rgba(37,99,235,0.25)] p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-9 h-9 rounded bg-blue-600 flex items-center justify-center">
                <Keyboard size={20} />
              </div>
              <div>
                <h2 className="text-xl font-tech font-bold text-white">权限与快捷操作</h2>
                <p className="text-xs text-gray-500 mt-1">{roleInfo?.description}</p>
              </div>
            </div>

            <div className="space-y-3">
              {keyHelpItems.map((item) => (
                <div key={item.key} className="flex items-center gap-4 bg-black/35 border border-white/10 rounded-lg px-4 py-3">
                  <div className="w-12 h-12 rounded-md bg-white/10 border border-white/15 flex items-center justify-center text-sm font-bold text-blue-200 font-mono">
                    {item.key}
                  </div>
                  <div className="text-sm text-gray-200">{item.action}</div>
                </div>
              ))}
            </div>

            <div className="flex justify-center mt-6">
              <button
                onClick={() => setShowKeyHelp(false)}
                className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-2 rounded-md text-sm font-bold transition-colors"
              >
                已知晓
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
