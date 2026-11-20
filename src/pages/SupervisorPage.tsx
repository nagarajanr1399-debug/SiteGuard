import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  Check,
  Coffee,
  Lock,
  OctagonAlert,
  Radar,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { AnimatedMetric } from '../components/PageTransition';
import { TemperatureThresholdEditor } from '../components/TemperatureThresholdEditor';
import { UaeSiteHubSimulator } from '../components/UaeSiteHubSimulator';
import { VoiceCopilotBar, VoiceWaveform, useVoiceSpeechOutput } from '../components/VoiceCopilotBar';
import { useAbuDhabiClock } from '../hooks/useAbuDhabiClock';
import { getTierTokens, SG_COLORS, SG_SURFACES } from '../shared/designTokens';
import { formatTemperature, formatTemperatureText, type TemperatureUnit } from '../shared/temperature';
import {
  isRtlLanguage,
  LANGUAGE_LABELS,
  type EnvironmentalObservation,
  type IncidentLogEntry,
  type ShiftRotationSuggestion,
  type SupervisorAiBriefing,
  type SupportedLanguage,
  type WorkerStatusPublic,
} from '../shared/types';

interface SupervisorSnapshot {
  crew: WorkerStatusPublic[];
  needsBreakQueue: WorkerStatusPublic[];
  rotationSuggestions: ShiftRotationSuggestion[];
  alerts: IncidentLogEntry[];
  env: EnvironmentalObservation;
  privacyEnforced: true;
}

const SUPERVISOR_CACHE_KEY = 'siteguard_last_supervisor';

