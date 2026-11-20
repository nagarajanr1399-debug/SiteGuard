import { useCallback, useEffect, useState } from 'react';
import { Pause, Play, RotateCcw, Sparkles, Volume2, VolumeX } from 'lucide-react';
import { AnimatedMetric } from '../components/PageTransition';
import { VoiceCopilotBar, VoiceWaveform, useVoiceSpeechOutput } from '../components/VoiceCopilotBar';
import { useAbuDhabiClock } from '../hooks/useAbuDhabiClock';
import { SG_COLORS, SG_SURFACES } from '../shared/designTokens';
import type {
  ForecastReplaySample,
  ForecastValidationReport,
  ValidationAiInsights,
} from '../shared/types';

interface ForecastValidationApiResponse {
  report: ForecastValidationReport;
  cohortMetadata: {
    source: string;
    generator: string;
    count: number;
  };
}

export function ForecastValidationPage() {
  const [data, setData] = useState<ForecastValidationApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [hoverSample, setHoverSample] = useState<ForecastReplaySample | null>(null);
  const [aiInsights, setAiInsights] = useState<ValidationAiInsights | null>(null);
  const [analyzingAi, setAnalyzingAi] = useState(false);
  const [replayIndex, setReplayIndex] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const { speaking, speak, stopSpeaking } = useVoiceSpeechOutput();
  const clock = useAbuDhabiClock();

  const loadValidation = useCallback(async () => {
    try {
      const res = await fetch('/api/validation/forecast');
      const json = (await res.json()) as ForecastValidationApiResponse;
      setData(json);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadValidation();
  }, [loadValidation]);

  const samplesLength = data?.report.sampleReplay.length ?? 0;

  useEffect(() => {
    if (!isPlaying || samplesLength === 0) return;
    const id = window.setInterval(() => {
      setReplayIndex((prev) => {
        const cur = prev ?? 0;
        if (cur + 1 >= samplesLength) {
          setIsPlaying(false);
          return samplesLength - 1;
        }
        return cur + 1;
      });
    }, 180);
    return () => window.clearInterval(id);
  }, [isPlaying, samplesLength]);

  const handleAnalyzeForecast = async () => {
    setAnalyzingAi(true);
    try {
      const res = await fetch('/api/validation/ai-insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'forecast' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ValidationAiInsights;
      setAiInsights(json);
    } catch {
      // Keep UI responsive on transient failure
    } finally {
      setAnalyzingAi(false);
    }
  };

  if (loading && !data) {
    return (
      <main className="max-w-[1280px] mx-auto px-6 py-8">
        <div className="h-96 bg-[#141821] border border-white/10 rounded-[24px] animate-pulse" />
      </main>
    );
  }

  if (!data) return null;
  const { report } = data;

  // Dual-curve SVG Replay Chart (Actual vs t-15 Predicted Baseline + 90% CI + Ridge Ablation)
  // INVARIANT: Keep zero <svg> icons above this chart so `main svg.first()` remains this SVG chart.
  const samples = report.sampleReplay;
  const width = 880;
  const height = 270;
  const padL = 44;
  const padR = 20;
  const padT = 18;
  const padB = 34;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const maxMin = samples.length > 0 ? samples[samples.length - 1].minute : 240;
  const toX = (m: number) => padL + (m / Math.max(1, maxMin)) * plotW;
  const toY = (v: number) => padT + plotH - (Math.max(0, Math.min(10, v)) / 10) * plotH;

  const actualPath = samples
    .map((s, idx) => `${idx === 0 ? 'M' : 'L'} ${toX(s.minute).toFixed(1)} ${toY(s.actualPsi).toFixed(1)}`)
    .join(' ');

  const predSamples = samples.filter((s) => s.predicted15Baseline !== null);
  const baselinePath = predSamples
    .map(
      (s, idx) =>
        `${idx === 0 ? 'M' : 'L'} ${toX(s.minute).toFixed(1)} ${toY(s.predicted15Baseline!).toFixed(1)}`
    )
    .join(' ');

  const ridgePath = samples
    .filter((s) => s.predicted15Ridge !== null)
    .map(
      (s, idx) =>
        `${idx === 0 ? 'M' : 'L'} ${toX(s.minute).toFixed(1)} ${toY(s.predicted15Ridge!).toFixed(1)}`
    )
    .join(' ');

  const ciPoints =
    predSamples.length > 1
      ? [
          ...predSamples.map((s) => `${toX(s.minute).toFixed(1)},${toY(s.predicted15High!).toFixed(1)}`),
          ...[...predSamples]
            .reverse()
            .map((s) => `${toX(s.minute).toFixed(1)},${toY(s.predicted15Low!).toFixed(1)}`),
        ].join(' ')
      : '';

  const rows = [
    report.baseline15,
    report.ridgeAblation15,
    report.baseline30,
    report.ridgeAblation30,
  ];

  const maeDelta15 = Number((report.ridgeAblation15.maePsi - report.baseline15.maePsi).toFixed(2));
  const maeDelta30 = Number((report.ridgeAblation30.maePsi - report.baseline30.maePsi).toFixed(2));
  const activeCursorSample =
    hoverSample ?? (replayIndex !== null ? samples[replayIndex] ?? null : null);

  const spokenSummary = aiInsights
    ? `${aiInsights.headline}. ${aiInsights.summary}`
    : `Prospective walk-forward forecast achieved ${report.baseline15.tierAccuracyPct} percent tier accuracy at 15 minutes with ${report.baseline15.maePsi} PSI mean absolute error.`;

  return (
    <main className="max-w-[1280px] mx-auto px-6 py-5 space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">
          Prospective Forecast Validation &amp; Model Ablation
        </h1>
        <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
          Walk-forward evaluation across{' '}
          <span className="font-mono tabular-nums text-slate-200">{report.samplesEvaluated15}</span> (t+15m) and{' '}
          <span className="font-mono tabular-nums text-slate-200">{report.samplesEvaluated30}</span> (t+30m) held-out predictions. Zero LLM calls used for numeric extrapolation.{' '}
          <span className="font-mono text-emerald-300">· AUH {clock.timeWithSeconds} GST · Watch Horizon Synced</span>
        </p>
      </div>

      {/* Headline Metrics with Pure CSS Progress Telemetry Bars (No SVGs above replay chart) */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className={`${SG_SURFACES.card} px-4 py-3.5`}>
          <div className="text-xs text-slate-400">t+15m Trend MAE (PSI)</div>
          <div className="text-2xl sm:text-3xl font-mono tabular-nums font-bold text-white mt-0.5">
            <AnimatedMetric value={report.baseline15.maePsi} />
          </div>
          <div className="mt-1.5 h-1 w-full rounded-full bg-[#0c111d] overflow-hidden">
            <div
              className="h-full bg-[#787aff] rounded-full"
              style={{ width: `${Math.max(15, Math.min(100, 100 - report.baseline15.maePsi * 65))}%` }}
            />
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-400 mt-1">
            RMSE {report.baseline15.rmsePsi} · Ridge MAE {report.ridgeAblation15.maePsi}{' '}
            <span className={maeDelta15 <= 0 ? 'text-[#10b981]' : 'text-[#fa114f]'}>
              ({maeDelta15 >= 0 ? `+${maeDelta15}` : maeDelta15})
            </span>
          </div>
        </div>

        <div className={`${SG_SURFACES.card} px-4 py-3.5`}>
          <div className="text-xs text-slate-400">t+15m Tier Accuracy</div>
          <div className="text-2xl sm:text-3xl font-mono tabular-nums font-bold text-[#10b981] mt-0.5">
            <AnimatedMetric value={`${report.baseline15.tierAccuracyPct}%`} />
          </div>
          <div className="mt-1.5 h-1 w-full rounded-full bg-[#0c111d] overflow-hidden">
            <div
              className="h-full bg-[#10b981] rounded-full"
              style={{ width: `${Math.min(100, report.baseline15.tierAccuracyPct)}%` }}
            />
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-400 mt-1">
            Ridge ablation: {report.ridgeAblation15.tierAccuracyPct}%
          </div>
        </div>

        <div className={`${SG_SURFACES.card} px-4 py-3.5`}>
          <div className="text-xs text-slate-400">t+30m Trend MAE (PSI)</div>
          <div className="text-2xl sm:text-3xl font-mono tabular-nums font-bold text-white mt-0.5">
            <AnimatedMetric value={report.baseline30.maePsi} />
          </div>
          <div className="mt-1.5 h-1 w-full rounded-full bg-[#0c111d] overflow-hidden">
            <div
              className="h-full bg-[#f59e0b] rounded-full"
              style={{ width: `${Math.max(15, Math.min(100, 100 - report.baseline30.maePsi * 55))}%` }}
            />
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-400 mt-1">
            RMSE {report.baseline30.rmsePsi} · Ridge MAE {report.ridgeAblation30.maePsi}{' '}
            <span className={maeDelta30 <= 0 ? 'text-[#10b981]' : 'text-[#fa114f]'}>
              ({maeDelta30 >= 0 ? `+${maeDelta30}` : maeDelta30})
            </span>
          </div>
        </div>

        <div className={`${SG_SURFACES.card} px-4 py-3.5`}>
          <div className="text-xs text-slate-400">t+30m Tier Accuracy</div>
          <div className="text-2xl sm:text-3xl font-mono tabular-nums font-bold text-[#a5a7ff] mt-0.5">
            <AnimatedMetric value={`${report.baseline30.tierAccuracyPct}%`} />
          </div>
          <div className="mt-1.5 h-1 w-full rounded-full bg-[#0c111d] overflow-hidden">
            <div
              className="h-full bg-[#a5a7ff] rounded-full"
              style={{ width: `${Math.min(100, report.baseline30.tierAccuracyPct)}%` }}
            />
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-400 mt-1">
            90% CI Coverage: {report.baseline30.ci90CoveragePct}%
          </div>
        </div>
      </section>

      {/* Prospective Trajectory Replay Chart (Remains the 1st <svg> inside <main>) */}
      <section className={`${SG_SURFACES.panel} p-5`}>
        <div className="flex flex-wrap items-center justify-between gap-4 mb-3">
          <div>
            <h2 className="text-base font-semibold text-white">
              Prospective Replay: Predicted (15m prior) vs. Actual Realized Score (
              <span className="font-mono text-[#a5a7ff]">{report.sampleReplayTrajectoryId}</span>)
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Hover across minutes or press Play Replay below to trace the exact t-15 prediction made before strain materialized.
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-300">
            <span className="flex items-center gap-1.5">
              <span className="w-4 h-0.5 bg-white inline-block" /> Actual Score
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-4 h-0.5 bg-[#f59e0b] inline-block border-b border-dashed border-[#f59e0b]" />{' '}
              Damped Trend (t-15)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-4 h-0.5 bg-[#787aff] inline-block" /> Ridge Ablation (t-15)
            </span>
          </div>
        </div>

        <div className="relative bg-[#0c111d] border border-white/10 rounded-xl p-3">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="w-full h-auto cursor-crosshair"
            onMouseLeave={() => setHoverSample(null)}
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const relX = ((e.clientX - rect.left) / rect.width) * width;
              const targetMin = ((relX - padL) / plotW) * maxMin;
              let best = samples[0];
              let bestDist = Infinity;
              for (const s of samples) {
                const d = Math.abs(s.minute - targetMin);
                if (d < bestDist) {
                  bestDist = d;
                  best = s;
                }
              }
              setHoverSample(best ?? null);
            }}
          >
            {/* Horizontal grid & thresholds */}
            {[0, 2, 4, 7, 10].map((val) => (
              <g key={val}>
                <line
                  x1={padL}
                  x2={width - padR}
                  y1={toY(val)}
                  y2={toY(val)}
                  stroke={
                    val === 7
                      ? SG_COLORS.tierRed
                      : val === 4
                        ? SG_COLORS.tierAmber
                        : 'rgba(255,255,255,0.08)'
                  }
                  strokeOpacity={val === 7 || val === 4 ? 0.55 : 1}
                  strokeDasharray={val === 4 || val === 7 ? '4 4' : undefined}
                  strokeWidth={1}
                />
                <text
                  x={padL - 8}
                  y={toY(val) + 3}
                  textAnchor="end"
                  fontSize="10"
                  fontFamily="JetBrains Mono, monospace"
                  fill={val === 7 ? '#ff6b93' : val === 4 ? '#fbbf24' : '#94a3b8'}
                >
                  {val.toFixed(1)}
                </text>
              </g>
            ))}

            {/* 90% Confidence Interval shaded band */}
            {ciPoints && <polygon points={ciPoints} fill="rgba(245,158,11,0.16)" />}

            {/* Curves */}
            <path d={actualPath} fill="none" stroke="#f8fafc" strokeWidth={2.5} />
            <path d={baselinePath} fill="none" stroke={SG_COLORS.tierAmber} strokeWidth={2} strokeDasharray="5 3" />
            <path d={ridgePath} fill="none" stroke={SG_COLORS.accentPurple} strokeWidth={1.75} strokeDasharray="2 2" />

            {/* Interactive Hover / Playback Marker */}
            {activeCursorSample && (
              <g>
                <line
                  x1={toX(activeCursorSample.minute)}
                  x2={toX(activeCursorSample.minute)}
                  y1={padT}
                  y2={padT + plotH}
                  stroke="#a5a7ff"
                  strokeOpacity={0.65}
                  strokeWidth={1.25}
                />
                <circle
                  cx={toX(activeCursorSample.minute)}
                  cy={toY(activeCursorSample.actualPsi)}
                  r={4.5}
                  fill="#ffffff"
                  stroke="#787aff"
                  strokeWidth={2}
                />
                {activeCursorSample.predicted15Baseline !== null && (
                  <circle
                    cx={toX(activeCursorSample.minute)}
                    cy={toY(activeCursorSample.predicted15Baseline)}
                    r={4}
                    fill={SG_COLORS.tierAmber}
                  />
                )}
              </g>
            )}

            {/* X axis labels */}
            {[0, 60, 120, 180, maxMin].map((m) => (
              <text
                key={m}
                x={toX(m)}
                y={height - 10}
                textAnchor="middle"
                fontSize="10"
                fontFamily="JetBrains Mono, monospace"
                fill="#94a3b8"
              >
                T+{m}m
              </text>
            ))}
          </svg>

          {/* Playback Scrubber Bar (Below the SVG chart) */}
          <div className="mt-3 pt-3 border-t border-white/10 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => {
                if (!isPlaying && (replayIndex === null || replayIndex >= samples.length - 1)) {
                  setReplayIndex(0);
                }
                setIsPlaying((p) => !p);
              }}
              className={`${SG_SURFACES.buttonSecondary} px-3 py-1.5 text-xs flex items-center gap-1.5`}
            >
              {isPlaying ? (
                <>
                  <Pause className="w-3.5 h-3.5 text-[#f59e0b]" />
                  <span>Pause Replay</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 text-[#10b981]" />
                  <span>Play Replay</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setIsPlaying(false);
                setReplayIndex(null);
              }}
              className={`${SG_SURFACES.buttonSecondary} px-2.5 py-1.5 text-xs flex items-center gap-1`}
              aria-label="Reset replay scrubber"
            >
              <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
            </button>

            <input
              type="range"
              aria-label="Replay timeline scrubber"
              min={0}
              max={Math.max(0, samples.length - 1)}
              value={replayIndex ?? Math.max(0, samples.length - 1)}
              onChange={(e) => {
                setIsPlaying(false);
                setReplayIndex(Number(e.target.value));
              }}
              className="flex-1 min-w-[160px] sg-slider"
            />
            <span className="font-mono tabular-nums text-xs text-slate-300">
              {activeCursorSample ? `T+${activeCursorSample.minute}m` : `Full ${maxMin}m`}
            </span>
          </div>

          {activeCursorSample && (
            <div className="mt-2 px-3 py-2 bg-[#141821] border border-white/10 rounded-lg text-xs font-mono tabular-nums text-slate-200 flex flex-wrap gap-6">
              <span>Minute: T+{activeCursorSample.minute}m</span>
              <span>Actual Score: {activeCursorSample.actualPsi.toFixed(2)}</span>
              <span>
                t-15 Damped Trend:{' '}
                {activeCursorSample.predicted15Baseline !== null
                  ? `${activeCursorSample.predicted15Baseline.toFixed(2)} [${activeCursorSample.predicted15Low?.toFixed(2)}–${activeCursorSample.predicted15High?.toFixed(2)}]`
                  : 'Warmup'}
              </span>
              <span>
                t-15 Ridge Ablation:{' '}
                {activeCursorSample.predicted15Ridge !== null ? activeCursorSample.predicted15Ridge.toFixed(2) : 'Warmup'}
              </span>
            </div>
          )}
        </div>
      </section>

      {/* Ablation Comparison Table */}
      <section className={`${SG_SURFACES.panel} p-6`}>
        <h2 className="text-base font-semibold text-white mb-1">
          Ablation Comparison: Interpretable Trend Baseline vs. Lagged Ridge Regressor
        </h2>
        <p className="text-xs text-slate-400 mb-4">{report.methodologyNote}</p>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-white/10 text-xs text-slate-400">
                <th className="py-2.5 pr-4 font-medium">Model</th>
                <th className="py-2.5 pr-4 font-medium text-right">Horizon</th>
                <th className="py-2.5 pr-4 font-medium text-right">Samples</th>
                <th className="py-2.5 pr-4 font-medium text-right">MAE (PSI)</th>
                <th className="py-2.5 pr-4 font-medium text-right">RMSE (PSI)</th>
                <th className="py-2.5 pr-4 font-medium text-right">Tier Accuracy</th>
                <th className="py-2.5 font-medium text-right">90% CI Coverage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/8 font-mono tabular-nums text-xs">
              {rows.map((r) => (
                <tr key={`${r.modelName}-${r.horizonMin}`} className="hover:bg-white/[0.02]">
                  <td className="py-3 pr-4 font-sans font-semibold text-white">{r.modelName}</td>
                  <td className="py-3 pr-4 text-right text-slate-300">t+{r.horizonMin}m</td>
                  <td className="py-3 pr-4 text-right text-slate-400">{r.samplesEvaluated}</td>
                  <td className="py-3 pr-4 text-right font-semibold text-white">{r.maePsi}</td>
                  <td className="py-3 pr-4 text-right text-slate-300">{r.rmsePsi}</td>
                  <td className="py-3 pr-4 text-right font-semibold text-[#10b981]">
                    {r.tierAccuracyPct}%
                  </td>
                  <td className="py-3 text-right text-slate-300">{r.ci90CoveragePct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <VoiceCopilotBar
        currentRoute="/forecast-validation"
        summaryToRead={spokenSummary}
        quickPrompts={[
          'Read forecast ablation summary',
          'Open Backtest',
          'Open Compliance',
          'Open Supervisor',
        ]}
      />

      {/* AI Forecast Ablation Analyst + Voice Readout */}
      <section
        data-testid="forecast-ai-insights"
        className={`${SG_SURFACES.panel} p-6 space-y-4`}
      >
        <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-white/10">
          <div>
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#787aff]" />
              <span>AI Forecast &amp; Ablation Analyst</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Post-hoc model evaluation powered by Gemini 4 Hydrogen — deterministic walk-forward MAE, RMSE &amp; CI metrics remain untouched.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {aiInsights && (
              <button
                type="button"
                onClick={() => (speaking ? stopSpeaking() : speak(spokenSummary, 'en'))}
                className={`${SG_SURFACES.buttonSecondary} px-3.5 py-2 text-xs flex items-center gap-1.5`}
              >
                {speaking ? (
                  <VolumeX className="w-3.5 h-3.5 text-[#fa114f]" />
                ) : (
                  <Volume2 className="w-3.5 h-3.5 text-[#10b981]" />
                )}
                <span>{speaking ? 'Stop Audio' : 'Listen'}</span>
                <VoiceWaveform active={speaking} />
              </button>
            )}
            <button
              type="button"
              disabled={analyzingAi}
              onClick={() => void handleAnalyzeForecast()}
              className={`${SG_SURFACES.buttonPrimary} px-4 py-2 text-xs disabled:opacity-60 flex items-center gap-1.5`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{analyzingAi ? 'Analyzing...' : 'Analyze Forecast Ablation with Gemini'}</span>
            </button>
          </div>
        </div>

        {aiInsights ? (
          <div className="space-y-4">
            <div className="rounded-xl bg-[#0c111d] border border-[#787aff]/35 p-4">
              <div className="text-sm font-semibold text-white">{aiInsights.headline}</div>
              <p className="text-xs text-slate-300 mt-1.5 leading-relaxed">{aiInsights.summary}</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-xl bg-[#0c111d] border border-white/10 p-4">
                <div className="text-xs font-semibold text-[#a5a7ff] mb-2">Ablation &amp; Horizon Insights</div>
                <ul className="space-y-1.5 text-xs text-slate-200 list-disc pl-4">
                  {aiInsights.keyFindings.map((item, idx) => (
                    <li key={idx} className="leading-relaxed">{item}</li>
                  ))}
                </ul>
              </div>
              <div className="rounded-xl bg-[#0c111d] border border-white/10 p-4">
                <div className="text-xs font-semibold text-emerald-300 mb-2">Deployment Recommendations</div>
                <ul className="space-y-1.5 text-xs text-slate-200 list-disc pl-4">
                  {aiInsights.engineeringRecommendations.map((item, idx) => (
                    <li key={idx} className="leading-relaxed">{item}</li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="text-[11px] font-mono text-slate-400">
              Source: {aiInsights.source === 'gemini' ? 'Gemini 4 Hydrogen' : 'Analytical Fallback'} ·{' '}
              {new Date(aiInsights.generatedAt).toLocaleTimeString()}
            </div>
          </div>
        ) : (
          <div className="rounded-xl bg-[#0c111d] border border-white/10 p-4 text-xs text-slate-400">
            Click &quot;Analyze Forecast Ablation with Gemini&quot; to inspect why Weighted Damped Trend vs. Lagged Ridge performs differently across t+15m and t+30m horizons.
          </div>
        )}
      </section>
    </main>
  );
}
