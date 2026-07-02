/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  Activity,
  Moon,
  Shield,
  RotateCw,
  Cpu,
  Server,
  Database,
  Clock,
  Wifi,
  ChevronRight,
  ShieldAlert,
  HelpCircle
} from 'lucide-react';
import { SystemMode, DeviceConfig, SleepRecord, ConsoleLog } from './types';
import RealtimeDataDisplay from './components/RealtimeDataDisplay';
import ConsolePanel from './components/ConsolePanel';
import SleepModePanel from './components/SleepModePanel';
import LieDetectorPanel from './components/LieDetectorPanel';

// Pre-seeded records representing saved data in PostgreSQL database
const initialSleepRecords: SleepRecord[] = [
  {
    id: 'rec_1',
    timestamp: '06/29 夜间监测',
    avgHeartRate: 54,
    avgSpO2: 98.4,
    hrvScore: 68,
    deepSleepPercent: 28,
    remSleepPercent: 21,
    ansBalance: 'parasympathetic_dominant',
    qualityScore: 92,
    hypnogram: [4, 3, 2, 1, 1, 2, 1, 1, 2, 4],
    summary: "副交感自律神经恢复极佳，夜间 HRV 水平极高。身体完成深度代谢修复，深睡与 REM 比例完美分配，自主神经系统处于最佳平衡状态。"
  },
  {
    id: 'rec_2',
    timestamp: '06/28 夜间监测',
    avgHeartRate: 63,
    avgSpO2: 96.8,
    hrvScore: 49,
    deepSleepPercent: 16,
    remSleepPercent: 18,
    ansBalance: 'balanced',
    qualityScore: 74,
    hypnogram: [4, 3, 3, 2, 2, 1, 2, 3, 3, 4],
    summary: "自律神经整体处于微疲劳平衡。夜间有轻度血氧波动起伏，可能与睡姿压迫有关。建议日间减少过度劳累，睡前避免过饱饮食。"
  }
];

