// Data definitions for the Vehicle System

// Enums for Gears
export enum Gear {
  P = 'P',
  R = 'R',
  N = 'N',
  D = 'D'
}

// System Status - Determines if remote control is needed
export enum VehicleStatus {
  NORMAL = 'NORMAL',
  WARNING = 'WARNING',   // Minor issues
  CRITICAL = 'CRITICAL', // Requires immediate takeover
  DISCONNECTED = 'DISCONNECTED'
}

// The core data structure transmitted from the Car -> Cloud
export interface VehicleTelemetry {
  timestamp: number;
  speedKmh: number;
  rpm: number;
  gear: Gear;
  steeringAngle: number; // -450 to 450 degrees
  batteryLevel: number;
  temperature: number; // Engine/Battery temp
  latitude: number;
  longitude: number;
  latencyMs: number; // Network latency
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
  // Optional recorded telemetry samples captured during a control session
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
