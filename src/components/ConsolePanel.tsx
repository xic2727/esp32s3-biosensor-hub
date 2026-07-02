import React, { useRef, useEffect } from 'react';
import { Wifi, WifiOff, Terminal, Trash2, ShieldAlert, RotateCw } from 'lucide-react';
import { ConsoleLog, DeviceConfig } from '../types';

interface ConsolePanelProps {
  logs: ConsoleLog[];
  config: DeviceConfig;
  onClearLogs: () => void;
  onToggleConnection: () => void;
  onReboot: () => void;
}

export default function ConsolePanel({ logs, config, onClearLogs, onToggleConnection, onReboot }: ConsolePanelProps) {
  const terminalEndRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll terminal to bottom when new logs arrive
  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  return (
    <div className="bg-slate-900 text-slate-100 rounded-2xl border border-slate-800 p-6 shadow-xl font-mono flex flex-col h-[420px]" id="serial-console-panel">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-4">
        <div className="flex items-center gap-2.5">
          <Terminal className="w-5 h-5 text-indigo-400" />
          <div>
            <h3 className="font-semibold text-sm text-slate-200">ESP32-S3 串口监视器 / 实时套接字流</h3>
            <p className="text-[10px] text-slate-500">WiFi 实时回传 (115200 Baud) &amp; WebSocket 通信</p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {/* Simulate Disconnect Button */}
          <button
            onClick={onToggleConnection}
            title={config.isOnline ? "断开 Wi-Fi 模拟弱网" : "连接 Wi-Fi"}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
              config.isOnline
                ? 'bg-rose-950/40 text-rose-300 border-rose-800/60 hover:bg-rose-900/30'
                : 'bg-emerald-950/40 text-emerald-300 border-emerald-800/60 hover:bg-emerald-900/30'
            }`}
          >
            {config.isOnline ? (
              <>
                <WifiOff className="w-3.5 h-3.5" />
                <span>切断 Wi-Fi</span>
              </>
            ) : (
              <>
                <Wifi className="w-3.5 h-3.5" />
                <span>重连 Wi-Fi</span>
              </>
            )}
          </button>

          {/* Reboot Button */}
          <button
            onClick={onReboot}
            title="复位 ESP32-S3"
            className="p-1.5 bg-slate-800 border border-slate-700 hover:bg-slate-700 hover:text-white rounded-lg text-slate-400 transition"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>

          {/* Clear Button */}
          <button
            onClick={onClearLogs}
            title="清空监视器"
            className="p-1.5 bg-slate-800 border border-slate-700 hover:bg-slate-700 hover:text-white rounded-lg text-slate-400 transition"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Connection Indicator Strip */}
      <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-950 border border-slate-800/70 mb-3 text-xs">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${config.isOnline ? 'bg-emerald-500 animate-ping' : 'bg-rose-500'}`} />
          <span className="text-slate-400 font-medium">物理状态:</span>
          <span className={`font-bold ${config.isOnline ? 'text-emerald-400' : 'text-rose-400'}`}>
            {config.isOnline ? '在线 (ONLINE)' : '离线 (OFFLINE)'}
          </span>
        </div>
        {config.isOnline && (
          <div className="text-slate-500 text-[10px] flex items-center gap-3">
            <span>SSID: <strong className="text-indigo-400">{config.wifiSSID}</strong></span>
            <span>RSSI: <strong className="text-emerald-400">{config.wifiSignal} dBm</strong></span>
          </div>
        )}
      </div>

      {/* Terminal Viewport */}
      <div className="flex-1 overflow-y-auto bg-slate-950 p-4 rounded-xl border border-slate-800/50 space-y-1.5 text-xs select-text scrollbar-thin scrollbar-thumb-slate-800">
        {logs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-600 gap-2">
            <Terminal className="w-6 h-6 stroke-[1.5]" />
            <span className="text-[11px]">等待数据输入...</span>
          </div>
        ) : (
          logs.map((log) => {
            let typeColor = 'text-sky-400';
            let prefix = '[INFO]';
            if (log.type === 'warn') {
              typeColor = 'text-amber-400';
              prefix = '[WARN]';
            } else if (log.type === 'error') {
              typeColor = 'text-rose-400';
              prefix = '[ERR!]';
            } else if (log.type === 'tx') {
              typeColor = 'text-indigo-400';
              prefix = '[TX->]';
            } else if (log.type === 'rx') {
              typeColor = 'text-emerald-400';
              prefix = '[RX<-]';
            }

            return (
              <div key={log.id} className="flex items-start gap-2 hover:bg-slate-900/50 py-0.5 px-1 rounded">
                <span className="text-slate-600 select-none shrink-0 text-[10px] pt-0.5">{log.timestamp}</span>
                <span className={`font-bold shrink-0 text-[11px] ${typeColor}`}>{prefix}</span>
                <span className="text-slate-300 break-all leading-normal">{log.message}</span>
              </div>
            );
          })
        )}
        <div ref={terminalEndRef} />
      </div>

      {/* Safety Alarm Overlay when Disconnected */}
      {!config.isOnline && (
        <div className="mt-3 flex items-center gap-2.5 p-3 bg-rose-950/30 border border-rose-900/60 rounded-xl text-xs text-rose-300">
          <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 animate-bounce" />
          <div className="leading-snug">
            <strong>看门狗已响应：</strong> Wi-Fi 信号已断开。ESP32-S3 端所有采集工作紧急优雅关机，RGB 状态灯闪烁红光复位中。控制端所有按钮已冻结。
          </div>
        </div>
      )}
    </div>
  );
}
