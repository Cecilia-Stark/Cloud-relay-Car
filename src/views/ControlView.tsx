import React, { useEffect, useState } from 'react';
import { Save, Settings, Wifi } from 'lucide-react';
import { HttpFlvPlayer } from '../components/HttpFlvPlayer';
import { MapContainer } from '../components/MapContainer';
import { createRelayConnectionUrl } from '../services/auth';
import { getCarIp, setCarIp } from '../services/carControl';
import { VehicleTelemetry } from '../types';

interface ControlViewProps {
  telemetry: VehicleTelemetry;
  onExitControl: () => void;
}

interface G29State {
  status: 'connected' | 'disconnected' | 'error';
  steering: number;
  throttle: number;
  brake: number;
  message: string;
}

type ControlTheme = 'dark' | 'light';

function getInitialTheme(): ControlTheme {
  try {
    const saved = localStorage.getItem('clouddrive_login_theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // Ignore storage access errors.
  }
  return 'dark';
}

export const ControlView: React.FC<ControlViewProps> = ({ telemetry }) => {
  const [g29Data, setG29Data] = useState<G29State>({
    status: 'disconnected',
    steering: 0,
    throttle: 0,
    brake: 0,
    message: ''
  });
  const [showSettings, setShowSettings] = useState(false);
  const [carIpInput, setCarIpInput] = useState(getCarIp());
  const [cameraMode, setCameraMode] = useState<'main' | 'wide'>('main');
  const [theme, setTheme] = useState<ControlTheme>(getInitialTheme);

  const streamHost = import.meta.env.VITE_STREAM_HOST || window.location.hostname || '8.149.246.34';
  const carCameraUrl = import.meta.env.VITE_CAR_CAMERA_URL || `/live/car.flv`;
  const wideCameraUrl = import.meta.env.VITE_WIDE_CAMERA_URL || carCameraUrl;
  const roadsideCameraUrl = import.meta.env.VITE_ROADSIDE_CAMERA_URL || `/live/car_front.flv`;
  const steeringProgress = Math.min(100, Math.abs(g29Data.steering) / 450 * 100);

  const relayControlUrl = () => {
    const serverHost = window.location.hostname || streamHost || '8.149.246.34';
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
    return `${protocol}//${serverHost}:8083/relay-control`;
  };

  const postRelayControl = (action: 'enable' | 'disable', token: string, keepalive = false) => {
    return fetch(relayControlUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ action }),
      keepalive
    });
  };

  useEffect(() => {
    const readTheme = () => setTheme(getInitialTheme());
    window.addEventListener('storage', readTheme);
    window.addEventListener('focus', readTheme);
    return () => {
      window.removeEventListener('storage', readTheme);
      window.removeEventListener('focus', readTheme);
    };
  }, []);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let relayToken = '';
    let cancelled = false;

    async function connectRelay() {
      try {
        const wsUrl = await createRelayConnectionUrl();
        if (cancelled) return;

        relayToken = new URL(wsUrl).searchParams.get('relayToken') || '';
        if (relayToken) {
          await postRelayControl('enable', relayToken);
        }
        if (cancelled) return;

        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          setG29Data((prev) => ({ ...prev, status: 'connected', message: '' }));
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.status === 'disconnected' || data.status === 'error') {
              setG29Data((prev) => ({ ...prev, status: data.status, message: data.message || 'Disconnected' }));
              return;
            }

            setG29Data({
              status: 'connected',
              steering: Number(data.steering || 0),
              throttle: Number(data.throttle || 0),
              brake: Number(data.brake || 0),
              message: data.relayEnabled ? '' : 'Relay paused until takeover is enabled.'
            });
          } catch {
            console.warn('Received invalid G29 data.');
          }
        };

        ws.onerror = () => {
          setG29Data((prev) => ({ ...prev, status: 'error', message: 'Unable to connect to G29 relay.' }));
        };

        ws.onclose = () => {
          if (!cancelled) {
            setG29Data((prev) => ({ ...prev, status: 'error', message: 'G29 relay disconnected.' }));
          }
        };
      } catch (error) {
        console.error('G29 relay setup failed:', error);
        setG29Data((prev) => ({ ...prev, status: 'error', message: 'Unable to authorize G29 relay.' }));
      }
    }

    connectRelay();

    return () => {
      cancelled = true;
      ws?.close();
      if (relayToken) {
        postRelayControl('disable', relayToken, true).catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.repeat) return;
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName;
      if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || tagName === 'BUTTON') return;
      if (event.key.toLowerCase() === 'a') {
        event.preventDefault();
        setCameraMode((mode) => (mode === 'main' ? 'wide' : 'main'));
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const steeringStyle = {
    transform: `rotate(${g29Data.steering}deg)`,
    transition: 'transform 0.05s linear'
  };

  return (
    <div className="control-theme flex flex-col h-full overflow-hidden font-tech" data-theme={theme}>
      <div className="control-layout flex-1 flex min-h-0 relative">
        <div className="control-side-panel w-[20%] flex flex-col relative z-20">
          <HttpFlvPlayer label="Roadside 4G camera" src={roadsideCameraUrl} className="h-full" />
        </div>

        <div className="control-main-panel w-[60%] flex flex-col relative">
          <div className="absolute inset-0 z-0">
            {cameraMode === 'main' ? (
              <HttpFlvPlayer label="Vehicle front camera" src={carCameraUrl} className="w-full h-full" />
            ) : (
              <HttpFlvPlayer label="Wide camera" src={wideCameraUrl} className="w-full h-full" />
            )}
          </div>

          {g29Data.status !== 'connected' && (
            <div className="control-disconnected-overlay absolute inset-0 flex flex-col items-center justify-center backdrop-blur-sm z-50">
              <div className="control-disconnected-card p-8 rounded-2xl flex flex-col items-center">
                <Wifi size={64} className="text-red-500 mb-4 animate-pulse" />
                <h2 className="text-2xl font-bold mb-2">G29 wheel disconnected</h2>
                <p className="text-sm mb-6 text-center max-w-md">
                  Check the relay service, USB connection, and port 8082.
                </p>
                <div className="control-status-note text-xs font-mono px-4 py-2 rounded">
                  Current status: {g29Data.message || 'Waiting for connection...'}
                </div>
              </div>
            </div>
          )}

          {g29Data.status === 'connected' && (
            <>
              <div className="control-input-card absolute top-4 left-1/2 -translate-x-1/2 z-10 backdrop-blur px-4 py-2 rounded">
                <div className="text-xs font-mono">Control input</div>
                <div className="text-lg font-bold text-green-400">G29 wheel</div>
                <div className="text-[10px] font-mono">
                  Steering {g29Data.steering.toFixed(0)} deg | Throttle {g29Data.throttle.toFixed(0)}% | Brake {g29Data.brake.toFixed(0)}%
                </div>
                <div className="text-[10px] text-blue-300 font-mono mt-1">
                  View {cameraMode === 'main' ? 'main' : 'wide'}
                </div>
              </div>

              <div className="control-input-deck absolute bottom-4 left-4 right-4 h-40 rounded-2xl backdrop-blur-md z-20 overflow-hidden shadow-2xl flex items-center px-4 md:px-12">
                <div className="w-full grid grid-cols-[1fr_1.5fr_1fr] items-center gap-4 h-full max-w-3xl mx-auto">
                  <div className="control-real-pedal-control">
                    <div className="control-small-label text-[10px] mb-1 uppercase tracking-widest">Brake</div>
                    <div className="control-real-pedal">
                      {Array.from({ length: 24 }).map((_, index) => <i key={index} />)}
                    </div>
                    <div className="control-pedal-progress">
                      <div className="bg-red-600" style={{ height: `${g29Data.brake}%` }} />
                    </div>
                    <div className="text-[10px] md:text-xs mt-1 text-red-400 font-mono">{g29Data.brake.toFixed(0)}%</div>
                  </div>

                  <div className="flex flex-col items-center justify-center">
                    <div className="control-real-wheel transition-transform will-change-transform" style={steeringStyle}>
                      <div className="control-real-wheel-rim" />
                      <div className="control-real-wheel-hub">G29</div>
                      <span className="control-real-spoke control-real-spoke-left" />
                      <span className="control-real-spoke control-real-spoke-right" />
                      <span className="control-real-spoke control-real-spoke-bottom" />
                      <span className="control-real-wheel-marker" />
                    </div>
                    <div className="control-steering-progress">
                      <div style={{ width: `${steeringProgress}%` }} />
                    </div>
                    <div className="mt-2 text-lg md:text-xl font-bold text-blue-300">{g29Data.steering.toFixed(0)} deg</div>
                  </div>

                  <div className="control-real-pedal-control">
                    <div className="control-small-label text-[10px] mb-1 uppercase tracking-widest">Throttle</div>
                    <div className="control-real-pedal control-real-pedal-narrow">
                      {Array.from({ length: 24 }).map((_, index) => <i key={index} />)}
                    </div>
                    <div className="control-pedal-progress">
                      <div className="bg-green-500" style={{ height: `${g29Data.throttle}%` }} />
                    </div>
                    <div className="text-[10px] md:text-xs mt-1 text-green-400 font-mono">{g29Data.throttle.toFixed(0)}%</div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="control-side-panel w-[20%] flex flex-col relative z-20">
          <div className="control-network-card absolute top-2 left-2 right-2 z-10 backdrop-blur rounded p-2">
            <div className="control-small-label text-[9px] font-mono mb-1">Vehicle connection</div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-blue-400 font-mono">{getCarIp()}:8000</span>
              <button
                type="button"
                onClick={() => setShowSettings(true)}
                className="control-icon-button w-7 h-7 p-0 rounded-md inline-flex items-center justify-center"
                title="Vehicle network settings"
              >
                <Settings size={14} />
              </button>
            </div>
          </div>
          <MapContainer lat={telemetry.latitude} lng={telemetry.longitude} className="w-full h-full opacity-60" />
        </div>
      </div>

      {showSettings && (
        <div className="control-settings-backdrop fixed inset-0 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="control-settings-panel rounded-xl p-6 w-96 shadow-2xl">
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
              <Settings size={20} className="text-blue-500" />
              Vehicle network
            </h3>

            <label className="control-small-label block text-xs mb-2 font-mono" htmlFor="vehicle-ip">
              Vehicle IP address
            </label>
            <input
              id="vehicle-ip"
              type="text"
              value={carIpInput}
              onChange={(event) => setCarIpInput(event.target.value)}
              placeholder="192.168.1.100"
              className="control-settings-input w-full rounded px-3 py-2 font-mono text-sm focus:outline-none"
            />

            <div className="flex gap-2 mt-5">
              <button
                type="button"
                onClick={() => {
                  setCarIp(carIpInput);
                  setShowSettings(false);
                }}
                className="control-save-button flex-1 py-2 rounded text-sm font-bold transition-colors inline-flex items-center justify-center gap-2"
              >
                <Save size={16} />
                Save
              </button>
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="control-cancel-button flex-1 py-2 rounded text-sm font-bold transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
