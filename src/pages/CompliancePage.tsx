import { useCallback, useEffect, useState } from 'react';
import {
  Clock,
  Download,
  FileText,
  Printer,
  ShieldCheck,
  Sparkles,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { AnimatedMetric } from '../components/PageTransition';
import { UaeSiteHubSimulator } from '../components/UaeSiteHubSimulator';
import { VoiceCopilotBar, VoiceWaveform, useVoiceSpeechOutput } from '../components/VoiceCopilotBar';
import { useAbuDhabiClock } from '../hooks/useAbuDhabiClock';
import { SG_SURFACES } from '../shared/designTokens';
import type { TemperatureUnit } from '../shared/temperature';
import type {
  BreakRecord,
  ComplianceNarrativeRecord,
  EnvironmentalObservation,
  IncidentLogEntry,
} from '../shared/types';

interface ComplianceReport {
  siteName: string;
  emirate: string;
  regulationReference: string;
  env: EnvironmentalObservation;
  compliantPct: number;
  breaks: BreakRecord[];
  incidents: IncidentLogEntry[];
  cachedNarrative: ComplianceNarrativeRecord | null;
  generatedAt: string;
}

export function CompliancePage({
  onEnvUpdated,
  tempUnit = 'C',
}: {
  onEnvUpdated?: (nextEnv: EnvironmentalObservation) => void;
  tempUnit?: TemperatureUnit;
}) {
  const [report, setReport] = useState<ComplianceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [generatingNarrative, setGeneratingNarrative] = useState(false);
  const [narrativeLang, setNarrativeLang] = useState<'en' | 'ar'>('en');
  const [simBusy, setSimBusy] = useState(false);
  const { speaking, speak, stopSpeaking } = useVoiceSpeechOutput();
  const clock = useAbuDhabiClock();

  // Insurer / Regulator export metadata fields
  const [mohreId, setMohreId] = useState('EST-AUH-88412');
  const [recipient, setRecipient] = useState('UAE MOHRE Labor Inspection / Daman Occupational Insurer');
  const [permitRef, setPermitRef] = useState('AUH-SUMMER-2026-LOT07');

  const fetchReport = useCallback(async () => {
    try {
      const res = await fetch('/api/compliance/report');
      const json = (await res.json()) as ComplianceReport;
      setReport(json);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchReport();
  }, [fetchReport]);

  const handleGenerateNarrative = async (langOverride?: 'en' | 'ar') => {
    const lang = langOverride ?? narrativeLang;
    setGeneratingNarrative(true);
    try {
      const res = await fetch('/api/compliance/narrative', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          insurerRef: `${mohreId} / ${recipient}`,
          language: lang,
        }),
      });
      const saved = (await res.json()) as ComplianceNarrativeRecord;
      setReport((prev) => (prev ? { ...prev, cachedNarrative: saved } : prev));
    } finally {
      setGeneratingNarrative(false);
    }
  };

  const handleSimulateScenario = async (scenario: 'default' | 'zero_violations') => {
    setSimBusy(true);
    try {
      await fetch('/api/system/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario }),
      });
      await fetchReport();
    } finally {
      setSimBusy(false);
    }
  };

  const handleSimulateMiddayWindow = async (hourGst: number) => {
    setSimBusy(true);
    try {
      const res = await fetch('/api/environment/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'historical_heatwave', hourGst }),
      });
      const json = (await res.json()) as { current: EnvironmentalObservation };
      onEnvUpdated?.(json.current);
      await fetchReport();
    } finally {
      setSimBusy(false);
    }
  };

  const handleDownloadJson = () => {
    if (!report) return;
    const bundle = {
      exportedFor: recipient,
      mohreEstablishmentId: mohreId,
      sitePermitRef: permitRef,
      privacyGuarantee: 'Zero PII, zero raw physiological vitals included in compliance export.',
      ...report,
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `siteguard-uae-compliance-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading && !report) {
    return (
      <main className="max-w-[1280px] mx-auto px-6 py-8">
        <div className="h-96 bg-[#141821] border border-white/10 rounded-[24px] animate-pulse" />
      </main>
    );
  }

  if (!report) return null;

  const degradedCount = report.incidents.filter(
    (i) => i.eventType === 'sensor_degradation' || i.eventType === 'gps_loss'
  ).length;
  const redCount = report.incidents.filter((i) => i.severity === 'Red').length;

  // Circular SVG telemetry gauge math
  const ringRadius = 46;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringOffset = ringCircumference * (1 - Math.max(0, Math.min(100, report.compliantPct)) / 100);
  const complianceRingColor =
    report.compliantPct >= 95 ? '#10b981' : report.compliantPct >= 70 ? '#f59e0b' : '#fa114f';

  // GST Midday timeline indicator (06:00..19:00)
  const clampedHour = Math.max(6, Math.min(19, report.env.hourGst));
  const gstMarkerPct = ((clampedHour - 6) / 13) * 100;

  const spokenSummary = report.cachedNarrative
    ? report.cachedNarrative.narrative
    : `${report.siteName} break compliance is ${report.compliantPct} percent with ${redCount} Red stop-work alerts.`;

  return (
    <main className="max-w-[1280px] mx-auto px-6 py-8 space-y-6">
      {/* Futuristic Header + Export Controls */}
      <div className="no-print flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-mono text-[#a5a7ff] uppercase tracking-wider">
            UAE MOHRE &amp; Daman Digital Audit Deck · {report.emirate}
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white mt-0.5">
            UAE Midday Working Break Compliance Report
          </h1>
          <p className="text-sm text-slate-400 mt-1">{report.regulationReference}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleDownloadJson}
            className={`${SG_SURFACES.buttonSecondary} px-3.5 py-2 text-xs flex items-center gap-1.5`}
          >
            <Download className="w-3.5 h-3.5 text-[#787aff]" />
            <span>Export Regulator JSON</span>
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className={`${SG_SURFACES.buttonPrimary} px-4 py-2 text-xs flex items-center gap-1.5`}
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Export PDF</span>
          </button>
        </div>
      </div>

      {/* UAE Hub & Midday Window Interactive Simulation Controls */}
      <div className="no-print space-y-4">
        <UaeSiteHubSimulator
          env={report.env}
          tempUnit={tempUnit}
          onHubUpdated={(nextEnv) => {
            onEnvUpdated?.(nextEnv);
            void fetchReport();
          }}
        />
        <VoiceCopilotBar
          currentRoute="/compliance"
          language={narrativeLang}
          summaryToRead={spokenSummary}
          quickPrompts={[
            'Simulate Dubai Marina',
            'Simulate 13:00 Midday Ban',
            'Read compliance summary',
            'Open Forecast',
          ]}
          onAfterCommand={(payload) => {
            if (payload.env) onEnvUpdated?.(payload.env);
            void fetchReport();
          }}
        />
      </div>

      {/* Printable Command Compliance Sheet */}
      <div className="print-container bg-[#141821]/95 border border-white/10 rounded-[24px] p-6 sm:p-8 space-y-8 shadow-[0_12px_40px_rgba(0,0,0,0.38)]">
        {/* Top Compliance Telemetry Hero */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center pb-6 border-b border-white/10">
          <div className="lg:col-span-3 flex items-center gap-5">
            <div className="relative w-28 h-28 shrink-0 flex items-center justify-center">
              <svg viewBox="0 0 112 112" className="w-28 h-28 -rotate-90" aria-hidden="true">
                <circle
                  cx="56"
                  cy="56"
                  r={ringRadius}
                  fill="none"
                  stroke="rgba(255,255,255,0.08)"
                  strokeWidth="9"
                />
                <circle
                  cx="56"
                  cy="56"
                  r={ringRadius}
                  fill="none"
                  stroke={complianceRingColor}
                  strokeWidth="9"
                  strokeLinecap="round"
                  strokeDasharray={ringCircumference}
                  strokeDashoffset={ringOffset}
                  className="transition-all duration-500"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center font-mono tabular-nums">
                <span className="text-2xl font-bold text-white">
                  <AnimatedMetric value={`${report.compliantPct}%`} />
                </span>
                <span className="text-[10px] text-slate-400">COMPLIANT</span>
              </div>
            </div>

            <div className="space-y-1.5 font-mono tabular-nums text-xs">
              <div>
                <div className="text-slate-400 text-[11px]">Red Stop-Work</div>
                <div className="text-xl font-bold text-[#fa114f]">
                  <AnimatedMetric value={redCount} />
                </div>
              </div>
              <div>
                <div className="text-slate-400 text-[11px]">Sensor Fallbacks</div>
                <div className="text-xl font-bold text-[#f59e0b]">
                  <AnimatedMetric value={degradedCount} />
                </div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-9 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-xs font-mono text-[#787aff] font-semibold">
                  SITEGUARD COMPLIANCE RECORD · GENOS TEAM · LIVE AUH {clock.timeWithSeconds} GST
                </div>
                <h2 className="text-xl font-bold text-white mt-0.5">{report.siteName}</h2>
                <p className="text-xs text-slate-400 mt-1">
                  {report.emirate} · Mandatory Break Window: <span className="font-mono">12:30–15:00 GST</span> (June 15 – September 15) ·{' '}
                  <span className="font-mono text-emerald-300">{clock.middayWindowStatusLabel}</span>
                </p>
              </div>

              <div className="no-print flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  disabled={simBusy}
                  onClick={() => void handleSimulateMiddayWindow(13)}
                  className={`${SG_SURFACES.buttonSecondary} px-2.5 py-1.5 text-[11px] flex items-center gap-1`}
                >
                  <Clock className="w-3 h-3 text-[#f59e0b]" />
                  <span>Test 13:00 Halt Window</span>
                </button>
                <button
                  type="button"
                  disabled={simBusy}
                  onClick={() => void handleSimulateScenario('zero_violations')}
                  className={`${SG_SURFACES.buttonSecondary} px-2.5 py-1.5 text-[11px] flex items-center gap-1`}
                >
                  <ShieldCheck className="w-3 h-3 text-[#10b981]" />
                  <span>Simulate 100% Shift</span>
                </button>
                <button
                  type="button"
                  disabled={simBusy}
                  onClick={() => void handleSimulateScenario('default')}
                  className={`${SG_SURFACES.buttonSecondary} px-2.5 py-1.5 text-[11px]`}
                >
                  Reset Shift
                </button>
              </div>
            </div>

            {/* UAE Ministerial Resolution No. 44 Solar Ban Timeline */}
            <div className="bg-[#0c111d] border border-white/10 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between text-[11px] font-mono">
                <span className="text-slate-400">UAE Solar Ban Schedule (06:00 – 19:00 GST)</span>
                <span
                  className={
                    report.env.inUaeMiddayBreakWindow
                      ? 'text-[#f59e0b] font-semibold'
                      : 'text-emerald-300 font-semibold'
                  }
                >
                  {String(report.env.hourGst).padStart(2, '0')}:00 GST ·{' '}
                  {report.env.inUaeMiddayBreakWindow ? 'ACTIVE MIDDAY HALT WINDOW' : 'PRE/POST WINDOW'}
                </span>
              </div>
              <div className="relative h-2.5 w-full rounded-full bg-[#1a2234] overflow-hidden">
                {/* Mandatory Halt Band: 12.5..15 out of 6..19 => left 50%, width 19.2% */}
                <div
                  className="absolute top-0 bottom-0 bg-[#fa114f]/45 border-x border-[#fa114f]"
                  style={{ left: '50%', width: '19.2%' }}
                  title="Mandatory UAE Midday Working Break (12:30–15:00 GST)"
                />
                <div
                  className="absolute top-0 bottom-0 w-1.5 rounded-full bg-white shadow-[0_0_8px_#fff]"
                  style={{ left: `calc(${gstMarkerPct.toFixed(1)}% - 3px)` }}
                />
              </div>
              <div className="flex justify-between text-[10px] font-mono text-slate-500">
                <span>06:00 GST</span>
                <span className="text-[#ff6b93]">12:30–15:00 Mandatory Halt</span>
                <span>19:00 GST</span>
              </div>
            </div>
          </div>
        </div>

        {/* Full Compliance vs Active Escalations Summary Strip (SINGLE role="status" maintained for audit spec) */}
        <div
          role="status"
          className={`rounded-xl border px-4 py-3 text-xs font-medium ${
            report.compliantPct === 100 && redCount === 0
              ? 'bg-[#10b981]/15 border-[#10b981]/45 text-emerald-200'
              : 'bg-[#f59e0b]/15 border-[#f59e0b]/45 text-amber-200'
          }`}
        >
          {report.compliantPct === 100 && redCount === 0
            ? `Full Compliance Achieved: 100% of ${report.breaks.length} monitored crew members met the UAE Midday Working Break requirement with 0 heat-safety violations.`
            : `${report.breaks.filter((b) => !b.compliant).length} crew member(s) pending required break completion · ${redCount} Red escalation(s) logged.`}
        </div>

        {/* Insurer / Regulator Export Metadata Fields */}
        <section>
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <FileText className="w-4 h-4 text-[#787aff]" />
            <span>Insurer &amp; Regulator Export Metadata</span>
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label htmlFor="mohre-id" className="block text-xs font-medium text-slate-400 mb-1">
                Employer / MOHRE Establishment ID
              </label>
              <input
                id="mohre-id"
                type="text"
                value={mohreId}
                onChange={(e) => setMohreId(e.target.value)}
                className={`w-full px-3 py-2 text-sm font-mono ${SG_SURFACES.input}`}
              />
            </div>
            <div>
              <label htmlFor="recipient" className="block text-xs font-medium text-slate-400 mb-1">
                Insurer / Regulator Export Recipient
              </label>
              <input
                id="recipient"
                type="text"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                className={`w-full px-3 py-2 text-sm ${SG_SURFACES.input}`}
              />
            </div>
            <div>
              <label htmlFor="permit-ref" className="block text-xs font-medium text-slate-400 mb-1">
                Site Permit &amp; Policy Reference
              </label>
              <input
                id="permit-ref"
                type="text"
                value={permitRef}
                onChange={(e) => setPermitRef(e.target.value)}
                className={`w-full px-3 py-2 text-sm font-mono ${SG_SURFACES.input}`}
              />
            </div>
          </div>
        </section>

        {/* Gemini Plain-Language Executive Narrative (Bilingual EN / Arabic MOHRE + Voice Readout) */}
        <section className="pt-6 border-t border-white/10">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div>
              <h3 className="text-sm font-semibold text-white">
                Site Manager Executive Narrative &amp; AI Remediation Audit
              </h3>
              <p className="text-xs text-slate-400">
                Bilingual (English / Arabic MOHRE) compliance briefing generated by Gemini without personal worker vitals.
              </p>
            </div>
            <div className="no-print flex flex-wrap items-center gap-2">
              <div className="inline-flex p-1 rounded-xl bg-[#0c111d] border border-white/10 text-xs">
                <button
                  type="button"
                  onClick={() => setNarrativeLang('en')}
                  className={`px-2.5 py-1 rounded-lg font-medium cursor-pointer transition-all ${
                    narrativeLang === 'en' ? 'bg-[#787aff] text-white' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  English
                </button>
                <button
                  type="button"
                  onClick={() => setNarrativeLang('ar')}
                  className={`px-2.5 py-1 rounded-lg font-medium cursor-pointer transition-all ${
                    narrativeLang === 'ar' ? 'bg-[#787aff] text-white' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  العربية (MOHRE)
                </button>
              </div>
              {report.cachedNarrative && (
                <button
                  type="button"
                  onClick={() =>
                    speaking
                      ? stopSpeaking()
                      : speak(
                          report.cachedNarrative?.narrative ?? '',
                          report.cachedNarrative?.language ?? 'en'
                        )
                  }
                  className={`${SG_SURFACES.buttonSecondary} px-3 py-2 text-xs flex items-center gap-1.5`}
                >
                  {speaking ? (
                    <VolumeX className="w-3.5 h-3.5 text-[#fa114f]" />
                  ) : (
                    <Volume2 className="w-3.5 h-3.5 text-[#10b981]" />
                  )}
                  <span>{speaking ? 'Stop' : 'Listen'}</span>
                  <VoiceWaveform active={speaking} />
                </button>
              )}
              <button
                type="button"
                disabled={generatingNarrative}
                onClick={() => void handleGenerateNarrative()}
                className={`${SG_SURFACES.buttonPrimary} px-3.5 py-2 text-xs disabled:opacity-60 flex items-center gap-1.5`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{generatingNarrative ? 'Generating...' : 'Generate Summary with Gemini'}</span>
              </button>
            </div>
          </div>

          {report.cachedNarrative ? (
            <div
              data-testid="compliance-ai-narrative"
              dir={report.cachedNarrative.language === 'ar' ? 'rtl' : 'ltr'}
              className="bg-[#0c111d] border border-white/10 rounded-xl p-4 text-sm text-slate-200 leading-relaxed space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] font-mono text-[#a5a7ff]">
                  {report.cachedNarrative.language === 'ar'
                    ? 'تقرير وزارة الموارد البشرية (MOHRE Arabic)'
                    : 'MOHRE Executive Briefing (English)'}
                </span>
                {report.cachedNarrative.auditReadinessStatus && (
                  <span
                    className={`px-2 py-0.5 rounded-md border text-[11px] font-mono font-semibold ${
                      report.cachedNarrative.auditReadinessStatus === 'Audit Ready'
                        ? 'bg-[#10b981]/15 border-[#10b981]/40 text-emerald-300'
                        : 'bg-[#f59e0b]/15 border-[#f59e0b]/40 text-amber-200'
                    }`}
                  >
                    {report.cachedNarrative.auditReadinessStatus}
                  </span>
                )}
              </div>
              <p>{report.cachedNarrative.narrative}</p>
              {report.cachedNarrative.remediationActions &&
                report.cachedNarrative.remediationActions.length > 0 && (
                  <div className="pt-2.5 border-t border-white/10">
                    <div className="text-xs font-semibold text-white mb-1.5">
                      {report.cachedNarrative.language === 'ar'
                        ? 'إجراءات التصحيح الموصى بها:'
                        : 'AI Corrective Remediation Checklist:'}
                    </div>
                    <ul className="space-y-1 text-xs text-slate-300 list-disc ps-4">
                      {report.cachedNarrative.remediationActions.map((act, idx) => (
                        <li key={idx}>{act}</li>
                      ))}
                    </ul>
                  </div>
                )}
              <div className="pt-1 text-[11px] font-mono text-slate-400">
                Source: {report.cachedNarrative.source === 'gemini' ? 'Gemini 4 Hydrogen' : 'Compliance Template'} ·{' '}
                Generated {new Date(report.cachedNarrative.updatedAt).toLocaleTimeString()}
              </div>
            </div>
          ) : (
            <div className="bg-[#0c111d] border border-white/10 rounded-xl p-4 text-xs text-slate-400">
              Click &quot;Generate Summary with Gemini&quot; to produce an auditor-ready plain-language compliance narrative and remediation checklist for {recipient}.
            </div>
          )}
        </section>

        {/* Breaks Taken vs UAE Midday Break Window */}
        <section className="pt-6 border-t border-white/10">
          <h3 className="text-sm font-semibold text-white mb-3">
            Today&apos;s Rest Breaks vs. UAE Midday Working Break Requirement
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-white/10 text-xs text-slate-400">
                  <th className="py-2.5 pr-4 font-medium">Anonymized Unit</th>
                  <th className="py-2.5 pr-4 font-medium">Zone</th>
                  <th className="py-2.5 pr-4 font-medium">Required Midday Window</th>
                  <th className="py-2.5 pr-4 font-medium text-right">Breaks Taken</th>
                  <th className="py-2.5 pr-4 font-medium text-right">Target Min</th>
                  <th className="py-2.5 font-medium text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/8">
                {report.breaks.map((b) => (
                  <tr key={b.workerId} className="hover:bg-white/[0.02]">
                    <td className="py-2.5 pr-4 font-medium text-white">
                      <span className="font-mono text-[#a5a7ff]">{b.workerId}</span> · {b.roleLabel}
                    </td>
                    <td className="py-2.5 pr-4 text-xs text-slate-300">{b.zone}</td>
                    <td className="py-2.5 pr-4 font-mono text-xs text-slate-300">
                      {b.requiredMiddayWindow}
                    </td>
                    <td className="py-2.5 pr-4 font-mono tabular-nums text-right text-white">
                      {b.breaksTakenMin} min
                    </td>
                    <td className="py-2.5 pr-4 font-mono tabular-nums text-right text-slate-400">
                      {b.requiredMin} min
                    </td>
                    <td
                      className={`py-2.5 text-right text-xs font-mono font-semibold ${
                        b.compliant
                          ? 'text-[#10b981]'
                          : b.status === 'Action Required'
                            ? 'text-[#fa114f]'
                            : 'text-[#f59e0b]'
                      }`}
                    >
                      {b.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Incident, Near-Miss & Sensor Degradation Log */}
        <section className="pt-6 border-t border-white/10">
          <h3 className="text-sm font-semibold text-white mb-3">
            Incident, Near-Miss &amp; Sensor Degradation Audit Log (
            <span className="font-mono tabular-nums text-[#a5a7ff]">{report.incidents.length}</span> Entries)
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-white/10 text-slate-400">
                  <th className="py-2 pr-3 font-medium">Timestamp</th>
                  <th className="py-2 pr-3 font-medium">Unit</th>
                  <th className="py-2 pr-3 font-medium">Severity</th>
                  <th className="py-2 pr-3 font-medium">Event Summary</th>
                  <th className="py-2 font-medium">Action Taken</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/8">
                {report.incidents.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-4 text-center text-[#10b981] font-medium">
                      Zero heat-stress escalations or sensor violations logged for this shift — full compliance recorded.
                    </td>
                  </tr>
                ) : (
                  report.incidents.map((inc) => (
                    <tr key={inc.id} className="hover:bg-white/[0.02]">
                      <td className="py-2.5 pr-3 font-mono tabular-nums text-slate-400 whitespace-nowrap">
                        {new Date(inc.timestamp).toLocaleTimeString()}
                      </td>
                      <td className="py-2.5 pr-3 font-mono font-semibold text-[#a5a7ff] whitespace-nowrap">
                        {inc.workerId}
                      </td>
                      <td
                        className={`py-2.5 pr-3 font-mono font-semibold whitespace-nowrap ${
                          inc.severity === 'Red'
                            ? 'text-[#fa114f]'
                            : inc.severity === 'Amber'
                              ? 'text-[#f59e0b]'
                              : 'text-slate-300'
                        }`}
                      >
                        {inc.severity}
                      </td>
                      <td className="py-2.5 pr-3 text-slate-200">{inc.summary}</td>
                      <td className="py-2.5 text-slate-400">{inc.actionTaken}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
