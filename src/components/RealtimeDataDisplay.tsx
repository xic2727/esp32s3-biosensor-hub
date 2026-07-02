import React, { useState, useEffect, useRef } from 'react';
import { Activity, Heart, Eye, Sliders, Zap, Wifi, Database, Info, RefreshCw, AlertCircle, Sparkles } from 'lucide-react';
import { DeviceConfig, SystemMode } from '../types';

interface RealtimeDataDisplayProps {
  config: DeviceConfig;
  activeMode: SystemMode;
  onLogMessage?: (type: 'info' | 'warn' | 'error' | 'rx' | 'tx', msg: string) => void;
}

export default function RealtimeDataDisplay({ config, activeMode, onLogMessage }: RealtimeDataDisplayProps) {
  // Real-time states
  const [pulseRate, setPulseRate] = useState<number>(72);
  const [bloodOxygen, setBloodOxygen] = useState<number>(98.5);
  const [skinConductance, setSkinConductance] = useState<number>(2.45);
  const [heartRateVariability, setHeartRateVariability] = useState<number>(64);
  
  // ESP32 system parameters
  const [cpuTemp, setCpuTemp] = useState<number>(41.2);
  const [powerDraw, setPowerDraw] = useState<number>(145); // mW
  const [i2cBusSpeed, setI2cBusSpeed] = useState<number>(400); // kHz
  const [wifiPing, setWifiPing] = useState<number>(6); // ms

  // Waveform buffer for the large history chart
  const [chartData, setChartData] = useState<{ hr: number[]; spo2: number[]; gsr: number[]; hrv: number[] }>({
    hr: Array.from({ length: 40 }, () => 70 + Math.random() * 4),
    spo2: Array.from({ length: 40 }, () => 98 + Math.random() * 1),
    gsr: Array.from({ length: 40 }, () => 2.4 + Math.random() * 0.1),
    hrv: Array.from({ length: 40 }, () => 60 + Math.random() * 5),
  });

  const [selectedMetric, setSelectedMetric] = useState<'hr' | 'spo2' | 'gsr' | 'hrv'>('hr');
  const [anomalyType, setAnomalyType] = useState<'none' | 'breath' | 'stress' | 'apnea'>('none');
  const [anomalyProgress, setAnomalyProgress] = useState<number>(0);

  // Hardware WebSocket state
  const [isHardwareConnected, setIsHardwareConnected] = useState<boolean>(false);
  const wsRef = useRef<WebSocket | null>(null);

  // Buffer ref to avoid stale closure state
  const dataBufferRef = useRef(chartData);
  useEffect(() => {
    dataBufferRef.current = chartData;
  }, [chartData]);

  // Connect to backend WebSocket proxy
  useEffect(() => {
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProto}//${window.location.host}/ws/client`;
    
    let socket: WebSocket | null = null;
    let reconnectTimeout: any = null;

    function connect() {
      console.log(`[WebSocket] Connecting to Gateway: ${wsUrl}`);
      socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      socket.onopen = () => {
        console.log('[WebSocket] Connection established with Node fullstack hub.');
        if (onLogMessage) {
          onLogMessage('info', '✅ 云端中继网关已连入：双向高精信道准备就绪，实时监听物理多维终端。');
        }
      };

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          
          if (payload.type === 'device_status') {
            setIsHardwareConnected(payload.connected);
            if (onLogMessage) {
              onLogMessage('info', payload.connected 
                ? '🟢 物理传感器在线：成功发现物理 ESP32-S3 采集终端，真实数据流已接管。'
                : '🔴 物理传感器离线：等待物理硬件上电连接。已平滑自动激活本地高保真模拟发生器。'
              );
            }
          } else if (payload.type === 'telemetry') {
            setIsHardwareConnected(true);
            const { pulseRate, bloodOxygen, skinConductance, heartRateVariability, cpuTemp, powerDraw, anomaly } = payload.data;
            
            setPulseRate(pulseRate);
            setBloodOxygen(bloodOxygen);
            setSkinConductance(skinConductance);
            setHeartRateVariability(heartRateVariability);
            setCpuTemp(cpuTemp);
            setPowerDraw(powerDraw);
            if (anomaly) {
              setAnomalyType(anomaly);
            }

            // Sync with chart arrays
            setChartData((prev) => {
              const nextHr = [...prev.hr.slice(1), pulseRate];
              const nextSpO2 = [...prev.spo2.slice(1), bloodOxygen];
              const nextGsr = [...prev.gsr.slice(1), skinConductance];
              const nextHrv = [...prev.hrv.slice(1), heartRateVariability];
              return { hr: nextHr, spo2: nextSpO2, gsr: nextGsr, hrv: nextHrv };
            });

            if (onLogMessage && Math.random() < 0.15) { // Throttled telemetry logs so console is readable
              onLogMessage('rx', `物理数据帧 - 心率: ${pulseRate}BPM | 血氧: ${bloodOxygen}% | GSR: ${skinConductance}μS`);
            }
          }
        } catch (err) {
          console.error('[WebSocket] Parsing failed:', err);
        }
      };

      socket.onclose = () => {
        console.warn('[WebSocket] Disconnected. Reconnecting in 3s...');
        setIsHardwareConnected(false);
        reconnectTimeout = setTimeout(connect, 3000);
      };

      socket.onerror = (err) => {
        console.error('[WebSocket] Socket error:', err);
        socket?.close();
      };
    }

    connect();

    return () => {
      if (socket) {
        socket.close();
      }
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
    };
  }, []);

  // Handle simulations (runs only when physical hardware is disconnected)
  useEffect(() => {
    if (isHardwareConnected) return;

    const interval = setInterval(() => {
      // Base drift
      let hrDrift = (Math.random() - 0.5) * 1.2;
      let spo2Drift = (Math.random() - 0.5) * 0.15;
      let gsrDrift = (Math.random() - 0.5) * 0.04;
      let hrvDrift = (Math.random() - 0.5) * 2;

      // System telemetry drift
      setCpuTemp((prev) => Math.max(38, Math.min(55, prev + (Math.random() - 0.5) * 0.3 + (activeMode !== 'idle' ? 0.05 : -0.02))));
      setPowerDraw((prev) => {
        const base = activeMode === 'lie' ? 240 : activeMode === 'sleep' ? 95 : 130;
        return Math.round(base + (Math.random() - 0.5) * 8);
      });
      setWifiPing((prev) => Math.max(2, Math.min(80, prev + Math.round((Math.random() - 0.5) * 3))));

      // Handle custom anomaly simulations triggered by buttons
      if (anomalyType !== 'none') {
        setAnomalyProgress((prev) => {
          const next = prev + 5;
          if (next >= 100) {
            setAnomalyType('none');
            if (onLogMessage) {
              onLogMessage('info', `生物仿真事件：[${getAnomalyName(anomalyType)}] 结束，自主神经系统逐渐代偿回归基线。`);
            }
            return 0;
          }
          return next;
        });

        // Scale factor for anomaly (bell curve 0 -> 1 -> 0 over 100%)
        const rad = (anomalyProgress / 100) * Math.PI;
        const effectStrength = Math.sin(rad);

        if (anomalyType === 'breath') {
          // Deep breathing lowers HR, boosts HRV, stabilizes SpO2
          hrDrift -= effectStrength * 14;
          hrvDrift += effectStrength * 25;
          spo2Drift += effectStrength * 0.8;
          gsrDrift -= effectStrength * 0.3;
        } else if (anomalyType === 'stress') {
          // Stress spike HR, reduces HRV, increases GSR (sweat)
          hrDrift += effectStrength * 32;
          hrvDrift -= effectStrength * 28;
          gsrDrift += effectStrength * 1.8;
        } else if (anomalyType === 'apnea') {
          // Apnea drastically drops SpO2, triggers stress reaction later
          spo2Drift -= effectStrength * 4.5;
          if (anomalyProgress > 50) {
            hrDrift += effectStrength * 18; // delayed HR spike due to hypoxia panic
          } else {
            hrDrift -= effectStrength * 5;  // early breath holding bradycardia
          }
        }
      }

      // Compute final values
      setPulseRate((prev) => {
        let target = prev + hrDrift;
        if (activeMode === 'sleep') target = Math.max(45, Math.min(65, target));
        else if (activeMode === 'lie') target = Math.max(75, Math.min(115, target));
        else target = Math.max(55, Math.min(85, target));
        return Math.round(target * 10) / 10;
      });

      setBloodOxygen((prev) => {
        let target = prev + spo2Drift;
        target = Math.max(88, Math.min(100, target));
        return Math.round(target * 10) / 10;
      });

      setSkinConductance((prev) => {
        let target = prev + gsrDrift;
        target = Math.max(0.8, Math.min(6.5, target));
        return Math.round(target * 100) / 100;
      });

      setHeartRateVariability((prev) => {
        let target = prev + hrvDrift;
        if (activeMode === 'sleep') target = Math.max(55, Math.min(95, target));
        else if (activeMode === 'lie') target = Math.max(25, Math.min(50, target));
        else target = Math.max(45, Math.min(75, target));
        return Math.round(target);
      });

      // Update charts buffer
      setChartData((prev) => {
        const nextHr = [...prev.hr.slice(1), pulseRate];
        const nextSpO2 = [...prev.spo2.slice(1), bloodOxygen];
        const nextGsr = [...prev.gsr.slice(1), skinConductance];
        const nextHrv = [...prev.hrv.slice(1), heartRateVariability];
        return { hr: nextHr, spo2: nextSpO2, gsr: nextGsr, hrv: nextHrv };
      });

    }, 800);

    return () => clearInterval(interval);
  }, [isHardwareConnected, anomalyType, anomalyProgress, activeMode, pulseRate, bloodOxygen, skinConductance, heartRateVariability]);

  const getAnomalyName = (type: string) => {
    switch (type) {
      case 'breath': return '腹式深呼吸';
      case 'stress': return '应激兴奋/说谎';
      case 'apnea': return '短暂性睡眠呼吸暂停';
      default: return '基准状态';
    }
  };

  const triggerAnomaly = (type: 'breath' | 'stress' | 'apnea') => {
    // If physical websocket is open, send command down the channel
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify({
          type: 'trigger_anomaly',
          anomaly: type
        }));
      } catch (err) {
        console.error('Failed to send WS command:', err);
      }
    }

    setAnomalyType(type);
    setAnomalyProgress(0);
    if (onLogMessage) {
      onLogMessage('tx', `下发命令: [调整硬件仿真微电压偏置 - ${getAnomalyName(type)}]`);
    }
  };

  // Metric info mapping for display
  const metricConfig = {
    hr: {
      label: '实时心率 / 脉率',
      value: `${pulseRate} BPM`,
      color: 'text-rose-600 bg-rose-50 border-rose-100',
      lineColor: '#f43f5e',
      min: 40,
      max: 120,
      desc: 'MAX30102 采集到的每分钟心跳次数。安静时 55~75 BPM，应激时急速攀升。',
      data: chartData.hr
    },
    spo2: {
      label: '血氧饱和度 (SpO2)',
      value: `${bloodOxygen}%`,
      color: 'text-emerald-600 bg-emerald-50 border-emerald-100',
      lineColor: '#10b981',
      min: 88,
      max: 100,
      desc: '外周血氧饱和百分比。正常介于 95%~100%。低于 92% 提示存在乏氧或呼吸抑制风险。',
      data: chartData.spo2
    },
    gsr: {
      label: '皮肤电电导 (GSR)',
      value: `${skinConductance} μS`,
      color: 'text-cyan-600 bg-cyan-50 border-cyan-100',
      lineColor: '#06b6d4',
      min: 0.5,
      max: 6.0,
      desc: '微汗引发的皮肤电阻变化。交感神经兴奋时汗腺分泌加速，电导率急剧升高。',
      data: chartData.gsr
    },
    hrv: {
      label: '心率变异度 (HRV SDNN)',
      value: `${heartRateVariability} ms`,
      color: 'text-indigo-600 bg-indigo-50 border-indigo-100',
      lineColor: '#6366f1',
      min: 20,
      max: 100,
      desc: '连续心跳间期的标准偏差。越强表明副交感自律神经调节越活跃、身体越放松。',
      data: chartData.hrv
    }
  };

  // Render inline SVG sparklines/linecharts
  const renderTrendChart = (metricKey: 'hr' | 'spo2' | 'gsr' | 'hrv') => {
    const config = metricConfig[metricKey];
    const data = config.data;
    const width = 640;
    const height = 180;
    const padding = 20;

    const dataMin = config.min;
    const dataMax = config.max;

    // Build points coordinates
    const points = data.map((val, idx) => {
      const x = padding + (idx / (data.length - 1)) * (width - padding * 2);
      // Normalized y between 0 and 1
      const normalizedY = (val - dataMin) / (dataMax - dataMin);
      const y = height - padding - normalizedY * (height - padding * 2);
      return `${x},${y}`;
    }).join(' ');

    return (
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-[180px] bg-slate-950 rounded-xl border border-slate-800" id="trend-svg-chart">
        {/* Grids */}
        <line x1={padding} y1={height / 2} x2={width - padding} y2={height / 2} stroke="#1e293b" strokeDasharray="4 4" />
        <line x1={padding} y1={padding} x2={width - padding} y2={padding} stroke="#1e293b" strokeWidth="0.5" />
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#1e293b" strokeWidth="0.5" />

        {/* Polylines path */}
        <polyline
          fill="none"
          stroke={config.lineColor}
          strokeWidth="2.5"
          points={points}
        />

        {/* Glowing gradient filled area */}
        <path
          d={`M ${padding},${height - padding} L ${points} L ${width - padding},${height - padding} Z`}
          fill={`url(#gradient-${metricKey})`}
          opacity="0.15"
        />

        {/* Linear Gradient declaration */}
        <defs>
          <linearGradient id={`gradient-${metricKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={config.lineColor} />
            <stop offset="100%" stopColor={config.lineColor} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Circles for values */}
        {data.map((val, idx) => {
          if (idx % 8 !== 0 && idx !== data.length - 1) return null;
          const x = padding + (idx / (data.length - 1)) * (width - padding * 2);
          const normalizedY = (val - dataMin) / (dataMax - dataMin);
          const y = height - padding - normalizedY * (height - padding * 2);
          return (
            <g key={idx}>
              <circle cx={x} cy={y} r="3.5" fill={config.lineColor} />
              <text x={x} y={y - 8} fill="#94a3b8" fontSize="10" fontFamily="monospace" textAnchor="middle">
                {Math.round(val * 10) / 10}
              </text>
            </g>
          );
        })}
      </svg>
    );
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-xs" id="realtime-data-panel">
      
      {/* Panel title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
            <Activity className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-800 text-lg">24H 实时生物体征与物理遥测系统</h3>
            <p className="text-xs text-slate-400">毫秒级数据轮询 · 物理功耗监控 · 云端模拟波形发生器</p>
          </div>
        </div>

        {/* Telemetry Stats mini pills */}
        <div className="flex items-center gap-2 flex-wrap text-[11px] font-mono">
          <div className={`px-2.5 py-1 rounded-md flex items-center gap-1.5 border ${
            isHardwareConnected 
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
              : 'bg-amber-50 text-amber-700 border-amber-200'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isHardwareConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
            <span>{isHardwareConnected ? 'ESP32-S3 物理硬件在线' : '中继监听中: 触发高精度仿真'}</span>
          </div>
          <div className="px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-md text-slate-500 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
            <span>芯片温度: <strong className="text-slate-700">{cpuTemp.toFixed(1)}°C</strong></span>
          </div>
          <div className="px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-md text-slate-500 flex items-center gap-1">
            <Zap className="w-3 h-3 text-amber-500" />
            <span>硬件功耗: <strong className="text-slate-700">{powerDraw} mW</strong></span>
          </div>
          <div className="px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-md text-slate-500 flex items-center gap-1">
            <Wifi className="w-3 h-3 text-blue-500" />
            <span>网关延迟: <strong className="text-slate-700">{wifiPing} ms</strong></span>
          </div>
        </div>
      </div>

      {/* Main Grid: left interactive metric cards, right big visualization */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left: 4 interactive cards (grid spanning 5 columns) */}
        <div className="lg:col-span-5 space-y-3">
          {(Object.keys(metricConfig) as Array<'hr' | 'spo2' | 'gsr' | 'hrv'>).map((key) => {
            const m = metricConfig[key];
            const isSelected = selectedMetric === key;
            return (
              <button
                key={key}
                onClick={() => setSelectedMetric(key)}
                className={`w-full text-left p-4 rounded-xl border transition-all flex items-center justify-between cursor-pointer ${
                  isSelected
                    ? 'bg-slate-900 text-white border-slate-900 shadow-md scale-[1.01]'
                    : 'bg-slate-50 text-slate-700 border-slate-100 hover:border-slate-300 hover:bg-slate-100/50'
                }`}
              >
                <div className="space-y-1">
                  <span className={`text-[10px] font-bold uppercase tracking-wider block ${isSelected ? 'text-indigo-400' : 'text-slate-400'}`}>
                    {m.label}
                  </span>
                  <span className="font-mono text-xl font-bold block tracking-tight">
                    {m.value}
                  </span>
                </div>
                <div className={`p-2.5 rounded-lg shrink-0 ${isSelected ? 'bg-slate-800 text-white' : 'bg-white text-slate-500 shadow-2xs'}`}>
                  {key === 'hr' && <Heart className={`w-4 h-4 text-rose-500 ${activeMode !== 'idle' ? 'animate-pulse' : ''}`} />}
                  {key === 'spo2' && <Activity className="w-4 h-4 text-emerald-500" />}
                  {key === 'gsr' && <Sparkles className="w-4 h-4 text-cyan-500" />}
                  {key === 'hrv' && <Sliders className="w-4 h-4 text-indigo-500" />}
                </div>
              </button>
            );
          })}
        </div>

        {/* Right: Big Focused Metric Detail & SVG Trend (grid spanning 7 columns) */}
        <div className="lg:col-span-7 bg-slate-50 rounded-2xl border border-slate-100 p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-semibold text-slate-800 text-sm flex items-center gap-1.5">
                <Eye className="w-4 h-4 text-indigo-500" />
                <span>生理指标精细走线趋势图:</span>
                <span className="font-mono text-xs text-indigo-600 font-bold uppercase">
                  {selectedMetric.toUpperCase()}
                </span>
              </h4>
              <span className="text-[10px] font-mono text-slate-400">实时更新 (0.8s 刷新率)</span>
            </div>
            
            <p className="text-xs text-slate-500 mb-4 leading-relaxed bg-white border border-slate-100 p-2.5 rounded-lg">
              {metricConfig[selectedMetric].desc}
            </p>

            {/* Render the selected graph */}
            <div className="relative">
              {renderTrendChart(selectedMetric)}
              
              {/* Anomaly Progress Indicator overlay bar */}
              {anomalyType !== 'none' && (
                <div className="absolute bottom-2 left-2 right-2 bg-slate-900/90 border border-slate-800 rounded-md p-2 flex items-center justify-between text-[11px] font-mono">
                  <span className="text-amber-400 flex items-center gap-1 shrink-0">
                    <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
                    已注入仿真: {getAnomalyName(anomalyType)}
                  </span>
                  <div className="flex-1 mx-3 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-amber-500 transition-all duration-300"
                      style={{ width: `${anomalyProgress}%` }}
                    />
                  </div>
                  <span className="text-slate-400 text-[10px]">{anomalyProgress}%</span>
                </div>
              )}
            </div>
          </div>

        </div>

      </div>

    </div>
  );
}
