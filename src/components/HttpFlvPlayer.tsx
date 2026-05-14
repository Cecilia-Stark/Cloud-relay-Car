import React, { useEffect, useRef, useState } from 'react';
import { Radio, VideoOff } from 'lucide-react';

interface HttpFlvPlayerProps {
  label: string;
  src: string;
  className?: string;
}

interface SrsPlayResponse {
  code: number;
  sdp?: string;
  sessionid?: string;
  server?: string;
}

const CONNECT_TIMEOUT_MS = 7000;
const RETRY_DELAY_MS = 1200;
const STALL_TIMEOUT_MS = 4500;
const TARGET_PLAYOUT_DELAY_SECONDS = 0.08;
const STATS_INTERVAL_MS = 1000;
const MAX_JITTER_BUFFER_DELAY_SECONDS = 0.24;
const MAX_HIGH_DELAY_SAMPLES = 2;

function buildSrsRtcUrls(src: string) {
  const sourceUrl = new URL(src, window.location.href);
  const streamPath = sourceUrl.pathname.replace(/^\/+/, '').replace(/\.flv$/i, '');
  const streamHost = sourceUrl.hostname || window.location.hostname || '8.149.246.34';
  const apiUrl =
    import.meta.env.VITE_SRS_WEBRTC_API ||
    `${sourceUrl.protocol || window.location.protocol}//${streamHost}:1985/rtc/v1/play/`;

  return {
    apiUrl,
    streamUrl: src.startsWith('webrtc://') ? src : `webrtc://${streamHost}/${streamPath}`
  };
}

function tuneReceiverForLowLatency(receiver: RTCRtpReceiver) {
  const lowLatencyReceiver = receiver as RTCRtpReceiver & {
    playoutDelayHint?: number;
  };

  if ('playoutDelayHint' in lowLatencyReceiver) {
    lowLatencyReceiver.playoutDelayHint = TARGET_PLAYOUT_DELAY_SECONDS;
  }
}

