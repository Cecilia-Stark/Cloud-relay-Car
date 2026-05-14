import React, { useEffect, useRef, useState } from 'react';

interface SrsWebRtcPlayerProps {
  label: string;
  streamUrl: string;
  apiUrl: string;
  className?: string;
}

export const SrsWebRtcPlayer: React.FC<SrsWebRtcPlayerProps> = ({
  label,
  streamUrl,
  apiUrl,
  className = '',
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const connect = async () => {
      setStatus('connecting');
      setError('');

      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });
      pcRef.current = pc;

      pc.addTransceiver('video', { direction: 'recvonly' });
      pc.addTransceiver('audio', { direction: 'recvonly' });

      pc.ontrack = (event) => {
        if (!videoRef.current || cancelled) return;
        const [stream] = event.streams;
        if (stream) {
          videoRef.current.srcObject = stream;
          setStatus('connected');
        }
      };

      pc.onconnectionstatechange = () => {
        if (cancelled) return;
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
          setStatus('error');
          setError('流媒体连接已断开');
        }
      };

      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api: apiUrl,
            streamurl: streamUrl,
            sdp: offer.sdp,
          }),
        });

        if (!response.ok) {
          throw new Error(`SRS API ${response.status}`);
        }

        const data = await response.json();
        if (data.code !== 0) {
          throw new Error(data.msg || 'SRS 播放失败');
        }

        await pc.setRemoteDescription(new RTCSessionDescription({
          type: 'answer',
          sdp: data.sdp,
        }));
      } catch (err) {
        if (!cancelled) {
          setStatus('error');
          setError(err instanceof Error ? err.message : '无法连接全景视频流');
        }
        pc.close();
      }
    };

    connect();

    return () => {
      cancelled = true;
      if (videoRef.current) videoRef.current.srcObject = null;
      pcRef.current?.close();
      pcRef.current = null;
    };
  }, [apiUrl, retry, streamUrl]);

  const isConnected = status === 'connected';

  return (
    <div className={`relative bg-black overflow-hidden border border-gray-800 flex flex-col ${className}`}>
      <div className="absolute top-2 left-2 z-20 flex items-center gap-2 bg-black/60 backdrop-blur-sm px-3 py-1.5 rounded border border-white/10">
        <div className={`w-2 h-2 rounded-full shadow-[0_0_8px_currentColor] ${
          isConnected ? 'bg-green-500 animate-pulse text-green-500' : 'bg-red-500 text-red-500'
        }`} />
        <span className="text-[10px] text-white font-mono tracking-wider opacity-80">{label}</span>
      </div>

      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="w-full h-full object-cover bg-gray-900"
      />

      {status === 'connecting' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 z-10">
          <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-3"></div>
          <span className="text-blue-400 text-xs font-mono">全景视频连接中...</span>
        </div>
      )}

      {status === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-10 px-6 text-center">
          <div className="text-red-500 text-sm font-mono mb-2">全景视频未接入</div>
          <div className="text-gray-500 text-[10px] font-mono mb-4">{error || '等待 4G 摄像头推流'}</div>
          <button
            onClick={() => setRetry((value) => value + 1)}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-mono rounded border border-red-400"
          >
            重新连接
          </button>
        </div>
      )}

      <div className="absolute inset-0 pointer-events-none opacity-10 bg-[linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:40px_40px]"></div>
    </div>
  );
};
