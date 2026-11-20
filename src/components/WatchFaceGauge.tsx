import { Battery, BatteryCharging, BatteryWarning, Droplets, Flame, OctagonAlert } from 'lucide-react';
import { useAbuDhabiClock } from '../hooks/useAbuDhabiClock';
import { RISK_TIER_THRESHOLDS, mapScoreToTier } from '../shared/riskEngine';
import { formatTemperature, type TemperatureUnit } from '../shared/temperature';
import type { WorkerStateSelf } from '../shared/types';
import {
  WEARABLE_SPEC_TELEMETRY,
  type WearableAlertStateId,
} from '../shared/wearableAlertSpecs';

interface WatchFaceGaugeProps {
  workerState: WorkerStateSelf;
  aodMode: boolean;
  onToggleAod: () => void;
  embedded?: boolean;
  onOpenCarousel?: () => void;
  alertPreviewState?: WearableAlertStateId;
  tempUnit?: TemperatureUnit;
  edgeOfflineActive?: boolean;
}

const CX = 160;
const CY = 160;
const ARC_RADIUS = 114;
const TICK_INNER_R = 131;
const TICK_OUTER_R = 143;
const SWEEP_START_DEG = -120;
const SWEEP_SPAN_DEG = 240;

function polarToCartesian(cx: number, cy: number, radius: number, angleDegFromTop: number) {
  const rad = ((angleDegFromTop - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(rad),
    y: cy + radius * Math.sin(rad),
  };
}

function describeArc(
  cx: number,
  cy: number,
  radius: number,
  startAngleDeg: number,
  endAngleDeg: number
): string {
  const start = polarToCartesian(cx, cy, radius, startAngleDeg);
  const end = polarToCartesian(cx, cy, radius, endAngleDeg);
  const largeArcFlag = Math.abs(endAngleDeg - startAngleDeg) > 180 ? 1 : 0;
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

export function WatchFaceGauge({
  workerState,
  aodMode,
  onToggleAod,
  embedded = false,
  onOpenCarousel,
  alertPreviewState = 'live',
  tempUnit = 'C',
  edgeOfflineActive = false,
}: WatchFaceGaugeProps) {
  const clock = useAbuDhabiClock();
  const { context, assessment, forecast, faults, latestFrame, history, simulatedClockMin } = workerState;
  const thresholds = workerState.tierThresholds ?? RISK_TIER_THRESHOLDS;
  const maxScore = thresholds.maxScore || 10;

  const isAmberForecastPreview = alertPreviewState === 'amber_forecast';

  const scoreToAngle = (score: number): number => {
    const clamped = Math.max(0, Math.min(maxScore, score));
    return SWEEP_START_DEG + (clamped / maxScore) * SWEEP_SPAN_DEG;
  };

  // Unit equivalence note:
  // `assessment.compositeScore` (0..10) and `forecast.psi15.point` (0..10 predicted compositeScore at t+15m
  // produced by `predictCompositeTrajectory(history)` over `history[].compositeScore`) share an identical
  // 0..10 scale, so both the active needle and the ghost needle map 1:1 across -120deg..+120deg.
  const mainScore = isAmberForecastPreview
    ? WEARABLE_SPEC_TELEMETRY.amberForecast.dialScore
    : assessment.compositeScore;
  const mainAngle = scoreToAngle(mainScore);
  const mainTip = polarToCartesian(CX, CY, ARC_RADIUS - 14, mainAngle);
  const mainTail = polarToCartesian(CX, CY, 16, mainAngle + 180);

  const hasValidForecast = isAmberForecastPreview
    ? true
    : forecast.status === 'ready' && forecast.psi15 !== null;
  const ghostScore = isAmberForecastPreview
    ? WEARABLE_SPEC_TELEMETRY.amberForecast.projectedT15
    : hasValidForecast && forecast.psi15
      ? forecast.psi15.point
      : null;
  const ghostAngle = ghostScore !== null ? scoreToAngle(ghostScore) : null;
  const ghostTip =
    ghostAngle !== null ? polarToCartesian(CX, CY, ARC_RADIUS - 16, ghostAngle) : null;

  const anyFaultActive =
    !isAmberForecastPreview &&
    alertPreviewState === 'live' &&
    (faults.bleDisconnected || faults.lowBattery || faults.sensorNoise || faults.gpsLoss);

  // Dynamic band angles driven by backend threshold constants
  const greenStartDeg = scoreToAngle(0);
  const greenEndDeg = scoreToAngle(thresholds.amberMin);
  const amberEndDeg = scoreToAngle(thresholds.redMin);
  const redEndDeg = scoreToAngle(maxScore);

  const activeTierWord = isAmberForecastPreview
    ? '4.0 · NOMINAL'
    : assessment.tier === 'Red'
      ? 'RED · STOP WORK'
      : assessment.tier === 'Amber'
        ? 'AMBER · REST IN SHADE'
        : 'GREEN · NOMINAL';

  const singleLetterTier =
    assessment.tier === 'Red' ? 'R' : assessment.tier === 'Amber' ? 'A' : 'G';

  // Micro bottom label strictly derived from API fields (never frontend-invented fault guesses)
  const bottomMicroLabel = isAmberForecastPreview
    ? `Air ${formatTemperature(WEARABLE_SPEC_TELEMETRY.amberForecast.airTempC, tempUnit, 1)} · RH ${WEARABLE_SPEC_TELEMETRY.amberForecast.relHumidityPct}% · WBGT ${formatTemperature(WEARABLE_SPEC_TELEMETRY.amberForecast.wbgtC, tempUnit, 1)}`
    : assessment.scoringMode === 'environment_only_degraded' && assessment.degradedReason
      ? assessment.degradedReason
      : assessment.gpsDegraded
        ? `GPS SIGNAL LOST · ${context.zone}`
        : `${context.deviceId} · HR+SKIN · ${Math.round(latestFrame.signalQuality * 100)}%`;

  const forecastDelta = isAmberForecastPreview
    ? WEARABLE_SPEC_TELEMETRY.amberForecast.deltaT15
    : hasValidForecast && ghostScore !== null
      ? Number((ghostScore - mainScore).toFixed(1))
      : null;
  const forecastArrow =
    forecastDelta === null ? '' : forecastDelta > 0.15 ? '↑' : forecastDelta < -0.15 ? '↓' : '→';

  const recentTicks = history.slice(-5);
  const isEdgePillActive = edgeOfflineActive || alertPreviewState !== 'live';

  const renderEdgeStatusPill = () => (
    <div className="w-full flex justify-center mt-1">
      <span
        data-testid="wearable-edge-pill"
        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[10px] font-mono tracking-tight whitespace-nowrap ${
          isEdgePillActive
            ? 'bg-[#f59e0b]/15 border-[#f59e0b]/50 text-amber-200'
            : 'bg-[#141821] border-white/15 text-slate-300'
        }`}
      >
        <span
          aria-hidden="true"
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            isEdgePillActive ? 'bg-[#f59e0b] sg-tier-pulse-amber' : 'bg-emerald-400'
          }`}
        />
        <span>
          {isEdgePillActive
            ? 'Gemma 4 Edge Offline Mode'
            : 'Gemma 4 Edge Offline Mode · Armed'}
        </span>
      </span>
    </div>
  );

  const batteryPct = Math.max(0, Math.min(100, Math.round(latestFrame.batteryPct)));
  const renderWatchTopComplications = (alertAccent: 'green' | 'amber' | 'red' | 'cyan' = 'green') => {
    const timeAccent =
      alertAccent === 'red'
        ? 'text-rose-200 border-[#fa114f]/45 bg-[#fa114f]/15'
        : alertAccent === 'amber'
          ? 'text-amber-200 border-[#f59e0b]/45 bg-[#f59e0b]/15'
          : alertAccent === 'cyan'
            ? 'text-cyan-200 border-cyan-400/40 bg-cyan-500/12'
            : 'text-slate-200 border-white/12 bg-[#141821]/90';

    const batColor =
      faults.lowBattery || batteryPct <= 15
        ? 'text-[#ff6b93]'
        : batteryPct <= 35
          ? 'text-amber-300'
          : 'text-emerald-300';

    const BatIcon =
      faults.lowBattery || batteryPct <= 15
        ? BatteryWarning
        : batteryPct >= 90
          ? BatteryCharging
          : Battery;

    return (
      <div className="w-full flex items-center justify-between gap-2 text-[10px] font-mono tabular-nums">
        <div
          data-testid="watch-abudhabi-clock"
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg border ${timeAccent}`}
          title={`Abu Dhabi GST (${clock.dateLabel}) · Shift T+${simulatedClockMin}m`}
        >
          <span
            aria-hidden="true"
            className={`w-1.5 h-1.5 rounded-full animate-pulse ${
              isEdgePillActive ? 'bg-amber-400' : 'bg-emerald-400'
            }`}
          />
          <span className="font-semibold">{clock.timeWithSeconds}</span>
          <span className="text-[9px] opacity-75">GST · T+{simulatedClockMin}m</span>
        </div>

        <div
          data-testid="watch-battery-complication"
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg border border-white/12 bg-[#141821]/90 text-slate-200"
          title={
            isEdgePillActive
              ? 'Edge Backup Telemetry Active'
              : 'Synced to Live Abu Dhabi Telemetry'
          }
        >
          <BatIcon className={`w-3 h-3 shrink-0 ${batColor}`} />
          <span className={`font-semibold ${batColor}`}>{batteryPct}%</span>
        </div>
      </div>
    );
  };

  // Separate Always-On Display (AOD) low-power rendering branch:
  // Genuinely reduced-pixel SVG: monochrome grayscale only, thin 1.5px strokes,
  // zero outer history ticks, zero ghost needle, single-letter tier marker (G/A/R).
  if (aodMode) {
    return (
      <div
        data-testid="watchface-aod"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          onToggleAod();
        }}
        className={`relative flex flex-col items-center justify-center bg-black text-neutral-300 select-none cursor-pointer ${
          embedded
            ? 'px-5 py-4 w-full'
            : 'rounded-[28px] border border-neutral-800 px-6 py-6'
        }`}
      >
        <div className="w-full flex items-center justify-between text-[11px] font-mono tabular-nums text-neutral-500 mb-2">
          <span>AOD · {clock.timeShort} GST</span>
          <span>BAT {batteryPct}% · T+{simulatedClockMin}m</span>
        </div>

        <svg
          viewBox="0 0 320 300"
          className="w-full max-w-[320px] h-auto"
          role="img"
          aria-label={`Wearable Always-On Display: score ${mainScore.toFixed(1)} tier ${singleLetterTier}`}
        >
          {/* Thin 1.5px monochrome track arc */}
          <path
            d={describeArc(CX, CY, ARC_RADIUS, greenStartDeg, redEndDeg)}
            fill="none"
            stroke="#525252"
            strokeWidth={1.5}
            strokeLinecap="round"
          />
          {/* Thin 1.5px monochrome needle */}
          <line
            x1={mainTail.x}
            y1={mainTail.y}
            x2={mainTip.x}
            y2={mainTip.y}
            stroke="#d4d4d4"
            strokeWidth={1.5}
            strokeLinecap="round"
          />
          <circle cx={CX} cy={CY} r={4} fill="#d4d4d4" />

          {/* Large monochrome numeral */}
          <text
            x={CX}
            y={CY + 44}
            textAnchor="middle"
            className="font-mono tabular-nums"
            fill="#e5e5e5"
            fontSize="44"
            fontWeight="700"
          >
            {mainScore.toFixed(1)}
          </text>
          {/* Single-letter tier indicator */}
          <text
            x={CX}
            y={CY + 70}
            textAnchor="middle"
            className="font-mono"
            fill="#a3a3a3"
            fontSize="16"
            fontWeight="600"
            letterSpacing="0.16em"
          >
            {singleLetterTier}
          </text>
        </svg>

        <div className="mt-2 w-full flex items-center justify-between gap-3 pt-3 border-t border-neutral-900">
          <span className="text-[11px] font-mono text-neutral-500 truncate">
            {anyFaultActive ? bottomMicroLabel : `${context.deviceId} · AOD`}
          </span>
          <button
            type="button"
            onClick={onToggleAod}
            aria-pressed="true"
            className="px-3 py-1.5 rounded-lg border border-neutral-700 bg-neutral-900 text-neutral-200 hover:bg-neutral-800 text-xs font-mono font-semibold cursor-pointer shrink-0"
          >
            Exit AOD
          </button>
        </div>
      </div>
    );
  }

  // Active Mode colors (desaturated grey when ANY device/GPS fault is active)
  const bandColors = anyFaultActive
    ? {
        green: '#475569',
        amber: '#64748b',
        red: '#94a3b8',
        needle: '#cbd5e1',
        pill: 'bg-slate-800 text-slate-200 border-slate-600',
      }
    : {
        green: '#10b981',
        amber: '#f59e0b',
        red: '#ef4444',
        needle:
          assessment.tier === 'Red'
            ? '#f87171'
            : assessment.tier === 'Amber'
              ? '#fbbf24'
              : '#34d399',
        pill:
          assessment.tier === 'Red'
            ? 'bg-rose-500/20 text-rose-300 border-rose-500/50'
            : assessment.tier === 'Amber'
              ? 'bg-amber-500/20 text-amber-200 border-amber-400/50'
              : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
      };

  const tierTickColor = (score: number, degraded: boolean): string => {
    if (anyFaultActive || degraded) return '#64748b';
    const t = mapScoreToTier(score, thresholds);
    if (t === 'Red') return '#ef4444';
    if (t === 'Amber') return '#f59e0b';
    return '#10b981';
  };

  const redArcPulsing = !anyFaultActive && assessment.tier === 'Red';

  // Specialized Watch Face Branch — State 2: Hydration Alert (Circular cyan-to-amber ring with water droplet)
  if (alertPreviewState === 'hydration_alert') {
    const hyd = WEARABLE_SPEC_TELEMETRY.hydrationAlert;
    return (
      <div
        data-testid="watchface-active"
        data-fault-degraded="false"
        className={`relative flex flex-col items-center text-slate-100 ${
          embedded
            ? 'bg-black px-5 py-3 w-full'
            : 'rounded-[28px] bg-[#0B1120] border-2 border-slate-800 px-6 py-5 shadow-lg'
        }`}
      >
        {renderWatchTopComplications('cyan')}
        {renderEdgeStatusPill()}

        <div
          data-testid="watchface-hydration"
          className="relative w-full max-w-[300px] flex flex-col items-center mt-2"
        >
          <svg
            viewBox="0 0 240 218"
            className="w-full h-auto overflow-visible"
            role="img"
            aria-label="Hydration Alert circular cyan to amber ring"
          >
            <defs>
              <linearGradient id="sg-hydration-ring" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#06b6d4" />
                <stop offset="55%" stopColor="#22d3ee" />
                <stop offset="100%" stopColor="#f59e0b" />
              </linearGradient>
            </defs>
            <circle cx="120" cy="108" r="82" fill="none" stroke="#1e293b" strokeWidth="14" />
            <circle
              cx="120"
              cy="108"
              r="82"
              fill="none"
              stroke="url(#sg-hydration-ring)"
              strokeWidth="14"
              strokeLinecap="round"
              strokeDasharray="442 520"
              transform="rotate(-90 120 108)"
            />
          </svg>

          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none pb-2">
            <div className="w-11 h-11 rounded-full bg-cyan-500/20 border border-cyan-400/50 flex items-center justify-center mb-1.5">
              <Droplets className="w-6 h-6 text-cyan-300" />
            </div>
            <div className="text-[11px] font-mono font-bold tracking-wider text-cyan-200 uppercase">
              SAFE TO WORK
            </div>
            <div className="text-sm font-bold text-white tracking-tight mt-0.5">HYDRATE</div>
            <div className="text-[10px] font-mono text-amber-200 mt-0.5">
              Drink water every {hyd.intervalMin} min
            </div>
          </div>
        </div>

        <div className="w-full grid grid-cols-3 gap-1.5 text-center font-mono tabular-nums text-[10px] bg-[#141821] border border-white/10 rounded-xl px-2.5 py-2 mt-1">
          <div>
            <div className="text-slate-400">Skin</div>
            <div className="text-white font-semibold">
              {formatTemperature(hyd.skinTempC, tempUnit, 1)}
            </div>
          </div>
          <div>
            <div className="text-slate-400">RH</div>
            <div className="text-cyan-300 font-semibold">{hyd.relHumidityPct}%</div>
          </div>
          <div>
            <div className="text-slate-400">Sweat</div>
            <div className="text-emerald-300 font-semibold">{hyd.sweatRateMlHr} ml/hr</div>
          </div>
        </div>

        <div className="mt-2.5 w-full flex items-center justify-between gap-2 pt-2.5 border-t border-slate-800">
          <div data-testid="watchface-bottom-label" className="text-[11px] font-mono text-cyan-300">
            Sweat Rate: {hyd.sweatRateMlHr} ml/hr ({hyd.sweatStatus})
          </div>
          <button
            type="button"
            onClick={onToggleAod}
            aria-pressed="false"
            className="px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-mono font-medium cursor-pointer shrink-0 whitespace-nowrap"
          >
            Simulate AOD
          </button>
        </div>
      </div>
    );
  }

  // Specialized Watch Face Branch — State 3: High Heat / WBGT (Amber-to-red arc gauge, central WBGT 37.2°C, Air 47.1°C)
  if (alertPreviewState === 'high_heat') {
    const heat = WEARABLE_SPEC_TELEMETRY.highHeat;
    const wbgtFrac = Math.max(0, Math.min(1, (heat.wbgtC - 26) / (42 - 26)));
    const wbgtAngle = SWEEP_START_DEG + wbgtFrac * SWEEP_SPAN_DEG;
    const needleTip = polarToCartesian(CX, CY, ARC_RADIUS - 14, wbgtAngle);
    const needleTail = polarToCartesian(CX, CY, 16, wbgtAngle + 180);

    return (
      <div
        data-testid="watchface-active"
        data-fault-degraded="false"
        className={`relative flex flex-col items-center text-slate-100 ${
          embedded
            ? 'bg-black px-5 py-3 w-full'
            : 'rounded-[28px] bg-[#0B1120] border-2 border-slate-800 px-6 py-5 shadow-lg'
        }`}
      >
        {renderWatchTopComplications('red')}
        {renderEdgeStatusPill()}

        <div
          data-testid="watchface-high-heat"
          className="relative w-full max-w-[320px] flex flex-col items-center mt-1"
        >
          <svg
            viewBox="0 0 320 264"
            className="w-full h-auto overflow-visible"
            role="img"
            aria-label={`High Heat WBGT gauge ${formatTemperature(heat.wbgtC, tempUnit, 1)}`}
          >
            <defs>
              <linearGradient id="sg-highheat-arc" x1="0%" y1="50%" x2="100%" y2="50%">
                <stop offset="0%" stopColor="#f59e0b" />
                <stop offset="60%" stopColor="#ef4444" />
                <stop offset="100%" stopColor="#fa114f" />
              </linearGradient>
            </defs>
            <path
              d={describeArc(CX, CY, ARC_RADIUS, SWEEP_START_DEG, SWEEP_START_DEG + SWEEP_SPAN_DEG)}
              fill="none"
              stroke="#1e293b"
              strokeWidth={16}
              strokeLinecap="round"
            />
            <path
              d={describeArc(CX, CY, ARC_RADIUS, SWEEP_START_DEG, wbgtAngle)}
              fill="none"
              stroke="url(#sg-highheat-arc)"
              strokeWidth={13}
              strokeLinecap="round"
              className="sg-red-arc-pulse"
            />
            <line
              x1={needleTail.x}
              y1={needleTail.y}
              x2={needleTip.x}
              y2={needleTip.y}
              stroke="#fa114f"
              strokeWidth={4}
              strokeLinecap="round"
            />
            <circle cx={CX} cy={CY} r={7} fill="#0B1120" stroke="#fa114f" strokeWidth={3} />
            <text
              x={CX}
              y={CY - 22}
              textAnchor="middle"
              className="font-mono"
              fill="#fbbf24"
              fontSize="11"
              fontWeight="700"
              letterSpacing="0.12em"
            >
              WBGT
            </text>
            <text
              x={CX}
              y={CY + 44}
              textAnchor="middle"
              className="font-mono tabular-nums"
              fill="#ffffff"
              fontSize="36"
              fontWeight="700"
            >
              {formatTemperature(heat.wbgtC, tempUnit, 1)}
            </text>
            <text
              x={CX}
              y={CY + 66}
              textAnchor="middle"
              className="font-mono tabular-nums"
              fill="#fca5a5"
              fontSize="12"
              fontWeight="600"
            >
              Air {formatTemperature(heat.airTempC, tempUnit, 1)} · RH {heat.relHumidityPct}%
            </text>
          </svg>

          <div className="flex flex-col items-center -mt-3 mb-1.5 text-center">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md border border-[#fa114f]/60 bg-[#fa114f]/20 text-rose-200 text-xs font-mono font-bold tracking-wider">
              <Flame className="w-3.5 h-3.5 text-[#fa114f]" />
              <span>
                {tempUnit === 'F' ? '99–104°F High Risk' : '37–40°C High Risk'}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-2 w-full flex items-center justify-between gap-2 pt-3 border-t border-slate-800">
          <div data-testid="watchface-bottom-label" className="text-[11px] font-mono text-rose-300">
            Environmental Heat Stress Sensors Active
          </div>
          <button
            type="button"
            onClick={onToggleAod}
            aria-pressed="false"
            className="px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-mono font-medium cursor-pointer shrink-0 whitespace-nowrap"
          >
            Simulate AOD
          </button>
        </div>
      </div>
    );
  }

  // Specialized Watch Face Branch — State 4: SOS Active (Distress Sensor active, HR 98 bpm, Skin Temp 36.0°C)
  if (alertPreviewState === 'sos_active') {
    const sos = WEARABLE_SPEC_TELEMETRY.sosActive;
    return (
      <div
        data-testid="watchface-active"
        data-fault-degraded="false"
        className={`relative flex flex-col items-center text-slate-100 ${
          embedded
            ? 'bg-black px-5 py-3 w-full'
            : 'rounded-[28px] bg-[#0B1120] border-2 border-[#fa114f] px-6 py-5 shadow-lg'
        }`}
      >
        {renderWatchTopComplications('red')}
        {renderEdgeStatusPill()}

        <div
          data-testid="watchface-sos-active"
          className="w-full mt-2 rounded-[24px] border border-[#fa114f] bg-[#fa114f]/15 px-4 py-4 text-center space-y-3 sg-sos-flash"
        >
          <div className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1 rounded-full bg-[#fa114f] text-white text-[10px] font-mono font-bold tracking-wider uppercase">
            <OctagonAlert className="w-3.5 h-3.5" />
            <span>Distress Sensor: {sos.distressSensorStatus}</span>
          </div>

          <div className="text-sm font-bold text-white leading-snug">
            SUPERVISOR &amp; MEDIC NOTIFIED
          </div>

          <div className="grid grid-cols-2 gap-2 text-center font-mono tabular-nums">
            <div className="rounded-xl bg-black/60 border border-[#fa114f]/40 px-2.5 py-2">
              <div className="text-[10px] text-rose-200 uppercase">Heart Rate</div>
              <div className="text-lg font-bold text-white">{sos.hrBpm} bpm</div>
            </div>
            <div className="rounded-xl bg-black/60 border border-[#fa114f]/40 px-2.5 py-2">
              <div className="text-[10px] text-rose-200 uppercase">Skin Temp</div>
              <div className="text-lg font-bold text-white">
                {formatTemperature(sos.skinTempC, tempUnit, 1)}
              </div>
            </div>
          </div>

          <div className="text-[11px] font-mono text-rose-100">
            Live Escalation Stream · Zone A Dispatch Locked
          </div>
        </div>

        <div className="mt-3 w-full flex items-center justify-between gap-2 pt-3 border-t border-slate-800">
          <div data-testid="watchface-bottom-label" className="text-[11px] font-mono text-[#ff6b93] font-semibold">
            SOS ACTIVE · {context.deviceId}
          </div>
          <button
            type="button"
            onClick={onToggleAod}
            aria-pressed="false"
            className="px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-mono font-medium cursor-pointer shrink-0 whitespace-nowrap"
          >
            Simulate AOD
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="watchface-active"
      data-fault-degraded={anyFaultActive ? 'true' : 'false'}
      className={`relative flex flex-col items-center text-slate-100 ${
        embedded
          ? 'bg-black px-5 py-3 w-full'
          : 'rounded-[28px] bg-[#0B1120] border-2 border-slate-800 px-6 py-5 shadow-lg'
      }`}
    >
      {/* Top Micro-Overlays: Live Abu Dhabi GST Time, Elapsed Shift & Dynamic Battery */}
      {renderWatchTopComplications(
        isAmberForecastPreview || assessment.tier === 'Amber'
          ? 'amber'
          : assessment.tier === 'Red'
            ? 'red'
            : 'green'
      )}
      {renderEdgeStatusPill()}

      {/* Circular 240° Watch Dial */}
      <div className="relative w-full max-w-[320px] flex flex-col items-center mt-1">
        <svg
          viewBox="0 0 320 278"
          className="w-full h-auto overflow-visible"
          role="img"
          aria-label={`Wearable strain gauge: ${mainScore.toFixed(1)} out of 10, ${activeTierWord}`}
        >
          {/* Live 60-second Abu Dhabi Bezel Track & Orbiting Sync Dot */}
          <circle
            cx={CX}
            cy={CY}
            r={149}
            fill="none"
            stroke="#1e293b"
            strokeOpacity={0.55}
            strokeWidth={1}
            strokeDasharray="2 6"
          />
          {(() => {
            const secPt = polarToCartesian(CX, CY, 149, clock.seconds * 6);
            return (
              <circle
                cx={secPt.x}
                cy={secPt.y}
                r={3.2}
                fill={
                  assessment.tier === 'Red'
                    ? '#fa114f'
                    : assessment.tier === 'Amber'
                      ? '#f59e0b'
                      : '#787aff'
                }
              />
            );
          })()}

          {/* Dim background track */}
          <path
            d={describeArc(CX, CY, ARC_RADIUS, greenStartDeg, redEndDeg)}
            fill="none"
            stroke="#1e293b"
            strokeWidth={16}
            strokeLinecap="round"
          />

          {/* Three Colored Arc Bands driven by backend RISK_TIER_THRESHOLDS */}
          <path
            data-testid="arc-green"
            d={describeArc(CX, CY, ARC_RADIUS, greenStartDeg, greenEndDeg)}
            fill="none"
            stroke={bandColors.green}
            strokeWidth={11}
            strokeLinecap="butt"
          />
          <path
            data-testid="arc-amber"
            d={describeArc(CX, CY, ARC_RADIUS, greenEndDeg, amberEndDeg)}
            fill="none"
            stroke={bandColors.amber}
            strokeWidth={11}
            strokeLinecap="butt"
          />
          <path
            data-testid="arc-red"
            d={describeArc(CX, CY, ARC_RADIUS, amberEndDeg, redEndDeg)}
            fill="none"
            stroke={bandColors.red}
            strokeWidth={11}
            strokeLinecap="butt"
            className={redArcPulsing ? 'sg-red-arc-pulse' : undefined}
          />

          {/* Outer History Tick Ring (last 5 entries from worker's history array) */}
          <g data-testid="history-tick-ring">
            {recentTicks.map((pt, idx) => {
              const deg = scoreToAngle(pt.compositeScore);
              const inner = polarToCartesian(CX, CY, TICK_INNER_R, deg);
              const outer = polarToCartesian(CX, CY, TICK_OUTER_R + (idx === recentTicks.length - 1 ? 3 : 0), deg);
              return (
                <line
                  key={`${pt.minuteOffset}-${idx}`}
                  data-testid="history-tick"
                  x1={inner.x}
                  y1={inner.y}
                  x2={outer.x}
                  y2={outer.y}
                  stroke={tierTickColor(pt.compositeScore, pt.degraded)}
                  strokeWidth={idx === recentTicks.length - 1 ? 3.5 : 2.5}
                  strokeLinecap="round"
                  opacity={0.45 + ((idx + 1) / Math.max(1, recentTicks.length)) * 0.55}
                />
              );
            })}
          </g>

          {/* Scale boundary ticks (0, amberMin, redMin, 10) */}
          {[0, thresholds.amberMin, thresholds.redMin, maxScore].map((val) => {
            const deg = scoreToAngle(val);
            const p1 = polarToCartesian(CX, CY, ARC_RADIUS - 11, deg);
            const p2 = polarToCartesian(CX, CY, ARC_RADIUS + 9, deg);
            return (
              <line
                key={val}
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                stroke="#0f172a"
                strokeWidth={2}
              />
            );
          })}

          {/* Ghost Needle (dashed, ~45% opacity) — STRICTLY omitted when insufficient_trend_data */}
          {hasValidForecast && ghostTip && (
            <g data-testid="ghost-needle" opacity={0.45}>
              <line
                x1={CX}
                y1={CY}
                x2={ghostTip.x}
                y2={ghostTip.y}
                stroke={anyFaultActive ? '#94a3b8' : '#e2e8f0'}
                strokeWidth={3}
                strokeDasharray="5 4"
                strokeLinecap="round"
              />
              <circle
                cx={ghostTip.x}
                cy={ghostTip.y}
                r={3.5}
                fill={anyFaultActive ? '#94a3b8' : '#e2e8f0'}
              />
            </g>
          )}

          {/* Main Needle (current compositeScore) */}
          <g data-testid="main-needle">
            <line
              x1={mainTail.x}
              y1={mainTail.y}
              x2={mainTip.x}
              y2={mainTip.y}
              stroke={bandColors.needle}
              strokeWidth={4}
              strokeLinecap="round"
            />
            <circle cx={CX} cy={CY} r={7} fill="#0B1120" stroke={bandColors.needle} strokeWidth={3} />
          </g>

          {/* Center Large JetBrains Mono Numeral — tap opens AppCarousel in active mode */}
          <g
            data-testid="watchface-center-score"
            role={onOpenCarousel ? 'button' : undefined}
            tabIndex={onOpenCarousel ? 0 : undefined}
            aria-label={
              onOpenCarousel
                ? `Score ${mainScore.toFixed(1)}, tap to open Apple Watch app carousel`
                : undefined
            }
            onClick={onOpenCarousel}
            onKeyDown={
              onOpenCarousel
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onOpenCarousel();
                    }
                  }
                : undefined
            }
            className={onOpenCarousel ? 'cursor-pointer focus:outline-none' : undefined}
          >
            <circle cx={CX} cy={CY + 36} r={54} fill="transparent" />
            <text
              x={CX}
              y={CY + 46}
              textAnchor="middle"
              className="font-mono tabular-nums"
              fill={anyFaultActive ? '#cbd5e1' : '#ffffff'}
              fontSize="42"
              fontWeight="700"
            >
              {mainScore.toFixed(1)}
            </text>
            <text
              x={CX}
              y={CY + 64}
              textAnchor="middle"
              className="font-mono tabular-nums"
              fill="#94a3b8"
              fontSize="11"
            >
              {assessment.psi !== null
                ? `Composite ${mainScore.toFixed(1)}/10 · PSI ${assessment.psi.toFixed(1)}`
                : `Composite ${mainScore.toFixed(1)}/10 · PSI N/A (Env-Only)`}
            </text>
          </g>
        </svg>

        {/* Tier Word Badge + t+15m Sub-line */}
        <div className="flex flex-col items-center -mt-3 mb-2 text-center">
          <div
            className={`px-3 py-1 rounded-md border text-xs font-mono font-bold tracking-wider ${bandColors.pill}`}
          >
            {activeTierWord}
          </div>

          <div
            data-testid="watchface-forecast-subline"
            className="mt-2 text-xs font-mono tabular-nums text-slate-300"
          >
            {hasValidForecast && ghostScore !== null ? (
              <span>
                t+15m: {ghostScore.toFixed(1)} {forecastArrow} (
                {forecastDelta !== null && forecastDelta >= 0 ? `+${forecastDelta.toFixed(1)}` : forecastDelta?.toFixed(1)})
              </span>
            ) : (
              <span className="text-amber-300">collecting trend data</span>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Micro-Label & Simulate AOD Control */}
      <div className="mt-2 w-full flex items-center justify-between gap-2 pt-3 border-t border-slate-800">
        <div
          data-testid="watchface-bottom-label"
          className={`text-[11px] font-mono leading-tight ${
            anyFaultActive ? 'text-amber-300 font-semibold' : 'text-slate-400'
          }`}
        >
          {bottomMicroLabel}
        </div>
        <button
          type="button"
          onClick={onToggleAod}
          aria-pressed="false"
          className="px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-mono font-medium cursor-pointer shrink-0 whitespace-nowrap"
        >
          Simulate AOD
        </button>
      </div>
    </div>
  );
}