export const HttpFlvPlayer: React.FC<HttpFlvPlayerProps> = ({ label, src, className = '' }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const [hasError, setHasError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const abortController = new AbortController();
    let retryTimer: number | undefined;
    let connectTimer: number | undefined;
    let stallTimer: number | undefined;
    let statsTimer: number | undefined;
    let videoFrameCallback = 0;
    let lastFrameAt = Date.now();
    let lastJitterBufferDelay = 0;
    let lastJitterBufferEmittedCount = 0;
    let highDelaySamples = 0;
    let closed = false;

    const cleanupPeer = () => {
      peerRef.current?.close();
      peerRef.current = null;
      video.srcObject = null;
    };

    const scheduleRetry = () => {
      if (closed) return;
      if (retryTimer) return;
      setHasError(true);
      cleanupPeer();
      retryTimer = window.setTimeout(() => setRetryCount((count) => count + 1), RETRY_DELAY_MS);
    };

    const markFrame = () => {
      lastFrameAt = Date.now();
    };

    const frameWatcher = () => {
      markFrame();
      const frameVideo = video as HTMLVideoElement & {
        requestVideoFrameCallback?: (callback: () => void) => number;
      };
      videoFrameCallback = frameVideo.requestVideoFrameCallback?.(frameWatcher) || 0;
    };

    const watchReceiverStats = async (peer: RTCPeerConnection) => {
      try {
        const stats = await peer.getStats();
        stats.forEach((report) => {
          if (report.type !== 'inbound-rtp' || report.kind !== 'video') return;

          const jitterBufferDelay = Number(report.jitterBufferDelay || 0);
          const jitterBufferEmittedCount = Number(report.jitterBufferEmittedCount || 0);
          const delayDelta = jitterBufferDelay - lastJitterBufferDelay;
          const frameDelta = jitterBufferEmittedCount - lastJitterBufferEmittedCount;

          lastJitterBufferDelay = jitterBufferDelay;
          lastJitterBufferEmittedCount = jitterBufferEmittedCount;

          if (frameDelta <= 0) return;

          const averageDelay = delayDelta / frameDelta;
          if (averageDelay > MAX_JITTER_BUFFER_DELAY_SECONDS) {
            highDelaySamples += 1;
          } else {
            highDelaySamples = 0;
          }

          if (highDelaySamples >= MAX_HIGH_DELAY_SAMPLES) {
            scheduleRetry();
          }
        });
      } catch {
        // getStats can fail while the peer is closing; the connection watcher will handle recovery.
      }
    };

    const play = async () => {
      setHasError(false);
      cleanupPeer();

      if (!window.RTCPeerConnection) {
        scheduleRetry();
        return;
      }

      const { apiUrl, streamUrl } = buildSrsRtcUrls(src);
      const peer = new RTCPeerConnection({
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
        iceCandidatePoolSize: 1
      });

      peerRef.current = peer;
      const videoTransceiver = peer.addTransceiver('video', { direction: 'recvonly' });
      tuneReceiverForLowLatency(videoTransceiver.receiver);

      peer.ontrack = (event) => {
        tuneReceiverForLowLatency(event.receiver);
        if (video.srcObject !== event.streams[0]) {
          video.srcObject = event.streams[0];
        }
        markFrame();
        video.play().catch(() => {
          video.muted = true;
          video.play().catch(scheduleRetry);
        });
      };

      peer.onconnectionstatechange = () => {
        if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') {
          scheduleRetry();
        }
      };

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);

      connectTimer = window.setTimeout(() => abortController.abort(), CONNECT_TIMEOUT_MS);
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api: apiUrl,
          streamurl: streamUrl,
          sdp: offer.sdp
        }),
        signal: abortController.signal
      });
      if (connectTimer) window.clearTimeout(connectTimer);

      if (!response.ok) {
        throw new Error(`SRS WebRTC play failed: ${response.status}`);
      }

      const data = (await response.json()) as SrsPlayResponse;
      if (data.code !== 0 || !data.sdp) {
        throw new Error(`SRS WebRTC play rejected: ${data.code}`);
      }

      await peer.setRemoteDescription({ type: 'answer', sdp: data.sdp });
      peer.getReceivers().forEach(tuneReceiverForLowLatency);
      statsTimer = window.setInterval(() => watchReceiverStats(peer), STATS_INTERVAL_MS);
    };

    video.addEventListener('loadeddata', markFrame);
    video.addEventListener('playing', markFrame);
    video.addEventListener('timeupdate', markFrame);

    const frameVideo = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (callback: () => void) => number;
    };
    videoFrameCallback = frameVideo.requestVideoFrameCallback?.(frameWatcher) || 0;

    stallTimer = window.setInterval(() => {
      if (video.srcObject && Date.now() - lastFrameAt > STALL_TIMEOUT_MS) {
        scheduleRetry();
      }
    }, 1000);

    play().catch((error) => {
      if (closed && abortController.signal.aborted) return;
      console.warn('WebRTC stream disconnected.', error);
      scheduleRetry();
    });

    return () => {
      closed = true;
      abortController.abort();
      if (retryTimer) window.clearTimeout(retryTimer);
      if (connectTimer) window.clearTimeout(connectTimer);
      if (stallTimer) window.clearInterval(stallTimer);
      if (statsTimer) window.clearInterval(statsTimer);
      const frameVideo = video as HTMLVideoElement & {
        cancelVideoFrameCallback?: (handle: number) => void;
      };
      if (videoFrameCallback) frameVideo.cancelVideoFrameCallback?.(videoFrameCallback);
      video.removeEventListener('loadeddata', markFrame);
      video.removeEventListener('playing', markFrame);
      video.removeEventListener('timeupdate', markFrame);
      cleanupPeer();
    };
  }, [retryCount, src]);

  return (
    <div className={`relative min-h-[180px] overflow-hidden bg-slate-950 ${className}`}>
      <video ref={videoRef} className="h-full w-full object-cover" muted autoPlay playsInline preload="none" />
      {hasError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/85 text-slate-300">
          <VideoOff size={36} className="text-red-400" />
          <div className="text-sm font-semibold">WebRTC stream disconnected</div>
          <button
            type="button"
            onClick={() => setRetryCount((count) => count + 1)}
            className="rounded-md border border-red-400/40 bg-red-500/20 px-4 py-2 text-xs font-bold text-red-100"
          >
            Reconnect
          </button>
        </div>
      )}
      <div className="absolute left-3 top-3 rounded border border-white/10 bg-black/70 px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-cyan-100">
        {label}
      </div>
      <div className="absolute right-3 top-3 rounded-full border border-white/10 bg-black/70 p-2 text-cyan-100">
        <Radio size={14} />
      </div>
    </div>
  );
};
