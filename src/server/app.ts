import 'dotenv/config';
import express from 'express';
import {
  generateDeterministicSyntheticCohort,
  runBacktest,
  runProspectiveForecastValidation,
} from '../shared/cohortAndValidation.ts';
import { getGlobalLanguageByCode } from '../shared/globalLanguages.ts';
import {
  LANGUAGE_LABELS,
  TTS_LOCALE_BY_LANGUAGE,
  type BLETelemetryFrame,
  type FaultFlags,
  type SupportedLanguage,
  type SyntheticWorkerDay,
  type UaeSiteHubId,
  type VoiceIncidentSeverity,
} from '../shared/types.ts';
import { HISTORICAL_UAE_HEATWAVE_CURVE } from '../shared/uaeWeatherData.ts';
import {
  generateComplianceNarrative,
  generateSupervisorShiftBriefing,
  generateSyntheticCohortViaGemini,
  generateValidationAiInsights,
  getLastGeminiDiagnostic,
  parseVoiceCopilotCommand,
  synthesizeWorkerSpeech,
  transcribeWorkerVoiceIncident,
  translateWorkerAlertGlobal,
} from './geminiService.ts';
import { siteGuardStore } from './store.ts';

// Cached validation cohort (defaults to deterministic calibrated cohort; can be regenerated via Gemini)
let activeValidationCohort: SyntheticWorkerDay[] = generateDeterministicSyntheticCohort(24, 202608);

