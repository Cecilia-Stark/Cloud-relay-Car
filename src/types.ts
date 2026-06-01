// Data definitions for the Vehicle System — real telemetry from the relay server

// System Status
export enum VehicleStatus {
  NORMAL = 'NORMAL',
  WARNING = 'WARNING',
  CRITICAL = 'CRITICAL',
  DISCONNECTED = 'DISCONNECTED'
}

// Real robot telemetry received from the relay server /api/status
export interface RobotTelemetry {
  position: { x: number; y: number; yaw: number };
  velocity: { linear: number; angular: number };
  battery: { voltage: number; percentage: number };
  obstacle: { distance: number | null };
  vehicle: {
    ev_ready: boolean | null;
    hand_brake: boolean | null;
    gear: string | null;
    speed: number | null;
    steering_angle: number | null;
  };
  gps: { latitude: number | null; longitude: number | null; fix: string | null };
  imu: {
    acc_x: number | null; acc_y: number | null; acc_z: number | null;
    gyro_x: number | null; gyro_y: number | null; gyro_z: number | null;
  };
}

// G29 wheel data forwarded by the relay server
export interface G29Input {
  steer: number;
  throttle: number;
  brake: number;
  source: string;
  sent_at: number;
}

// The core data structure consumed by the UI
export interface VehicleTelemetry {
  timestamp: number;
  robot: RobotTelemetry | null;
  robotConnected: boolean;
  g29: G29Input | null;
  speedKmh: number;
  latitude: number;
  longitude: number;
  status: VehicleStatus;
  errorMessage?: string;
}

// Application View States
export type ViewMode = 'LOGIN' | 'MONITOR' | 'CONTROL' | 'HISTORY';

export type UserRole = 'operator' | 'dispatcher' | 'viewer';

export interface AuthenticatedUser {
  id: string;
  username: string;
  role: UserRole;
  createdAt: string;
}

// Log entry for the history/playback tab
export interface DriveSessionLog {
  id: string;
  startTime: string;
  endTime: string;
  operator: string;
  events: number;
  status: 'Completed' | 'Aborted';
  telemetrySamples?: VehicleTelemetry[];
}

export interface DriveSessionRecord {
  id: string;
  operator: string;
  role: UserRole;
  startTime: string;
  endTime: string | null;
  durationSeconds: number | null;
  events: number;
  status: 'recording' | 'completed' | 'aborted' | 'recording_error';
  videoPath: string | null;
  videoFilename: string | null;
  videoSize: number;
  errorMessage?: string | null;
}
