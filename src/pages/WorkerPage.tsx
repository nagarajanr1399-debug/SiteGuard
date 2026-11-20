import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  BatteryWarning,
  BluetoothOff,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Code2,
  MapPinOff,
  Mic,
  OctagonAlert,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Thermometer,
  Wrench,
} from 'lucide-react';
import { GlobalLanguagePicker } from '../components/GlobalLanguagePicker';
import { AnimatedMetric } from '../components/PageTransition';
import { SparklineChart } from '../components/SparklineChart';
import { VoiceIncidentRecorder } from '../components/VoiceIncidentRecorder';
import { WatchShell } from '../components/WatchShell';
import {
  AlertStateSwitcher,
  WearableAlertSpecColumn,
} from '../components/WearableAlertTelemetryPanels';
import { WorkerVoiceAlertBar } from '../components/WorkerVoiceAlertBar';
import { useAbuDhabiClock } from '../hooks/useAbuDhabiClock';
import {
  useWorkerVoiceAlerts,
  type GlobalLanguageOverride,
} from '../hooks/useWorkerVoiceAlerts';
import { getTierTokens, SG_SURFACES } from '../shared/designTokens';
import { synthesizeGemma4EdgeObservation } from '../shared/edgeWeatherFallback';
import { predictCompositeTrajectory } from '../shared/forecastEngine';
import type { GlobalLanguageOption } from '../shared/globalLanguages';
import { assessWorkerHeatRisk } from '../shared/riskEngine';
import { formatTemperature, type TemperatureUnit } from '../shared/temperature';
import {
  isRtlLanguage,
  LANGUAGE_LABELS,
  SUPPORTED_LANGUAGES,
  type BLETelemetryFrame,
  type EnvironmentalObservation,
  type FaultFlags,
  type SupportedLanguage,
  type WorkerAlertCopy,
  type WorkerStateSelf,
} from '../shared/types';
import {
  WEARABLE_SPEC_TELEMETRY,
  getWearableAlertSpecCopy,
  type WearableAlertStateId,
} from '../shared/wearableAlertSpecs';

function readCachedWorkerState(workerId: string): WorkerStateSelf | null {
  try {
    const raw = window.localStorage.getItem(`siteguard_worker_state_${workerId}`);
    if (!raw) return null;
    return JSON.parse(raw) as WorkerStateSelf;
  } catch {
    return null;
  }
}

function persistWorkerState(state: WorkerStateSelf) {
  try {
    window.localStorage.setItem(
      `siteguard_worker_state_${state.context.workerId}`,
      JSON.stringify(state)
    );
  } catch {
    // Ignore storage write errors
  }
}

function buildColdOfflineWorkerState(
  workerId: string,
  activeEnv: EnvironmentalObservation
): WorkerStateSelf {
  const context: WorkerStateSelf['context'] = {
    workerId,
    deviceId: `BLE-BAND-${workerId.replace(/\D/g, '') || '101'}`,
    roleLabel: 'Steel Fixer',
    zone: 'Zone A · Rebar Deck',
    ppeLevel: 'Standard Coverall',
    acclimatizationDays: 3,
    ageYears: 29,
    hr0: 68,
    tc0: 36.7,
    preferredLanguage: 'en',
    plannedBreakTime: '12:30',
    hydrationCount: 2,
    breaksTakenTodayMin: 20,
  };
  const faults: FaultFlags = {
    bleDisconnected: false,
    lowBattery: false,
    sensorNoise: false,
    gpsLoss: false,
  };
  const offlineBatteryByWorker: Record<string, number> = {
    'W-101': 95,
    'W-102': 79,
    'W-103': 92,
    'W-104': 68,
    'W-105': 89,
    'W-106': 84,
  };
  const frame: BLETelemetryFrame = {
    deviceId: context.deviceId,
    workerId,
    timestamp: new Date().toISOString(),
    hrBpm: 94,
    skinTempC: 34.1,
    exertionIndex: 5.5,
    batteryPct: offlineBatteryByWorker[workerId] ?? 91,
    rssiDbm: -61,
    gpsFix: true,
    signalQuality: 0.97,
    simulatedClockMin: 12,
  };
  const assessment = assessWorkerHeatRisk(context, frame, activeEnv, faults);
  const history = [0, 3, 6, 9, 12].map((minOffset, idx) => ({
    minuteOffset: minOffset,
    timestamp: new Date(Date.now() - (4 - idx) * 180_000).toISOString(),
    psi: Number(Math.max(1.2, (assessment.psi ?? 3.2) - (4 - idx) * 0.25).toFixed(2)),
    compositeScore: Number(Math.max(1.5, assessment.compositeScore - (4 - idx) * 0.2).toFixed(2)),
    wbgtC: activeEnv.wbgtC,
    degraded: false,
  }));
  const forecast = predictCompositeTrajectory(history, 0.45);
  const copy = {
    headline:
      assessment.tier === 'Red'
        ? 'STOP WORK NOW — CRITICAL HEAT'
        : assessment.tier === 'Amber'
          ? 'REST IN SHADE — ELEVATED STRAIN'
          : 'SAFE TO WORK — STAY HYDRATED',
    explanation: `Gemma 4 Edge Local Inference active (${activeEnv.wbgtC}°C WBGT).`,
    action: assessment.recommendedAction,
    proactiveForecastNote:
      forecast.projectedAmberCrossingMin !== null && forecast.projectedAmberCrossingMin > 0
        ? `Edge projection: Amber risk anticipated in ~${forecast.projectedAmberCrossingMin} min.`
        : null,
    source: 'template_fallback' as const,
    cached: true,
  };
  const alertTranslations = {} as WorkerStateSelf['alertTranslations'];
  for (const code of SUPPORTED_LANGUAGES) {
    alertTranslations[code] = copy;
  }
  return {
    context,
    latestFrame: frame,
    faults,
    assessment,
    forecast,
    history,
    alertTranslations,
    lastCheckIn: null,
    supervisorDirective: null,
    simulatedClockMin: 12,
  };
}