export default function App() {
  // System general modes
  const [activeMode, setActiveMode] = useState<SystemMode>('idle');
  const [activeTab, setActiveTab] = useState<'sleep' | 'lie'>('sleep');

  // Device configuration
  const [config, setConfig] = useState<DeviceConfig>({
    wifiSSID: 'Geek_Lab_2.4G',
    wifiSignal: -58,
    isOnline: true,
    max30102LedCurrent: 8, // 8mA (safe range)
    enableEcgInSleep: false,
    gsrEnabled: true,
    pingIntervalMs: 3000,
    lastPingTime: Date.now()
  });

  // Logs stream buffer
  const [logs, setLogs] = useState<ConsoleLog[]>([]);

  // PostgreSQL simulated database records
  const [historicalRecords, setHistoricalRecords] = useState<SleepRecord[]>(initialSleepRecords);

  // UTC clock / local clock simulator
  const [systemTime, setSystemTime] = useState<string>('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setSystemTime(now.toLocaleTimeString('zh-CN', { hour12: false }) + ' CST');
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Log appending helper
  const addLog = (type: ConsoleLog['type'], message: string) => {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('zh-CN', { hour12: false }) + '.' + String(now.getMilliseconds()).padStart(3, '0');
    const newLog: ConsoleLog = {
      id: Math.random().toString(),
      timestamp: timeStr,
      type,
      message
    };
    setLogs((prev) => [...prev, newLog]);
  };

  // Seed initial logs on startup
  useEffect(() => {
    addLog('info', 'ESP32-S3 引导装载程序启动中... (ESP-IDF v5.1)');
    addLog('info', '物理内存初始化: PSRAM 8MB mapped, Flash 16MB SPI OK');
    addLog('info', '正在搜索 SSID [Geek_Lab_2.4G]...');
    setTimeout(() => {
      addLog('rx', 'WiFi 连接成功! 已获取 IP: 192.168.1.108 (RSSI: -58dBm)');
      addLog('info', '自检 AD8232、MAX30102、GSR 传感总线... 均已正常挂载');
      addLog('info', 'ESP32-S3 成功连接云端服务器! 回落待命状态 (IDLE)');
      addLog('tx', 'PING -> WebServer 握手建立成功 [Watchdog timer started]');
    }, 800);
  }, []);

  // Periodic heartbeat ping-pong logging in IDLE state
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (activeMode === 'idle' && config.isOnline) {
      interval = setInterval(() => {
        addLog('tx', 'PING -> 心跳自检 (Heartbeat Watchdog keep-alive)');
        setTimeout(() => {
          addLog('rx', 'PONG <- 服务器 ACK: 硬件状态在线 延迟: 4ms');
        }, 120);
      }, 15000); // log every 15s in idle to keep terminal tidy
    }
    return () => clearInterval(interval);
  }, [activeMode, config.isOnline]);

  // Handle configuration changes
  const handleConfigChange = (newConfig: Partial<DeviceConfig>) => {
    setConfig((prev) => {
      const updated = { ...prev, ...newConfig };
      if (newConfig.max30102LedCurrent !== undefined) {
        addLog('tx', `更新配置: MAX30102 LED 电流调整为 ${newConfig.max30102LedCurrent} mA`);
        addLog('rx', `ESP32-S3 写入 I2C 寄存器 0x09: ${newConfig.max30102LedCurrent}mA 成功`);
      }
      return updated;
    });
  };

  // Turn active modes on or off
  const handleStartSleepMode = (ecgEnabled: boolean) => {
    setActiveMode('sleep');
    addLog('tx', `启动场景 [夜间睡眠监测模式]: config={ecg:${ecgEnabled}, led_current:${config.max30102LedCurrent}mA}`);
    addLog('rx', 'ESP32-S3 接收指令成功: 物理熄灭板载 RGB、Tx/Rx 指示灯以进入无光运行');
    addLog('info', `MAX30102 极低噪 50Hz 基准采样启动，1Hz 周期性均值聚合开始...`);
    if (ecgEnabled) {
      addLog('info', 'AD8232 心电辅助电极已激活。');
    }
  };

  const handleStopSleepMode = () => {
    setActiveMode('idle');
    addLog('tx', '下发指令: [停止睡眠监测]');
    addLog('rx', 'ESP32-S3 接收成功: 传感器停止工作，恢复板载指示灯。');
    addLog('info', '向 PostgreSQL 写入永久资产并生成睡眠质量简报。');
  };

  const handleStartLieMode = () => {
    setActiveMode('lie');
    addLog('tx', '启动场景 [测谎实验模式]: 全感应全开, ws_fps: 200Hz');
    addLog('rx', 'ESP32-S3 接收指令成功: ADC 200Hz 级激流套接字联通成功。');
  };

  const handleStopLieMode = () => {
    setActiveMode('idle');
    addLog('tx', '下发指令: [终止测谎测试]');
    addLog('rx', 'ESP32-S3 接收成功: 全面释放高频 ADC，重新回到静默待命状态。');
  };

  // Toggle WiFi simulated connection (Watchdog simulation)
  const handleToggleConnection = () => {
    setConfig((prev) => {
      const isNowOnline = !prev.isOnline;
      if (!isNowOnline) {
        // Just went offline!
        addLog('warn', 'Wi-Fi 链路异常断开！ESP32-S3 失去服务器网络脉搏。');

        // If it was in monitoring state, trigger safety watchdog instantly!
        if (activeMode !== 'idle') {
          setTimeout(() => {
            addLog('error', '【看门狗超时报警】连续 5 分钟未收到 PING，或物理链路失效。安全守护已拦截！');
            addLog('warn', 'ESP32-S3 强制关闭 MAX30102 红外二极管，AD8232 差分运算电路断电。');
            addLog('info', '采集优雅收尾，设备重新引导复位中...');
            setActiveMode('idle');
          }, 1500);
        }
      } else {
        addLog('rx', 'Wi-Fi 重新联通。SSID: Geek_Lab_2.4G 已分配内网 IP。');
        addLog('info', '心跳 PING/PONG 回路握手恢复成功。');
      }
      return { ...prev, isOnline: isNowOnline };
    });
  };

  // Hard reboot simulation
  const handleReboot = () => {
    addLog('warn', '>>> 物理按键触发: 强制复位 ESP32-S3 <<<');
    setActiveMode('idle');
    setConfig((prev) => ({ ...prev, isOnline: false }));

    setTimeout(() => {
      setConfig((prev) => ({ ...prev, isOnline: true }));
      addLog('info', 'ESP32-S3 重新冷启动... (ESP-IDF v5.1)');
      addLog('info', '加载物理固件: Multi_Bio_Stream_System_V1.bin');
      addLog('rx', 'SSID Geek_Lab_2.4G 握手建立! IP 分配: 192.168.1.108');
      addLog('info', '云端通信恢复在线。设备处于 IDLE 待命。');
    }, 1500);
  };

  // Save/Delete PostgreSQL simulated records
  const handleSaveRecord = (record: SleepRecord) => {
    setHistoricalRecords((prev) => [record, ...prev]);
    addLog('info', `数据持久化: 已向 PostgreSQL 写入新睡眠条目 ID: ${record.id}`);
  };

  const handleDeleteRecord = (id: string) => {
    setHistoricalRecords((prev) => prev.filter((r) => r.id !== id));
    addLog('warn', `PostgreSQL 执行删除语句: DELETE FROM sleep_history WHERE id='${id}'`);
  };

  return (
    <div className="min-h-screen bg-slate-50/75 text-slate-800 flex flex-col font-sans selection:bg-indigo-100 selection:text-indigo-900" id="app-root">
      {/* Header Bar */}
      <header className="bg-white border-b border-slate-100 sticky top-0 z-40 shadow-xs">
        <div className="max-w-7xl mx-auto px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          {/* Logo / Title */}
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-600 text-white rounded-xl shadow-md shadow-indigo-100">
              <Cpu className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-bold text-slate-900 text-lg tracking-tight">ESP32-S3 生物信号采集与分析系统</h1>
                <span className="text-[10px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full border border-indigo-100 font-semibold uppercase">
                  v1.2 Dual-Scene
                </span>
              </div>
              <p className="text-xs text-slate-500">基于 ESP32-S3 物联网的夜间睡眠健康监测 &amp; 实时极客测谎分析仪表盘</p>
            </div>
          </div>

          {/* Quick status badge indicators */}
          <div className="flex items-center gap-3 flex-wrap">
            {/* Clock */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 border border-slate-200 text-slate-600 text-xs font-mono">
              <Clock className="w-3.5 h-3.5 text-slate-500" />
              <span>{systemTime || '加载中...'}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl mx-auto px-6 py-6 w-full space-y-6">
        
        {/* Connection lost warning card */}
        {!config.isOnline && (
          <div className="bg-rose-50 border border-rose-200 text-rose-900 rounded-2xl p-5 shadow-xs flex items-start gap-4 animate-in fade-in-50 slide-in-from-top-4 duration-200">
            <div className="p-2.5 bg-rose-100 text-rose-700 rounded-xl">
              <ShieldAlert className="w-6 h-6 animate-bounce" />
            </div>
            <div className="space-y-1">
              <h4 className="font-bold text-sm text-rose-800">物联网节点已触发紧急重置</h4>
              <p className="text-xs text-rose-600 leading-relaxed">
                网络连线被切断。ESP32-S3 搭载的安全机制正在自动强制熄灭所有传感器。为避免指令落空形成不稳定的“幽灵状态”，本地控制操作已全部冻结锁定。
              </p>
              <button
                onClick={handleToggleConnection}
                className="mt-2.5 px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold shadow-xs transition cursor-pointer"
              >
                一键重连 Wi-Fi 恢复正常
              </button>
            </div>
          </div>
        )}

        {/* Dashboard grid layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Left Area: Scenario workspace (cols 7) */}
          <div className="lg:col-span-7 space-y-6 flex flex-col justify-start">
            
            {/* Tabs Selector for Sleep Monitoring vs Lie Detector */}
            <div className="bg-white border border-slate-100 rounded-2xl p-2.5 shadow-2xs flex items-center gap-1.5">
              <button
                onClick={() => {
                  if (activeMode !== 'idle' && activeMode !== 'sleep') return;
                  setActiveTab('sleep');
                }}
                disabled={activeMode === 'lie'}
                className={`flex-1 py-3 px-4 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 ${
                  activeTab === 'sleep'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-100'
                    : 'text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed'
                }`}
              >
                <Moon className="w-4 h-4" />
                <span>睡眠监测场景 (Sleep Mode)</span>
              </button>

              <button
                onClick={() => {
                  if (activeMode !== 'idle' && activeMode !== 'lie') return;
                  setActiveTab('lie');
                }}
                disabled={activeMode === 'sleep'}
                className={`flex-1 py-3 px-4 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 ${
                  activeTab === 'lie'
                    ? 'bg-rose-600 text-white shadow-md shadow-rose-100'
                    : 'text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed'
                }`}
              >
                <Shield className="w-4 h-4" />
                <span>测谎实验场景 (Lie Detector Mode)</span>
              </button>
            </div>

            {/* Workspace Panels container */}
            <div className="flex-1">
              {activeTab === 'sleep' ? (
                <SleepModePanel
                  config={config}
                  isActive={activeMode === 'sleep'}
                  onStartSleepMode={handleStartSleepMode}
                  onStopSleepMode={handleStopSleepMode}
                  onSaveRecord={handleSaveRecord}
                  historicalRecords={historicalRecords}
                  onDeleteRecord={handleDeleteRecord}
                />
              ) : (
                <LieDetectorPanel
                  config={config}
                  isActive={activeMode === 'lie'}
                  onStartLieMode={handleStartLieMode}
                  onStopLieMode={handleStopLieMode}
                  onLogMessage={addLog}
                />
              )}
            </div>

          </div>

          {/* Right Area: Serial logs monitor & System configuration (cols 5) */}
          <div className="lg:col-span-5 space-y-6">
            
            {/* System active status indicator widget */}
            <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-2xs">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">ESP32-S3 实机当前状态</h3>
              <div className="flex items-center gap-4">
                <div className={`p-3.5 rounded-xl ${
                  activeMode === 'sleep' ? 'bg-indigo-50 text-indigo-600' : activeMode === 'lie' ? 'bg-rose-50 text-rose-600 animate-pulse' : 'bg-slate-50 text-slate-500'
                }`}>
                  {activeMode === 'sleep' ? (
                    <Moon className="w-6 h-6" />
                  ) : activeMode === 'lie' ? (
                    <Activity className="w-6 h-6" />
                  ) : (
                    <Cpu className="w-6 h-6" />
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-800 text-base">
                      {activeMode === 'sleep' ? '监测模式 [Sleep Mode]' : activeMode === 'lie' ? '测谎实验 [Lie Detector]' : '待命状态 [Idle State]'}
                    </span>
                    <span className="text-[10px] bg-slate-100 border border-slate-200 text-slate-500 px-2 py-0.5 rounded-full font-mono">
                      {activeMode === 'sleep' ? '50Hz / 1Hz avg' : activeMode === 'lie' ? '200Hz raw' : '0Hz static'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {activeMode === 'sleep'
                      ? '物理指示灯全黑。血氧及心率变异度数据正在上传 PostgreSQL...'
                      : activeMode === 'lie'
                      ? '强制启用全电极。实时 WebSocket 波形高帧绘制，事件打标开启。'
                      : '系统稳定在线，周期性发送握手包进行链路自维持。'}
                  </p>
                </div>
              </div>
            </div>

            {/* Serial Terminal panel */}
            <ConsolePanel
              logs={logs}
              config={config}
              onClearLogs={() => setLogs([])}
              onToggleConnection={handleToggleConnection}
              onReboot={handleReboot}
            />

          </div>

        </div>

        {/* 24H 实时生物体征与物理遥测系统 */}
        <RealtimeDataDisplay config={config} activeMode={activeMode} onLogMessage={addLog} />

      </main>

      {/* Footer copyright */}
      <footer className="bg-slate-900 border-t border-slate-800 text-slate-500 text-xs py-8 mt-12 font-mono">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div>
            <p className="text-slate-400 font-bold">ESP32-S3 Bio-Signal Acquisition System Control Panel</p>
            <p className="text-[11px] text-slate-600 mt-1">分体式低噪生理监测极客实验终端 · 全时 Wi-Fi 物理抗干扰架构</p>
          </div>
          <div className="flex items-center gap-4 text-[11px]">
            <span>CST Time: 2026-07-01</span>
            <span>·</span>
            <span>PostgreSQL Ver: 15.3</span>
            <span>·</span>
            <span className="text-indigo-400">Status: Active</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
