/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type SystemMode = 'idle' | 'sleep' | 'lie';

export interface DeviceConfig {
  wifiSSID: string;
  wifiSignal: number; // RSSI in dBm
  isOnline: boolean;
  max30102LedCurrent: number; // 0 to 50mA, limit in code to 7mA-10mA for safety
  enableEcgInSleep: boolean;
  gsrEnabled: boolean;
  pingIntervalMs: number;
  lastPingTime: number;
}

export interface SleepRecord {
  id: string;
  timestamp: string;
  avgHeartRate: number;
  avgSpO2: number;
  hrvScore: number; // SDNN or RMSSD representation
  deepSleepPercent: number;
  remSleepPercent: number;
  ansBalance: 'sympathetic_dominant' | 'balanced' | 'parasympathetic_dominant';
  qualityScore: number;
  hypnogram: number[]; // 10 points representing sleep stages over time
  summary: string;
}

export interface EventTag {
  id: string;
  timestamp: number; // relative time in seconds from test start
  questionText: string;
  reactionDetected: boolean;
  hrIncrease: number;
  gsrSurge: number;
}

export interface LiveSignalPoint {
  time: number; // relative seconds
  ecg: number;  // raw volt or ADC
  ppg: number;  // raw photodetector ADC
  gsr: number;  // raw skin conductance ADC
}

export interface ConsoleLog {
  id: string;
  timestamp: string;
  type: 'info' | 'warn' | 'error' | 'rx' | 'tx';
  message: string;
}