function recomputeLocalWorkerEdgeState(
  prev: WorkerStateSelf,
  activeEnv: EnvironmentalObservation,
  nextFrame?: BLETelemetryFrame,
  appendSample = false
): WorkerStateSelf {
  const frame = nextFrame ?? prev.latestFrame;
  const assessment = assessWorkerHeatRisk(prev.context, frame, activeEnv, prev.faults);
  const nextHistory = [...prev.history];
  if (appendSample) {
    nextHistory.push({
      minuteOffset: frame.simulatedClockMin ?? prev.simulatedClockMin + 3,
      timestamp: frame.timestamp,
      psi: assessment.psi,
      compositeScore: assessment.compositeScore,
      wbgtC: activeEnv.wbgtC,
      degraded: assessment.scoringMode === 'environment_only_degraded',
    });
  } else if (nextHistory.length > 0) {
    const last = nextHistory[nextHistory.length - 1];
    nextHistory[nextHistory.length - 1] = {
      ...last,
      psi: assessment.psi,
      compositeScore: assessment.compositeScore,
      wbgtC: activeEnv.wbgtC,
      degraded: assessment.scoringMode === 'environment_only_degraded',
    };
  }
  const trimmedHistory = nextHistory.slice(-24);
  const forecast = predictCompositeTrajectory(trimmedHistory, 0.45);
  return {
    ...prev,
    latestFrame: frame,
    assessment,
    history: trimmedHistory,
    forecast,
    simulatedClockMin: frame.simulatedClockMin ?? prev.simulatedClockMin,
  };
}

interface WorkerPageProps {
  env: EnvironmentalObservation | null;
  tempUnit: TemperatureUnit;
}

interface WorkerOption {
  workerId: string;
  roleLabel: string;
  zone: string;
}

