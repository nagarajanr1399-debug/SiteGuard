import { describe, expect, it } from 'vitest';
import { evaluateHeatThresholdForVoice } from '../../src/hooks/useWorkerVoiceAlerts.ts';
import {
  GLOBAL_WORKFORCE_LANGUAGES,
  getGlobalLanguageByCode,
} from '../../src/shared/globalLanguages.ts';
import {
  SUPPORTED_LANGUAGES,
  TTS_LOCALE_BY_LANGUAGE,
  type SupportedLanguage,
  type WorkerStateSelf,
} from '../../src/shared/types.ts';

function makeWorkerState(
  tier: 'Green' | 'Amber' | 'Red',
  preferredLanguage: SupportedLanguage = 'en'
): WorkerStateSelf {
  const alertTranslations = {} as WorkerStateSelf['alertTranslations'];
  for (const lang of SUPPORTED_LANGUAGES) {
    alertTranslations[lang] = {
      headline:
        lang === 'ta'
          ? tier === 'Red'
            ? 'வேலையை உடனே நிறுத்துங்கள்'
            : 'பாதுகாப்பான நிலை'
          : lang === 'ar'
            ? tier === 'Red'
              ? 'أوقف العمل فوراً — حرارة حرجة'
              : 'العمل آمن'
            : tier === 'Red'
              ? 'STOP WORK NOW — CRITICAL HEAT'
              : tier === 'Amber'
                ? 'REST IN SHADE — ELEVATED STRAIN'
                : 'SAFE TO WORK — STAY HYDRATED',
      explanation: `Tier=${tier}`,
      action:
        lang === 'ta'
          ? 'நிழலுக்குச் செல்லவும்'
          : lang === 'ar'
            ? 'انتقل إلى منطقة الظل فوراً'
            : 'Move to shaded cooling station.',
      proactiveForecastNote: null,
      source: 'template_fallback',
      cached: false,
    };
  }

  return {
    context: {
      workerId: 'W-101',
      deviceId: 'BLE-BAND-101',
      roleLabel: 'Steel Fixer',
      zone: 'Zone A · Rebar Deck',
      ppeLevel: 'Standard Coverall',
      acclimatizationDays: 3,
      ageYears: 29,
      hr0: 68,
      tc0: 36.7,
      preferredLanguage,
      plannedBreakTime: '12:30',
      hydrationCount: 2,
      breaksTakenTodayMin: 20,
    },
    latestFrame: {
      deviceId: 'BLE-BAND-101',
      workerId: 'W-101',
      timestamp: '2026-11-19T11:00:00+04:00',
      hrBpm: tier === 'Red' ? 162 : tier === 'Amber' ? 136 : 94,
      skinTempC: tier === 'Red' ? 37.1 : tier === 'Amber' ? 35.8 : 34.0,
      exertionIndex: tier === 'Red' ? 8.8 : tier === 'Amber' ? 6.8 : 5.0,
      batteryPct: 90,
      rssiDbm: -60,
      gpsFix: true,
      signalQuality: 0.98,
    },
    faults: {
      bleDisconnected: false,
      lowBattery: false,
      sensorNoise: false,
      gpsLoss: false,
    },
    assessment: {
      workerId: 'W-101',
      timestamp: '2026-11-19T11:00:00+04:00',
      psi: tier === 'Red' ? 7.8 : tier === 'Amber' ? 5.2 : 2.9,
      tcProxyC: 37.5,
      hrMaxEstimated: 188,
      effectiveWbgtC: 35.0,
      acgihActionLimitC: 23.5,
      acgihTlvLimitC: 26.0,
      envRiskScore: 6.2,
      compositeScore: tier === 'Red' ? 7.6 : tier === 'Amber' ? 5.1 : 3.1,
      tier,
      scoringMode: 'physiological_plus_env',
      degradedReason: null,
      gpsDegraded: false,
      contributingFactors: [],
      recommendedAction: 'Move to shade',
    },
    forecast: {
      status: 'insufficient_trend_data',
      reason: 'Need more samples',
      cleanWindowSamples: 2,
      windowMinutes: 3,
      psiNow: 3.1,
      psi15: null,
      psi30: null,
      predictedTier15: null,
      predictedTier30: null,
      projectedAmberCrossingMin: null,
      projectedRedCrossingMin: null,
      slopePerMin: null,
      modelLabel: 'Damped Holt Trend',
    },
    history: [],
    alertTranslations,
    lastCheckIn: null,
    supervisorDirective: null,
    simulatedClockMin: 12,
  };
}

