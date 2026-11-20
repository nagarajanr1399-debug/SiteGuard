import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MIN_CLEAN_FORECAST_SAMPLES,
  predictCompositeTrajectory,
} from '../../src/shared/forecastEngine.ts';
import type {
  EnvironmentalObservation,
  ForecastOutput,
  RiskAssessment,
  TelemetryHistoryPoint,
  WorkerContext,
} from '../../src/shared/types.ts';

// Capture calls made to @google/genai without hitting live network in unit tests
const generateContentMock = vi.fn();
vi.mock('@google/genai', async () => {
  const actual = await vi.importActual<typeof import('@google/genai')>('@google/genai');
  class MockGoogleGenAI {
    models = {
      generateContent: generateContentMock,
    };
  }
  return {
    ...actual,
    GoogleGenAI: MockGoogleGenAI,
  };
});

const trendFixtureFile = JSON.parse(
  fs.readFileSync(path.resolve('fixtures/forecast_trend_fixtures.json'), 'utf-8')
);

const ENV_SAMPLE: EnvironmentalObservation = {
  timestampIso: '2025-08-14T11:00:00+04:00',
  hourGst: 11,
  station: 'Abu Dhabi Mussafah Industrial (Historical Record)',
  lat: 24.3712,
  lon: 54.5097,
  airTempC: 44.4,
  relHumidityPct: 34,
  windSpeedMs: 3.4,
  solarWm2: 930,
  wetBulbC: 29.4,
  globeTempC: 56.1,
  wbgtC: 35.0,
  heatIndexC: 52.9,
  mode: 'historical_heatwave',
  sourceLabel: 'Historical UAE Heatwave',
  inUaeMiddayBreakWindow: false,
};

