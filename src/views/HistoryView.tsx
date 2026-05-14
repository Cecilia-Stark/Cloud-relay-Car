import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle, Clock, Download, FileX, PlayCircle, RefreshCw, Shield, User, Video } from 'lucide-react';
import { DriveSessionLog, DriveSessionRecord } from '../types';
import { createSessionDownloadUrl, createSessionVideoUrl, listDriveSessions } from '../services/sessionArchive';

interface ActiveSessionData {
  startTime: number;
  eventCount: number;
  operator: string;
}

interface HistoryViewProps {
  logs: DriveSessionLog[];
  activeSession?: ActiveSessionData;
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '--';
  const whole = Math.max(0, Math.round(seconds));
  const hrs = Math.floor(whole / 3600);
  const mins = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function formatDate(value: string | null): string {
  if (!value) return '--';
  return new Date(value).toLocaleString();
}

function formatSize(bytes: number): string {
  if (!bytes) return '无视频';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const HistoryView: React.FC<HistoryViewProps> = ({ logs, activeSession }) => {
  const [currentDuration, setCurrentDuration] = useState('00:00:00');
  const [sessions, setSessions] = useState<DriveSessionRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openingVideo, setOpeningVideo] = useState<string | null>(null);
  const localLogCount = logs.length;

  const completedCount = useMemo(
    () => sessions.filter((session) => session.status === 'completed').length,
    [sessions]
  );

  const eventCount = useMemo(
    () => sessions.reduce((sum, session) => sum + session.events, 0),
    [sessions]
  );

  const loadSessions = async () => {
    setIsLoading(true);
    setError(null);
    try {
      setSessions(await listDriveSessions());
    } catch (err) {
      setError(err instanceof Error ? err.message : '历史记录加载失败。');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSessions();
  }, []);

  const openVideo = async (sessionId: string, disposition: 'inline' | 'download') => {
    setOpeningVideo(`${sessionId}:${disposition}`);
    setError(null);
    try {
      const url = disposition === 'download'
        ? await createSessionDownloadUrl(sessionId)
        : await createSessionVideoUrl(sessionId);

      if (disposition === 'download') {
        window.location.assign(url);
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '视频链接创建失败。');
    } finally {
      setOpeningVideo(null);
    }
  };

  useEffect(() => {
    if (!activeSession?.startTime) return;

    const timer = setInterval(() => {
      const diff = Date.now() - activeSession.startTime;
      const hrs = Math.floor(diff / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      setCurrentDuration(`${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
    }, 1000);

    return () => clearInterval(timer);
  }, [activeSession]);

  return (
    <div className="p-5 lg:p-8 min-h-full text-white space-y-6">
      <div className="glass-panel rounded-xl p-5 lg:p-6 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <div className="text-[10px] text-slate-500 font-mono tracking-[0.28em]">SESSION ARCHIVE</div>
          <h2 className="mt-1 text-2xl font-black tracking-wide">驾驶数据归档</h2>
          <p className="mt-2 text-sm text-slate-400">接管会话、视频回放、异常事件和下载入口集中管理。</p>
          {localLogCount > 0 && (
            <p className="mt-2 text-xs text-slate-500">{localLogCount} 条本地缓存日志</p>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 min-w-[86px]">
            <div className="text-2xl font-mono font-black text-cyan-200">{sessions.length}</div>
            <div className="text-[10px] text-slate-500">总归档数</div>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 min-w-[86px]">
            <div className="text-2xl font-mono font-black text-red-300">{eventCount}</div>
            <div className="text-[10px] text-slate-500">异常总数</div>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 min-w-[86px]">
            <div className="text-2xl font-mono font-black text-emerald-300">{completedCount}</div>
            <div className="text-[10px] text-slate-500">已完成</div>
          </div>
        </div>
      </div>

      {activeSession && activeSession.startTime > 0 && (
        <div className="glass-panel rounded-xl border-cyan-300/20 p-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <Clock size={120} />
          </div>

          <h3 className="text-xl font-bold text-cyan-200 mb-6 flex items-center gap-2">
            <span className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
            当前会话录制中
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative z-10">
            <div className="bg-white/[0.04] p-4 rounded-lg border border-white/10">
              <div className="flex items-center gap-2 text-gray-400 mb-2">
                <Clock size={16} />
                <span className="text-xs uppercase">已用时间</span>
              </div>
              <div className="text-3xl font-mono font-bold text-white tracking-widest">{currentDuration}</div>
            </div>

            <div className="bg-white/[0.04] p-4 rounded-lg border border-white/10">
              <div className="flex items-center gap-2 text-gray-400 mb-2">
                <Shield size={16} />
                <span className="text-xs uppercase">检测到异常</span>
              </div>
              <div className={`text-3xl font-mono font-bold ${activeSession.eventCount > 0 ? 'text-red-500' : 'text-green-500'}`}>
                {activeSession.eventCount}
              </div>
            </div>

            <div className="bg-white/[0.04] p-4 rounded-lg border border-white/10">
              <div className="flex items-center gap-2 text-gray-400 mb-2">
                <User size={16} />
                <span className="text-xs uppercase">操作员</span>
              </div>
              <div className="text-xl font-bold text-cyan-100 truncate">{activeSession.operator}</div>
            </div>
          </div>
        </div>
      )}

      <div className="glass-panel rounded-xl p-5 lg:p-6">
        <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-3 mb-4">
          <h2 className="text-lg font-bold text-slate-200">历史记录归档</h2>
          <button
            onClick={loadSessions}
            disabled={isLoading}
            className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-slate-200 hover:bg-white/[0.08] disabled:opacity-50"
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
            刷新
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        )}

        {sessions.length === 0 ? (
          <div className="text-center py-12 text-slate-500 bg-white/[0.03] rounded-lg border border-white/10 border-dashed">
            <Video size={42} className="mx-auto mb-3 text-slate-600" />
            <p className="text-lg text-slate-300">{isLoading ? '正在加载历史记录...' : '暂无视频归档记录'}</p>
            <p className="text-sm mt-2">结束接管后，视频文件会自动保存到服务器并显示在这里。</p>
          </div>
        ) : (
          <div className="rounded-lg overflow-hidden shadow-xl border border-white/10">
            <table className="w-full text-left text-sm md:text-base">
              <thead className="bg-white/[0.06] text-slate-300">
                <tr>
                  <th className="p-4">会话 ID</th>
                  <th className="p-4 hidden md:table-cell">开始时间</th>
                  <th className="p-4 hidden lg:table-cell">时长</th>
                  <th className="p-4">视频</th>
                  <th className="p-4">状态</th>
                  <th className="p-4">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10 bg-slate-950/30">
                {sessions.map((session) => {
                  const hasVideo = session.videoSize > 0 && session.status === 'completed';
                  return (
                    <tr key={session.id} className="hover:bg-cyan-400/[0.06] transition-colors">
                      <td className="p-4">
                        <div className="font-mono text-cyan-200">{session.id}</div>
                        <div className="mt-1 text-xs text-slate-500">{session.operator}</div>
                      </td>
                      <td className="p-4 hidden md:table-cell text-slate-400">{formatDate(session.startTime)}</td>
                      <td className="p-4 hidden lg:table-cell text-slate-400 font-mono">{formatDuration(session.durationSeconds)}</td>
                      <td className="p-4">
                        <div className="text-xs text-slate-300">{formatSize(session.videoSize)}</div>
                        {session.events > 0 && (
                          <span className="mt-1 inline-flex bg-red-900/50 text-red-300 px-2 py-1 rounded text-xs border border-red-800">
                            {session.events} 个异常
                          </span>
                        )}
                      </td>
                      <td className="p-4">
                        <span className={`px-2 py-1 rounded text-xs flex w-fit items-center gap-1 ${session.status === 'completed' ? 'bg-green-900/50 text-green-200 border border-green-800' : 'bg-amber-900/50 text-amber-100 border border-amber-700'}`}>
                          {session.status === 'completed' ? <CheckCircle size={12} /> : <FileX size={12} />}
                          {session.status === 'completed' ? '已完成' : session.status === 'recording' ? '录制中' : '录制异常'}
                        </span>
                      </td>
                      <td className="p-4 flex gap-2">
                        <button
                          type="button"
                          className={`w-8 h-8 rounded-md border border-white/10 bg-white/[0.03] transition-colors flex items-center justify-center ${hasVideo ? 'text-cyan-300 hover:text-white hover:bg-cyan-400/12' : 'text-slate-600 pointer-events-none'}`}
                          disabled={!hasVideo || openingVideo === `${session.id}:inline`}
                          onClick={() => openVideo(session.id, 'inline')}
                          title="播放视频"
                        >
                          <PlayCircle size={18} />
                        </button>
                        <button
                          type="button"
                          className={`w-8 h-8 rounded-md border border-white/10 bg-white/[0.03] transition-colors flex items-center justify-center ${hasVideo ? 'text-slate-300 hover:text-white hover:bg-white/10' : 'text-slate-600 pointer-events-none'}`}
                          disabled={!hasVideo || openingVideo === `${session.id}:download`}
                          onClick={() => openVideo(session.id, 'download')}
                          title="下载视频"
                        >
                          <Download size={18} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
