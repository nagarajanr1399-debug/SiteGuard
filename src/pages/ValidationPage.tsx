import { useCallback, useEffect, useState } from 'react';
import { Activity, RefreshCw, Sliders, Sparkles, Volume2, VolumeX } from 'lucide-react';
import { AnimatedMetric } from '../components/PageTransition';
import { VoiceCopilotBar, VoiceWaveform, useVoiceSpeechOutput } from '../components/VoiceCopilotBar';
import { useAbuDhabiClock } from '../hooks/useAbuDhabiClock';
import { SG_SURFACES } from '../shared/designTokens';
import type { BacktestReport, ValidationAiInsights } from '../shared/types';

interface BacktestApiResponse {
  report: BacktestReport;
  cohortMetadata: {
    source: 'SYNTHETIC_PHYSIOLOGICAL_COHORT';
    generator: 'deterministic_calibrated' | 'gemini_synthesized';
    count: number;
  };
}

export function ValidationPage() {
  const [data, setData] = useState<BacktestApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [aiInsights, setAiInsights] = useState<ValidationAiInsights | null>(null);
  const [analyzingAi, setAnalyzingAi] = useState(false);
  const [whatIfThreshold, setWhatIfThreshold] = useState(4.0);
  const [outcomeFilter, setOutcomeFilter] = useState<
    'ALL' | 'True Positive' | 'False Positive' | 'False Negative' | 'True Negative'
  >('ALL');
  const { speaking, speak, stopSpeaking } = useVoiceSpeechOutput();
  const clock = useAbuDhabiClock();

  const loadBacktest = useCallback(async () => {
    try {
      const res = await fetch('/api/validation/backtest');
      const json = (await res.json()) as BacktestApiResponse;
      setData(json);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBacktest();
  }, [loadBacktest]);

  const handleRegenerate = async (mode: 'gemini' | 'deterministic') => {
    setRegenerating(true);
    try {
      const res = await fetch('/api/validation/generate-cohort', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, count: mode === 'gemini' ? 14 : 24 }),
      });
      const json = await res.json();
      setData({
        report: json.backtest,
        cohortMetadata: json.cohortMetadata,
      });
      setAiInsights(null);
    } finally {
      setRegenerating(false);
    }
  };

  const handleAnalyzeBacktest = async () => {
    setAnalyzingAi(true);
    try {
      const res = await fetch('/api/validation/ai-insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'backtest' }),
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
  const { report, cohortMetadata } = data;

  const tpCount = report.trajectories.filter((t) => t.outcome === 'True Positive').length;
  const fpCount = report.trajectories.filter((t) => t.outcome === 'False Positive').length;
  const fnCount = report.trajectories.filter((t) => t.outcome === 'False Negative').length;
  const tnCount = report.trajectories.filter((t) => t.outcome === 'True Negative').length;

  // Interactive "What-If" threshold sensitivity trade-off sandbox (does NOT alter official empirical scorecard)
  const delta = whatIfThreshold - 4.0;
  const estLeadMin = Math.max(
    18,
    Math.round((report.meanLeadTimeMin ?? 60) - delta * 26)
  );
  const estRecallPct = Number(
    Math.max(55, Math.min(99.5, report.sensitivityPct - delta * 9.5)).toFixed(1)
  );
  const estFalseAlarmPct = Number(
    Math.max(2, Math.min(60, report.falseAlarmRatePct - delta * 14)).toFixed(1)
  );

  const visibleTrajectories =
    outcomeFilter === 'ALL'
      ? report.trajectories
      : report.trajectories.filter((t) => t.outcome === outcomeFilter);

  const maxLead = Math.max(
    60,
    ...report.trajectories.map((t) => t.leadTimeMin ?? 0)
  );

  const spokenSummary = aiInsights
    ? `${aiInsights.headline}. ${aiInsights.summary}`
    : `Historical heatwave backtest across ${report.cohortSize} worker-days achieved ${report.sensitivityPct} percent recall, ${report.falseAlarmRatePct} percent false-alarm rate, and ${report.meanLeadTimeMin ?? 0} minutes mean warning lead time.`;

  return (
    <main className="max-w-[1280px] mx-auto px-6 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-[#a5a7ff] uppercase tracking-wider">
            <span>Empirical Clinical Replay Telemetry · UAE Heatwave Benchmark</span>
            <span className="text-slate-600">·</span>
            <span className="text-emerald-300">AUH {clock.timeWithSeconds} GST · Watch-Synced</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white mt-0.5">
            Historical Heat-Wave Backtest Validation
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Cohort Source:{' '}
            <span className="font-mono text-xs font-semibold text-[#a5a7ff]">{cohortMetadata.source}</span> ·{' '}
            Generator: {cohortMetadata.generator === 'gemini_synthesized' ? 'Gemini Synthesized' : 'Calibrated Physiological Model'} ·{' '}
            <span className="font-mono tabular-nums text-slate-200">{report.cohortSize}</span> worker-days (
            <span className="font-mono tabular-nums text-slate-200">{report.totalMinutesEvaluated}</span> simulated minutes)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={regenerating}
            onClick={() => handleRegenerate('deterministic')}
            className={`${SG_SURFACES.buttonSecondary} px-3.5 py-2 text-xs flex items-center gap-1.5`}
          >
            <RefreshCw className="w-3.5 h-3.5 text-[#787aff]" />
            <span>Calibrated Cohort (24d)</span>
          </button>
          <button
            type="button"
            disabled={regenerating}
            onClick={() => handleRegenerate('gemini')}
            className={`${SG_SURFACES.buttonPrimary} px-4 py-2 text-xs disabled:opacity-60 flex items-center gap-1.5`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{regenerating ? 'Synthesizing...' : 'Synthesize Cohort via Gemini'}</span>
          </button>
        </div>
      </div>

      {/* Primary Empirical Metrics Strip (Deterministic & Locked) */}
      <section className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className={`${SG_SURFACES.card} p-5`}>
          <div className="text-xs text-slate-400">Mean Alert Lead Time</div>
          <div className="text-3xl font-mono tabular-nums font-bold text-white mt-1">
            <AnimatedMetric value={report.meanLeadTimeMin !== null ? `${report.meanLeadTimeMin}m` : 'N/A'} />
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-400 mt-1">
            Before PSI &ge; 7.0 crossing (median {report.medianLeadTimeMin ?? 0}m)
          </div>
        </div>

        <div className={`${SG_SURFACES.card} p-5`}>
          <div className="text-xs text-slate-400">Sensitivity (Recall)</div>
          <div className="text-3xl font-mono tabular-nums font-bold text-[#10b981] mt-1">
            <AnimatedMetric value={`${report.sensitivityPct}%`} />
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-400 mt-1">
            {report.detectedEventsCount}/{report.trueEventsCount} crossings detected
          </div>
        </div>

        <div className={`${SG_SURFACES.card} p-5`}>
          <div className="text-xs text-slate-400">False-Alarm Rate</div>
          <div className="text-3xl font-mono tabular-nums font-bold text-[#f59e0b] mt-1">
            <AnimatedMetric value={`${report.falseAlarmRatePct}%`} />
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-400 mt-1">
            Specificity {report.specificityPct}%
          </div>
        </div>

        <div className={`${SG_SURFACES.card} p-5`}>
          <div className="text-xs text-slate-400">Precision</div>
          <div className="text-3xl font-mono tabular-nums font-bold text-[#a5a7ff] mt-1">
            <AnimatedMetric value={`${report.precisionPct}%`} />
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Positive predictive value</div>
        </div>

        <div className={`${SG_SURFACES.card} p-5`}>
          <div className="text-xs text-slate-400">F1 Score</div>
          <div className="text-3xl font-mono tabular-nums font-bold text-white mt-1">
            <AnimatedMetric value={report.f1Score} />
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Computed from replay</div>
        </div>
      </section>

      {/* Interactive Confusion Matrix + Threshold Calibration Sandbox + Lead-Time Spectrum */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* 2x2 Confusion Matrix + Calibration Simulator */}
        <div className={`lg:col-span-5 ${SG_SURFACES.panel} p-6 space-y-5`}>
          <div>
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <Sliders className="w-4 h-4 text-[#787aff]" />
              <span>Confusion Matrix &amp; Calibration Sandbox</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Click a cell to filter worker-day trajectories, or scrub Amber trigger threshold to explore trade-offs.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 font-mono tabular-nums">
            {[
              { label: 'True Positive', count: tpCount, tone: 'border-[#10b981]/45 bg-[#10b981]/10 text-emerald-300' },
              { label: 'False Positive', count: fpCount, tone: 'border-[#f59e0b]/45 bg-[#f59e0b]/10 text-amber-300' },
              { label: 'False Negative', count: fnCount, tone: 'border-[#fa114f]/55 bg-[#fa114f]/12 text-[#ff6b93]' },
              { label: 'True Negative', count: tnCount, tone: 'border-white/15 bg-[#0c111d] text-slate-200' },
            ].map((cell) => (
              <button
                key={cell.label}
                type="button"
                onClick={() =>
                  setOutcomeFilter((prev) =>
                    prev === cell.label ? 'ALL' : (cell.label as typeof outcomeFilter)
                  )
                }
                className={`rounded-xl border p-3.5 text-left transition-all cursor-pointer ${cell.tone} ${
                  outcomeFilter === cell.label ? 'ring-2 ring-[#787aff]' : ''
                }`}
              >
                <div className="text-[11px] opacity-85">{cell.label}</div>
                <div className="text-2xl font-bold mt-1">{cell.count}</div>
              </button>
            ))}
          </div>

          {/* What-If Threshold Sandbox Slider */}
          <div className="rounded-xl bg-[#0c111d] border border-white/10 p-4 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-200">
                What-If Amber Trigger Threshold
              </span>
              <span className="font-mono font-bold text-[#a5a7ff]">
                {whatIfThreshold.toFixed(1)} / 10
              </span>
            </div>
            <input
              type="range"
              aria-label="What-If Amber Trigger Threshold"
              min={3.5}
              max={5.0}
              step={0.1}
              value={whatIfThreshold}
              onChange={(e) => setWhatIfThreshold(Number(e.target.value))}
              className="w-full sg-slider"
            />
            <div className="grid grid-cols-3 gap-2 pt-1 text-[11px] font-mono tabular-nums text-center">
              <div className="rounded-lg bg-[#141821] px-2 py-1.5">
                <div className="text-slate-400">Est. Lead</div>
                <div className="text-white font-semibold">{estLeadMin}m</div>
              </div>
              <div className="rounded-lg bg-[#141821] px-2 py-1.5">
                <div className="text-slate-400">Est. Recall</div>
                <div className="text-emerald-300 font-semibold">{estRecallPct}%</div>
              </div>
              <div className="rounded-lg bg-[#141821] px-2 py-1.5">
                <div className="text-slate-400">Est. False Alarm</div>
                <div className="text-amber-300 font-semibold">{estFalseAlarmPct}%</div>
              </div>
            </div>
          </div>
        </div>

        {/* SVG Lead-Time Distribution Chart across Worker-Days */}
        <div className={`lg:col-span-7 ${SG_SURFACES.panel} p-6 space-y-4`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                <Activity className="w-4 h-4 text-[#787aff]" />
                <span>Early-Warning Lead-Time Spectrum (Minutes Before Crossing)</span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Bars show minutes gained before simulated heat exhaustion (PSI &ge; 7.0) per trajectory.
              </p>
            </div>
            <span className="font-mono text-xs text-slate-400">
              {visibleTrajectories.length} / {report.trajectories.length} shown
            </span>
          </div>

          <div className="bg-[#0c111d] border border-white/10 rounded-xl p-4">
            <svg viewBox="0 0 640 200" className="w-full h-auto" aria-label="Lead-time distribution across cohort">
              <line x1="28" x2="624" y1="165" y2="165" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
              {visibleTrajectories.map((t, idx) => {
                const slotW = 596 / Math.max(1, visibleTrajectories.length);
                const barW = Math.max(8, Math.min(22, slotW - 5));
                const x = 28 + idx * slotW + (slotW - barW) / 2;
                const val = t.leadTimeMin ?? 0;
                const barH = Math.max(4, (val / maxLead) * 135);
                const y = 165 - barH;
                const fill =
                  t.outcome === 'True Positive'
                    ? '#10b981'
                    : t.outcome === 'False Positive'
                      ? '#f59e0b'
                      : t.outcome === 'False Negative'
                        ? '#fa114f'
                        : '#475569';
                return (
                  <g key={t.trajectoryId}>
                    <rect x={x} y={y} width={barW} height={barH} rx="3" fill={fill} opacity={0.9}>
                      <title>
                        {t.trajectoryId} ({t.outcome}): {t.leadTimeMin !== null ? `${t.leadTimeMin} min lead` : 'No crossing'}
                      </title>
                    </rect>
                    {t.leadTimeMin !== null && barW >= 12 && (
                      <text
                        x={x + barW / 2}
                        y={y - 4}
                        textAnchor="middle"
                        fontSize="9"
                        fontFamily="JetBrains Mono, monospace"
                        fill="#cbd5e1"
                      >
                        {t.leadTimeMin}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
            <div className="mt-2 flex flex-wrap gap-4 text-[11px] font-mono text-slate-400">
              <span className="text-emerald-300">■ True Positive ({tpCount})</span>
              <span className="text-amber-300">■ False Positive ({fpCount})</span>
              <span className="text-[#ff6b93]">■ False Negative ({fnCount})</span>
              <span className="text-slate-400">■ True Negative ({tnCount})</span>
            </div>
          </div>
        </div>
      </section>

      <VoiceCopilotBar
        currentRoute="/validation"
        summaryToRead={spokenSummary}
        quickPrompts={[
          'Read backtest summary',
          'Open Forecast',
          'Open Compliance',
          'Simulate Dubai Marina',
        ]}
      />

      {/* AI Backtest Diagnostic Analysis + Voice Readout */}
      <section
        data-testid="backtest-ai-insights"
        className={`${SG_SURFACES.panel} p-6 space-y-4`}
      >
        <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-white/10">
          <div>
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#787aff]" />
              <span>AI Backtest &amp; Clinical Threshold Interpretation</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Gemini 4 Hydrogen diagnoses sensitivity vs. false-alarm drivers while keeping all replay metrics strictly deterministic.
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
              onClick={() => void handleAnalyzeBacktest()}
              className={`${SG_SURFACES.buttonPrimary} px-4 py-2 text-xs disabled:opacity-60 flex items-center gap-1.5`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{analyzingAi ? 'Analyzing...' : 'Analyze Backtest with Gemini'}</span>
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
                <div className="text-xs font-semibold text-[#a5a7ff] mb-2">Key Replay Findings</div>
                <ul className="space-y-1.5 text-xs text-slate-200 list-disc pl-4">
                  {aiInsights.keyFindings.map((item, idx) => (
                    <li key={idx} className="leading-relaxed">{item}</li>
                  ))}
                </ul>
              </div>
              <div className="rounded-xl bg-[#0c111d] border border-white/10 p-4">
                <div className="text-xs font-semibold text-emerald-300 mb-2">Engineering Recommendations</div>
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
            Click &quot;Analyze Backtest with Gemini&quot; to synthesize cohort acclimatization risks, lead-time margins, and false-alarm drivers.
          </div>
        )}
      </section>

      {/* Methodology & Limitations */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className={`lg:col-span-6 ${SG_SURFACES.panel} p-6`}>
          <h2 className="text-base font-semibold text-white">Methodology &amp; Data Provenance</h2>
          <p className="text-sm text-slate-300 leading-relaxed mt-2">{report.methodologyNote}</p>
          <div className="mt-4 pt-4 border-t border-white/10 text-xs text-slate-300 space-y-1">
            <div>
              <strong className="text-white">Real Data:</strong> {report.weatherDataset}
            </div>
            <div>
              <strong className="text-white">Synthetic Data:</strong>{' '}
              <span className="font-mono text-[#a5a7ff]">{cohortMetadata.source}</span> ({cohortMetadata.count} worker-days, 08:00–12:00 GST)
            </div>
          </div>
        </div>

        <div className={`lg:col-span-6 ${SG_SURFACES.panel} p-6`}>
          <h2 className="text-base font-semibold text-white">Known Limitations</h2>
          <ul className="mt-3 space-y-2 text-sm text-slate-300 list-disc pl-5">
            {report.limitations.map((lim, idx) => (
              <li key={idx} className="leading-relaxed">
                {lim}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Trajectory-by-Trajectory Replay Table */}
      <section className={`${SG_SURFACES.panel} p-6`}>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="text-base font-semibold text-white">
            Worker-Day Replay Outcomes (<span className="font-mono tabular-nums text-[#a5a7ff]">{visibleTrajectories.length}</span> Trajectories)
          </h2>
          {outcomeFilter !== 'ALL' && (
            <button
              type="button"
              onClick={() => setOutcomeFilter('ALL')}
              className="text-xs font-mono text-[#a5a7ff] hover:text-white underline cursor-pointer"
            >
              Clear Filter ({outcomeFilter})
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-white/10 text-slate-400">
                <th className="py-2.5 pr-4 font-medium">Trajectory ID</th>
                <th className="py-2.5 pr-4 font-medium">Role &amp; PPE</th>
                <th className="py-2.5 pr-4 font-medium text-right">Acclim.</th>
                <th className="py-2.5 pr-4 font-medium text-right">First Alert</th>
                <th className="py-2.5 pr-4 font-medium text-right">True Crossing</th>
                <th className="py-2.5 pr-4 font-medium text-right">Lead Time</th>
                <th className="py-2.5 font-medium text-right">Outcome</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/8">
              {visibleTrajectories.map((t) => (
                <tr key={t.trajectoryId} className="hover:bg-white/[0.02]">
                  <td className="py-2.5 pr-4 font-mono font-semibold text-[#a5a7ff]">
                    {t.trajectoryId}
                  </td>
                  <td className="py-2.5 pr-4 text-slate-200">
                    {t.roleLabel} · {t.ppeLevel}
                  </td>
                  <td className="py-2.5 pr-4 font-mono tabular-nums text-right text-slate-300">
                    {t.acclimatizationDays}d
                  </td>
                  <td className="py-2.5 pr-4 font-mono tabular-nums text-right text-slate-300">
                    {t.firstAlertMin !== null ? `T+${t.firstAlertMin}m` : '—'}
                  </td>
                  <td className="py-2.5 pr-4 font-mono tabular-nums text-right text-slate-300">
                    {t.firstCrossingMin !== null ? `T+${t.firstCrossingMin}m` : 'None'}
                  </td>
                  <td className="py-2.5 pr-4 font-mono tabular-nums text-right font-semibold text-white">
                    {t.leadTimeMin !== null ? `${t.leadTimeMin} min` : '—'}
                  </td>
                  <td
                    className={`py-2.5 text-right font-mono font-semibold ${
                      t.outcome === 'True Positive' || t.outcome === 'True Negative'
                        ? 'text-[#10b981]'
                        : 'text-[#fa114f]'
                    }`}
                  >
                    {t.outcome}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