function readCachedSupervisor(): SupervisorSnapshot | null {
  try {
    const raw = window.localStorage.getItem(SUPERVISOR_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SupervisorSnapshot;
  } catch {
    return null;
  }
}

const ZONE_COORDS: Record<string, { x: number; y: number; label: string }> = {
  'Zone A': { x: 24, y: 30, label: 'Zone A · Rebar & Slab' },
  'Zone B': { x: 74, y: 28, label: 'Zone B · Tower West' },
  'Zone C': { x: 28, y: 74, label: 'Zone C · Enclosed Bay' },
  'Zone D': { x: 76, y: 72, label: 'Zone D · Shaded Yard' },
};

function getZoneKey(zoneStr: string): string {
  const m = zoneStr.match(/Zone\s+[A-D]/i);
  return m ? `Zone ${m[0].slice(-1).toUpperCase()}` : 'Zone A';
}

export function SupervisorPage({
  env,
  tempUnit,
  onEnvUpdated,
}: {
  env?: EnvironmentalObservation | null;
  tempUnit: TemperatureUnit;
  onEnvUpdated?: (nextEnv: EnvironmentalObservation) => void;
}) {
  const [data, setData] = useState<SupervisorSnapshot | null>(() => readCachedSupervisor());
  const [loading, setLoading] = useState(() => readCachedSupervisor() === null);
  const [busyWorker, setBusyWorker] = useState<string | null>(null);
  const [briefingLang, setBriefingLang] = useState<SupportedLanguage>('en');
  const [aiBriefing, setAiBriefing] = useState<SupervisorAiBriefing | null>(null);
  const [generatingBriefing, setGeneratingBriefing] = useState(false);
  const [focusedZone, setFocusedZone] = useState<string>('ALL');
  const { speaking, speak, stopSpeaking } = useVoiceSpeechOutput();
  const clock = useAbuDhabiClock();

  const fetchSnapshot = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setData((prev) => prev ?? readCachedSupervisor());
      setLoading(false);
      return;
    }
    try {
      const res = await fetch('/api/supervisor/crew', {
        headers: { 'X-SiteGuard-Role': 'supervisor' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as SupervisorSnapshot;
      try {
        window.localStorage.setItem(SUPERVISOR_CACHE_KEY, JSON.stringify(json));
      } catch {
        // Ignore storage write errors
      }
      setData(json);
    } catch {
      setData((prev) => prev ?? readCachedSupervisor());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSnapshot();
    const id = window.setInterval(() => {
      void fetchSnapshot();
    }, 8000);
    return () => window.clearInterval(id);
  }, [fetchSnapshot, env?.wbgtC, env?.edgeOfflineActive, env?.hubId]);

  const handleAction = async (
    workerId: string,
    action: 'acknowledge' | 'order_break' | 'escalate' | 'apply_rotation'
  ) => {
    setBusyWorker(workerId);
    try {
      const res = await fetch('/api/supervisor/action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-SiteGuard-Role': 'supervisor',
        },
        body: JSON.stringify({ workerId, action }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as SupervisorSnapshot;
      try {
        window.localStorage.setItem(SUPERVISOR_CACHE_KEY, JSON.stringify(json));
      } catch {
        // Ignore storage write errors
      }
      setData(json);
    } catch {
      // Offline continuity: keep current crew state without throwing unhandled errors
    } finally {
      setBusyWorker(null);
    }
  };

  const handleGenerateBriefing = async (langOverride?: SupportedLanguage) => {
    const targetLang = langOverride ?? briefingLang;
    setGeneratingBriefing(true);
    try {
      const res = await fetch('/api/supervisor/ai-briefing', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-SiteGuard-Role': 'supervisor',
        },
        body: JSON.stringify({ language: targetLang }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as SupervisorAiBriefing;
      setAiBriefing(json);
    } catch {
      // Offline continuity: keep current briefing state
    } finally {
      setGeneratingBriefing(false);
    }
  };

  if (loading && !data) {
    return (
      <main className="max-w-[1280px] mx-auto px-6 py-8">
        <div className="h-24 bg-[#141821] border border-white/10 rounded-[22px] animate-pulse mb-6" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-48 bg-[#141821] border border-white/10 rounded-[22px] animate-pulse" />
          ))}
        </div>
      </main>
    );
  }

  if (!data) return null;

  const activeEnv = env ?? data.env;
  const redCount = data.crew.filter((w) => w.tier === 'Red').length;
  const amberCount = data.crew.filter((w) => w.tier === 'Amber').length;
  const greenCount = data.crew.filter((w) => w.tier === 'Green').length;

  const tierIcon = (tier: WorkerStatusPublic['tier']) => {
    if (tier === 'Red') return OctagonAlert;
    if (tier === 'Amber') return AlertTriangle;
    return ShieldCheck;
  };

  const renderMiniSparkline = (actual: number[], proj: number[]) => {
    const pts = [...actual, ...proj.slice(1)];
    if (pts.length < 2) return null;
    const w = 136;
    const h = 34;
    const toX = (idx: number) => 4 + (idx / Math.max(1, pts.length - 1)) * (w - 8);
    const toY = (v: number) => h - 4 - (Math.max(0, Math.min(10, v)) / 10) * (h - 8);
    const split = Math.max(0, actual.length - 1);
    const actD = actual.map((v, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(v).toFixed(1)}`).join(' ');
    const projD =
      proj.length >= 2
        ? proj.map((v, i) => `${i === 0 ? 'M' : 'L'} ${toX(split + i).toFixed(1)} ${toY(v).toFixed(1)}`).join(' ')
        : '';

    return (
      <svg viewBox={`0 0 ${w} ${h}`} className="w-36 h-8 shrink-0" aria-hidden="true">
        <line x1={0} x2={w} y1={toY(4)} y2={toY(4)} stroke={SG_COLORS.tierAmber} strokeOpacity={0.35} strokeDasharray="2 2" />
        <line x1={0} x2={w} y1={toY(7)} y2={toY(7)} stroke={SG_COLORS.tierRed} strokeOpacity={0.35} strokeDasharray="2 2" />
        <path d={actD} fill="none" stroke="#f8fafc" strokeWidth={1.75} />
        {projD && <path d={projD} fill="none" stroke={SG_COLORS.tierAmber} strokeWidth={1.75} strokeDasharray="3 2" />}
      </svg>
    );
  };

  const visibleCrew =
    focusedZone === 'ALL'
      ? data.crew
      : data.crew.filter((w) => getZoneKey(w.zone) === focusedZone);

  const briefingSpeakText = aiBriefing
    ? `${aiBriefing.executiveSummary} ${aiBriefing.priorityActions.join('. ')}`
    : `SiteGuard dispatch status for ${activeEnv.station}: ${redCount} Red critical units, ${amberCount} Amber warning units, and ${greenCount} Green units. Ambient WBGT is ${activeEnv.wbgtC} degrees Celsius.`;

  return (
    <main className="max-w-[1280px] mx-auto px-6 py-8 space-y-7">
      {/* Futuristic Command Masthead */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-[#a5a7ff] tracking-wider uppercase">
            <span>
              {activeEnv.emirate ?? 'Abu Dhabi'} · {activeEnv.station}
            </span>
            <span className="text-slate-600">·</span>
            <span className="text-emerald-300">
              {clock.timeWithSeconds} GST · {clock.middayWindowStatusLabel}
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            Supervisor Crew Grid &amp; Dispatch
          </h1>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#787aff]/12 border border-[#787aff]/35 text-xs text-slate-200">
            <Lock className="w-3.5 h-3.5 text-[#787aff] shrink-0" />
            <span>
              Privacy Enforced at API Layer: Raw vitals (HR, skin temp, exertion) are stripped from{' '}
              <code className="font-mono text-[#a5a7ff]">/api/supervisor/crew</code>. Only risk tiers and actions are exposed.
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-4 px-4 py-2 rounded-xl bg-[#141821] border border-white/10 font-mono tabular-nums text-xs">
            <span className="text-[#ff6b93] font-bold">{redCount} RED</span>
            <span className="text-slate-600">·</span>
            <span className="text-amber-300 font-bold">{amberCount} AMBER</span>
            <span className="text-slate-600">·</span>
            <span className="text-emerald-300 font-bold">{greenCount} GREEN</span>
          </div>
          <button
            type="button"
            onClick={fetchSnapshot}
            className={`${SG_SURFACES.buttonSecondary} px-3.5 py-2 text-xs flex items-center gap-2`}
          >
            <RefreshCw className="w-3.5 h-3.5 text-[#787aff]" />
            <span>Refresh Crew</span>
          </button>
        </div>
      </div>

      {/* UAE Multi-Emirate Simulation (Abu Dhabi & Dubai) + Voice AI Co-Pilot */}
      <UaeSiteHubSimulator
        env={activeEnv}
        tempUnit={tempUnit}
        onHubUpdated={(nextEnv) => {
          onEnvUpdated?.(nextEnv);
          void fetchSnapshot();
        }}
      />

      <VoiceCopilotBar
        currentRoute="/supervisor"
        language={briefingLang}
        summaryToRead={briefingSpeakText}
        onAfterCommand={(payload) => {
          if (payload.env) {
            onEnvUpdated?.(payload.env);
          }
          if (payload.snapshot && typeof payload.snapshot === 'object') {
            setData(payload.snapshot as SupervisorSnapshot);
          } else {
            void fetchSnapshot();
          }
        }}
      />

      {/* Interactive Spatial Site Thermal Radar & Zone Telemetry Matrix */}
      <section
        data-testid="supervisor-zone-radar"
        className={`${SG_SURFACES.panel} p-5 grid grid-cols-1 lg:grid-cols-12 gap-6 items-center`}
      >
        <div className="lg:col-span-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Radar className="w-4 h-4 text-[#787aff]" />
              <span>Spatial Site Thermal Radar &amp; Zone Focus</span>
            </h2>
            <span className="font-mono tabular-nums text-xs text-[#a5a7ff]">
              WBGT {formatTemperature(activeEnv.wbgtC, tempUnit, 1)}
            </span>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            Live sector overlay across {activeEnv.emirate ?? 'UAE'} active work zones. Click any zone node to filter the dispatch grid without exposing raw biometrics.
          </p>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {(['ALL', 'Zone A', 'Zone B', 'Zone C', 'Zone D'] as const).map((z) => (
              <button
                key={z}
                type="button"
                onClick={() => setFocusedZone(z)}
                className={`px-2.5 py-1 rounded-lg text-xs font-mono font-medium transition-all cursor-pointer ${
                  focusedZone === z
                    ? 'bg-[#787aff] text-white'
                    : 'bg-[#0c111d] border border-white/10 text-slate-300 hover:border-white/25'
                }`}
              >
                {z === 'ALL' ? 'All Zones (6)' : z}
              </button>
            ))}
          </div>
        </div>

        <div className="lg:col-span-7 relative h-52 rounded-2xl bg-[#0c111d] border border-white/10 overflow-hidden">
          {/* Concentric Radar Sweep Rings */}
          <div
            aria-hidden="true"
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage:
                'radial-gradient(circle at 50% 50%, rgba(120,122,255,0.12) 0%, transparent 62%), radial-gradient(circle at 50% 50%, transparent 32%, rgba(255,255,255,0.05) 32.5%, transparent 33%), radial-gradient(circle at 50% 50%, transparent 58%, rgba(255,255,255,0.05) 58.5%, transparent 59%)',
            }}
          />
          {Object.entries(ZONE_COORDS).map(([zoneKey, pos]) => {
            const unitsInZone = data.crew.filter((w) => getZoneKey(w.zone) === zoneKey);
            const hasRed = unitsInZone.some((w) => w.tier === 'Red');
            const hasAmber = unitsInZone.some((w) => w.tier === 'Amber');
            const active = focusedZone === zoneKey;
            return (
              <button
                key={zoneKey}
                type="button"
                onClick={() => setFocusedZone((prev) => (prev === zoneKey ? 'ALL' : zoneKey))}
                style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                className={`-translate-x-1/2 -translate-y-1/2 absolute rounded-xl px-3 py-2 border text-left transition-all cursor-pointer min-w-[140px] ${
                  hasRed
                    ? 'bg-[#fa114f]/15 border-[#fa114f]/60 shadow-[0_0_18px_rgba(250,17,79,0.22)]'
                    : hasAmber
                      ? 'bg-[#f59e0b]/15 border-[#f59e0b]/50'
                      : 'bg-[#141821]/95 border-white/15'
                } ${active ? 'ring-2 ring-[#787aff]' : ''}`}
              >
                <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
                  <span className="font-bold text-white">{zoneKey}</span>
                  <span className="text-slate-300">{unitsInZone.length} units</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {unitsInZone.map((u) => (
                    <span
                      key={u.workerId}
                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                        u.tier === 'Red'
                          ? 'bg-[#fa114f] text-white'
                          : u.tier === 'Amber'
                            ? 'bg-[#f59e0b] text-slate-950 font-semibold'
                            : 'bg-[#10b981]/25 text-emerald-200'
                      }`}
                    >
                      {u.workerId}
                    </span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Crew Status Grid (Tier Only — Zero Raw Vitals) */}
      <section>
        <div className="flex items-center justify-between gap-4 mb-4">
          <h2 className="text-base font-semibold text-white">
            Active Crew Status (<span className="font-mono tabular-nums text-[#a5a7ff]">{visibleCrew.length}</span> Monitored Units)
          </h2>
          {focusedZone !== 'ALL' && (
            <button
              type="button"
              onClick={() => setFocusedZone('ALL')}
              className="text-xs font-mono text-[#a5a7ff] hover:text-white underline cursor-pointer"
            >
              Show All 6 Units
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {visibleCrew.map((w) => {
            const tokens = getTierTokens(w.tier);
            const Icon = tierIcon(w.tier);
            const progressRatio =
              w.tier === 'Red' ? 92 : w.tier === 'Amber' ? 68 : w.projectedAmberCrossingMin !== null ? 44 : 24;
            return (
              <div
                key={w.workerId}
                className={`rounded-[22px] bg-[#141821]/95 border p-5 flex flex-col justify-between gap-4 transition-all ${tokens.ringClass}`}
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {/* 36px Watch-Synced Radial Tier Complication (Zero Raw Vitals) */}
                      <div className="relative w-9 h-9 shrink-0 flex items-center justify-center">
                        <svg viewBox="0 0 36 36" className="w-9 h-9 -rotate-90" aria-hidden="true">
                          <circle cx="18" cy="18" r="14" fill="none" stroke="#0c111d" strokeWidth="3.5" />
                          <circle
                            cx="18"
                            cy="18"
                            r="14"
                            fill="none"
                            stroke={tokens.hex}
                            strokeWidth="3.5"
                            strokeLinecap="round"
                            strokeDasharray={`${((progressRatio / 100) * 87.96).toFixed(1)} 88`}
                          />
                        </svg>
                        <span
                          className="absolute text-[9px] font-mono font-bold"
                          style={{ color: tokens.hex }}
                        >
                          {w.tier[0]}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs text-slate-400 truncate">
                          <span className="font-mono font-semibold text-[#a5a7ff]">{w.workerId}</span> · {w.zone}
                        </div>
                        <h3 className="text-base font-bold text-white mt-0.5 truncate">{w.roleLabel}</h3>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <div
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-mono font-bold ${tokens.pillClass}`}
                      >
                        <Icon className="w-3.5 h-3.5 shrink-0" />
                        <span>{w.tier.toUpperCase()}</span>
                      </div>
                      <span className="text-[10px] font-mono tabular-nums text-slate-400">
                        BAT {Math.round(w.deviceBatteryPct ?? 88)}% · T+{w.simulatedClockMin ?? 12}m
                      </span>
                    </div>
                  </div>

                  {/* Thermal Margin Bar */}
                  <div className="mt-3 h-1.5 w-full rounded-full bg-[#0c111d] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${progressRatio}%`,
                        backgroundColor: tokens.hex,
                      }}
                    />
                  </div>

                  <div className="mt-2.5 text-xs text-slate-400">
                    {w.ppeLevel} · <span className="font-mono tabular-nums">{w.acclimatizationDays}d</span> acclim. · Breaks{' '}
                    <span className="font-mono tabular-nums text-slate-200">{w.breaksTakenTodayMin}m</span>
                  </div>

                  <div className="mt-1.5 text-[11px] font-mono text-slate-300">{w.riskBandLabel}</div>

                  {w.scoringMode === 'environment_only_degraded' && (
                    <div className="mt-2 text-xs font-medium text-amber-200 bg-[#f59e0b]/12 border border-[#f59e0b]/35 rounded-xl px-2.5 py-1.5">
                      Env-Only Fallback ({w.faultSummary.join(', ')})
                    </div>
                  )}

                  {w.lastCheckIn?.status === 'help' && (
                    <div className="mt-2 text-xs font-mono font-semibold text-rose-200 bg-[#fa114f]/20 border border-[#fa114f]/50 rounded-xl px-2.5 py-1.5">
                      WORKER REQUESTED HELP
                    </div>
                  )}
                </div>

                {/* Forecast Sparkline & Crossing ETA */}
                <div className="pt-3 border-t border-white/10 flex items-center justify-between gap-3">
                  <div className="text-xs text-slate-300 font-mono tabular-nums">
                    {w.forecastStatus === 'ready' ? (
                      <>
                        <div>t+15m Tier: {w.predictedTier15}</div>
                        <div className="text-[11px] text-slate-400">
                          {w.projectedAmberCrossingMin === 0
                            ? 'Amber Active'
                            : w.projectedAmberCrossingMin !== null
                              ? `Amber ~${w.projectedAmberCrossingMin}m`
                              : 'Trend Stable'}
                        </div>
                      </>
                    ) : (
                      <div className="text-[11px] text-amber-300">Insufficient trend data</div>
                    )}
                  </div>
                  {renderMiniSparkline(w.sparklineComposite, w.sparklineProjected)}
                </div>

                <p className="text-xs text-slate-300 leading-relaxed">{w.recommendedAction}</p>

                <div className="flex items-center gap-2 pt-2 border-t border-white/10">
                  <button
                    type="button"
                    disabled={busyWorker === w.workerId}
                    onClick={() => handleAction(w.workerId, 'order_break')}
                    className={`flex-1 py-2 px-2.5 text-xs ${SG_SURFACES.buttonPrimary}`}
                  >
                    Order 15m Break
                  </button>
                  <button
                    type="button"
                    disabled={busyWorker === w.workerId}
                    onClick={() => handleAction(w.workerId, 'escalate')}
                    className="py-2 px-2.5 text-xs font-semibold border border-[#fa114f]/55 bg-[#fa114f]/10 text-rose-200 rounded-xl hover:bg-[#fa114f]/25 active:scale-[0.99] transition-all cursor-pointer whitespace-nowrap"
                  >
                    Escalate
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* AI Shift Triage & Dispatch Co-Pilot (Privacy-Enforced + Voice TTS) */}
      <section
        data-testid="supervisor-ai-briefing-panel"
        className={`${SG_SURFACES.panel} p-6 space-y-4`}
      >
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-white/10">
          <div>
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#787aff]" />
              <span>AI Shift Triage &amp; Crew Dispatch Briefing</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Generated from anonymized tier bands, PPE load, and crossing ETAs via Gemini 4 Hydrogen — zero raw vitals sent.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <select
              aria-label="Supervisor AI briefing language"
              value={briefingLang}
              onChange={(e) => {
                const next = e.target.value as SupportedLanguage;
                setBriefingLang(next);
                if (aiBriefing) {
                  void handleGenerateBriefing(next);
                }
              }}
              className="bg-[#0c111d] border border-white/15 rounded-xl px-3 py-2 text-xs font-medium text-slate-100 focus:outline-none focus:border-[#787aff] cursor-pointer"
            >
              {(Object.keys(LANGUAGE_LABELS) as SupportedLanguage[]).map((code) => (
                <option key={code} value={code}>
                  {LANGUAGE_LABELS[code].name} ({LANGUAGE_LABELS[code].native})
                </option>
              ))}
            </select>

            {aiBriefing && (
              <button
                type="button"
                onClick={() =>
                  speaking
                    ? stopSpeaking()
                    : speak(
                        `${aiBriefing.executiveSummary}. ${aiBriefing.priorityActions.join('. ')}`,
                        aiBriefing.language
                      )
                }
                className={`${SG_SURFACES.buttonSecondary} px-3.5 py-2 text-xs flex items-center gap-1.5`}
              >
                {speaking ? (
                  <VolumeX className="w-3.5 h-3.5 text-[#fa114f]" />
                ) : (
                  <Volume2 className="w-3.5 h-3.5 text-[#10b981]" />
                )}
                <span>{speaking ? 'Stop Voice' : 'Listen'}</span>
                <VoiceWaveform active={speaking} />
              </button>
            )}

            <button
              type="button"
              disabled={generatingBriefing}
              onClick={() => void handleGenerateBriefing()}
              className={`${SG_SURFACES.buttonPrimary} px-4 py-2 text-xs disabled:opacity-60 flex items-center gap-1.5`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{generatingBriefing ? 'Analyzing Crew...' : 'Generate AI Shift Briefing'}</span>
            </button>
          </div>
        </div>

        {aiBriefing ? (
          <div
            data-testid="supervisor-ai-briefing-body"
            dir={isRtlLanguage(aiBriefing.language) ? 'rtl' : 'ltr'}
            className="space-y-4"
          >
            <div className="rounded-xl bg-[#0c111d] border border-[#787aff]/35 p-4 text-sm text-slate-100 leading-relaxed">
              {formatTemperatureText(aiBriefing.executiveSummary, tempUnit)}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2 rounded-xl bg-[#0c111d] border border-white/10 p-4">
                <div className="text-xs font-semibold text-[#a5a7ff] mb-2">
                  Priority Dispatch &amp; Rotation Actions
                </div>
                <ul className="space-y-1.5 text-xs text-slate-200 list-disc ps-4">
                  {aiBriefing.priorityActions.map((act, idx) => (
                    <li key={idx} className="leading-relaxed">
                      {formatTemperatureText(act, tempUnit)}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-xl bg-[#0c111d] border border-white/10 p-4 space-y-2.5 text-xs">
                <div>
                  <div className="font-semibold text-amber-300 mb-0.5">Zone Concentration</div>
                  <p className="text-slate-300 leading-relaxed">{aiBriefing.zoneFocus}</p>
                </div>
                <div className="pt-2 border-t border-white/10">
                  <div className="font-semibold text-emerald-300 mb-0.5">UAE Midday Break Advisory</div>
                  <p className="text-slate-300 leading-relaxed">
                    {formatTemperatureText(aiBriefing.heatWindowAdvice, tempUnit)}
                  </p>
                </div>
              </div>
            </div>

            <div className="text-[11px] font-mono text-slate-400">
              Source: {aiBriefing.source === 'gemini' ? 'Gemini 4 Hydrogen (Privacy-Enforced)' : 'Deterministic Triage Fallback'} ·{' '}
              {new Date(aiBriefing.generatedAt).toLocaleTimeString()}
            </div>
          </div>
        ) : (
          <div className="rounded-xl bg-[#0c111d] border border-white/10 p-4 text-xs text-slate-400">
            Click &quot;Generate AI Shift Briefing&quot; for an AI-synthesized crew triage &amp; zone rotation summary in any of the 9 UAE site languages.
          </div>
        )}
      </section>

      {/* Supervisor Temperature Thresholds & Multilingual Alert Rules */}
      <TemperatureThresholdEditor tempUnit={tempUnit} onPolicySaved={fetchSnapshot} />

      {/* Bottom 2-Column Split: Priority Break Queue + Shift Rotation & Alert Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <section className={`lg:col-span-7 ${SG_SURFACES.panel} p-6`}>
          <h2 className="text-base font-semibold text-white">
            Who Needs a Break Now (Sorted by Risk &amp; Projected Crossing)
          </h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-white/10 text-xs text-slate-400">
                  <th className="py-2.5 pr-3 font-medium">Unit</th>
                  <th className="py-2.5 pr-3 font-medium">Tier</th>
                  <th className="py-2.5 pr-3 font-medium">Forecast</th>
                  <th className="py-2.5 font-medium text-right">Controls</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/8">
                {data.needsBreakQueue.map((w) => {
                  const rowTier = getTierTokens(w.tier);
                  return (
                    <tr key={w.workerId} className="hover:bg-white/[0.03] transition-colors">
                      <td className="py-3 pr-3">
                        <div className="font-semibold text-white">
                          <span className="font-mono text-[#a5a7ff]">{w.workerId}</span> · {w.roleLabel}
                        </div>
                        <div className="text-xs text-slate-400">{w.zone}</div>
                      </td>
                      <td className="py-3 pr-3 font-mono text-xs font-semibold">
                        <span className={`inline-flex px-2 py-0.5 rounded-md border ${rowTier.pillClass}`}>
                          {w.tier}
                        </span>
                      </td>
                      <td className="py-3 pr-3 font-mono tabular-nums text-xs text-slate-300">
                        {w.forecastStatus === 'ready'
                          ? w.projectedAmberCrossingMin === 0
                            ? 'Threshold crossed'
                            : w.projectedAmberCrossingMin !== null
                              ? `Amber in ~${w.projectedAmberCrossingMin}m`
                              : 'Stable'
                          : 'Insufficient trend'}
                      </td>
                      <td className="py-3 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={busyWorker === w.workerId || w.acknowledged}
                            onClick={() => handleAction(w.workerId, 'acknowledge')}
                            className="px-2.5 py-1.5 text-xs font-medium border border-white/15 bg-[#0c111d] rounded-lg text-slate-200 hover:bg-white/5 disabled:opacity-50 active:scale-[0.99] transition-all cursor-pointer flex items-center gap-1"
                          >
                            <Check className="w-3 h-3 text-[#10b981]" />
                            <span>{w.acknowledged ? 'Ack' : 'Acknowledge'}</span>
                          </button>
                          <button
                            type="button"
                            disabled={busyWorker === w.workerId}
                            onClick={() => handleAction(w.workerId, 'order_break')}
                            className="px-2.5 py-1.5 text-xs font-medium bg-[#787aff] text-white rounded-lg hover:bg-[#898bff] active:scale-[0.99] transition-all cursor-pointer flex items-center gap-1"
                          >
                            <Coffee className="w-3 h-3" />
                            <span>Break</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="lg:col-span-5 space-y-6">
          <div className={`${SG_SURFACES.panel} p-6`}>
            <h2 className="text-base font-semibold text-white">
              Shift &amp; Zone Rotation Suggestions
            </h2>
            {data.rotationSuggestions.length === 0 ? (
              <p className="text-xs text-slate-400 mt-3">
                All crew operating within nominal thermal margins; no rotation needed.
              </p>
            ) : (
              <ul className="mt-4 space-y-3">
                {data.rotationSuggestions.map((sug) => (
                  <li key={sug.id} className="pb-3 border-b border-white/8 last:border-none last:pb-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-white">
                        <span className="font-mono text-[#a5a7ff]">{sug.workerId}</span> · {sug.priority} Priority
                      </span>
                      <button
                        type="button"
                        disabled={busyWorker === sug.workerId}
                        onClick={() => handleAction(sug.workerId, 'apply_rotation')}
                        className="px-2.5 py-1 rounded-lg bg-[#787aff]/20 border border-[#787aff]/45 text-xs font-semibold text-[#b8b9ff] hover:bg-[#787aff]/35 active:scale-[0.99] flex items-center gap-1 transition-all cursor-pointer"
                      >
                        <ArrowRightLeft className="w-3 h-3" />
                        <span>Apply Rotation</span>
                      </button>
                    </div>
                    <p className="text-xs text-slate-200 mt-1">{sug.suggestedAction}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {formatTemperatureText(sug.rationale, tempUnit)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={`${SG_SURFACES.panel} p-6`}>
            <h2 className="text-base font-semibold text-white">Live Alert &amp; Fault Feed</h2>
            <ul className="mt-4 space-y-3 max-h-72 overflow-y-auto pr-1">
              {data.alerts.slice(0, 12).map((evt) => (
                <li key={evt.id} className="text-xs pb-2.5 border-b border-white/8 last:border-none">
                  <div className="flex items-center justify-between font-mono tabular-nums text-[11px] text-slate-400">
                    <span>
                      <span className="text-[#a5a7ff] font-semibold">{evt.workerId}</span> ·{' '}
                      <span
                        className={
                          evt.severity === 'Red'
                            ? 'text-[#ff5c8a]'
                            : evt.severity === 'Amber'
                              ? 'text-amber-300'
                              : 'text-slate-300'
                        }
                      >
                        {evt.severity}
                      </span>
                    </span>
                    <AnimatedMetric value={new Date(evt.timestamp).toLocaleTimeString()} />
                  </div>
                  <div className="font-medium text-slate-100 mt-0.5">
                    {formatTemperatureText(evt.summary, tempUnit)}
                  </div>
                  <div className="text-slate-400 mt-0.5">{evt.actionTaken}</div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </main>
  );
}