export function createApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: '6mb' }));

  // ── Environmental Feed Endpoints ─────────────────────────────────────────────
  app.get('/api/environment', (_req, res) => {
    res.json({
      current: siteGuardStore.getEnvironment(),
      heatwaveCurve: HISTORICAL_UAE_HEATWAVE_CURVE,
    });
  });

  app.get('/api/environment/live', async (req, res) => {
    const simParam = req.query.simulateOffline;
    const simulateOffline =
      simParam === 'true' ? true : simParam === 'false' ? false : undefined;
    const env = await siteGuardStore.fetchLiveAbuDhabiWeather({ simulateOffline });
    res.json({
      current: env,
      heatwaveCurve: HISTORICAL_UAE_HEATWAVE_CURVE,
    });
  });

  app.post('/api/environment/mode', async (req, res) => {
    try {
      const { mode, hourGst, simulateOffline } = (req.body ?? {}) as {
        mode?: 'historical_heatwave' | 'live_abu_dhabi';
        hourGst?: number;
        simulateOffline?: boolean;
      };
      const env =
        mode === 'live_abu_dhabi'
          ? await siteGuardStore.fetchLiveAbuDhabiWeather({ simulateOffline })
          : siteGuardStore.setHistoricalHour(typeof hourGst === 'number' ? hourGst : 11);
      res.json({ current: env, heatwaveCurve: HISTORICAL_UAE_HEATWAVE_CURVE });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/environment/hub', async (req, res) => {
    try {
      const { hubId, hourGst, mode } = (req.body ?? {}) as {
        hubId?: UaeSiteHubId;
        hourGst?: number;
        mode?: 'historical_heatwave' | 'live_abu_dhabi';
      };
      const env = await siteGuardStore.setActiveHub(hubId ?? 'abu_dhabi_mussafah', {
        hourGst,
        mode,
      });
      res.json({
        current: env,
        hubId: siteGuardStore.getSelectedHubId(),
        heatwaveCurve: HISTORICAL_UAE_HEATWAVE_CURVE,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── Worker & Hardware-Agnostic BLE Wearable API ──────────────────────────────
  app.get('/api/workers', (_req, res) => {
    res.json({ workers: siteGuardStore.listWorkerIds() });
  });

  const isSupervisorToken = (req: express.Request): boolean => {
    const roleHeader = String(req.headers['x-siteguard-role'] ?? '').toLowerCase();
    const authHeader = String(req.headers.authorization ?? '').toLowerCase();
    const roleQuery = String(req.query.role ?? '').toLowerCase();
    return roleHeader === 'supervisor' || authHeader.includes('supervisor') || roleQuery === 'supervisor';
  };

  app.get('/api/worker/:id/state', async (req, res) => {
    if (isSupervisorToken(req)) {
      res.status(403).json({
        error: 'Forbidden: supervisor-role sessions cannot access raw worker physiological vitals.',
        redacted: true,
        allowedEndpoint: '/api/supervisor/crew',
      });
      return;
    }
    try {
      const state = await siteGuardStore.getWorkerState(req.params.id);
      res.setHeader('X-SiteGuard-Gemini-Status', getLastGeminiDiagnostic());
      res.json({ state, env: siteGuardStore.getEnvironment() });
    } catch (err) {
      res.status(404).json({ error: (err as Error).message });
    }
  });

  /**
   * Hardware-Agnostic BLE Wearable Telemetry Endpoint.
   * Identical contract for the UI simulator slider panel and physical BLE gateways.
   */
  app.post('/api/ble/telemetry', async (req, res) => {
    try {
      const frame = req.body as BLETelemetryFrame;
      if (!frame || !frame.workerId || typeof frame.hrBpm !== 'number') {
        res.status(400).json({ error: 'Invalid BLETelemetryFrame payload' });
        return;
      }
      const state = await siteGuardStore.ingestBleTelemetry(frame);
      res.json({ state, env: siteGuardStore.getEnvironment() });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/worker/:id/fault', async (req, res) => {
    try {
      const { faultKey, active } = req.body as {
        faultKey: keyof FaultFlags | 'clear_all';
        active: boolean;
      };
      const state = await siteGuardStore.setWorkerFault(req.params.id, faultKey, Boolean(active));
      res.json({ state, env: siteGuardStore.getEnvironment() });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/worker/:id/language', async (req, res) => {
    try {
      const { language } = req.body as { language: SupportedLanguage };
      const state = await siteGuardStore.setWorkerLanguage(req.params.id, language);
      res.json({ state });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/worker/:id/translate-global', async (req, res) => {
    try {
      const { code, name, nativeName, baseCopyOverride } = (req.body ?? {}) as {
        code?: string;
        name?: string;
        nativeName?: string;
        baseCopyOverride?: {
          headline: string;
          explanation: string;
          action: string;
          proactiveForecastNote?: string | null;
        };
      };
      if (!code || !code.trim()) {
        res.status(400).json({ error: 'Target language code is required' });
        return;
      }

      const catalogMeta = getGlobalLanguageByCode(code.trim());
      const target = {
        code: catalogMeta?.code ?? code.trim(),
        name: catalogMeta?.name ?? name?.trim() ?? code.trim(),
        nativeName: catalogMeta?.nativeName ?? nativeName?.trim() ?? name?.trim() ?? code.trim(),
      };

      const state = await siteGuardStore.getWorkerState(req.params.id);
      const env = siteGuardStore.getEnvironment();

      // If target is one of the 10 core languages and no custom preview override is given, update worker preferredLanguage cleanly
      const coreMatch = state.alertTranslations[target.code as SupportedLanguage];
      if (coreMatch && !baseCopyOverride) {
        const updated = await siteGuardStore.setWorkerLanguage(
          req.params.id,
          target.code as SupportedLanguage
        );
        res.setHeader('X-SiteGuard-Gemini-Status', getLastGeminiDiagnostic());
        res.json({
          translation: updated.alertTranslations[target.code as SupportedLanguage],
          languageMeta: catalogMeta ?? { ...target, bcp47: 'en-US', region: 'Core UAE' },
          state: updated,
        });
        return;
      }

      const translation = await translateWorkerAlertGlobal({
        context: state.context,
        assessment: state.assessment,
        forecast: state.forecast,
        env,
        target,
        baseCopyOverride,
      });

      res.setHeader('X-SiteGuard-Gemini-Status', getLastGeminiDiagnostic());
      res.json({
        translation,
        languageMeta: catalogMeta ?? { ...target, bcp47: target.code, region: 'Core UAE' },
      });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  /**
   * Server-Side Multilingual Cloud TTS Endpoint (`gemini-3.8-flash-lite-tts`).
   * Produces authentic pronunciation across all 10 UAE crew languages & 114+ global languages
   * independently of OS-installed Web Speech SAPI voices.
   */
  app.post('/api/worker/:id/speak', async (req, res) => {
    try {
      const workerExists = siteGuardStore
        .listWorkerIds()
        .some((w) => w.workerId === req.params.id);
      if (!workerExists) {
        res.status(404).json({ error: `Unknown workerId: ${req.params.id}` });
        return;
      }

      const { text, language, localeTag, languageName, severity } = (req.body ?? {}) as {
        text?: string;
        language?: string;
        localeTag?: string;
        languageName?: string;
        severity?: 'nominal' | 'amber' | 'red';
      };

      if (typeof text !== 'string' || !text.trim()) {
        res.status(400).json({ error: 'Non-empty text is required for speech synthesis.' });
        return;
      }

      const langCode = (language?.trim() || 'en') as string;
      const globalMeta = getGlobalLanguageByCode(langCode);
      const coreLabel = LANGUAGE_LABELS[langCode as SupportedLanguage];
      const coreLocale = TTS_LOCALE_BY_LANGUAGE[langCode as SupportedLanguage];

      const resolvedLocale = localeTag?.trim() || globalMeta?.bcp47 || coreLocale || 'en-US';
      const resolvedLanguageName =
        languageName?.trim() || globalMeta?.name || coreLabel?.name || langCode;

      const ttsResult = await synthesizeWorkerSpeech({
        text: text.trim(),
        language: langCode,
        localeTag: resolvedLocale,
        languageName: resolvedLanguageName,
        severity: severity === 'red' || severity === 'nominal' ? severity : 'amber',
      });

      res.setHeader('X-SiteGuard-Gemini-Status', getLastGeminiDiagnostic());

      if (!ttsResult.ok) {
        res.status(503).json({
          error: ttsResult.error,
          fallback: ttsResult.fallback,
          reason: ttsResult.reason,
        });
        return;
      }

      res.json({
        audioBase64: ttsResult.audioBase64,
        mimeType: ttsResult.mimeType,
        language: ttsResult.language,
        localeTag: ttsResult.localeTag,
        voiceName: ttsResult.voiceName,
        model: ttsResult.model,
        cached: ttsResult.cached,
        source: ttsResult.source,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/worker/:id/checkin', (req, res) => {
    try {
      const { status } = req.body as { status: 'okay' | 'help' };
      const state = siteGuardStore.recordWorkerCheckIn(req.params.id, status);
      res.json({ state });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/worker/:id/voice-report', async (req, res) => {
    try {
      const { audioBase64, mimeType, transcript, language, severity } = (req.body ?? {}) as {
        audioBase64?: string;
        mimeType?: string;
        transcript?: string;
        language?: SupportedLanguage;
        severity?: VoiceIncidentSeverity;
      };
      if (!audioBase64 && (!transcript || !transcript.trim())) {
        res.status(400).json({ error: 'Provide either recorded audio or a spoken/typed incident note.' });
        return;
      }
      const transcribed = await transcribeWorkerVoiceIncident({
        audioBase64,
        mimeType,
        language,
        fallbackTranscript: transcript,
      });
      const recorded = siteGuardStore.recordVoiceIncident(req.params.id, {
        transcript: transcribed.transcript,
        language: language ?? 'en',
        source: transcribed.source,
        severity,
      });
      res.setHeader('X-SiteGuard-Gemini-Status', getLastGeminiDiagnostic());
      res.json({
        state: recorded.state,
        incident: recorded.incident,
        transcript: transcribed.transcript,
        source: transcribed.source,
        severity: recorded.selectedSeverity,
      });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/worker/:id/sim-step', async (req, res) => {
    try {
      const { action } = req.body as { action: 'step_3m' | 'step_6m' | 'reset_cool' };
      const state = await siteGuardStore.stepSimulatedClock(req.params.id, action);
      res.json({ state, env: siteGuardStore.getEnvironment() });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // ── Privacy-Enforced Supervisor Endpoints ────────────────────────────────────
  // Architecturally strips raw physiological vitals (hrBpm, skinTempC, exertionIndex, hr0, tc0)
  app.get('/api/supervisor/crew', (_req, res) => {
    res.json(siteGuardStore.getSupervisorSnapshot());
  });

  app.post('/api/supervisor/action', (req, res) => {
    try {
      const { workerId, action } = req.body as {
        workerId: string;
        action: 'acknowledge' | 'order_break' | 'escalate' | 'apply_rotation';
      };
      const snapshot = siteGuardStore.performSupervisorAction(workerId, action);
      res.json(snapshot);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.get('/api/supervisor/alert-policy', (_req, res) => {
    res.json({ policy: siteGuardStore.getAlertPolicy() });
  });

  app.put('/api/supervisor/alert-policy', (req, res) => {
    try {
      const policy = siteGuardStore.updateAlertPolicy(req.body ?? {});
      const snapshot = siteGuardStore.getSupervisorSnapshot();
      res.json({ policy, snapshot });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/supervisor/ai-briefing', async (req, res) => {
    try {
      const { language } = (req.body ?? {}) as { language?: SupportedLanguage };
      const snapshot = siteGuardStore.getSupervisorSnapshot();
      const briefing = await generateSupervisorShiftBriefing({
        crew: snapshot.crew,
        alerts: snapshot.alerts,
        env: snapshot.env,
        language: language ?? 'en',
      });
      res.setHeader('X-SiteGuard-Gemini-Status', getLastGeminiDiagnostic());
      res.json(briefing);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/voice/command', async (req, res) => {
    try {
      const { commandText, language, currentRoute } = (req.body ?? {}) as {
        commandText?: string;
        language?: SupportedLanguage;
        currentRoute?: string;
      };
      if (!commandText || !commandText.trim()) {
        res.status(400).json({ error: 'commandText is required' });
        return;
      }

      const initialSnapshot = siteGuardStore.getSupervisorSnapshot();
      const plan = await parseVoiceCopilotCommand({
        commandText: commandText.trim(),
        crew: initialSnapshot.crew,
        env: initialSnapshot.env,
        language: language ?? 'en',
        currentRoute,
      });

      let executed = false;
      if (
        (plan.intent === 'order_break' || plan.intent === 'escalate' || plan.intent === 'apply_rotation') &&
        plan.workerId
      ) {
        siteGuardStore.performSupervisorAction(plan.workerId, plan.intent);
        executed = true;
      } else if (plan.intent === 'switch_hub' && plan.hubId) {
        await siteGuardStore.setActiveHub(plan.hubId, { hourGst: 13, mode: 'historical_heatwave' });
        executed = true;
      } else if (plan.intent === 'simulate_midday') {
        siteGuardStore.setHistoricalHour(13);
        executed = true;
      } else if (plan.intent === 'navigate' || plan.intent === 'read_summary' || plan.intent === 'status_query') {
        executed = true;
      }

      res.setHeader('X-SiteGuard-Gemini-Status', getLastGeminiDiagnostic());
      res.json({
        result: {
          ...plan,
          executed,
        },
        snapshot: siteGuardStore.getSupervisorSnapshot(),
        env: siteGuardStore.getEnvironment(),
        compliance: siteGuardStore.getComplianceReport(),
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── UAE Midday Break Compliance Endpoints ────────────────────────────────────
  app.get('/api/compliance/report', (_req, res) => {
    res.json(siteGuardStore.getComplianceReport());
  });

  app.post('/api/compliance/narrative', async (req, res) => {
    try {
      const { insurerRef, language } = (req.body ?? {}) as {
        insurerRef?: string;
        language?: 'en' | 'ar';
      };
      const report = siteGuardStore.getComplianceReport();
      const result = await generateComplianceNarrative({
        siteName: report.siteName,
        env: report.env,
        breaks: report.breaks,
        incidents: report.incidents,
        insurerRef: insurerRef ?? 'MOHRE-AUH-2026-07',
        language: language === 'ar' ? 'ar' : 'en',
      });
      const saved = siteGuardStore.setComplianceNarrative(result.narrative, result.source, {
        language: result.language,
        remediationActions: result.remediationActions,
        auditReadinessStatus: result.auditReadinessStatus,
      });
      res.setHeader('X-SiteGuard-Gemini-Status', getLastGeminiDiagnostic());
      res.json(saved);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/system/reset', (req, res) => {
    const { scenario } = (req.body ?? {}) as { scenario?: 'default' | 'zero_violations' };
    siteGuardStore.resetScenario(scenario === 'zero_violations' ? 'zero_violations' : 'default');
    res.json({ ok: true, scenario: scenario ?? 'default' });
  });

  // ── Backtest & Prospective Forecast Validation Endpoints ─────────────────────
  app.get('/api/validation/backtest', (_req, res) => {
    const report = runBacktest(activeValidationCohort);
    res.json({
      report,
      cohortMetadata: {
        source: 'SYNTHETIC_PHYSIOLOGICAL_COHORT',
        generator: activeValidationCohort[0]?.generator ?? 'deterministic_calibrated',
        count: activeValidationCohort.length,
      },
    });
  });

  app.post('/api/validation/generate-cohort', async (req, res) => {
    try {
      const { mode, count } = (req.body ?? {}) as {
        mode?: 'gemini' | 'deterministic';
        count?: number;
      };
      const n = Math.max(8, Math.min(36, count ?? 16));
      if (mode === 'gemini') {
        const gem = await generateSyntheticCohortViaGemini(n);
        if (gem.cohort.length >= 6) {
          activeValidationCohort = gem.cohort;
        } else {
          activeValidationCohort = generateDeterministicSyntheticCohort(n, Date.now() % 100000);
        }
      } else {
        activeValidationCohort = generateDeterministicSyntheticCohort(n, 202608);
      }

      const backtest = runBacktest(activeValidationCohort);
      const forecastValidation = runProspectiveForecastValidation(activeValidationCohort);
      res.json({
        backtest,
        forecastValidation,
        cohortMetadata: {
          source: 'SYNTHETIC_PHYSIOLOGICAL_COHORT',
          generator: activeValidationCohort[0]?.generator ?? 'deterministic_calibrated',
          count: activeValidationCohort.length,
        },
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/validation/forecast', (_req, res) => {
    const report = runProspectiveForecastValidation(activeValidationCohort);
    res.json({
      report,
      cohortMetadata: {
        source: 'SYNTHETIC_PHYSIOLOGICAL_COHORT',
        generator: activeValidationCohort[0]?.generator ?? 'deterministic_calibrated',
        count: activeValidationCohort.length,
      },
    });
  });

  app.post('/api/validation/ai-insights', async (req, res) => {
    try {
      const { kind } = (req.body ?? {}) as { kind?: 'backtest' | 'forecast' };
      const analysis =
        kind === 'forecast'
          ? await generateValidationAiInsights({
              kind: 'forecast',
              report: runProspectiveForecastValidation(activeValidationCohort),
            })
          : await generateValidationAiInsights({
              kind: 'backtest',
              report: runBacktest(activeValidationCohort),
            });
      res.setHeader('X-SiteGuard-Gemini-Status', getLastGeminiDiagnostic());
      res.json(analysis);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return app;
}
