import React from 'react';
import { AlertTriangle, Disc } from 'lucide-react';
import { HttpFlvPlayer } from '../components/HttpFlvPlayer';
import { MapContainer } from '../components/MapContainer';
import { VehicleStatus, VehicleTelemetry } from '../types';

interface MonitorViewProps {
  telemetry: VehicleTelemetry;
  onTakeover: () => void;
  canTakeover?: boolean;
  roleLabel?: string;
}

export const MonitorView: React.FC<MonitorViewProps> = ({
  telemetry,
  onTakeover,
  canTakeover = true,
  roleLabel = 'Operator'
}) => {
  const isCritical = telemetry.status === VehicleStatus.CRITICAL;
  const streamHost = import.meta.env.VITE_STREAM_HOST || window.location.hostname || '119.45.14.204';
  const carCameraUrl = import.meta.env.VITE_CAR_CAMERA_URL || `/live/car.flv`;
  const roadsideCameraUrl = import.meta.env.VITE_ROADSIDE_CAMERA_URL || `/live/car_front.flv`;

  return (
    <div className="monitor-view flex flex-col h-full p-4 gap-4">
      <div className="flex-1 grid grid-cols-12 gap-4 min-h-0">
        <div className="monitor-panel monitor-panel-left col-span-3 overflow-hidden flex flex-col relative group">
          <div className="monitor-panel-accent absolute top-0 left-0 right-0 h-1 z-20" />
          <HttpFlvPlayer
            label="Roadside 4G camera"
            src={roadsideCameraUrl}
            className="flex-1 opacity-80 grayscale-[30%]"
          />
        </div>

        <div className="monitor-panel monitor-panel-main col-span-6 overflow-hidden flex flex-col relative">
          <HttpFlvPlayer label="Vehicle front camera" src={carCameraUrl} className="flex-1 w-full h-full" />

          {isCritical && (
            <div className="monitor-warning-overlay absolute inset-0 backdrop-blur-sm z-50 flex flex-col items-center justify-center">
              <div className="monitor-warning-card p-8 rounded-2xl flex flex-col items-center animate-pulse">
                <AlertTriangle size={64} className="text-red-500 mb-4" />
                <h1 className="text-3xl font-tech font-bold text-white mb-1 tracking-widest uppercase">Warning</h1>
                <p className="text-lg text-red-300 mb-6 font-mono">Vehicle anomaly detected</p>
                <button
                  type="button"
                  onClick={canTakeover ? onTakeover : undefined}
                  disabled={!canTakeover}
                  className={`px-8 py-3 rounded text-lg font-bold font-tech tracking-wide transition-all shadow-lg ${canTakeover ? 'bg-red-600 hover:bg-red-500 text-white hover:scale-105' : 'bg-slate-700 text-slate-300 cursor-not-allowed'}`}
                >
                  {canTakeover ? 'Start manual takeover' : `${roleLabel} read-only`}
                </button>
                {!canTakeover && (
                  <p className="text-xs text-slate-400 mt-3">This account cannot send vehicle control commands.</p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="monitor-panel monitor-panel-map col-span-3 overflow-hidden flex flex-col relative">
          <div className="monitor-map-label absolute top-3 left-3 z-10 backdrop-blur px-3 py-1 rounded flex items-center gap-2">
            <Disc className="text-blue-400 animate-spin-slow" size={14} />
            <span className="text-[10px] font-tech text-gray-300 tracking-wider">Map layer</span>
          </div>
          <MapContainer lat={telemetry.latitude} lng={telemetry.longitude} className="flex-1" />
        </div>
      </div>
    </div>
  );
};