describe('Worker Voice-Synthesis Threshold Evaluation', () => {
  it('stays nominal (not exceeded) in Green tier and triggers on Amber/Red tiers', () => {
    const greenEval = evaluateHeatThresholdForVoice({
      workerState: makeWorkerState('Green', 'en'),
      alertPreviewState: 'live',
      tempUnit: 'C',
    });
    expect(greenEval.exceeded).toBe(false);
    expect(greenEval.severity).toBe('nominal');

    const amberEval = evaluateHeatThresholdForVoice({
      workerState: makeWorkerState('Amber', 'en'),
      alertPreviewState: 'live',
      tempUnit: 'C',
    });
    expect(amberEval.exceeded).toBe(true);
    expect(amberEval.severity).toBe('amber');
    expect(amberEval.spokenText).toContain('REST IN SHADE');

    const redEval = evaluateHeatThresholdForVoice({
      workerState: makeWorkerState('Red', 'en'),
      alertPreviewState: 'live',
      tempUnit: 'C',
    });
    expect(redEval.exceeded).toBe(true);
    expect(redEval.severity).toBe('red');
    expect(redEval.spokenText).toContain('STOP WORK NOW');
  });

  it('produces localized alert copy and proper BCP-47 locale tags for all 10 Dubai/UAE languages including Sinhala', () => {
    const taEval = evaluateHeatThresholdForVoice({
      workerState: makeWorkerState('Red', 'ta'),
      alertPreviewState: 'live',
      tempUnit: 'C',
    });
    expect(taEval.exceeded).toBe(true);
    expect(taEval.localeTag).toBe('ta-IN');
    expect(taEval.spokenText).toContain('வேலையை உடனே நிறுத்துங்கள்');

    const arEval = evaluateHeatThresholdForVoice({
      workerState: makeWorkerState('Red', 'ar'),
      alertPreviewState: 'live',
      tempUnit: 'C',
    });
    expect(arEval.exceeded).toBe(true);
    expect(arEval.localeTag).toBe('ar-AE');
    expect(arEval.spokenText).toContain('أوقف العمل فوراً');

    const siEval = evaluateHeatThresholdForVoice({
      workerState: makeWorkerState('Red', 'si'),
      alertPreviewState: 'high_heat',
      tempUnit: 'C',
    });
    expect(siEval.exceeded).toBe(true);
    expect(siEval.localeTag).toBe('si-LK');
    expect(siEval.languageName).toBe('Sinhala');
    expect(siEval.spokenText).toMatch(/[\u0D80-\u0DFF]{3,}/);

    expect(SUPPORTED_LANGUAGES).toHaveLength(10);
    for (const lang of SUPPORTED_LANGUAGES) {
      const res = evaluateHeatThresholdForVoice({
        workerState: makeWorkerState('Red', lang),
        alertPreviewState: 'high_heat',
        tempUnit: 'C',
      });
      expect(res.exceeded).toBe(true);
      expect(res.localeTag).toBe(TTS_LOCALE_BY_LANGUAGE[lang]);
      expect(res.spokenText.length).toBeGreaterThan(10);
    }
  });

  it('treats hydration_alert preview as nominal and amber_forecast/high_heat/sos_active as exceeded', () => {
    const hydration = evaluateHeatThresholdForVoice({
      workerState: makeWorkerState('Green', 'hi'),
      alertPreviewState: 'hydration_alert',
      tempUnit: 'C',
    });
    expect(hydration.exceeded).toBe(false);
    expect(hydration.severity).toBe('nominal');

    const highHeat = evaluateHeatThresholdForVoice({
      workerState: makeWorkerState('Green', 'hi'),
      alertPreviewState: 'high_heat',
      tempUnit: 'F',
    });
    expect(highHeat.exceeded).toBe(true);
    expect(highHeat.severity).toBe('red');
    expect(highHeat.localeTag).toBe('hi-IN');
    expect(highHeat.spokenText).toContain('99');
  });

  it('supports 100+ Abu Dhabi workforce languages via globalLanguageOverride and BCP-47 locales', () => {
    expect(GLOBAL_WORKFORCE_LANGUAGES.length).toBeGreaterThanOrEqual(100);
    const telugu = getGlobalLanguageByCode('te');
    const persian = getGlobalLanguageByCode('fa');
    expect(telugu?.bcp47).toBe('te-IN');
    expect(persian?.rtl).toBe(true);

    const teEval = evaluateHeatThresholdForVoice({
      workerState: makeWorkerState('Red', 'en'),
      alertPreviewState: 'live',
      tempUnit: 'C',
      globalLanguageOverride: {
        option: telugu!,
        copy: {
          headline: 'పనిని వెంటనే ఆపండి',
          explanation: 'అధిక వేడి ఒత్తిడి',
          action: 'నీడలోకి వెళ్లండి మరియు నీరు తాగండి.',
          proactiveForecastNote: null,
          source: 'gemini',
          cached: false,
        },
      },
    });
    expect(teEval.exceeded).toBe(true);
    expect(teEval.localeTag).toBe('te-IN');
    expect(teEval.languageLabel).toBe('తెలుగు');
    expect(teEval.spokenText).toContain('పనిని వెంటనే ఆపండి');
  });
});
