import { useState } from 'react';
import {
  Activity,
  Droplets,
  Flame,
  OctagonAlert,
  Radio,
  ShieldAlert,
  Thermometer,
  TrendingUp,
  WifiOff,
} from 'lucide-react';
import type { GlobalLanguageOverride } from '../hooks/useWorkerVoiceAlerts';
import { SG_SURFACES } from '../shared/designTokens';
import type { GlobalLanguageOption } from '../shared/globalLanguages';
import { formatTemperature, type TemperatureUnit } from '../shared/temperature';
import { isRtlLanguage, LANGUAGE_LABELS, type SupportedLanguage } from '../shared/types';
import {
  SOS_ESCALATION_TIMELINE,
  WEARABLE_ALERT_STATE_OPTIONS,
  WEARABLE_SPEC_TELEMETRY,
  getWearableAlertSpecCopy,
  type WearableAlertStateId,
} from '../shared/wearableAlertSpecs';
import { GlobalLanguagePicker } from './GlobalLanguagePicker';
import { AnimatedMetric } from './PageTransition';

interface AlertStateSwitcherProps {
  activeState: WearableAlertStateId;
  onChangeState: (next: WearableAlertStateId) => void;
}

export function AlertStateSwitcher({ activeState, onChangeState }: AlertStateSwitcherProps) {
  return (
    <section
      aria-label="Alert State Switcher"
      data-testid="alert-state-switcher"
      className="bg-[#141821]/95 border border-white/10 rounded-[22px] p-2.5 shadow-[0_8px_32px_rgba(0,0,0,0.32)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-2 pb-2 border-b border-white/10">
        <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
          <Radio className="w-3.5 h-3.5 text-[#787aff] shrink-0" />
          <span>Wearable Alert State Switcher</span>
        </div>
        <span className="text-[11px] font-mono text-slate-400">
          Toggle live telemetry or inspect 4 wearable alert specifications
        </span>
      </div>

      <div role="tablist" aria-label="Wearable alert states" className="mt-2 flex flex-wrap gap-2">
        {WEARABLE_ALERT_STATE_OPTIONS.map((opt) => {
          const isActive = activeState === opt.id;
          const activeClasses =
            opt.id === 'sos_active'
              ? 'bg-[#fa114f] text-white border-[#fa114f] shadow-[0_0_18px_rgba(250,17,79,0.35)]'
              : opt.id === 'high_heat'
                ? 'bg-[#ef4444]/20 text-rose-100 border-[#ef4444]/70'
                : opt.id === 'hydration_alert'
                  ? 'bg-cyan-500/20 text-cyan-100 border-cyan-400/70'
                  : opt.id === 'amber_forecast'
                    ? 'bg-[#f59e0b]/20 text-amber-100 border-[#f59e0b]/70'
                    : 'bg-[#787aff] text-white border-[#787aff] shadow-[0_0_16px_rgba(120,122,255,0.28)]';

          return (
            <button
              key={opt.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              data-testid={`alert-state-tab-${opt.id}`}
              onClick={() => onChangeState(opt.id)}
              className={`min-h-[40px] px-3.5 py-2 rounded-xl border text-xs font-semibold flex items-center gap-2 transition-all active:scale-[0.99] cursor-pointer whitespace-nowrap shrink-0 ${
                isActive
                  ? activeClasses
                  : 'bg-[#0c111d] text-slate-300 border-white/10 hover:text-white hover:border-white/20'
              }`}
            >
              <span
                aria-hidden="true"
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: opt.accentHex }}
              />
              <span>{opt.shortLabel}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

interface HighRiskWbgtDialProps {
  wbgtC: number;
  tempUnit: TemperatureUnit;
}

function HighRiskWbgtDial({ wbgtC, tempUnit }: HighRiskWbgtDialProps) {
  const minC = 30;
  const maxC = 42;
  const frac = Math.max(0, Math.min(1, (wbgtC - minC) / (maxC - minC)));
  const startDeg = -110;
  const spanDeg = 220;
  const pointerDeg = startDeg + frac * spanDeg;

  const toXY = (r: number, degFromTop: number) => {
    const rad = ((degFromTop - 90) * Math.PI) / 180;
    return { x: 110 + r * Math.cos(rad), y: 108 + r * Math.sin(rad) };
  };
  const arcPath = (r: number, a1: number, a2: number) => {
    const s = toXY(r, a1);
    const e = toXY(r, a2);
    const large = Math.abs(a2 - a1) > 180 ? 1 : 0;
    return `M ${s.x.toFixed(1)} ${s.y.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${e.x.toFixed(1)} ${e.y.toFixed(1)}`;
  };

  const highRiskStartDeg = startDeg + ((37 - minC) / (maxC - minC)) * spanDeg;
  const highRiskEndDeg = startDeg + ((40 - minC) / (maxC - minC)) * spanDeg;
  const tip = toXY(66, pointerDeg);
  const tail = toXY(12, pointerDeg + 180);

  return (
    <div
      data-testid="high-risk-wbgt-dial"
      className="rounded-[20px] bg-[#0c111d] border border-[#ef4444]/40 p-4 flex flex-col items-center justify-between"
    >
      <div className="w-full flex items-center justify-between text-xs">
        <span className="font-semibold text-white">High Risk Dial</span>
        <span className="font-mono text-[11px] text-rose-300 font-semibold">
          {tempUnit === 'F' ? '99–104°F High Risk' : '37–40°C High Risk'}
        </span>
      </div>

      <svg
        viewBox="0 0 220 164"
        className="w-full max-w-[220px] h-auto mt-1"
        role="img"
        aria-label={`37 to 40 degrees Celsius High Risk WBGT dial showing ${formatTemperature(wbgtC, tempUnit, 1)}`}
      >
        <defs>
          <linearGradient id="sg-panel-heat-grad" x1="0%" y1="50%" x2="100%" y2="50%">
            <stop offset="0%" stopColor="#f59e0b" />
            <stop offset="55%" stopColor="#ef4444" />
            <stop offset="100%" stopColor="#fa114f" />
          </linearGradient>
        </defs>
        <path
          d={arcPath(78, startDeg, startDeg + spanDeg)}
          fill="none"
          stroke="#1e293b"
          strokeWidth={14}
          strokeLinecap="round"
        />
        <path
          d={arcPath(78, startDeg, highRiskEndDeg)}
          fill="none"
          stroke="url(#sg-panel-heat-grad)"
          strokeWidth={10}
          strokeLinecap="round"
        />
        <path
          d={arcPath(78, highRiskStartDeg, highRiskEndDeg)}
          fill="none"
          stroke="#fa114f"
          strokeWidth={14}
          strokeLinecap="butt"
          opacity={0.78}
        />
        <line
          x1={tail.x}
          y1={tail.y}
          x2={tip.x}
          y2={tip.y}
          stroke="#ffffff"
          strokeWidth={3.5}
          strokeLinecap="round"
        />
        <circle cx={110} cy={108} r={5.5} fill="#0c111d" stroke="#fa114f" strokeWidth={2.5} />
        <text
          x={110}
          y={138}
          textAnchor="middle"
          className="font-mono tabular-nums"
          fill="#ffffff"
          fontSize="22"
          fontWeight="700"
        >
          {formatTemperature(wbgtC, tempUnit, 1)}
        </text>
        <text
          x={110}
          y={155}
          textAnchor="middle"
          className="font-mono"
          fill="#fca5a5"
          fontSize="10"
        >
          Effective WBGT · High Risk Zone
        </text>
      </svg>
    </div>
  );
}

interface WearableAlertSpecColumnProps {
  alertState: Exclude<WearableAlertStateId, 'live'>;
  language: SupportedLanguage;
  onChangeLanguage: (lang: SupportedLanguage) => void;
  globalLanguageOverride?: GlobalLanguageOverride | null;
  translatingGlobal?: boolean;
  onSelectGlobalLanguage?: (lang: GlobalLanguageOption) => void;
  onClearGlobalLanguage?: () => void;
  tempUnit: TemperatureUnit;
  updating: boolean;
  onBackToLive: () => void;
  onDispatchRealSos: () => Promise<void> | void;
  hydrationCount: number;
  onLogHydrationCheckIn: () => Promise<void> | void;
}

export function WearableAlertSpecColumn({
  alertState,
  language,
  onChangeLanguage,
  globalLanguageOverride = null,
  translatingGlobal = false,
  onSelectGlobalLanguage,
  onClearGlobalLanguage,
  tempUnit,
  updating,
  onBackToLive,
  onDispatchRealSos,
  hydrationCount,
  onLogHydrationCheckIn,
}: WearableAlertSpecColumnProps) {
  const [escalationPulseCount, setEscalationPulseCount] = useState(0);
  const copy = getWearableAlertSpecCopy(alertState, language, tempUnit);
  const activeHeadline = globalLanguageOverride?.copy.headline ?? copy.headline;
  const activeAction = globalLanguageOverride?.copy.action ?? copy.action;
  const activeSecondary = globalLanguageOverride?.copy.explanation ?? copy.secondaryDetail;
  const activeLanguageLabel =
    globalLanguageOverride?.option.nativeName ?? LANGUAGE_LABELS[language].native;
  const isRtl = globalLanguageOverride?.option.rtl ?? isRtlLanguage(language);

  const cardRingClass =
    alertState === 'sos_active'
      ? 'border-[#fa114f]/80 ring-1 ring-[#fa114f]/40 shadow-[0_0_32px_rgba(250,17,79,0.22)]'
      : alertState === 'high_heat'
        ? 'border-[#ef4444]/60 ring-1 ring-[#ef4444]/30 shadow-[0_0_26px_rgba(239,68,68,0.16)]'
        : alertState === 'hydration_alert'
          ? 'border-cyan-400/50 ring-1 ring-cyan-400/20 shadow-[0_0_24px_rgba(6,182,212,0.12)]'
          : 'border-[#f59e0b]/55 ring-1 ring-[#f59e0b]/25 shadow-[0_0_24px_rgba(245,158,11,0.12)]';

  return (
    <div className="space-y-6">
      {/* State Top Alert Banner */}
      {alertState === 'amber_forecast' && (
        <div
          data-testid="spec-banner-amber-forecast"
          className="px-4 py-3.5 rounded-[22px] bg-[#f59e0b]/15 border border-[#f59e0b]/60 text-amber-100 flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2.5 text-sm font-semibold">
            <TrendingUp className="w-4 h-4 text-[#f59e0b] shrink-0" />
            <span>{copy.bannerTitle}</span>
          </div>
          <span className="font-mono text-xs text-amber-200">
            t+15m: 5.2 (+1.2)
          </span>
        </div>
      )}

      {alertState === 'sos_active' && (
        <div
          data-testid="spec-banner-sos-active"
          className="px-4 py-3.5 rounded-[22px] border border-[#fa114f] text-white flex flex-wrap items-center justify-between gap-3 sg-sos-flash"
        >
          <div className="flex items-center gap-2.5 text-sm font-bold tracking-wide">
            <OctagonAlert className="w-5 h-5 text-[#ff8aa8] shrink-0" />
            <span>{copy.bannerTitle}</span>
          </div>
          <span className="font-mono text-xs font-bold uppercase text-rose-100">
            Distress Sensor Active
          </span>
        </div>
      )}

      {/* Primary Guidance + Language Switcher Card */}
      <div
        className={`bg-[#141821]/95 text-slate-100 rounded-[24px] border p-6 shadow-[0_12px_40px_rgba(0,0,0,0.38)] transition-colors ${cardRingClass}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-white/10">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-xs font-mono uppercase tracking-wider text-slate-400">
              Wearable Safety Guidance ({activeLanguageLabel})
            </span>
            <span className="px-2.5 py-0.5 rounded-lg border border-[#f59e0b]/45 bg-[#f59e0b]/15 text-[11px] font-mono text-amber-200 inline-flex items-center gap-1.5">
              <WifiOff className="w-3 h-3 shrink-0" />
              <span>Gemma 4 Edge Offline Mode</span>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1 p-1 bg-[#0c111d] rounded-xl border border-white/10">
            {(Object.keys(LANGUAGE_LABELS) as SupportedLanguage[]).map((code) => (
              <button
                key={code}
                type="button"
                disabled={updating}
                onClick={() => onChangeLanguage(code)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-lg transition-all active:scale-[0.99] cursor-pointer whitespace-nowrap ${
                  !globalLanguageOverride && language === code
                    ? 'bg-[#787aff] text-white shadow-xs'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                {LANGUAGE_LABELS[code].native}
              </button>
            ))}
          </div>
        </div>

        {onSelectGlobalLanguage && (
          <div className="mt-3">
            <GlobalLanguagePicker
              activeGlobalLang={globalLanguageOverride?.option ?? null}
              translating={translatingGlobal}
              onSelectGlobalLanguage={onSelectGlobalLanguage}
              onClearGlobalLanguage={onClearGlobalLanguage}
            />
          </div>
        )}

        <div className="mt-4" dir={isRtl ? 'rtl' : 'ltr'}>
          <div className="text-lg font-bold text-white leading-snug">{activeHeadline}</div>
          <p className="text-sm text-slate-200 mt-1.5 leading-relaxed">{activeAction}</p>
          <p className="text-xs text-slate-400 mt-2">{activeSecondary}</p>
        </div>

        {/* STATE 1: AMBER FORECAST TELEMETRY */}
        {alertState === 'amber_forecast' && (
          <div className="mt-5 pt-4 border-t border-white/10 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono tabular-nums">
              <div className="rounded-xl bg-[#0c111d] border border-white/10 p-3.5">
                <div className="text-[11px] text-slate-400">Current Dial</div>
                <div className="text-xl font-bold text-emerald-300 mt-1">
                  4.0 Nominal
                </div>
              </div>
              <div className="rounded-xl bg-[#0c111d] border border-[#f59e0b]/40 p-3.5">
                <div className="text-[11px] text-amber-200">Forward Projection</div>
                <div className="text-xl font-bold text-amber-300 mt-1">
                  t+15m: 5.2 (+1.2)
                </div>
              </div>
              <div className="rounded-xl bg-[#0c111d] border border-white/10 p-3.5">
                <div className="text-[11px] text-slate-400">Crossing ETA</div>
                <div className="text-xl font-bold text-white mt-1">Amber In ~1 min</div>
              </div>
            </div>

            <div className="rounded-xl bg-[#0c111d] border border-[#f59e0b]/35 p-4 flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-xs font-semibold text-amber-200">
                  Gemma 4 Edge Offline Mode Readout
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  On-device thermal inference sustaining Abu Dhabi shift protection
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-4 font-mono tabular-nums text-sm">
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
            </div>
          </div>
        )}

        {/* STATE 2: HYDRATION ALERT TELEMETRY */}
        {alertState === 'hydration_alert' && (
          <div className="mt-5 pt-4 border-t border-white/10 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono tabular-nums">
              <div className="rounded-xl bg-[#0c111d] border border-cyan-400/35 p-3.5">
                <div className="text-[11px] text-slate-400">Skin Temp</div>
                <div className="text-xl font-bold text-white mt-1">
                  <AnimatedMetric value={formatTemperature(36.0, tempUnit, 1)} />
                </div>
              </div>
              <div className="rounded-xl bg-[#0c111d] border border-cyan-400/35 p-3.5">
                <div className="text-[11px] text-slate-400">Relative Humidity</div>
                <div className="text-xl font-bold text-cyan-300 mt-1">RH 29%</div>
              </div>
              <div className="rounded-xl bg-[#0c111d] border border-emerald-400/35 p-3.5">
                <div className="text-[11px] text-slate-400">Sweat Rate</div>
                <div className="text-lg font-bold text-emerald-300 mt-1">0.8 ml/hr (Optimal)</div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-gradient-to-r from-cyan-500/12 to-amber-500/10 border border-cyan-400/35 p-4">
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-full bg-cyan-500/20 border border-cyan-400/50 flex items-center justify-center shrink-0">
                  <Droplets className="w-5 h-5 text-cyan-300" />
                </span>
                <div>
                  <div className="text-xs font-semibold text-white">
                    Hydration Cycle · {hydrationCount} bottles logged today
                  </div>
                  <div className="text-[11px] text-slate-300">
                    Next scheduled intake in 20 min · 250 ml cool electrolyte water
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void onLogHydrationCheckIn()}
                className="px-3.5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-semibold cursor-pointer active:scale-[0.99] transition-all whitespace-nowrap"
              >
                Log 250 ml Intake
              </button>
            </div>
          </div>
        )}

        {/* STATE 3: HIGH HEAT / WBGT TELEMETRY */}
        {alertState === 'high_heat' && (
          <div className="mt-5 pt-4 border-t border-white/10 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div
              data-testid="env-heat-stress-card"
              className="rounded-[20px] bg-[#0c111d] border border-white/10 p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                  <Flame className="w-4 h-4 text-[#ef4444]" />
                  <span>Environmental Heat Stress Sensors</span>
                </span>
                <span className="font-mono text-[11px] text-rose-300 font-semibold">ACTIVE</span>
              </div>

              <div className="grid grid-cols-2 gap-2.5 font-mono tabular-nums text-xs">
                <div className="rounded-xl bg-[#141821] border border-[#ef4444]/35 p-3">
                  <div className="text-slate-400 text-[11px]">Central WBGT</div>
                  <div className="text-lg font-bold text-rose-300 mt-0.5">
                    {formatTemperature(37.2, tempUnit, 1)}
                  </div>
                </div>
                <div className="rounded-xl bg-[#141821] border border-white/10 p-3">
                  <div className="text-slate-400 text-[11px]">Air Temperature</div>
                  <div className="text-lg font-bold text-white mt-0.5">
                    {formatTemperature(47.1, tempUnit, 1)}
                  </div>
                </div>
                <div className="rounded-xl bg-[#141821] border border-white/10 p-3">
                  <div className="text-slate-400 text-[11px]">Humidity (RH)</div>
                  <div className="text-base font-bold text-cyan-300 mt-0.5">29%</div>
                </div>
                <div className="rounded-xl bg-[#141821] border border-white/10 p-3">
                  <div className="text-slate-400 text-[11px]">Globe / Solar</div>
                  <div className="text-base font-bold text-amber-300 mt-0.5">
                    {formatTemperature(54.8, tempUnit, 1)} · 940 W/m²
                  </div>
                </div>
              </div>
            </div>

            <HighRiskWbgtDial wbgtC={37.2} tempUnit={tempUnit} />
          </div>
        )}

        {/* STATE 4: SOS ACTIVE + DISTRESS SENSOR + LIVE ESCALATION STREAM */}
        {alertState === 'sos_active' && (
          <div className="mt-5 pt-4 border-t border-white/10 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono tabular-nums">
              <div className="rounded-xl bg-[#fa114f]/15 border border-[#fa114f]/60 p-3.5">
                <div className="text-[11px] text-rose-200 flex items-center gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5 text-[#fa114f]" />
                  <span>Distress Sensor</span>
                </div>
                <div className="text-lg font-bold text-white mt-1">ACTIVE</div>
              </div>
              <div className="rounded-xl bg-[#0c111d] border border-white/10 p-3.5">
                <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-[#fa114f]" />
                  <span>Heart Rate</span>
                </div>
                <div className="text-lg font-bold text-white mt-1">HR 98 bpm</div>
              </div>
              <div className="rounded-xl bg-[#0c111d] border border-white/10 p-3.5">
                <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                  <Thermometer className="w-3.5 h-3.5 text-amber-300" />
                  <span>Skin Temp</span>
                </div>
                <div className="text-lg font-bold text-white mt-1">
                  {formatTemperature(36.0, tempUnit, 1)}
                </div>
              </div>
            </div>

            <div
              data-testid="sos-escalation-stream"
              className="rounded-[20px] bg-[#0c111d] border border-[#fa114f]/45 p-4 space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-semibold text-white">
                  Live Escalation Stream
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEscalationPulseCount((c) => c + 1)}
                    className="px-2.5 py-1 rounded-lg bg-[#17191d] border border-white/15 text-[11px] font-mono text-slate-200 hover:bg-white/5 cursor-pointer"
                  >
                    Ping Escalation ({escalationPulseCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => void onDispatchRealSos()}
                    className="px-3 py-1 rounded-lg bg-[#fa114f] text-white text-[11px] font-semibold hover:brightness-110 cursor-pointer"
                  >
                    Sync SOS to Supervisor
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                {SOS_ESCALATION_TIMELINE.map((ev) => (
                  <div
                    key={ev.id}
                    className="flex items-start justify-between gap-3 rounded-xl bg-[#141821] border border-white/8 px-3 py-2 text-xs"
                  >
                    <div className="flex items-baseline gap-2.5 min-w-0 flex-1">
                      <span className="font-mono text-[11px] text-[#ff8aa8] shrink-0">
                        {ev.offsetLabel}
                      </span>
                      <span className="font-mono text-[11px] text-slate-400 shrink-0">
                        {ev.channel}
                      </span>
                      <span className="text-slate-200 leading-snug">{ev.message}</span>
                    </div>
                    <span className="font-mono text-[10px] text-emerald-300 shrink-0 pt-0.5">
                      {ev.status}
                    </span>
                  </div>
                ))}
                {escalationPulseCount > 0 && (
                  <div className="flex items-center justify-between gap-2 rounded-xl bg-[#fa114f]/12 border border-[#fa114f]/40 px-3 py-2 text-xs">
                    <span className="font-mono text-[11px] text-rose-200">
                      Live Ping #{escalationPulseCount} · Beacon lock verified &amp; Medic ETA 2 min
                    </span>
                    <span className="font-mono text-[10px] text-rose-200">Confirmed</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="mt-5 pt-4 border-t border-white/10 flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-slate-400">
            Previewing Alert Specification · Live physiological stream remains active in background
          </span>
          <button
            type="button"
            onClick={onBackToLive}
            className={`${SG_SURFACES.buttonSecondary} px-3.5 py-1.5 text-xs`}
          >
            Return to Live Telemetry
          </button>
        </div>
      </div>
    </div>
  );
}
