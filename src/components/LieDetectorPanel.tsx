import React, { useState, useEffect, useRef } from 'react';
import { Shield, Play, Square, Activity, AlertTriangle, Tag, Download, Trash, CheckCircle2 } from 'lucide-react';
import { DeviceConfig, EventTag, LiveSignalPoint } from '../types';

interface LieDetectorPanelProps {
  config: DeviceConfig;
  isActive: boolean;
  onStartLieMode: () => void;
  onStopLieMode: () => void;
  onLogMessage: (type: 'info' | 'warn' | 'error' | 'rx' | 'tx', msg: string) => void;
}

export default function LieDetectorPanel({
  config,
  isActive,
  onStartLieMode,
  onStopLieMode,
  onLogMessage
}: LieDetectorPanelProps) {
  // UI states
  const [showSandboxModal, setShowSandboxModal] = useState<boolean>(false);
  const [questionText, setQuestionText] = useState<string>('');
  const [eventTags, setEventTags] = useState<EventTag[]>([]);
  const [stressLevel, setStressLevel] = useState<number>(10); // 0-100%
  const [heartRate, setHeartRate] = useState<number>(72);
  const [hrv, setHrv] = useState<number>(64);
  const [gsrValue, setGsrValue] = useState<number>(2.4); // microsiemens

  // Refs for canvas and animation
  const ecgCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const ppgCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const gsrCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Buffers for real-time display
  const pointsRef = useRef<LiveSignalPoint[]>([]);
  const phaseRef = useRef<number>(0);
  const timeRef = useRef<number>(0);
  const activeStressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const stressResponseActiveRef = useRef<boolean>(false);
  const stressResponseFactorRef = useRef<number>(0); // 0 (relaxed) to 1 (max stress)

  // Quick preset questions
  const presetQuestions = [
    '这是你的真实名字吗？',
    '你昨天晚上是否私自动用过核心盒？',
    '你对本次生物监测系统有说谎吗？',
    '刚才的回答，你百分之百诚实吗？'
  ];

  // Initialize and run the 200Hz raw waveform generator
  useEffect(() => {
    if (!isActive) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      pointsRef.current = [];
      return;
    }

    onLogMessage('info', 'ESP32-S3 进入测谎实验模式：强制开启 (ECG+PPG+GSR)');
    onLogMessage('info', '高频采样激活：200Hz 原始 ADC 激流长连接上传中...');

    // Warm-up buffers
    pointsRef.current = Array.from({ length: 400 }, (_, i) => ({
      time: -2 + i * 0.005,
      ecg: 0.5,
      ppg: 0.5,
      gsr: 2.0
    }));

    const updateSignals = () => {
      timeRef.current += 0.005; // 200Hz step (5ms)

      // Base physiological factors governed by stress level
      const currentStress = stressResponseFactorRef.current; // 0 to 1
      const targetHr = 70 + currentStress * 35; // Stress heart rate spikes to 105
      const targetHrv = 65 - currentStress * 35; // HRV plummets from 65 to 30ms

      // Smoothly interpolate metrics for visual dashboard
      setHeartRate((prev) => prev + (targetHr - prev) * 0.05);
      setHrv((prev) => prev + (targetHrv - prev) * 0.05);

      // Heart frequency in radians per sample step
      const currentHr = 70 + currentStress * 35;
      const omega = (currentHr / 60) * 2 * Math.PI; // rad/sec
      phaseRef.current = (phaseRef.current + omega * 0.005) % (2 * Math.PI);

      // 1. ECG (AD8232) Waveform synthesis
      let ecgVal = 0.5;
      const theta = phaseRef.current;

      // P wave
      if (theta > 0.1 && theta < 0.4) {
        ecgVal += 0.08 * Math.sin(((theta - 0.1) / 0.3) * Math.PI);
      }
      // Q wave
      if (theta >= 0.45 && theta < 0.5) {
        ecgVal -= 0.06 * Math.sin(((theta - 0.45) / 0.05) * Math.PI);
      }
      // R wave (Sharp high spike)
      if (theta >= 0.5 && theta < 0.58) {
        ecgVal += 0.65 * Math.sin(((theta - 0.5) / 0.08) * Math.PI);
      }
      // S wave (Deep dip)
      if (theta >= 0.58 && theta < 0.64) {
        ecgVal -= 0.15 * Math.sin(((theta - 0.58) / 0.06) * Math.PI);
      }
      // T wave (Medium wide bump)
      if (theta > 1.0 && theta < 1.6) {
        ecgVal += 0.18 * Math.sin(((theta - 1.0) / 0.6) * Math.PI);
      }
      // Noise component (simulates live physical ADC micro-deviations)
      ecgVal += (Math.random() - 0.5) * 0.015;

      // 2. PPG (MAX30102) Waveform synthesis
      // Slightly delayed relative to ECG (Pulse Transit Time)
      const ppgPhase = (theta - 0.65 + 2 * Math.PI) % (2 * Math.PI);
      let ppgVal = 0.4;
      if (ppgPhase < Math.PI * 1.2) {
        // Main systolic rise & fall
        ppgVal += 0.35 * Math.sin((ppgPhase / (Math.PI * 1.2)) * Math.PI);
        // Add a secondary dicrotic notch
        if (ppgPhase > Math.PI * 0.4 && ppgPhase < Math.PI * 0.9) {
          ppgVal += 0.08 * Math.sin(((ppgPhase - Math.PI * 0.4) / (Math.PI * 0.5)) * Math.PI);
        }
      }
      ppgVal += (Math.random() - 0.5) * 0.008;

      // 3. GSR (Skin Conductance) Synthesis
      // Slower changes. Rises sharply during stress response, then decays slowly.
      let targetGsr = 2.0 + currentStress * 1.8;
      let currentGsr = pointsRef.current[pointsRef.current.length - 1]?.gsr || 2.0;

      // Fast rising, slower decaying
      if (currentGsr < targetGsr) {
        currentGsr += 0.004; // rising rate
      } else {
        currentGsr -= 0.0008; // slow decay rate
      }
      // Add fine electrodermal noise
      currentGsr += (Math.random() - 0.5) * 0.001;
      setGsrValue(Math.round(currentGsr * 100) / 100);

      // Append new coordinate point
      pointsRef.current.push({
        time: timeRef.current,
        ecg: ecgVal,
        ppg: ppgVal,
        gsr: currentGsr
      });

      // Maintain buffer size (keep latest 500 points)
      if (pointsRef.current.length > 500) {
        pointsRef.current.shift();
      }

      // Draw onto the three canvases
      drawCanvases();

      // Stress factor decay
      if (!stressResponseActiveRef.current && stressResponseFactorRef.current > 0) {
        stressResponseFactorRef.current -= 0.0005; // slowly return to relax state
      }

      // Live stress level percentage computation
      setStressLevel(Math.round(stressResponseFactorRef.current * 100));

      animationFrameRef.current = requestAnimationFrame(updateSignals);
    };

    animationFrameRef.current = requestAnimationFrame(updateSignals);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isActive]);

  // High performance Canvas drawing logic
  const drawCanvases = () => {
    const ecgCanvas = ecgCanvasRef.current;
    const ppgCanvas = ppgCanvasRef.current;
    const gsrCanvas = gsrCanvasRef.current;
    const points = pointsRef.current;

    if (!points || points.length === 0) return;

    const drawSingle = (canvas: HTMLCanvasElement, pointsAccessor: (pt: LiveSignalPoint) => number, color: string, isGsr = false) => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const width = canvas.width;
      const height = canvas.height;

      // Clear with dark grid look
      ctx.fillStyle = '#0b1329';
      ctx.fillRect(0, 0, width, height);

      // Draw grid lines
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 0.5;
      for (let x = 0; x < width; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += 30) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Plot signal curve
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.8;

      points.forEach((pt, idx) => {
        const x = (idx / points.length) * width;
        let yNorm = pointsAccessor(pt);

        if (isGsr) {
          // GSR ranges roughly from 1.5 to 4.5
          yNorm = (pt.gsr - 1.5) / 3.0;
        }

        // Invert Y for canvas coordinate system (0 is at top)
        const y = height - (yNorm * 0.8 + 0.1) * height;

        if (idx === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.stroke();

      // Highlight the newest lead tip point
      if (points.length > 0) {
        const lastIdx = points.length - 1;
        const xLast = width;
        let yNorm = pointsAccessor(points[lastIdx]);
        if (isGsr) yNorm = (points[lastIdx].gsr - 1.5) / 3.0;
        const yLast = height - (yNorm * 0.8 + 0.1) * height;

        ctx.beginPath();
        ctx.fillStyle = color;
        ctx.arc(xLast - 2, yLast, 4, 0, 2 * Math.PI);
        ctx.fill();
      }
    };

    if (ecgCanvas) drawSingle(ecgCanvas, (pt) => pt.ecg, '#f43f5e'); // Rose ECG
    if (ppgCanvas) drawSingle(ppgCanvas, (pt) => pt.ppg, '#10b981'); // Emerald PPG
    if (gsrCanvas) drawSingle(gsrCanvas, (pt) => pt.gsr, '#06b6d4', true); // Cyan GSR
  };

  // Trigger Autonomic Stress Event (Simulated Lie reaction)
  const handleTagEvent = (tagText: string) => {
    if (!isActive) return;

    const cleanText = tagText.trim() || '未设定提问';
    onLogMessage('tx', `网页端下发打标事件：[提问标记] "${cleanText}"`);

    // Record Event tag
    const relativeTime = Math.round(timeRef.current * 10) / 10;
    const newTag: EventTag = {
      id: Date.now().toString(),
      timestamp: relativeTime,
      questionText: cleanText,
      reactionDetected: false,
      hrIncrease: 0,
      gsrSurge: 0
    };

    setEventTags((prev) => [newTag, ...prev]);
    setQuestionText('');

    // Trigger physiological stress response with delay
    onLogMessage('info', `测谎脑电与皮肤电信号延迟计算中... 提问后 0.5s~3.0s 应激窗口已开启`);

    if (activeStressTimerRef.current) {
      clearTimeout(activeStressTimerRef.current);
    }

    // Lie detection delay simulation (physiological EDR latency is about 1.5 seconds)
    stressResponseActiveRef.current = true;
    
    // Simulate gradual autonomic arousal
    activeStressTimerRef.current = setTimeout(() => {
      stressResponseFactorRef.current = 0.85 + Math.random() * 0.15; // Set stress to maximum
      onLogMessage('warn', `自律神经应激反应触发！检测到交感神经激活 (HR 跃升, GSR 阻抗下降)`);

      // Update the tag with detection results
      setEventTags((prev) =>
        prev.map((t) =>
          t.id === newTag.id
            ? {
                ...t,
                reactionDetected: true,
                hrIncrease: Math.round(18 + Math.random() * 12),
                gsrSurge: Math.round((1.1 + Math.random() * 0.8) * 10) / 10
              }
            : t
        )
      );

      // Relax after some time
      setTimeout(() => {
        stressResponseActiveRef.current = false;
      }, 3500);

    }, 1200); // 1.2s physiological latent delay
  };

  const handleStartMode = () => {
    if (!config.isOnline) return;
    onStartLieMode();
  };

  const handleStopMode = () => {
    onStopLieMode();
    // Open the CSV download / sandbox destruction popup required by Section 3.2
    setShowSandboxModal(true);
  };

  const handleDestroySandbox = () => {
    setShowSandboxModal(false);
    setEventTags([]);
    onLogMessage('warn', '沙盒机制触发：测谎原始数据与标记已在内存中全量销毁，未向 PostgreSQL 写入任何条目。');
  };

  const handleExportCSV = () => {
    setShowSandboxModal(false);

    // Build actual CSV file formatted correctly for download
    let csvContent = 'data:text/csv;charset=utf-8,';
    csvContent += 'Timestamp(s),ECG(ADC_Raw),PPG(ADC_Raw),GSR(uS),EventTag\n';

    // Seed dummy raw points representation matching the live test
    const samples = Array.from({ length: 150 }, (_, i) => {
      const ts = i * 0.1;
      const hasTag = eventTags.find((t) => Math.abs(t.timestamp - ts) < 0.08);
      const ecg = (0.5 + Math.sin(ts * 6.28) * 0.2).toFixed(3);
      const ppg = (0.4 + Math.cos(ts * 6.28) * 0.15).toFixed(3);
      const gsr = (2.1 + (ts > 5 ? 1.4 * Math.exp(-(ts - 5) / 10) : 0)).toFixed(3);
      const tagStr = hasTag ? `"${hasTag.questionText}"` : '';
      return `${ts.toFixed(1)},${ecg},${ppg},${gsr},${tagStr}`;
    });

    csvContent += samples.join('\n');

    // Trigger physical web browser download
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `ESP32-S3_测谎测试报告_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setEventTags([]);
    onLogMessage('info', '测谎测试数据成功导出为 CSV 本地文件。');
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-xs h-full flex flex-col justify-between" id="lie-detector-panel">
      <div>
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-rose-50 text-rose-600 rounded-xl animate-pulse">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-800 text-lg">测谎实验室模式 (Lie Detector Mode)</h3>
              <p className="text-xs text-slate-400">200Hz 原始波高采样流 · 沙盒内存销毁保障</p>
            </div>
          </div>
          {isActive && (
            <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-100 text-rose-700 text-xs font-semibold animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-600" />
              高频流传输中
            </span>
          )}
        </div>

        {/* Dynamic Sandbox Modal Backdrop */}
        {showSandboxModal && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl max-w-md w-full border border-slate-100 p-6 shadow-2xl animate-in fade-in-50 zoom-in-95 duration-150">
              <div className="p-3 bg-amber-50 text-amber-600 rounded-xl w-12 h-12 flex items-center justify-center mb-4">
                <Shield className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-slate-800 mb-2">测谎原始数据沙盒结算</h3>
              <p className="text-xs text-slate-500 leading-relaxed mb-5">
                根据极客系统的安全数据隔离规范，本次测谎产生的 200Hz 原始高频波形数据<strong>默认不写入 PostgreSQL 生产数据库</strong>。请选择结算策略：
              </p>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleExportCSV}
                  className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>导出 CSV 报告</span>
                </button>
                <button
                  onClick={handleDestroySandbox}
                  className="flex-1 py-3 bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold rounded-xl border border-rose-200 text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Trash className="w-3.5 h-3.5" />
                  <span>全量销毁数据</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Content Screens */}
        {!isActive ? (
          <div className="bg-slate-50 border border-slate-100 rounded-xl p-5 mb-5 flex flex-col items-center justify-center text-center py-10">
            <Activity className="w-12 h-12 text-slate-300 mb-3 animate-pulse" />
            <h4 className="font-semibold text-slate-700 text-sm mb-1.5">准备开始测谎实验</h4>
            <p className="text-xs text-slate-400 max-w-sm mb-6 leading-relaxed">
              此模式将强制启用所有贴身电极及红外光电二极管（AD8232 + MAX30102 + GSR），以 200Hz 原始采样激流流向服务器，支持实时毫秒级生理绘图。
            </p>

            <button
              onClick={handleStartMode}
              disabled={!config.isOnline}
              className={`px-8 py-3 rounded-xl font-bold text-sm flex items-center gap-2 transition cursor-pointer ${
                config.isOnline
                  ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-md shadow-rose-100'
                  : 'bg-slate-200 text-slate-400 cursor-not-allowed border border-slate-200'
              }`}
            >
              <Play className="w-4 h-4 fill-current" />
              <span>启动测谎测试</span>
            </button>
            {!config.isOnline && (
              <p className="text-[10px] text-rose-500 mt-2.5 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                硬件离线，看门狗已冻结控制，请重连 WiFi
              </p>
            )}
          </div>
        ) : (
          /* Live Lie Detector Board */
          <div className="space-y-4">
            {/* Waveforms columns Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* ECG Canvas */}
              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-xs">
                <div className="bg-rose-50 border-b border-rose-100 px-3 py-1.5 flex justify-between items-center">
                  <span className="text-[10px] font-bold text-rose-700 uppercase">AD8232 心电信号 (ECG)</span>
                  <span className="text-xs font-mono font-bold text-rose-600">{Math.round(heartRate)} BPM</span>
                </div>
                <canvas ref={ecgCanvasRef} width={280} height={110} className="w-full h-[110px] block" />
              </div>

              {/* PPG Canvas */}
              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-xs">
                <div className="bg-emerald-50 border-b border-emerald-100 px-3 py-1.5 flex justify-between items-center">
                  <span className="text-[10px] font-bold text-emerald-700 uppercase">MAX30102 脉搏血氧 (PPG)</span>
                  <span className="text-xs font-mono font-bold text-emerald-600">SpO2: 98%</span>
                </div>
                <canvas ref={ppgCanvasRef} width={280} height={110} className="w-full h-[110px] block" />
              </div>

              {/* GSR Canvas */}
              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-xs">
                <div className="bg-cyan-50 border-b border-cyan-100 px-3 py-1.5 flex justify-between items-center">
                  <span className="text-[10px] font-bold text-cyan-700 uppercase">GSR 皮肤电传导度</span>
                  <span className="text-xs font-mono font-bold text-cyan-600">{gsrValue.toFixed(2)} μS</span>
                </div>
                <canvas ref={gsrCanvasRef} width={280} height={110} className="w-full h-[110px] block" />
              </div>
            </div>

            {/* Live Lie Indices Metrics row */}
            <div className="grid grid-cols-3 gap-3 p-3.5 bg-slate-900 rounded-xl border border-slate-800 text-slate-100">
              <div className="text-center border-r border-slate-800">
                <span className="text-[10px] text-slate-400 block mb-0.5">自律应激水平 (Lie Prob)</span>
                <span className={`font-mono text-lg font-bold ${stressLevel > 50 ? 'text-rose-500 animate-pulse' : 'text-emerald-400'}`}>
                  {stressLevel}%
                </span>
              </div>
              <div className="text-center border-r border-slate-800">
                <span className="text-[10px] text-slate-400 block mb-0.5">瞬时心率</span>
                <span className="font-mono text-lg font-bold text-slate-100">{Math.round(heartRate)} BPM</span>
              </div>
              <div className="text-center">
                <span className="text-[10px] text-slate-400 block mb-0.5">HRV变异度 (RMS)</span>
                <span className="font-mono text-lg font-bold text-cyan-400">{Math.round(hrv)} ms</span>
              </div>
            </div>

            {/* Stress Alert Banner */}
            {stressLevel > 50 && (
              <div className="p-3 bg-rose-50 border border-rose-100 text-rose-800 rounded-xl text-xs leading-relaxed flex gap-2.5 animate-bounce">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <strong>检测到微汗应激反应！</strong> 皮肤阻抗急剧下降，心跳变动范围(HRV)瞬时收缩。被测人自律神经发生防御性兴奋。
                </div>
              </div>
            )}

            {/* Question Tagging Section */}
            <div className="bg-slate-50 p-4 border border-slate-150 rounded-xl">
              <label className="text-xs font-semibold text-slate-700 block mb-2">提问并进行时间轴打标 (Event Tagging)</label>
              <div className="flex gap-2 mb-3">
                <input
                  type="text"
                  placeholder="输入提问内容，点击打标或按回车..."
                  value={questionText}
                  onChange={(e) => setQuestionText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleTagEvent(questionText);
                  }}
                  className="flex-1 px-3.5 py-2 border border-slate-200 rounded-lg text-xs bg-white focus:outline-hidden focus:ring-1 focus:ring-rose-500"
                />
                <button
                  onClick={() => handleTagEvent(questionText)}
                  className="px-4 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-lg text-xs flex items-center gap-1 transition shrink-0 cursor-pointer"
                >
                  <Tag className="w-3.5 h-3.5" />
                  <span>提问打标</span>
                </button>
              </div>

              {/* Preset questions fast buttons */}
              <div className="flex flex-wrap gap-1.5">
                {presetQuestions.map((q, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleTagEvent(q)}
                    className="text-[10px] text-slate-600 bg-white border border-slate-200 hover:bg-slate-100 rounded-full px-2.5 py-1 transition cursor-pointer"
                  >
                    + {q}
                  </button>
                ))}
              </div>
            </div>

            {/* Big Stop Button */}
            <button
              onClick={handleStopMode}
              className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition shadow-md cursor-pointer"
            >
              <Square className="w-4 h-4 fill-current text-rose-500" />
              <span>结束测谎测试 (进入沙盒清算)</span>
            </button>
          </div>
        )}
      </div>

      {/* Tags List History in active session */}
      {isActive && eventTags.length > 0 && (
        <div className="border-t border-slate-100 pt-4 mt-4">
          <h4 className="text-xs font-semibold text-slate-700 mb-2">本次测谎提问应激轴 (时间轴标记)</h4>
          <div className="space-y-2 max-h-[140px] overflow-y-auto pr-1">
            {eventTags.map((tag) => (
              <div key={tag.id} className="p-3 bg-slate-50 border border-slate-100 rounded-lg flex items-start justify-between gap-3 text-xs">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-[10px] px-1.5 py-0.5 bg-slate-200 text-slate-600 rounded">
                      {tag.timestamp.toFixed(1)} 秒
                    </span>
                    <strong className="text-slate-800">"{tag.questionText}"</strong>
                  </div>
                  {tag.reactionDetected ? (
                    <p className="text-[11px] text-rose-600 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      应激触发: 心率上升 +{tag.hrIncrease}BPM · 皮肤汗液阻抗变化 +{tag.gsrSurge}μS
                    </p>
                  ) : (
                    <p className="text-[11px] text-slate-400">分析中...</p>
                  )}
                </div>
                {tag.reactionDetected && (
                  <span className="text-[10px] bg-rose-100 text-rose-800 px-2 py-0.5 rounded-full font-bold">
                    应激显著
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
