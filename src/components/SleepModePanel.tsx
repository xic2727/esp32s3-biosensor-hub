import React, { useState, useEffect } from 'react';
import { Heart, Moon, Zap, AlertCircle, Activity, Star, CheckCircle, Trash } from 'lucide-react';
import { DeviceConfig, SleepRecord } from '../types';

interface SleepModePanelProps {
  config: DeviceConfig;
  isActive: boolean;
  onStartSleepMode: (ecgEnabled: boolean) => void;
  onStopSleepMode: () => void;
  onSaveRecord: (record: SleepRecord) => void;
  historicalRecords: SleepRecord[];
  onDeleteRecord: (id: string) => void;
}

export default function SleepModePanel({
  config,
  isActive,
  onStartSleepMode,
  onStopSleepMode,
  onSaveRecord,
  historicalRecords,
  onDeleteRecord
}: SleepModePanelProps) {
  // Local toggles
  const [addEcg, setAddEcg] = useState<boolean>(false);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);

  // Live aggregated sensor values for display during active sleep monitoring
  const [liveHr, setLiveHr] = useState<number>(62);
  const [liveSpO2, setLiveSpO2] = useState<number>(98);
  const [liveHrv, setLiveHrv] = useState<number>(55);
  const [accumulatedHr, setAccumulatedHr] = useState<number[]>([]);
  const [accumulatedSpO2, setAccumulatedSpO2] = useState<number[]>([]);
  const [accumulatedHrv, setAccumulatedHrv] = useState<number[]>([]);

  // Simulation timer during active mode
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isActive) {
      timer = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);

        // Fluctuate values in a realistic sleeping range
        // HR goes down in deep sleep, fluctuates slightly
        const hrDelta = Math.random() > 0.5 ? 1 : -1;
        const nextHr = Math.max(48, Math.min(75, liveHr + (Math.random() > 0.8 ? hrDelta : 0)));
        setLiveHr(nextHr);
        setAccumulatedHr((prev) => [...prev, nextHr]);

        // SpO2 stays high, occasionally drops 1%
        const spo2Delta = Math.random() > 0.95 ? (Math.random() > 0.5 ? 1 : -1) : 0;
        const nextSpO2 = Math.max(94, Math.min(100, liveSpO2 + spo2Delta));
        setLiveSpO2(nextSpO2);
        setAccumulatedSpO2((prev) => [...prev, nextSpO2]);

        // HRV fluctuates around 50-70ms
        const hrvDelta = Math.random() > 0.5 ? 2 : -2;
        const nextHrv = Math.max(40, Math.min(85, liveHrv + (Math.random() > 0.7 ? hrvDelta : 0)));
        setLiveHrv(nextHrv);
        setAccumulatedHrv((prev) => [...prev, nextHrv]);
      }, 1000);
    } else {
      setElapsedSeconds(0);
      setLiveHr(60);
      setLiveSpO2(98);
      setLiveHrv(55);
      setAccumulatedHr([]);
      setAccumulatedSpO2([]);
      setAccumulatedHrv([]);
    }

    return () => clearInterval(timer);
  }, [isActive, liveHr, liveSpO2, liveHrv]);

  // Handle Starting Sleep Mode
  const handleStart = () => {
    if (!config.isOnline) return;
    onStartSleepMode(addEcg);
  };

  // Handle stopping sleep mode, generating aggregated data and saving to simulated PostgreSQL
  const handleStopAndGenerateReport = () => {
    const finalHrArray = accumulatedHr.length > 0 ? accumulatedHr : [58, 60, 57, 59, 61, 58];
    const finalSpO2Array = accumulatedSpO2.length > 0 ? accumulatedSpO2 : [98, 97, 98, 98, 99, 97];
    const finalHrvArray = accumulatedHrv.length > 0 ? accumulatedHrv : [52, 58, 55, 60, 54, 56];

    const avgHr = Math.round(finalHrArray.reduce((a, b) => a + b, 0) / finalHrArray.length);
    const avgSpO2 = Math.round((finalSpO2Array.reduce((a, b) => a + b, 0) / finalSpO2Array.length) * 10) / 10;
    const avgHrv = Math.round(finalHrvArray.reduce((a, b) => a + b, 0) / finalHrvArray.length);

    // Sleep quality calculation
    // Lower average HR is good, higher SpO2 is good, higher HRV is good
    let score = 80;
    if (avgHr < 60) score += 8;
    if (avgHr > 70) score -= 8;
    if (avgSpO2 >= 98) score += 5;
    if (avgSpO2 < 95) score -= 15;
    if (avgHrv > 55) score += 7;
    score = Math.max(40, Math.min(100, score));

    // Hypnogram curve generator (10 steps)
    const hypnogram = [4, 3, 2, 1, 1, 2, 1, 3, 2, 4]; // stages: 4-Wake, 3-REM, 2-Light, 1-Deep

    // Autonomic Nervous System Balance assessment
    // High HRV usually points to Parasympathetic dominance (rest & digest, good recovery)
    let ans: 'sympathetic_dominant' | 'balanced' | 'parasympathetic_dominant' = 'balanced';
    if (avgHrv > 62) {
      ans = 'parasympathetic_dominant';
    } else if (avgHrv < 48) {
      ans = 'sympathetic_dominant';
    }

    const reportSummaries = [
      "自律神经恢复极佳。夜间脉搏平缓，深睡眠充足，心肺耦合度高。",
      "身体机能轻度疲劳。自律神经处于平衡状态，建议维持良好的入睡时间。",
      "副交感神经系统受抑制。夜间平均心率偏高，可能存在日间精神压力积攒或睡前摄入咖啡因，深睡眠偏低。"
    ];

    const summary = score >= 85 ? reportSummaries[0] : score >= 70 ? reportSummaries[1] : reportSummaries[2];

    const newRecord: SleepRecord = {
      id: Date.now().toString(),
      timestamp: new Date().toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) + ' 夜间监测',
      avgHeartRate: avgHr,
      avgSpO2: avgSpO2,
      hrvScore: avgHrv,
      deepSleepPercent: score > 80 ? 25 : score > 65 ? 18 : 12,
      remSleepPercent: score > 80 ? 22 : score > 65 ? 20 : 15,
      ansBalance: ans,
      qualityScore: score,
      hypnogram,
      summary
    };

    onStopSleepMode();
    onSaveRecord(newRecord);
  };

  const getAnsBalanceText = (ans: SleepRecord['ansBalance']) => {
    switch (ans) {
      case 'parasympathetic_dominant':
        return { label: '副交感 dominant (深度恢复)', color: 'text-emerald-600 bg-emerald-50 border-emerald-100' };
      case 'sympathetic_dominant':
        return { label: '交感 dominant (精神疲劳)', color: 'text-amber-600 bg-amber-50 border-amber-100' };
      default:
        return { label: '平衡 (Balanced)', color: 'text-indigo-600 bg-indigo-50 border-indigo-100' };
    }
  };

  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-xs h-full flex flex-col justify-between" id="sleep-mode-panel">
      <div>
        {/* Title */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
              <Moon className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-800 text-lg">夜间睡眠监测模式 (Sleep Mode)</h3>
              <p className="text-xs text-slate-400">1Hz 慢速低噪采样 · 自律神经平衡度计算</p>
            </div>
          </div>
          {isActive && (
            <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-indigo-100 text-indigo-700 text-xs font-semibold animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-600" />
              正在监测
            </span>
          )}
        </div>

        {/* Info Box */}
        <p className="text-xs text-slate-500 mb-5 leading-relaxed">
          <strong>无干扰静默规范：</strong> 启动后，ESP32-S3 将强制熄灭板载 RGB 与所有 LED，以避免光污染。数据经由本地轻量化滤波，每秒向 PostgreSQL 数据库持久化存储一次生理聚合点。
        </p>

        {/* Mode Configuration & Control Trigger */}
        {!isActive ? (
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 mb-6">
            <h4 className="text-xs font-semibold text-slate-600 mb-3">监测参数配置</h4>

            <div className="space-y-3 mb-5">
              <div className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  id="default-ppg"
                  checked={true}
                  disabled={true}
                  className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4 border-slate-200 mt-0.5"
                />
                <label htmlFor="default-ppg" className="text-xs text-slate-600 cursor-not-allowed">
                  <span className="font-medium text-slate-800 block">默认启用 PPG 血氧脉搏监控 (MAX30102)</span>
                  <span className="text-slate-400">无感贴身佩戴，驱动电流限制在防烫伤安全区间</span>
                </label>
              </div>

              <div className="flex items-start gap-2.5 pt-2 border-t border-slate-200/50">
                <input
                  type="checkbox"
                  id="add-ecg"
                  checked={addEcg}
                  onChange={(e) => setAddEcg(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4 border-slate-200 mt-0.5 cursor-pointer"
                />
                <label htmlFor="add-ecg" className="text-xs text-slate-600 cursor-pointer select-none">
                  <span className="font-medium text-slate-800 block flex items-center gap-1">
                    加测完整夜间心电 (AD8232)
                    <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded-full font-bold scale-90 origin-left">
                      需要贴片
                    </span>
                  </span>
                  <span className="text-slate-400">勾选后将激活心电传感器。需将三芯抗干扰电极贴于胸口</span>
                </label>
              </div>
            </div>

            {/* Launch Button */}
            <button
              onClick={handleStart}
              disabled={!config.isOnline}
              className={`w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition cursor-pointer ${
                config.isOnline
                  ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-100'
                  : 'bg-slate-200 text-slate-400 cursor-not-allowed border border-slate-200'
              }`}
            >
              <Moon className="w-4 h-4" />
              <span>开始夜间监测</span>
            </button>
            {!config.isOnline && (
              <p className="text-[10px] text-rose-500 text-center mt-2 flex items-center justify-center gap-1">
                <AlertCircle className="w-3 h-3" />
                硬件当前离线，无法下发指令
              </p>
            )}
          </div>
        ) : (
          /* Active Simulation Screen */
          <div className="bg-slate-950 text-slate-100 rounded-xl p-5 border border-slate-800 mb-6 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-900/10 rounded-full blur-2xl pointer-events-none" />

            <div className="flex justify-between items-center mb-4">
              <span className="text-[10px] text-indigo-400 tracking-widest font-bold uppercase">
                实时夜间生理聚合中
              </span>
              <span className="text-xs font-mono bg-indigo-950 text-indigo-300 border border-indigo-900/40 px-2 py-0.5 rounded">
                运行时间: {formatTime(elapsedSeconds)}
              </span>
            </div>

            {/* Live aggregated visual digits */}
            <div className="grid grid-cols-3 gap-3 mb-5">
              <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800/60 text-center">
                <span className="text-[10px] text-slate-400 block mb-1">平均心率 (HR)</span>
                <span className="font-mono text-xl font-bold text-rose-400 flex items-center justify-center gap-1">
                  <Heart className="w-3.5 h-3.5 text-rose-500 animate-pulse shrink-0" />
                  {liveHr} <span className="text-[10px] text-slate-500 font-normal">BPM</span>
                </span>
              </div>

              <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800/60 text-center">
                <span className="text-[10px] text-slate-400 block mb-1">血氧浓度 (SpO2)</span>
                <span className="font-mono text-xl font-bold text-emerald-400">
                  {liveSpO2}%
                </span>
              </div>

              <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800/60 text-center">
                <span className="text-[10px] text-slate-400 block mb-1">心率变异度 (HRV)</span>
                <span className="font-mono text-xl font-bold text-cyan-400 flex items-center justify-center gap-1">
                  <Activity className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  {liveHrv} <span className="text-[10px] text-slate-500 font-normal">ms</span>
                </span>
              </div>
            </div>

            {/* Silent Mode Banner */}
            <div className="p-2.5 bg-indigo-950/40 border border-indigo-900/30 rounded-lg text-[11px] text-indigo-300 flex items-center gap-2 mb-4">
              <Moon className="w-3.5 h-3.5 shrink-0 text-indigo-400" />
              <span>
                <strong>静默保护运行：</strong> ESP32 处于静默休眠灯效。数据每1秒打包。
              </span>
            </div>

            {/* Stop and aggregation button */}
            <button
              onClick={handleStopAndGenerateReport}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition shadow-lg shadow-indigo-950"
            >
              <Moon className="w-3.5 h-3.5" />
              <span>结束监测并保存至 PostgreSQL 数据库</span>
            </button>
          </div>
        )}
      </div>

      {/* PostgreSQL Database Section (History) */}
      <div className="border-t border-slate-100 pt-5 mt-4">
        <h4 className="text-xs font-semibold text-slate-700 mb-3 flex items-center justify-between">
          <span>PostgreSQL 历史数据资产 (睡眠健康趋势)</span>
          <span className="text-[10px] font-normal text-slate-400">永久库存储</span>
        </h4>

        {historicalRecords.length === 0 ? (
          <div className="bg-slate-50 border border-dashed border-slate-200 rounded-xl p-6 text-center text-slate-400 text-xs">
            暂无已存的夜间睡眠记录。请开始您的第一晚夜间监测！
          </div>
        ) : (
          <div className="space-y-4 max-h-[220px] overflow-y-auto pr-1">
            {historicalRecords.map((record) => {
              const ansInfo = getAnsBalanceText(record.ansBalance);
              return (
                <div key={record.id} className="p-4 bg-slate-50 border border-slate-100 rounded-xl relative hover:border-slate-200 transition">
                  <button
                    onClick={() => onDeleteRecord(record.id)}
                    className="absolute top-3 right-3 text-slate-300 hover:text-rose-500 p-1 rounded-md transition"
                    title="删除此记录"
                  >
                    <Trash className="w-3.5 h-3.5" />
                  </button>

                  <div className="flex flex-wrap items-center gap-2 mb-2.5">
                    <span className="text-xs font-semibold text-slate-700">{record.timestamp}</span>
                    <span className="text-xs font-mono font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded">
                      睡眠得分: {record.qualityScore}
                    </span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border ${ansInfo.color}`}>
                      {ansInfo.label}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center bg-white p-2 rounded-lg border border-slate-100 mb-2.5">
                    <div>
                      <span className="text-[10px] text-slate-400 block">心率均值</span>
                      <span className="text-xs font-semibold text-slate-700">{record.avgHeartRate} BPM</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block">血氧均值</span>
                      <span className="text-xs font-semibold text-slate-700">{record.avgSpO2}%</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block">HRV 变异度</span>
                      <span className="text-xs font-semibold text-slate-700">{record.hrvScore} ms</span>
                    </div>
                  </div>

                  {/* Sleep Hypnogram visual layout */}
                  <div className="mb-2">
                    <span className="text-[10px] text-slate-400 block mb-1">夜间睡眠周期曲线 (Hypnogram):</span>
                    <div className="h-8 flex items-end gap-1 px-1 bg-white border border-slate-100 rounded-md">
                      {record.hypnogram.map((stage, idx) => {
                        // stages: 4-Wake (lowest bar), 3-REM, 2-Light, 1-Deep (highest bar)
                        const heights = ['h-0', 'h-full bg-indigo-600', 'h-4/6 bg-indigo-400', 'h-3/6 bg-indigo-300', 'h-1/6 bg-amber-400'];
                        const labels = ['', '深睡', '浅睡', 'REM', '清醒'];
                        return (
                          <div
                            key={idx}
                            title={labels[stage]}
                            className={`flex-1 rounded-t-xs ${heights[stage]}`}
                          />
                        );
                      })}
                    </div>
                    <div className="flex justify-between text-[8px] text-slate-400 px-0.5 mt-0.5 font-mono">
                      <span>23:00 入睡</span>
                      <span>07:00 醒来</span>
                    </div>
                  </div>

                  <p className="text-[11px] text-slate-500 leading-relaxed bg-white p-2 rounded border border-slate-100 flex gap-1.5 items-start">
                    <Star className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                    <span>{record.summary}</span>
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