describe('Predictive Forecast Engine & LLM Safety Boundary', () => {
  beforeEach(async () => {
    generateContentMock.mockReset();
    process.env.GEMINI_API_KEY = 'unit-test-deterministic-mock-key';
    const { clearAlertTranslationCache, resetGeminiCircuitBreaker } = await import(
      '../../src/server/geminiService.ts'
    );
    clearAlertTranslationCache();
    resetGeminiCircuitBreaker();
  });

  it('matches hand-computed weighted-damped extrapolation across 5 trajectory fixtures', () => {
    for (const fx of trendFixtureFile.fixtures) {
      const out = predictCompositeTrajectory(
        fx.history as TelemetryHistoryPoint[],
        fx.wbgtSlopePerHour
      );
      expect(out.status, fx.name).toBe(fx.expected.status);
      if (fx.expected.slopePerMin !== undefined) {
        expect(out.slopePerMin, `${fx.name} slope`).toBeCloseTo(fx.expected.slopePerMin, 3);
      }
      if (fx.expected.psi15Point !== undefined) {
        expect(out.psi15?.point, `${fx.name} psi15`).toBeCloseTo(fx.expected.psi15Point, 2);
        expect(out.psi15!.low).toBeLessThanOrEqual(out.psi15!.point);
        expect(out.psi15!.high).toBeGreaterThanOrEqual(out.psi15!.point);
      }
      if (fx.expected.psi30Point !== undefined) {
        expect(out.psi30?.point, `${fx.name} psi30`).toBeCloseTo(fx.expected.psi30Point, 2);
      }
      if (fx.expected.minHalfWidth15 !== undefined) {
        const halfW = (out.psi15!.high - out.psi15!.low) / 2;
        expect(halfW, `${fx.name} noisy CI widening`).toBeGreaterThanOrEqual(fx.expected.minHalfWidth15);
      }
      if (fx.expected.predictedTier15) {
        expect(out.predictedTier15, `${fx.name} tier15`).toBe(fx.expected.predictedTier15);
      }
      if (fx.expected.predictedTier30) {
        expect(out.predictedTier30, `${fx.name} tier30`).toBe(fx.expected.predictedTier30);
      }
      if (fx.expected.projectedAmberCrossingMin !== undefined) {
        expect(out.projectedAmberCrossingMin, `${fx.name} amber crossing`).toBe(
          fx.expected.projectedAmberCrossingMin
        );
      }
    }
  });

  it('returns explicit insufficient_trend_data on cold start and post-fault recovery (<4 clean samples)', () => {
    const emptyOut = predictCompositeTrajectory([]);
    expect(emptyOut.status).toBe('insufficient_trend_data');
    expect(emptyOut.psi15).toBeNull();
    expect(emptyOut.psi30).toBeNull();

    const shortHistory: TelemetryHistoryPoint[] = [
      { minuteOffset: 0, timestamp: 't0', psi: 3.1, compositeScore: 3.3, wbgtC: 34, degraded: false },
      { minuteOffset: 3, timestamp: 't1', psi: 3.3, compositeScore: 3.5, wbgtC: 34, degraded: false },
      { minuteOffset: 6, timestamp: 't2', psi: 3.5, compositeScore: 3.7, wbgtC: 34, degraded: false },
    ];
    expect(shortHistory.length).toBeLessThan(MIN_CLEAN_FORECAST_SAMPLES);
    const shortOut = predictCompositeTrajectory(shortHistory);
    expect(shortOut.status).toBe('insufficient_trend_data');
    expect(shortOut.cleanWindowSamples).toBe(3);
    expect(shortOut.psi15).toBeNull();
    expect(shortOut.projectedAmberCrossingMin).toBeNull();

    // Post-fault boundary: 5 clean points, then 1 degraded fault point, then only 2 clean recovery points
    const postFaultHistory: TelemetryHistoryPoint[] = [
      { minuteOffset: 0, timestamp: 't0', psi: 3.0, compositeScore: 3.2, wbgtC: 34, degraded: false },
      { minuteOffset: 3, timestamp: 't1', psi: 3.2, compositeScore: 3.4, wbgtC: 34, degraded: false },
      { minuteOffset: 6, timestamp: 't2', psi: 3.4, compositeScore: 3.6, wbgtC: 34, degraded: false },
      { minuteOffset: 9, timestamp: 't3', psi: 3.6, compositeScore: 3.8, wbgtC: 34, degraded: false },
      { minuteOffset: 12, timestamp: 't4', psi: null, compositeScore: 6.2, wbgtC: 34, degraded: true },
      { minuteOffset: 15, timestamp: 't5', psi: 3.7, compositeScore: 3.9, wbgtC: 34, degraded: false },
      { minuteOffset: 18, timestamp: 't6', psi: 3.8, compositeScore: 4.0, wbgtC: 34, degraded: false },
    ];
    const postFaultOut = predictCompositeTrajectory(postFaultHistory);
    expect(postFaultOut.status).toBe('insufficient_trend_data');
    expect(postFaultOut.cleanWindowSamples).toBe(2);
    expect(postFaultOut.psi15).toBeNull();
    expect(postFaultOut.reason).toContain('Insufficient clean trend window');
  });

  it('enforces LLM boundary: passes deterministic forecast numbers into Gemini prompt and never allows LLM to alter numeric forecasts', async () => {
    const { getMultilingualWorkerAlert } = await import('../../src/server/geminiService.ts');

    const crossingFx = trendFixtureFile.fixtures.find(
      (f: { name: string }) => f.name === 'tier_crossing_green_to_amber_to_red'
    );
    const deterministicForecast: ForecastOutput = predictCompositeTrajectory(
      crossingFx.history as TelemetryHistoryPoint[],
      crossingFx.wbgtSlopePerHour
    );

    const ctx: WorkerContext = {
      workerId: 'W-BOUNDARY-1',
      deviceId: 'BLE-B1',
      roleLabel: 'Steel Fixer',
      zone: 'Zone A · Boundary Test',
      ppeLevel: 'Standard Coverall',
      acclimatizationDays: 4,
      ageYears: 29,
      hr0: 68,
      tc0: 36.7,
      preferredLanguage: 'en',
      plannedBreakTime: '12:30',
      hydrationCount: 1,
      breaksTakenTodayMin: 15,
    };

    const assessment: RiskAssessment = {
      workerId: ctx.workerId,
      timestamp: '2025-08-14T11:09:00+04:00',
      psi: 3.6,
      tcProxyC: 37.3,
      hrMaxEstimated: 188,
      effectiveWbgtC: 35.0,
      acgihActionLimitC: 23.5,
      acgihTlvLimitC: 26.0,
      envRiskScore: 5.5,
      compositeScore: 3.95,
      tier: 'Green',
      scoringMode: 'physiological_plus_env',
      degradedReason: null,
      gpsDegraded: false,
      contributingFactors: ['Warming trend in Zone A'],
      recommendedAction: 'Drink water and prepare shade break.',
    };

    const mockCopy = {
      headline: 'HYDRATE BEFORE AMBER RISE',
      explanation: 'Heat strain is approaching Amber in Zone A.',
      action: 'Start your shade break early and drink cool water.',
      proactiveForecastNote: `Projected Amber crossing in ~${deterministicForecast.projectedAmberCrossingMin} min.`,
    };

    generateContentMock.mockResolvedValueOnce({
      text: JSON.stringify({
        en: mockCopy,
        hi: mockCopy,
        ur: mockCopy,
        bn: mockCopy,
        tl: mockCopy,
      }),
    });

    const copyMap = await getMultilingualWorkerAlert(ctx, assessment, deterministicForecast, ENV_SAMPLE);
    expect(generateContentMock).toHaveBeenCalledTimes(1);

    const promptArg = generateContentMock.mock.calls[0][0].contents as string;
    expect(promptArg).toContain(`current=${deterministicForecast.psiNow}/10`);
    expect(promptArg).toContain(`t+15=${deterministicForecast.psi15!.point}`);
    expect(promptArg).toContain(
      `90% CI ${deterministicForecast.psi15!.low}–${deterministicForecast.psi15!.high}`
    );
    expect(promptArg).toContain(`t+30=${deterministicForecast.psi30!.point}`);
    expect(promptArg).toContain(
      `projected Amber crossing in ${deterministicForecast.projectedAmberCrossingMin} min`
    );

    // Deterministic forecast object remains completely isolated and unmutated
    expect(deterministicForecast.psi15?.point).toBeCloseTo(5.22, 2);
    expect(copyMap.en.source).toBe('gemini');
  });

  it('gracefully falls back to deterministic multilingual templates if Gemini fails or times out while preserving deterministic ForecastOutput', async () => {
    const { getMultilingualWorkerAlert } = await import('../../src/server/geminiService.ts');

    const risingFx = trendFixtureFile.fixtures.find((f: { name: string }) => f.name === 'rising_trend');
    const deterministicForecast: ForecastOutput = predictCompositeTrajectory(
      risingFx.history as TelemetryHistoryPoint[],
      risingFx.wbgtSlopePerHour
    );

    const ctx: WorkerContext = {
      workerId: 'W-FALLBACK-2',
      deviceId: 'BLE-F2',
      roleLabel: 'Scaffold Rigger',
      zone: 'Zone B · Tower West',
      ppeLevel: 'FR / Arc-Flash',
      acclimatizationDays: 12,
      ageYears: 34,
      hr0: 70,
      tc0: 36.75,
      preferredLanguage: 'en',
      plannedBreakTime: '12:30',
      hydrationCount: 2,
      breaksTakenTodayMin: 20,
    };

    // Unique score band (5.5) so cache does not hit the previous test
    const assessment: RiskAssessment = {
      workerId: ctx.workerId,
      timestamp: '2025-08-14T11:12:00+04:00',
      psi: 5.4,
      tcProxyC: 38.0,
      hrMaxEstimated: 184,
      effectiveWbgtC: 37.0,
      acgihActionLimitC: 25.5,
      acgihTlvLimitC: 28.5,
      envRiskScore: 7.2,
      compositeScore: 5.5,
      tier: 'Amber',
      scoringMode: 'physiological_plus_env',
      degradedReason: null,
      gpsDegraded: false,
      contributingFactors: ['Moderate-high Physiological Strain Index (PSI 5.4/10)'],
      recommendedAction: 'Take 15-min shade break.',
    };

    generateContentMock.mockRejectedValueOnce(new Error('Gemini request timed out after 25000ms'));

    const fallbackCopy = await getMultilingualWorkerAlert(ctx, assessment, deterministicForecast, ENV_SAMPLE);
    expect(fallbackCopy.en.source).toBe('template_fallback');
    expect(fallbackCopy.en.headline).toContain('REST IN SHADE');
    expect(fallbackCopy.hi.headline.length).toBeGreaterThan(3);
    expect(fallbackCopy.ur.headline.length).toBeGreaterThan(3);
    expect(fallbackCopy.bn.headline.length).toBeGreaterThan(3);
    expect(fallbackCopy.tl.headline.length).toBeGreaterThan(3);

    // Deterministic forecast values remain completely intact even when LLM is down
    expect(deterministicForecast.status).toBe('ready');
    expect(deterministicForecast.psi15?.point).toBeCloseTo(5.32, 2);
    expect(deterministicForecast.predictedTier15).toBe('Amber');
  });

  it('blocks fabricated ETA claims across all 5 languages when crossing ETAs are null or slope is negative', async () => {
    const {
      clearAlertTranslationCache,
      getMultilingualWorkerAlert,
    } = await import('../../src/server/geminiService.ts');
    clearAlertTranslationCache();

    // Falling trajectory: composite drops from 6.2 -> 5.4, Amber already reached or null, Red null
    const fallingHistory: TelemetryHistoryPoint[] = [
      { minuteOffset: 0, timestamp: 't0', psi: 5.9, compositeScore: 6.2, wbgtC: 34, degraded: false },
      { minuteOffset: 3, timestamp: 't1', psi: 5.6, compositeScore: 5.9, wbgtC: 34, degraded: false },
      { minuteOffset: 6, timestamp: 't2', psi: 5.2, compositeScore: 5.5, wbgtC: 34, degraded: false },
      { minuteOffset: 9, timestamp: 't3', psi: 4.8, compositeScore: 5.1, wbgtC: 34, degraded: false },
      { minuteOffset: 12, timestamp: 't4', psi: 4.4, compositeScore: 4.8, wbgtC: 34, degraded: false },
    ];
    const coolingForecast = predictCompositeTrajectory(fallingHistory, 0.0);
    expect(coolingForecast.status).toBe('ready');
    expect(coolingForecast.slopePerMin!).toBeLessThan(0);
    expect(coolingForecast.projectedRedCrossingMin).toBeNull();

    // Simulate Green/cooling scenario where BOTH projectedAmberCrossingMin & projectedRedCrossingMin are null
    const nullCrossingForecast: ForecastOutput = {
      ...coolingForecast,
      projectedAmberCrossingMin: null,
      projectedRedCrossingMin: null,
    };

    const ctx: WorkerContext = {
      workerId: 'W-ETA-GUARD',
      deviceId: 'BLE-EG',
      roleLabel: 'Steel Fixer',
      zone: 'Zone A · Shaded Rebar',
      ppeLevel: 'Standard Coverall',
      acclimatizationDays: 10,
      ageYears: 30,
      hr0: 68,
      tc0: 36.7,
      preferredLanguage: 'en',
      plannedBreakTime: '12:30',
      hydrationCount: 3,
      breaksTakenTodayMin: 20,
    };

    const assessment: RiskAssessment = {
      workerId: ctx.workerId,
      timestamp: '2025-08-14T11:15:00+04:00',
      psi: 3.1,
      tcProxyC: 37.1,
      hrMaxEstimated: 187,
      effectiveWbgtC: 34.0,
      acgihActionLimitC: 25.5,
      acgihTlvLimitC: 28.5,
      envRiskScore: 5.0,
      compositeScore: 3.5,
      tier: 'Green',
      scoringMode: 'physiological_plus_env',
      degradedReason: null,
      gpsDegraded: false,
      contributingFactors: ['Heat strain cooling down in shade'],
      recommendedAction: 'Continue hydration.',
    };

    // Mock Gemini hallucinating bogus minute ETAs in every language despite null crossings
    generateContentMock.mockResolvedValueOnce({
      text: JSON.stringify({
        en: {
          headline: 'AMBER IN 1 MINUTE',
          explanation: 'Heat strain is projected to reach Red in 36 minutes.',
          action: 'Drink water every 20 minutes.',
          proactiveForecastNote: 'Heat risk is projected to reach Amber in 1 minute and Red in 36 minutes.',
        },
        hi: {
          headline: 'सामान्य स्थिति',
          explanation: 'गर्मी कम हो रही है।',
          action: 'हर 20 मिनट में पानी पिएं।',
          proactiveForecastNote: '1 मिनट में अंबर और 36 मिनट में गंभीर स्तर संभावित है।',
        },
        ur: {
          headline: 'حالت محفوظ ہے',
          explanation: 'گرمی کم ہو رہی ہے۔',
          action: 'ہر 20 منٹ بعد پانی پئیں۔',
          proactiveForecastNote: '1 منٹ میں احتیاطی اور 36 منٹ میں شدید حد متوقع ہے۔',
        },
        bn: {
          headline: 'কাজ নিরাপদ',
          explanation: 'তাপচাপ কমছে।',
          action: 'প্রতি ২০ মিনিটে পানি পান করুন।',
          proactiveForecastNote: '১ মিনিটে সতর্ক এবং ৩৬ মিনিটে গুরুতর সীমা আসতে পারে।',
        },
        tl: {
          headline: 'LIGTAS ANG LAGAY',
          explanation: 'Bumababa ang heat strain.',
          action: 'Uminom ng tubig tuwing 20 minuto.',
          proactiveForecastNote: 'Aabot sa Amber sa 1 min at Red sa 36 minuto.',
        },
      }),
    });

    const sanitized = await getMultilingualWorkerAlert(ctx, assessment, nullCrossingForecast, ENV_SAMPLE);
    for (const lang of ['en', 'hi', 'ur', 'bn', 'tl'] as const) {
      expect(sanitized[lang].proactiveForecastNote).not.toMatch(/\b(?:1|36)\b|১|৩৬/);
      expect(sanitized[lang].headline).not.toContain('1 MINUTE');
      expect(sanitized[lang].explanation).not.toContain('36 minutes');
    }
    expect(sanitized.en.proactiveForecastNote).toContain('No Amber or Red threshold crossing');
    // Missing ar/ta/ml/ne/si keys in partial LLM JSON fall back safely to deterministic localized templates
    for (const addedLang of ['ar', 'ta', 'ml', 'ne', 'si'] as const) {
      expect(sanitized[addedLang].headline.length).toBeGreaterThan(2);
      expect(sanitized[addedLang].proactiveForecastNote?.length ?? 0).toBeGreaterThan(5);
    }
  });

  it('supports all 10 Dubai/UAE languages in deterministic fallback and blocks Tamil/Arabic/Malayalam/Nepali/Sinhala ETA hallucinations', async () => {
    const {
      clearAlertTranslationCache,
      getMultilingualWorkerAlert,
    } = await import('../../src/server/geminiService.ts');
    const { SUPPORTED_LANGUAGES } = await import('../../src/shared/types.ts');
    clearAlertTranslationCache();

    const fallingHistory: TelemetryHistoryPoint[] = [
      { minuteOffset: 0, timestamp: 't0', psi: 5.5, compositeScore: 5.8, wbgtC: 34, degraded: false },
      { minuteOffset: 3, timestamp: 't1', psi: 5.2, compositeScore: 5.5, wbgtC: 34, degraded: false },
      { minuteOffset: 6, timestamp: 't2', psi: 4.9, compositeScore: 5.1, wbgtC: 34, degraded: false },
      { minuteOffset: 9, timestamp: 't3', psi: 4.5, compositeScore: 4.7, wbgtC: 34, degraded: false },
    ];
    const coolingForecast: ForecastOutput = {
      ...predictCompositeTrajectory(fallingHistory, 0.0),
      projectedAmberCrossingMin: null,
      projectedRedCrossingMin: null,
    };

    const ctx: WorkerContext = {
      workerId: 'W-10LANG-1',
      deviceId: 'BLE-10L',
      roleLabel: 'Crane Signalman',
      zone: 'Zone C · Dubai Marina',
      ppeLevel: 'Standard Coverall',
      acclimatizationDays: 9,
      ageYears: 31,
      hr0: 69,
      tc0: 36.7,
      preferredLanguage: 'ta',
      plannedBreakTime: '12:30',
      hydrationCount: 2,
      breaksTakenTodayMin: 15,
    };

    const assessment: RiskAssessment = {
      workerId: ctx.workerId,
      timestamp: '2025-08-14T11:20:00+04:00',
      psi: 3.3,
      tcProxyC: 37.1,
      hrMaxEstimated: 186,
      effectiveWbgtC: 34.2,
      acgihActionLimitC: 25.5,
      acgihTlvLimitC: 28.5,
      envRiskScore: 5.1,
      compositeScore: 3.7,
      tier: 'Green',
      scoringMode: 'physiological_plus_env',
      degradedReason: null,
      gpsDegraded: false,
      contributingFactors: ['Cooling trend'],
      recommendedAction: 'Hydrate every 20 minutes.',
    };

    generateContentMock.mockResolvedValueOnce({
      text: JSON.stringify({
        ar: {
          headline: 'حالة مستقرة',
          explanation: 'تنخفض درجة الحرارة.',
          action: 'اشرب الماء.',
          proactiveForecastNote: 'سيصل إلى مستوى التحذير خلال 2 دقيقة.',
        },
        ta: {
          headline: 'பாதுகாப்பான நிலை',
          explanation: 'வெப்பம் குறைகிறது.',
          action: 'தண்ணீர் குடிக்கவும்.',
          proactiveForecastNote: '2 நிமிடங்களில் மஞ்சள் எச்சரிக்கை வரும்.',
        },
        ml: {
          headline: 'സുരക്ഷിതമാണ്',
          explanation: 'താപം കുറയുന്നു.',
          action: 'വെള്ളം കുടിക്കുക.',
          proactiveForecastNote: '2 മിനിറ്റിൽ മുന്നറിയിപ്പ് എത്തും.',
        },
        ne: {
          headline: 'सुरक्षित अवस्था',
          explanation: 'तापक्रम घट्दैछ।',
          action: 'पानी पिउनुहोस्।',
          proactiveForecastNote: '२ मिनेटमा चेतावनी पुग्नेछ।',
        },
        si: {
          headline: 'වැඩ කිරීමට ආරක්ෂිතයි',
          explanation: 'තාප පීඩනය අඩු වෙමින් පවතී.',
          action: 'ජලය පානය කරන්න.',
          proactiveForecastNote: 'විනාඩි 2කින් ඇම්බර් අනතුරු ඇඟවීම වෙත ළඟා වේ.',
        },
      }),
    });

    const out = await getMultilingualWorkerAlert(ctx, assessment, coolingForecast, ENV_SAMPLE);
    expect(SUPPORTED_LANGUAGES).toHaveLength(10);
    expect(Object.keys(out).sort()).toEqual([...SUPPORTED_LANGUAGES].sort());
    for (const lang of ['ar', 'ta', 'ml', 'ne', 'si'] as const) {
      expect(out[lang].proactiveForecastNote).not.toMatch(/\b2\b|२/);
    }
  });

  it('strips any accidental raw physiological vitals from Supervisor AI shift briefings', async () => {
    const { generateSupervisorShiftBriefing } = await import('../../src/server/geminiService.ts');
    generateContentMock.mockResolvedValueOnce({
      text: JSON.stringify({
        executiveSummary: 'W-104 reached 142 bpm and PSI 7.4 with Tc proxy 38.6 and needs shade.',
        priorityActions: ['Rotate W-104 (HR0 72, HRmax 188, Borg 15) into cool recovery.'],
        zoneFocus: 'Zone A Steel Deck',
        heatWindowAdvice: 'Enforce 12:30–15:00 GST UAE midday break.',
      }),
    });

    const briefing = await generateSupervisorShiftBriefing({
      crew: [
        {
          workerId: 'W-104',
          roleLabel: 'Steel Fixer',
          zone: 'Zone A',
          ppeLevel: 'FR / Arc-Flash',
          acclimatizationDays: 3,
          breaksTakenTodayMin: 10,
          tier: 'Red',
          riskBandLabel: 'High Strain Band',
          scoringMode: 'physiological_plus_env',
          degradedReason: null,
          faultSummary: [],
          gpsDegraded: false,
          recommendedAction: 'Stop work and move to AC shade immediately.',
          acknowledged: false,
          lastCheckIn: null,
          predictedTier15: 'Red',
          predictedTier30: 'Red',
          projectedAmberCrossingMin: 0,
          projectedRedCrossingMin: 0,
          forecastStatus: 'ready',
          sparklineComposite: [5.5, 6.2, 6.9, 7.2],
          sparklineProjected: [7.2, 7.5, 7.6],
          supervisorDirective: null,
          hydrationCount: 2,
          lastUpdated: '2025-08-14T11:20:00+04:00',
        },
      ],
      alerts: [],
      env: ENV_SAMPLE,
      language: 'en',
    });

    const combined = `${briefing.executiveSummary} ${briefing.priorityActions.join(' ')}`;
    expect(combined).not.toMatch(/\b\d+\s*bpm\b/i);
    expect(combined).not.toMatch(/\bPSI\s*\d/i);
    expect(combined).not.toMatch(/\bHR0\b|\bHRmax\b|\bTc proxy\b|\bBorg\b/i);
  });

  it('routes Dubai Marina & dispatch commands via Voice AI Co-Pilot while sanitizing raw physiological vitals', async () => {
    const { parseVoiceCopilotCommand } = await import('../../src/server/geminiService.ts');

    const crewFixture = [
      {
        workerId: 'W-104',
        roleLabel: 'Tank Coating Tech',
        zone: 'Zone C · Enclosed Bay',
        ppeLevel: 'Chemical / Tyvek' as const,
        acclimatizationDays: 3,
        breaksTakenTodayMin: 10,
        tier: 'Red' as const,
        riskBandLabel: 'Critical Heat Strain',
        scoringMode: 'physiological_plus_env' as const,
        degradedReason: null,
        faultSummary: [],
        gpsDegraded: false,
        recommendedAction: 'Stop outdoor work immediately.',
        acknowledged: false,
        lastCheckIn: null,
        predictedTier15: 'Red' as const,
        predictedTier30: 'Red' as const,
        projectedAmberCrossingMin: 0,
        projectedRedCrossingMin: 0,
        forecastStatus: 'ready' as const,
        sparklineComposite: [6.4, 6.8, 7.1, 7.3],
        sparklineProjected: [7.3, 7.5, 7.6],
        supervisorDirective: null,
        hydrationCount: 2,
        lastUpdated: '2025-08-14T11:20:00+04:00',
      },
    ];

    // Mock Gemini emitting an accidental vital leak inside spokenReply
    generateContentMock.mockResolvedValueOnce({
      text: JSON.stringify({
        intent: 'switch_hub',
        hubId: 'dubai_marina',
        spokenReply: 'Switching to Dubai Marina Tower Deck. W-104 was 148 bpm and PSI 7.5.',
        actionSummary: 'Switched to Dubai Marina',
      }),
    });

    const dubaiPlan = await parseVoiceCopilotCommand({
      commandText: 'Simulate Dubai Marina',
      crew: crewFixture,
      env: ENV_SAMPLE,
      language: 'en',
      currentRoute: '/supervisor',
    });

    expect(dubaiPlan.intent).toBe('switch_hub');
    expect(dubaiPlan.hubId).toBe('dubai_marina');
    expect(dubaiPlan.spokenReply).not.toMatch(/\b\d+\s*bpm\b/i);
    expect(dubaiPlan.spokenReply).not.toMatch(/\bPSI\s*\d/i);
  });
});