export function WorkerPage({ env, tempUnit }: WorkerPageProps) {
  const [workers, setWorkers] = useState<WorkerOption[]>([]);
  const [selectedWorkerId, setSelectedWorkerId] = useState('W-101');
  const [workerState, setWorkerState] = useState<WorkerStateSelf | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aodMode, setAodMode] = useState(false);
  const [voiceSheetOpen, setVoiceSheetOpen] = useState(false);
  const [simulatorOpen, setSimulatorOpen] = useState(false);
  const [showBleJson, setShowBleJson] = useState(false);
  const [alertPreviewState, setAlertPreviewState] = useState<WearableAlertStateId>('live');
  const [globalOverride, setGlobalOverride] = useState<GlobalLanguageOverride | null>(null);
  const [translatingGlobal, setTranslatingGlobal] = useState(false);
  const [autoSimRunning, setAutoSimRunning] = useState(false);
  const forecastSectionRef = useRef<HTMLDivElement | null>(null);
  const clock = useAbuDhabiClock();

  // Local slider mirrors inside collapsed Developer / BLE Simulator drawer
  const [hrSlider, setHrSlider] = useState(120);
  const [skinSlider, setSkinSlider] = useState(35.0);
  const [exertionSlider, setExertionSlider] = useState(6.0);
  const debounceRef = useRef<number | null>(null);

  const voiceAlerts = useWorkerVoiceAlerts({
    workerState,
    alertPreviewState,
    tempUnit,
    globalLanguageOverride: globalOverride,
  });

  const getActiveOfflineEnv = useCallback(
    () => env ?? synthesizeGemma4EdgeObservation(null, 'Gemma 4 Edge local inference active'),
    [env]
  );

  const loadWorkerState = useCallback(
    async (workerId: string) => {
      const applyFallback = () => {
        const offlineEnv = getActiveOfflineEnv();
        const cached = readCachedWorkerState(workerId);
        const edgeState = cached
          ? recomputeLocalWorkerEdgeState(cached, offlineEnv)
          : buildColdOfflineWorkerState(workerId, offlineEnv);
        setError(null);
        setWorkerState(edgeState);
        setHrSlider(edgeState.latestFrame.hrBpm);
        setSkinSlider(edgeState.latestFrame.skinTempC);
        setExertionSlider(edgeState.latestFrame.exertionIndex);
      };

      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        applyFallback();
        setLoading(false);
        return;
      }

      try {
        setError(null);
        const res = await fetch(`/api/worker/${workerId}/state`);
        if (!res.ok) throw new Error('Failed to load worker telemetry');
        const data = (await res.json()) as { state: WorkerStateSelf };
        const syncedState =
          env?.edgeOfflineActive
            ? recomputeLocalWorkerEdgeState(data.state, env)
            : data.state;
        persistWorkerState(syncedState);
        setWorkerState(syncedState);
        setHrSlider(syncedState.latestFrame.hrBpm);
        setSkinSlider(syncedState.latestFrame.skinTempC);
        setExertionSlider(syncedState.latestFrame.exertionIndex);
      } catch {
        applyFallback();
      } finally {
        setLoading(false);
      }
    },
    [env, getActiveOfflineEnv]
  );

  useEffect(() => {
    fetch('/api/workers')
      .then((r) => r.json())
      .then((d: { workers: WorkerOption[] }) => {
        setWorkers(d.workers);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    void loadWorkerState(selectedWorkerId);
  }, [selectedWorkerId, env?.wbgtC, env?.mode, env?.edgeOfflineActive, loadWorkerState]);

  const pushBleFrame = async (nextHr: number, nextSkin: number, nextExertion: number) => {
    if (!workerState) return;
    setUpdating(true);
    const payload: BLETelemetryFrame = {
      deviceId: workerState.context.deviceId,
      workerId: workerState.context.workerId,
      timestamp: new Date().toISOString(),
      hrBpm: nextHr,
      skinTempC: nextSkin,
      exertionIndex: nextExertion,
      batteryPct: workerState.faults.lowBattery ? 6 : workerState.latestFrame.batteryPct,
      rssiDbm: workerState.faults.bleDisconnected ? -999 : -60,
      gpsFix: !workerState.faults.gpsLoss,
      signalQuality: workerState.faults.sensorNoise ? 0.22 : 0.98,
      simulatedClockMin: workerState.simulatedClockMin + 3,
    };

    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        throw new Error('Offline edge fallback');
      }
      const res = await fetch('/api/ble/telemetry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('BLE ingestion failed');
      const data = (await res.json()) as { state: WorkerStateSelf };
      persistWorkerState(data.state);
      setWorkerState(data.state);
    } catch {
      const localNext = recomputeLocalWorkerEdgeState(
        workerState,
        getActiveOfflineEnv(),
        payload,
        true
      );
      persistWorkerState(localNext);
      setWorkerState(localNext);
    } finally {
      setUpdating(false);
    }
  };

  const handleSliderChange = (nextHr: number, nextSkin: number, nextExertion: number) => {
    setHrSlider(nextHr);
    setSkinSlider(nextSkin);
    setExertionSlider(nextExertion);
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      pushBleFrame(nextHr, nextSkin, nextExertion);
    }, 240);
  };

  const handleFaultToggle = async (faultKey: keyof FaultFlags | 'clear_all', active: boolean) => {
    if (!workerState) return;
    setUpdating(true);
    try {
      const res = await fetch(`/api/worker/${workerState.context.workerId}/fault`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ faultKey, active }),
      });
      if (!res.ok) throw new Error('Fault toggle failed');
      const data = (await res.json()) as { state: WorkerStateSelf };
      persistWorkerState(data.state);
      setWorkerState(data.state);
      setHrSlider(data.state.latestFrame.hrBpm);
      setSkinSlider(data.state.latestFrame.skinTempC);
      setExertionSlider(data.state.latestFrame.exertionIndex);
    } catch {
      const nextFaults: FaultFlags =
        faultKey === 'clear_all'
          ? { bleDisconnected: false, lowBattery: false, sensorNoise: false, gpsLoss: false }
          : { ...workerState.faults, [faultKey]: active };
      const localNext = recomputeLocalWorkerEdgeState(
        { ...workerState, faults: nextFaults },
        getActiveOfflineEnv(),
        undefined,
        true
      );
      persistWorkerState(localNext);
      setWorkerState(localNext);
    } finally {
      setUpdating(false);
    }
  };

  const handleLanguageChange = async (language: SupportedLanguage) => {
    if (!workerState) return;
    setGlobalOverride(null);
    setUpdating(true);
    try {
      const res = await fetch(`/api/worker/${workerState.context.workerId}/language`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language }),
      });
      if (!res.ok) throw new Error('Language switch failed');
      const data = (await res.json()) as { state: WorkerStateSelf };
      persistWorkerState(data.state);
      setWorkerState(data.state);
    } catch {
      const localNext: WorkerStateSelf = {
        ...workerState,
        context: { ...workerState.context, preferredLanguage: language },
      };
      persistWorkerState(localNext);
      setWorkerState(localNext);
    } finally {
      setUpdating(false);
    }
  };

  const handleSelectGlobalLanguage = async (option: GlobalLanguageOption) => {
    if (!workerState) return;
    if (
      alertPreviewState === 'live' &&
      SUPPORTED_LANGUAGES.includes(option.code as SupportedLanguage)
    ) {
      await handleLanguageChange(option.code as SupportedLanguage);
      return;
    }

    setTranslatingGlobal(true);
    try {
      const specOverride =
        alertPreviewState !== 'live'
          ? (() => {
              const sCopy = getWearableAlertSpecCopy(
                alertPreviewState,
                workerState.context.preferredLanguage,
                tempUnit
              );
              return {
                headline: sCopy.headline,
                explanation: sCopy.secondaryDetail,
                action: sCopy.action,
                proactiveForecastNote: null,
              };
            })()
          : undefined;

      const res = await fetch(`/api/worker/${workerState.context.workerId}/translate-global`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: option.code,
          name: option.name,
          nativeName: option.nativeName,
          baseCopyOverride: specOverride,
        }),
      });
      if (!res.ok) throw new Error('Global translation failed');
      const data = (await res.json()) as {
        translation: WorkerAlertCopy;
        state?: WorkerStateSelf;
      };
      if (data.state) {
        persistWorkerState(data.state);
        setWorkerState(data.state);
      }
      setGlobalOverride({
        option,
        copy: data.translation,
      });
    } catch {
      const fallbackCopy =
        workerState.alertTranslations[workerState.context.preferredLanguage] ??
        workerState.alertTranslations.en;
      setGlobalOverride({
        option,
        copy: {
          ...fallbackCopy,
          explanation: `${option.nativeName} (${option.name}) edge guidance active.`,
        },
      });
    } finally {
      setTranslatingGlobal(false);
    }
  };

  const [checkInSending, setCheckInSending] = useState<'okay' | 'help' | null>(null);

  const handleCheckIn = async (status: 'okay' | 'help') => {
    if (!workerState) return;
    setCheckInSending(status);
    setError(null);
    try {
      const res = await fetch(`/api/worker/${workerState.context.workerId}/checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        throw new Error(`Check-in request failed (${res.status})`);
      }
      const data = (await res.json()) as { state: WorkerStateSelf };
      persistWorkerState(data.state);
      setWorkerState(data.state);
    } catch {
      const localNext: WorkerStateSelf = {
        ...workerState,
        lastCheckIn: { status, timestamp: new Date().toISOString() },
        supervisorDirective:
          status === 'help'
            ? 'SOS CACHED ON EDGE: Supervisor alert queued for sync; stop work and remain in shade.'
            : workerState.supervisorDirective,
      };
      persistWorkerState(localNext);
      setWorkerState(localNext);
    } finally {
      setCheckInSending(null);
    }
  };

  const handleSimStep = async (action: 'step_3m' | 'step_6m' | 'reset_cool') => {
    if (!workerState) return;
    setUpdating(true);
    try {
      const res = await fetch(`/api/worker/${workerState.context.workerId}/sim-step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error('Sim step failed');
      const data = (await res.json()) as { state: WorkerStateSelf };
      persistWorkerState(data.state);
      setWorkerState(data.state);
      setHrSlider(data.state.latestFrame.hrBpm);
      setSkinSlider(data.state.latestFrame.skinTempC);
      setExertionSlider(data.state.latestFrame.exertionIndex);
    } catch {
      const nextFrame: BLETelemetryFrame =
        action === 'reset_cool'
          ? {
              ...workerState.latestFrame,
              hrBpm: workerState.context.hr0 + 26,
              skinTempC: 34.0,
              exertionIndex: 4.5,
              timestamp: new Date().toISOString(),
              simulatedClockMin: workerState.simulatedClockMin + 3,
            }
          : {
              ...workerState.latestFrame,
              hrBpm: Math.min(182, workerState.latestFrame.hrBpm + (action === 'step_6m' ? 12 : 6)),
              skinTempC: Number(
                Math.min(37.9, workerState.latestFrame.skinTempC + (action === 'step_6m' ? 0.48 : 0.24)).toFixed(2)
              ),
              exertionIndex: Number(
                Math.min(9.5, workerState.latestFrame.exertionIndex + (action === 'step_6m' ? 0.4 : 0.2)).toFixed(1)
              ),
              timestamp: new Date().toISOString(),
              simulatedClockMin: workerState.simulatedClockMin + (action === 'step_6m' ? 6 : 3),
            };
      const localNext = recomputeLocalWorkerEdgeState(
        workerState,
        getActiveOfflineEnv(),
        nextFrame,
        true
      );
      persistWorkerState(localNext);
      setWorkerState(localNext);
      setHrSlider(localNext.latestFrame.hrBpm);
      setSkinSlider(localNext.latestFrame.skinTempC);
      setExertionSlider(localNext.latestFrame.exertionIndex);
    } finally {
      setUpdating(false);
    }
  };

  useEffect(() => {
    if (!autoSimRunning) return;
    const id = window.setInterval(() => {
      void handleSimStep('step_3m');
    }, 4000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSimRunning, workerState?.context.workerId, workerState?.simulatedClockMin]);

  if (loading && !workerState) {
    return (
      <main className="max-w-[1280px] mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-5 h-[560px] bg-[#141821] border border-white/10 rounded-[24px] animate-pulse" />
          <div className="lg:col-span-7 h-[560px] bg-[#141821] border border-white/10 rounded-[24px] animate-pulse" />
        </div>
      </main>
    );
  }

  if (error || !workerState) {
    return (
      <main className="max-w-[1280px] mx-auto px-6 py-8">
        <div className="bg-[#fa114f]/15 border border-[#fa114f]/40 rounded-[22px] p-6 text-sm text-rose-200">
          {error ?? 'Unable to load worker view.'}
        </div>
      </main>
    );
  }

  const { context, assessment, forecast, faults, latestFrame, alertTranslations } = workerState;
  const lang = context.preferredLanguage;
  const baseCopy = alertTranslations[lang] ?? alertTranslations.en;
  const copy = globalOverride?.copy ?? baseCopy;
  const activeLanguageNative = globalOverride?.option.nativeName ?? LANGUAGE_LABELS[lang].native;
  const isRtl = globalOverride?.option.rtl ?? isRtlLanguage(lang);
  const tierTokens = getTierTokens(assessment.tier);

  return (
    <main className="max-w-[1280px] mx-auto px-6 py-8 space-y-8">
      {/* Page Title & Active Unit Selector */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Worker Wearable Safety Display
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            <span className="font-mono text-[#787aff] font-semibold">{context.workerId}</span> ·{' '}
            {context.roleLabel} · {context.zone} · {context.ppeLevel} ·{' '}
            <span className="font-mono tabular-nums">{context.acclimatizationDays}d</span> acclimatized ·{' '}
            <span className="font-mono text-emerald-300">{clock.timeWithSeconds} GST</span>
          </p>
        </div>

        <div className="flex items-center gap-3">
          <label htmlFor="worker-select" className="text-xs font-medium text-slate-400">
            Active Unit
          </label>
          <select
            id="worker-select"
            value={selectedWorkerId}
            onChange={(e) => {
              setGlobalOverride(null);
              setSelectedWorkerId(e.target.value);
            }}
            className="bg-[#141821] border border-white/15 rounded-xl px-3.5 py-2 text-sm font-medium text-slate-100 focus:outline-none focus:border-[#787aff] cursor-pointer"
          >
            {(workers.length > 0
              ? workers
              : [{ workerId: 'W-101', roleLabel: 'Steel Fixer', zone: 'Zone A' }]
            ).map((w) => (
              <option key={w.workerId} value={w.workerId}>
                {w.workerId} — {w.roleLabel}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Alert State Switcher (Live Telemetry + 4 Wearable Safety Alert Specs) */}
      <AlertStateSwitcher
        activeState={alertPreviewState}
        onChangeState={(next) => {
          setGlobalOverride(null);
          setAlertPreviewState(next);
          if (next !== 'live') {
            setAodMode(false);
          }
        }}
      />

      {/* PRIMARY STAGE: WATCH FACE DIAL + WORKER SAFETY GUIDANCE */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* LEFT COLUMN: APPLE WATCH SHELL (WATCH FACE + CAROUSEL + CROWN GRID + SOS + VOICE SHEET) */}
        <section className="lg:col-span-5 space-y-4">
          <WatchShell
            workerState={workerState}
            aodMode={aodMode}
            onToggleAod={() => setAodMode((v) => !v)}
            onCheckIn={handleCheckIn}
            onToggleFault={handleFaultToggle}
            onNavigateForecast={() =>
              forecastSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }
            voiceSheetOpen={voiceSheetOpen}
            onOpenVoiceSheet={() => setVoiceSheetOpen(true)}
            onCloseVoiceSheet={() => setVoiceSheetOpen(false)}
            updating={updating}
            alertPreviewState={alertPreviewState}
            tempUnit={tempUnit}
            edgeOfflineActive={Boolean(env?.edgeOfflineActive)}
            voiceRecorderSlot={
              <VoiceIncidentRecorder
                workerId={context.workerId}
                language={lang}
                onReportLogged={(updatedState) => setWorkerState(updatedState)}
              />
            }
          />

          {/* Worker Actions & Voice Sheet Launcher Shell */}
          <div className={`${SG_SURFACES.panel} text-slate-100 p-5`}>
            {/* Compact Wearable Biometric Strip */}
            {alertPreviewState === 'sos_active' ? (
              <div className="flex items-center justify-between text-xs font-mono tabular-nums text-rose-200 pb-3 border-b border-white/10">
                <span>
                  HR <strong className="text-white">{WEARABLE_SPEC_TELEMETRY.sosActive.hrBpm} bpm</strong>
                </span>
                <span>
                  Skin{' '}
                  <strong className="text-white">
                    {formatTemperature(WEARABLE_SPEC_TELEMETRY.sosActive.skinTempC, tempUnit, 1)}
                  </strong>
                </span>
                <span className="text-[#ff6b93] font-semibold">DISTRESS ACTIVE</span>
              </div>
            ) : alertPreviewState === 'hydration_alert' ? (
              <div className="flex items-center justify-between text-xs font-mono tabular-nums text-slate-300 pb-3 border-b border-white/10">
                <span>
                  Skin{' '}
                  <strong className="text-white">
                    {formatTemperature(WEARABLE_SPEC_TELEMETRY.hydrationAlert.skinTempC, tempUnit, 1)}
                  </strong>
                </span>
                <span>
                  RH <strong className="text-cyan-300">{WEARABLE_SPEC_TELEMETRY.hydrationAlert.relHumidityPct}%</strong>
                </span>
                <span className="text-emerald-300">
                  {WEARABLE_SPEC_TELEMETRY.hydrationAlert.sweatRateMlHr} ml/hr
                </span>
              </div>
            ) : alertPreviewState === 'high_heat' || alertPreviewState === 'amber_forecast' ? (
              <div className="flex items-center justify-between text-xs font-mono tabular-nums text-slate-300 pb-3 border-b border-white/10">
                <span>
                  Air <strong className="text-white">{formatTemperature(47.1, tempUnit, 1)}</strong>
                </span>
                <span>
                  RH <strong className="text-cyan-300">29%</strong>
                </span>
                <span>
                  WBGT <strong className="text-amber-300">{formatTemperature(37.2, tempUnit, 1)}</strong>
                </span>
              </div>
            ) : (
              <div className="flex items-center justify-between text-xs font-mono tabular-nums text-slate-400 pb-3 border-b border-white/10">
                <span>
                  HR <AnimatedMetric value={latestFrame.hrBpm} className="text-slate-200" /> bpm
                </span>
                <span>
                  Skin{' '}
                  <AnimatedMetric
                    value={formatTemperature(latestFrame.skinTempC, tempUnit, 1)}
                    className="text-slate-200"
                  />
                </span>
                <span>
                  {faults.bleDisconnected ? (
                    <span className="text-amber-300">BLE OFF</span>
                  ) : (
                    <>
                      <AnimatedMetric value={latestFrame.rssiDbm} className="text-slate-200" /> dBm
                    </>
                  )}
                </span>
              </div>
            )}

            {/* Check-In Status Confirmation */}
            {workerState.lastCheckIn && (
              <div
                role="status"
                aria-live="polite"
                className={`mt-4 px-3.5 py-2.5 rounded-xl border text-xs ${
                  workerState.lastCheckIn.status === 'help'
                    ? 'bg-[#fa114f]/15 border-[#fa114f]/60 text-rose-100'
                    : 'bg-[#10b981]/15 border-[#10b981]/50 text-emerald-100'
                }`}
              >
                <div className="font-mono font-bold tracking-wide">
                  {workerState.lastCheckIn.status === 'help'
                    ? 'SOS ACTIVE · SUPERVISOR & MEDIC NOTIFIED'
                    : 'CHECK-IN CONFIRMED · WORKER OKAY'}
                </div>
                <div className="mt-0.5 text-[11px] opacity-90 font-mono tabular-nums">
                  {workerState.lastCheckIn.status === 'help'
                    ? `Dispatched at ${new Date(workerState.lastCheckIn.timestamp).toLocaleTimeString()} · Stay in shade or tap "I'm Okay" to clear`
                    : `Recorded at ${new Date(workerState.lastCheckIn.timestamp).toLocaleTimeString()} · Hydration log: ${context.hydrationCount}`}
                </div>
              </div>
            )}

            {/* Quick Check-In Buttons: "I'm Okay" / "Need Help" */}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={checkInSending !== null}
                onClick={() => handleCheckIn('okay')}
                className="min-h-[44px] px-4 py-2.5 rounded-xl bg-[#10b981] hover:brightness-110 active:scale-[0.99] disabled:opacity-60 text-slate-950 text-sm font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{checkInSending === 'okay' ? 'Sending...' : "I'm Okay"}</span>
              </button>
              <button
                type="button"
                disabled={checkInSending !== null}
                onClick={() => handleCheckIn('help')}
                className="min-h-[44px] px-4 py-2.5 rounded-xl bg-[#fa114f] hover:brightness-110 active:scale-[0.99] disabled:opacity-60 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <OctagonAlert className="w-4 h-4" />
                <span>{checkInSending === 'help' ? 'Alerting...' : 'Need Help'}</span>
              </button>
            </div>

            {/* Siri-Style Watch Voice Sheet Trigger */}
            <div className="mt-4 pt-4 border-t border-white/10">
              <button
                type="button"
                data-testid="open-voice-sheet-btn"
                onClick={() => setVoiceSheetOpen(true)}
                className="w-full min-h-[44px] px-4 py-2.5 rounded-xl border border-[#787aff]/50 bg-[#787aff]/15 hover:bg-[#787aff]/25 active:scale-[0.99] text-slate-100 text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <Mic className="w-4 h-4 text-[#787aff]" />
                <span>Open Watch Voice Incident Sheet</span>
              </button>
            </div>
          </div>
        </section>

        {/* RIGHT COLUMN: MULTILINGUAL WORKER GUIDANCE + PREDICTIVE TRAJECTORY + CLOCK/LANGUAGE */}
        <section className="lg:col-span-7 space-y-6">
          {alertPreviewState !== 'live' ? (
            <WearableAlertSpecColumn
              alertState={alertPreviewState}
              language={lang}
              onChangeLanguage={handleLanguageChange}
              globalLanguageOverride={globalOverride}
              translatingGlobal={translatingGlobal}
              onSelectGlobalLanguage={handleSelectGlobalLanguage}
              onClearGlobalLanguage={() => setGlobalOverride(null)}
              tempUnit={tempUnit}
              updating={updating}
              onBackToLive={() => {
                setGlobalOverride(null);
                setAlertPreviewState('live');
              }}
              onDispatchRealSos={() => handleCheckIn('help')}
              hydrationCount={context.hydrationCount}
              onLogHydrationCheckIn={() => handleCheckIn('okay')}
            />
          ) : (
            <>
          {/* Degraded Mode Notices */}
          {assessment.scoringMode === 'environment_only_degraded' && (
            <div className="px-4 py-3 rounded-[22px] bg-[#f59e0b]/10 border border-[#f59e0b]/35 text-xs text-amber-200">
              <strong className="font-semibold text-amber-100">
                DEGRADED · ENVIRONMENT-ONLY MODE:
              </strong>{' '}
              {assessment.degradedReason}. Scoring safely via outdoor WBGT (
              <span className="font-mono tabular-nums">
                {formatTemperature(assessment.effectiveWbgtC, tempUnit, 1)}
              </span>{' '}
              eff.).
            </div>
          )}
          {assessment.gpsDegraded && (
            <div className="px-4 py-3 rounded-[22px] bg-[#141821] border border-[#f59e0b]/35 text-xs text-amber-200">
              <strong className="font-semibold text-amber-100">DEGRADED · GPS SIGNAL LOST:</strong>{' '}
              Zone pinned to last verified beacon ({context.zone}).
            </div>
          )}

          {/* Multilingual Alert Card */}
          <div className={`bg-[#141821]/95 text-slate-100 rounded-[24px] border p-6 shadow-[0_12px_40px_rgba(0,0,0,0.38)] transition-colors ${tierTokens.ringClass}`}>
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-white/10">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="text-xs font-mono uppercase tracking-wider text-slate-400">
                  Wearable Safety Guidance ({activeLanguageNative})
                </span>
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg border text-[11px] font-mono font-semibold ${tierTokens.pillClass}`}
                >
                  <span aria-hidden="true" className={`w-2 h-2 rounded-full ${tierTokens.dotClass}`} />
                  <span>
                    <AnimatedMetric value={assessment.compositeScore.toFixed(1)} />
                    /10 · {assessment.tier}
                  </span>
                </span>
                {env?.edgeOfflineActive && (
                  <span className="px-2 py-0.5 rounded-lg border border-[#f59e0b]/40 bg-[#f59e0b]/15 text-[10px] font-mono text-amber-200">
                    Gemma 4 Edge Local Inference
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1 p-1 bg-[#0c111d] rounded-xl border border-white/10">
                {(Object.keys(LANGUAGE_LABELS) as SupportedLanguage[]).map((code) => (
                  <button
                    key={code}
                    type="button"
                    disabled={updating}
                    onClick={() => handleLanguageChange(code)}
                    className={`px-2.5 py-1.5 text-xs font-medium rounded-lg transition-all active:scale-[0.99] cursor-pointer whitespace-nowrap ${
                      !globalOverride && lang === code
                        ? 'bg-[#787aff] text-white shadow-xs'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    {LANGUAGE_LABELS[code].native}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-3">
              <GlobalLanguagePicker
                activeGlobalLang={globalOverride?.option ?? null}
                translating={translatingGlobal}
                onSelectGlobalLanguage={handleSelectGlobalLanguage}
                onClearGlobalLanguage={() => setGlobalOverride(null)}
              />
            </div>

            <div className="mt-4" dir={isRtl ? 'rtl' : 'ltr'}>
              <div className="text-lg font-bold text-white leading-snug">{copy.headline}</div>
              <p className="text-sm text-slate-200 mt-1.5 leading-relaxed">{copy.action}</p>
              <p className="text-xs text-slate-400 mt-2">
                {copy.explanation} · {copy.source === 'gemini' ? 'Gemini Explainability' : 'Safety Template'}
                {copy.cached ? ' (cached)' : ''}
              </p>
            </div>

            {workerState.supervisorDirective && (
              <div className="mt-4 px-3.5 py-2.5 rounded-xl bg-[#787aff]/15 border border-[#787aff]/40 text-xs text-slate-100">
                <span className="font-semibold text-[#a5a7ff]">Supervisor Order:</span>{' '}
                {workerState.supervisorDirective}
              </div>
            )}

            {/* Predictive Early-Warning Forecast & Sparkline */}
            <div id="forecast-section" ref={forecastSectionRef} className="mt-5 pt-4 border-t border-white/10">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-xs font-semibold text-slate-200">
                  30-Min Strain Trajectory Forecast
                </span>
                <span className="text-[11px] font-mono tabular-nums text-slate-400">
                  {forecast.status === 'ready' && forecast.psi15 ? (
                    <>
                      t+15m: <AnimatedMetric value={forecast.psi15.point.toFixed(1)} className="text-slate-200" /> [
                      {forecast.psi15.low.toFixed(1)}–{forecast.psi15.high.toFixed(1)}]
                    </>
                  ) : (
                    'Insufficient trend data'
                  )}
                </span>
              </div>

              {forecast.status === 'ready' ? (
                <>
                  <SparklineChart history={workerState.history} forecast={forecast} dark height={116} />
                  {copy.proactiveForecastNote && (
                    <p
                      dir={isRtl ? 'rtl' : 'ltr'}
                      data-testid="proactive-forecast-note"
                      className="mt-2.5 text-xs text-amber-200 bg-[#f59e0b]/10 border border-[#f59e0b]/30 rounded-xl px-3.5 py-2.5 leading-relaxed"
                    >
                      {copy.proactiveForecastNote}
                    </p>
                  )}
                  <div className="mt-2.5 flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-400">
                    <span>
                      Amber ETA:{' '}
                      <AnimatedMetric
                        value={
                          forecast.projectedAmberCrossingMin === 0
                            ? 'Reached'
                            : forecast.projectedAmberCrossingMin !== null
                              ? `~${forecast.projectedAmberCrossingMin} min`
                              : 'Not projected'
                        }
                        className="text-slate-200"
                      />
                    </span>
                    <span>
                      Red ETA:{' '}
                      <AnimatedMetric
                        value={
                          forecast.projectedRedCrossingMin === 0
                            ? 'Reached'
                            : forecast.projectedRedCrossingMin !== null
                              ? `~${forecast.projectedRedCrossingMin} min`
                              : 'Not projected'
                        }
                        className="text-slate-200"
                      />
                    </span>
                  </div>
                </>
              ) : (
                <div className="rounded-xl border border-white/10 bg-[#0c111d] px-3.5 py-4 text-xs text-slate-300">
                  <div className="font-semibold text-amber-300">Insufficient Trend Data</div>
                  <p className="mt-1 text-slate-400">{forecast.reason}</p>
                </div>
              )}
            </div>
          </div>
            </>
          )}

          {/* Audible Multilingual Voice-Synthesis Safety Alert Integration */}
          <WorkerVoiceAlertBar
            enabled={voiceAlerts.enabled}
            onToggleEnabled={voiceAlerts.setEnabled}
            speaking={voiceAlerts.speaking}
            language={lang}
            globalLanguageOption={globalOverride?.option ?? null}
            evaluation={voiceAlerts.evaluation}
            lastSpokenAlert={voiceAlerts.lastSpokenAlert}
            audioRef={voiceAlerts.audioRef}
            onSpeakNow={voiceAlerts.speakNow}
            onStopSpeaking={voiceAlerts.stopSpeaking}
          />

          {/* Simulated Clock & Live Abu Dhabi Watch Stream Controls */}
          <div className={`${SG_SURFACES.panel} p-5`}>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-xs text-slate-300">
                <Clock className="w-4 h-4 text-[#787aff] shrink-0" />
                <div>
                  <span>
                    Advance simulated shift time to watch the watch face forecast &amp; crossing update live:
                  </span>
                  <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                    Abu Dhabi {clock.timeWithSeconds} GST · Shift T+{workerState.simulatedClockMin}m · Watch Battery {Math.round(latestFrame.batteryPct)}%
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  data-testid="auto-sim-toggle-btn"
                  aria-pressed={autoSimRunning}
                  onClick={() => setAutoSimRunning((r) => !r)}
                  className={`px-3.5 py-2 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                    autoSimRunning
                      ? 'bg-[#10b981]/20 border-[#10b981] text-emerald-200'
                      : 'bg-[#0c111d] border-white/15 text-slate-200 hover:border-[#787aff]'
                  }`}
                >
                  {autoSimRunning ? (
                    <>
                      <Pause className="w-3.5 h-3.5 text-emerald-300" />
                      <span>Live Sim: ON</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5 text-[#787aff]" />
                      <span>Auto-Run Live</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  disabled={updating}
                  onClick={() => handleSimStep('step_3m')}
                  className={`${SG_SURFACES.buttonPrimary} px-3.5 py-2 text-xs flex items-center gap-1.5`}
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>+3 min Step</span>
                </button>
                <button
                  type="button"
                  disabled={updating}
                  onClick={() => handleSimStep('step_6m')}
                  className={`${SG_SURFACES.buttonSecondary} px-3.5 py-2 text-xs`}
                >
                  +6 min Step
                </button>
                <button
                  type="button"
                  disabled={updating}
                  onClick={() => {
                    setAutoSimRunning(false);
                    void handleSimStep('reset_cool');
                  }}
                  className={`${SG_SURFACES.buttonSecondary} px-3.5 py-2 text-xs text-slate-300 flex items-center gap-1`}
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset Cool</span>
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* DEMOTED COLLAPSIBLE DRAWER: DEVELOPER / BLE SIMULATOR (Sliders + Fault Injection) */}
      <section className={`${SG_SURFACES.panel} overflow-hidden`}>
        <button
          type="button"
          aria-expanded={simulatorOpen}
          aria-controls="ble-simulator-drawer"
          onClick={() => setSimulatorOpen((v) => !v)}
          className="w-full px-6 py-4 flex items-center justify-between gap-4 text-left hover:bg-white/[0.03] transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <Wrench className="w-4 h-4 text-[#787aff] shrink-0" />
            <div>
              <span className="text-sm font-semibold text-white">
                Developer / BLE Simulator
              </span>
              <span className="ml-2 text-xs text-slate-400">
                Physiological telemetry sliders, presets, hardware fault injection &amp; BLE JSON contract
              </span>
            </div>
          </div>
          {simulatorOpen ? (
            <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
          )}
        </button>

        {simulatorOpen && (
          <div
            id="ble-simulator-drawer"
            data-testid="ble-simulator-drawer"
            className="p-6 pt-4 border-t border-white/10 space-y-6"
          >
            {/* Physiological Stream Simulator Sliders */}
            <div>
              <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-white/10">
                <div>
                  <h2 className="text-base font-semibold text-white">
                    Wearable Physiological Simulator
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Simulated stream calibrated to ACGIH/NIOSH thresholds · pushed via{' '}
                    <code className="font-mono text-[#a5a7ff]">POST /api/ble/telemetry</code>
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setHrSlider(96);
                      setSkinSlider(34.1);
                      setExertionSlider(4.0);
                      pushBleFrame(96, 34.1, 4.0);
                    }}
                    className="px-2.5 py-1 text-xs font-medium bg-[#10b981]/15 text-emerald-300 border border-[#10b981]/40 rounded-lg hover:bg-[#10b981]/25 active:scale-[0.99] transition-all cursor-pointer"
                  >
                    Normal
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setHrSlider(138);
                      setSkinSlider(36.0);
                      setExertionSlider(7.2);
                      pushBleFrame(138, 36.0, 7.2);
                    }}
                    className="px-2.5 py-1 text-xs font-medium bg-[#f59e0b]/15 text-amber-300 border border-[#f59e0b]/40 rounded-lg hover:bg-[#f59e0b]/25 active:scale-[0.99] transition-all cursor-pointer"
                  >
                    Heat Ramp
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setHrSlider(164);
                      setSkinSlider(37.2);
                      setExertionSlider(8.8);
                      pushBleFrame(164, 37.2, 8.8);
                    }}
                    className="px-2.5 py-1 text-xs font-medium bg-[#fa114f]/15 text-rose-300 border border-[#fa114f]/50 rounded-lg hover:bg-[#fa114f]/25 active:scale-[0.99] transition-all cursor-pointer"
                  >
                    Critical
                  </button>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Heart Rate Slider */}
                <div>
                  <div className="flex items-center justify-between text-sm mb-1.5">
                    <label htmlFor="hr-slider" className="font-medium text-slate-200 flex items-center gap-1.5">
                      <Activity className="w-4 h-4 text-[#787aff]" />
                      <span>Heart Rate</span>
                    </label>
                    <span className="font-mono tabular-nums font-semibold text-white">
                      {hrSlider} bpm
                    </span>
                  </div>
                  <input
                    id="hr-slider"
                    type="range"
                    min={65}
                    max={185}
                    step={1}
                    value={hrSlider}
                    onChange={(e) => handleSliderChange(Number(e.target.value), skinSlider, exertionSlider)}
                    className="w-full sg-slider"
                  />
                </div>

                {/* Skin Temp Slider */}
                <div>
                  <div className="flex items-center justify-between text-sm mb-1.5">
                    <label htmlFor="skin-slider" className="font-medium text-slate-200 flex items-center gap-1.5">
                      <Thermometer className="w-4 h-4 text-[#787aff]" />
                      <span>Skin Temp</span>
                    </label>
                    <span className="font-mono tabular-nums font-semibold text-white">
                      {formatTemperature(skinSlider, tempUnit, 1)}
                    </span>
                  </div>
                  <input
                    id="skin-slider"
                    type="range"
                    min={33.0}
                    max={38.2}
                    step={0.1}
                    value={skinSlider}
                    onChange={(e) => handleSliderChange(hrSlider, Number(e.target.value), exertionSlider)}
                    className="w-full sg-slider"
                  />
                </div>

                {/* Exertion Slider */}
                <div>
                  <div className="flex items-center justify-between text-sm mb-1.5">
                    <label htmlFor="exertion-slider" className="font-medium text-slate-200 flex items-center gap-1.5">
                      <Radio className="w-4 h-4 text-[#787aff]" />
                      <span>Exertion (0–10)</span>
                    </label>
                    <span className="font-mono tabular-nums font-semibold text-white">
                      {exertionSlider.toFixed(1)}
                    </span>
                  </div>
                  <input
                    id="exertion-slider"
                    type="range"
                    min={1}
                    max={10}
                    step={0.5}
                    value={exertionSlider}
                    onChange={(e) => handleSliderChange(hrSlider, skinSlider, Number(e.target.value))}
                    className="w-full sg-slider"
                  />
                </div>
              </div>
            </div>

            {/* Fault Injection & Graceful Degradation */}
            <div className="pt-5 border-t border-white/10">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
                <div>
                  <h2 className="text-base font-semibold text-white">
                    Hardware Fault Injection &amp; Graceful Degradation
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Triggering BLE, battery, or sensor noise faults degrades scoring to environment-only WBGT and logs an audit event.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={updating}
                  onClick={() => handleFaultToggle('clear_all', false)}
                  className={`${SG_SURFACES.buttonSecondary} px-3 py-1.5 text-xs`}
                >
                  Clear All Faults
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <button
                  type="button"
                  disabled={updating}
                  onClick={() => handleFaultToggle('bleDisconnected', !faults.bleDisconnected)}
                  className={`min-h-[44px] px-3 py-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition-all active:scale-[0.99] cursor-pointer ${
                    faults.bleDisconnected
                      ? 'bg-[#fa114f] text-white border-[#fa114f]'
                      : 'bg-[#0c111d] text-slate-200 border-white/12 hover:bg-white/5'
                  }`}
                >
                  <BluetoothOff className="w-4 h-4 shrink-0" />
                  <span>Disconnect BLE</span>
                </button>

                <button
                  type="button"
                  disabled={updating}
                  onClick={() => handleFaultToggle('lowBattery', !faults.lowBattery)}
                  className={`min-h-[44px] px-3 py-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition-all active:scale-[0.99] cursor-pointer ${
                    faults.lowBattery
                      ? 'bg-[#f59e0b] text-slate-950 border-[#f59e0b]'
                      : 'bg-[#0c111d] text-slate-200 border-white/12 hover:bg-white/5'
                  }`}
                >
                  <BatteryWarning className="w-4 h-4 shrink-0" />
                  <span>Battery &lt;10%</span>
                </button>

                <button
                  type="button"
                  disabled={updating}
                  onClick={() => handleFaultToggle('sensorNoise', !faults.sensorNoise)}
                  className={`min-h-[44px] px-3 py-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition-all active:scale-[0.99] cursor-pointer ${
                    faults.sensorNoise
                      ? 'bg-[#f59e0b] text-slate-950 border-[#f59e0b]'
                      : 'bg-[#0c111d] text-slate-200 border-white/12 hover:bg-white/5'
                  }`}
                >
                  <Activity className="w-4 h-4 shrink-0" />
                  <span>Sensor Noise</span>
                </button>

                <button
                  type="button"
                  disabled={updating}
                  onClick={() => handleFaultToggle('gpsLoss', !faults.gpsLoss)}
                  className={`min-h-[44px] px-3 py-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition-all active:scale-[0.99] cursor-pointer ${
                    faults.gpsLoss
                      ? 'bg-[#787aff] text-white border-[#787aff]'
                      : 'bg-[#0c111d] text-slate-200 border-white/12 hover:bg-white/5'
                  }`}
                >
                  <MapPinOff className="w-4 h-4 shrink-0" />
                  <span>GPS Loss</span>
                </button>
              </div>

              {/* Hardware-Agnostic BLE API Contract Inspector */}
              <div className="mt-4 pt-4 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setShowBleJson((v) => !v)}
                  className="text-xs font-medium text-slate-400 hover:text-white flex items-center gap-1.5 cursor-pointer"
                >
                  <Code2 className="w-3.5 h-3.5 text-[#787aff]" />
                  <span>
                    {showBleJson ? 'Hide' : 'Inspect'} Hardware-Agnostic BLE Telemetry Contract (POST /api/ble/telemetry)
                  </span>
                </button>
                {showBleJson && (
                  <pre className="mt-3 p-3.5 bg-[#0c111d] border border-white/10 text-slate-200 rounded-xl text-[11px] font-mono overflow-x-auto leading-relaxed">
                    {JSON.stringify(latestFrame, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
