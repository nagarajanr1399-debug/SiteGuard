import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  SUPPORTED_LANGUAGES,
  type BacktestReport,
  type BreakRecord,
  type EnvironmentalObservation,
  type ForecastOutput,
  type ForecastValidationReport,
  type IncidentLogEntry,
  type RiskAssessment,
  type SupervisorAiBriefing,
  type SupportedLanguage,
  type SyntheticWorkerDay,
  type UaeSiteHubId,
  type ValidationAiInsights,
  type VoiceCommandIntent,
  type VoiceCommandResponse,
  type WorkerAlertCopy,
  type WorkerContext,
  type WorkerStatusPublic,
} from '../shared/types.ts';

/**
 * Server-Side Gemini API Service for SiteGuard (GenOS Team).
 *
 * Covers:
 *  1. explainWorkerRisk & translateWorkerAlert — 10 Dubai/UAE languages (en/ar/hi/ur/bn/tl/ta/ml/ne/si), cached (gemini-4-hydrogen)
 *  2. transcribeWorkerVoiceIncident — Voice incident intake (gemini-3.5-transcribe)
 *  3. synthesizeWorkerSpeech — Multilingual Cloud TTS (gemini-3.8-flash-lite-tts)
 *  4. generateSupervisorShiftBriefing — Privacy-safe AI crew triage & rotation strategy (gemini-4-hydrogen)
 *  4. generateComplianceNarrative — Bilingual EN/AR UAE MOHRE audit briefing + remediation checklist (gemini-4-hydrogen)
 *  5. generateSyntheticCohortViaGemini — Synthetic physiological cohort generation (gemini-4-hydrogen)
 *  6. generateValidationAiInsights — Post-hoc clinical/ablation analysis for Backtest & Forecast Validation (gemini-4-hydrogen)
 *
 * SAFETY INVARIANT: Gemini NEVER computes numeric PSI scores or numeric forecasts.
 * PRIVACY INVARIANT: Supervisor & Compliance AI prompts NEVER include raw physiological vitals.
 */

let cachedClient: GoogleGenAI | null = null;
let cachedClientKey: string | null = null;

function getClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  if (!cachedClient || cachedClientKey !== apiKey) {
    cachedClientKey = apiKey;
    cachedClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return cachedClient;
}

// Server-side translation & explanation cache so repeated renders / small ticks never re-call Gemini
const alertCache = new Map<string, Record<SupportedLanguage, WorkerAlertCopy>>();
const fallbackCooldown = new Map<string, { data: Record<SupportedLanguage, WorkerAlertCopy>; expiresAt: number }>();
const inFlightAlerts = new Map<string, Promise<Record<SupportedLanguage, WorkerAlertCopy>>>();
const ttsAudioCache = new Map<string, { audioBase64: string; mimeType: string; voiceName: string }>();
let dailyQuotaCooldownUntil = 0;
let transientCooldownUntil = 0;
let lastGeminiDiagnostic: string = 'ok';

export function clearAlertTranslationCache(): void {
  alertCache.clear();
  fallbackCooldown.clear();
  ttsAudioCache.clear();
}

export function resetGeminiCircuitBreaker(): void {
  dailyQuotaCooldownUntil = 0;
  transientCooldownUntil = 0;
}

export function getLastGeminiDiagnostic(): string {
  return lastGeminiDiagnostic;
}

function isDailyQuotaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('PerDay') || msg.includes('free_tier_requests') || msg.includes('GenerateRequestsPerDay');
}

function withTimeout<T>(p: Promise<T>, ms = 25000): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Gemini request timed out after ${ms}ms`)), ms)
    ),
  ]);
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 2): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (isDailyQuotaError(err)) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient =
        msg.includes('429') ||
        msg.includes('503') ||
        msg.includes('RESOURCE_EXHAUSTED') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('fetch failed');
      if (!isTransient || attempt === maxAttempts) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, 900 * attempt));
    }
  }
  throw lastErr;
}

function makeAlertCopySchema() {
  return {
    type: Type.OBJECT,
    properties: {
      headline: { type: Type.STRING },
      explanation: { type: Type.STRING },
      action: { type: Type.STRING },
      proactiveForecastNote: { type: Type.STRING },
    },
    required: ['headline', 'explanation', 'action', 'proactiveForecastNote'],
  };
}

function buildCacheKey(assessment: RiskAssessment, forecast: ForecastOutput, context: WorkerContext): string {
  const scoreBand = Math.floor(assessment.compositeScore * 2) / 2;
  const amberBucket =
    forecast.status === 'ready' && forecast.projectedAmberCrossingMin !== null
      ? Math.round(forecast.projectedAmberCrossingMin / 3) * 3
      : 'none';
  const redBucket =
    forecast.status === 'ready' && forecast.projectedRedCrossingMin !== null
      ? Math.round(forecast.projectedRedCrossingMin / 3) * 3
      : 'none';
  const slopeDir =
    forecast.status !== 'ready' || forecast.slopePerMin === null
      ? 'na'
      : forecast.slopePerMin > 0.015
        ? 'up'
        : forecast.slopePerMin < -0.015
          ? 'down'
          : 'flat';
  return [
    'v2-etaguard',
    assessment.tier,
    assessment.scoringMode,
    assessment.gpsDegraded ? 'nogps' : 'gps',
    scoreBand,
    context.ppeLevel,
    forecast.status,
    forecast.predictedTier15 ?? 'none',
    amberBucket,
    redBucket,
    slopeDir,
  ].join('|');
}

const NO_CROSSING_PROJECTED_COPY: Record<SupportedLanguage, string> = {
  en: 'No Amber or Red threshold crossing is currently projected on the current trajectory.',
  ar: 'لا يُتوقع حالياً تجاوز الحد البرتقالي أو الأحمر وفق المسار الحالي.',
  hi: 'वर्तमान रुझान के अनुसार अभी अंबर या गंभीर स्तर पार होने का कोई अनुमान नहीं है।',
  ur: 'موجودہ رجحان کے مطابق فی الحال احتیاطی یا شدید حد عبور ہونے کا کوئی امکان متوقع نہیں ہے۔',
  bn: 'বর্তমান প্রবণতা অনুযায়ী এখনই সতর্ক বা গুরুতর সীমা অতিক্রমের কোনো পূর্বাভাস নেই।',
  tl: 'Sa kasalukuyang takbo, walang inaasahang paglampas sa Amber o Red na antas.',
  ta: 'தற்போதைய போக்கின் படி ஆம்பர் அல்லது சிவப்பு அபாய எல்லையைத் தாண்டும் நிலை இல்லை.',
  ml: 'നിലവിലെ പ്രവണത അനുസരിച്ച് ആംബർ അല്ലെങ്കിൽ റെഡ് പരിധി കടക്കാൻ സാധ്യതയില്ല.',
  ne: 'हालको ट्रेन्ड अनुसार एम्बर वा रातो सीमा पार हुने अनुमान छैन।',
  si: 'වත්මන් ප්‍රවණතාව අනුව දැනට ඇම්බර් හෝ රතු සීමාව ඉක්මවීමක් අපේක්ෂා නොකෙරේ.',
};

const INSUFFICIENT_TREND_COPY: Record<SupportedLanguage, string> = {
  en: 'Insufficient trend data for forecast window — follow standard scheduled breaks.',
  ar: 'بيانات الاتجاه غير كافية لنافذة التوقع — التزم بفترات الراحة المجدولة.',
  hi: 'पूर्वानुमान के लिए पर्याप्त डेटा नहीं है — निर्धारित समय पर नियमित आराम करें।',
  ur: 'پیش گوئی کے لیے ناکافی ڈیٹا — مقررہ اوقات کے مطابق باقاعدہ وقفہ لیں۔',
  bn: 'পূর্বাভাসের জন্য পর্যাপ্ত ট্রেন্ড ডেটা নেই — নির্ধারিত বিরতি মেনে চলুন।',
  tl: 'Kulang pa ang trend data para sa forecast — sundin ang nakatakdang pahinga.',
  ta: 'முன்னறிவிப்புக்குப் போதுமான தரவு இல்லை — வழக்கமான இடைவேளைகளைப் பின்பற்றவும்.',
  ml: 'പ്രവചനത്തിന് ആവശ്യമായ ട്രെൻഡ് ഡാറ്റ ലഭ്യമല്ല — നിശ്ചിത ഇടവേളകളിൽ വിശ്രമിക്കുക.',
  ne: 'पूर्वानुमानका लागि पर्याप्त ट्रेन्ड डेटा छैन — नियमित विश्राम समय पालना गर्नुहोस्।',
  si: 'පුරෝකථනය සඳහා ප්‍රමාණවත් දත්ත නොමැත — නියමිත විවේක කාලසටහන අනුගමනය කරන්න.',
};

function buildLocalizedProactiveNote(
  lang: SupportedLanguage,
  context: WorkerContext,
  assessment: RiskAssessment,
  forecast: ForecastOutput
): string | null {
  if (forecast.status === 'insufficient_trend_data') {
    return INSUFFICIENT_TREND_COPY[lang];
  }

  const amberEta = forecast.projectedAmberCrossingMin;
  const redEta = forecast.projectedRedCrossingMin;

  if (assessment.tier === 'Green' && amberEta !== null && amberEta > 0) {
    switch (lang) {
      case 'en':
        return `At current pace, Amber heat strain threshold likely in ~${amberEta} min — start your shade & hydration break early rather than waiting for ${context.plannedBreakTime}.`;
      case 'ar':
        return `بالوتيرة الحالية، يُتوقع بلوغ حد الإجهاد البرتقالي خلال ~${amberEta} دقيقة — ابدأ استراحة الظل والماء مبكراً قبل ${context.plannedBreakTime}.`;
      case 'hi':
        return `वर्तमान गति पर ~${amberEta} मिनट में अंबर स्तर संभावित — ${context.plannedBreakTime} का इंतजार किए बिना अभी पानी का ब्रेक शुरू करें।`;
      case 'ur':
        return `موجودہ رفتار پر ~${amberEta} منٹ میں احتیاطی حد متوقع ہے — ${context.plannedBreakTime} سے پہلے ابھی سائے میں وقفہ لیں۔`;
      case 'bn':
        return `বর্তমান গতিতে ~${amberEta} মিনিটে সতর্ক সীমা আসতে পারে — ${context.plannedBreakTime}-এর আগে এখনই ছায়ায় বিরতি নিন।`;
      case 'tl':
        return `Sa kasalukuyang bilis, maaaring umabot sa Amber sa ~${amberEta} min — mag-break na nang maaga bago mag-${context.plannedBreakTime}.`;
      case 'ta':
        return `தற்போதைய வேகத்தில் ~${amberEta} நிமிடத்தில் ஆம்பர் நிலை வரலாம் — ${context.plannedBreakTime} வரை காத்திருக்காமல் இப்போதே நிழல் ஓய்வு தொடங்குங்கள்.`;
      case 'ml':
        return `നിലവിലെ വേഗത്തിൽ ~${amberEta} മിനിറ്റിനുള്ളിൽ ആംബർ പരിധിയിലെത്താം — ${context.plannedBreakTime} വരെ കാക്കാതെ തണലിൽ വിശ്രമം തുടങ്ങുക.`;
      case 'ne':
        return `हालको गतिमा ~${amberEta} मिनेटमा एम्बर स्तर पुग्न सक्छ — ${context.plannedBreakTime} नकुरी छिट्टै छायामा विश्राम सुरु गर्नुहोस्।`;
      case 'si':
        return `වත්මන් වේගය අනුව විනාඩි ~${amberEta} කින් ඇම්බර් සීමාවට ළඟා විය හැකිය — ${context.plannedBreakTime} තෙක් නොසිට දැන්ම සෙවණේ විවේක ගන්න.`;
    }
  }

  if (assessment.tier === 'Amber' && redEta !== null && redEta > 0) {
    switch (lang) {
      case 'en':
        return `Heat strain rising; Red stop-work threshold projected in ~${redEta} min unless you rest in shade now.`;
      case 'ar':
        return `الإجهاد الحراري يرتفع؛ من المتوقع بلوغ حد التوقف الأحمر خلال ~${redEta} دقيقة ما لم تسترح في الظل الآن.`;
      case 'hi':
        return `गर्मी का दबाव बढ़ रहा है; यदि अभी छाया में आराम नहीं किया तो ~${redEta} मिनट में गंभीर स्तर संभावित है।`;
      case 'ur':
        return `گرمی کا دباؤ بڑھ رہا ہے؛ ابھی سائے میں آرام نہ کرنے پر ~${redEta} منٹ میں شدید حد متوقع ہے۔`;
      case 'bn':
        return `তাপচাপ বাড়ছে; এখনই ছায়ায় বিশ্রাম না নিলে ~${redEta} মিনিটে গুরুতর সীমা পৌঁছাতে পারে।`;
      case 'tl':
        return `Tumataas ang heat strain; inaasahan ang Red stop-work threshold sa ~${redEta} min maliban kung magpahinga sa lilim ngayon.`;
      case 'ta':
        return `வெப்ப அழுத்தம் உயர்கிறது; இப்போதே நிழலில் ஓய்வெடுக்காவிட்டால் ~${redEta} நிமிடத்தில் சிவப்பு நிறுத்த எல்லை வரலாம்.`;
      case 'ml':
        return `ചൂട് സമ്മർദ്ദം ഉയരുന്നു; ഇപ്പോൾ തണലിൽ വിശ്രമിച്ചില്ലെങ്കിൽ ~${redEta} മിനിറ്റിൽ റെഡ് സ്റ്റോപ്പ്-വർക്ക് പരിധി എത്തിയേക്കാം.`;
      case 'ne':
        return `तापीय दबाब बढ्दैछ; अहिले छायामा आराम नगरे ~${redEta} मिनेटमा रातो काम-रोक सीमा पुग्न सक्छ।`;
      case 'si':
        return `තාප පීඩනය ඉහළ යමින් පවතී; දැන් සෙවණේ විවේක නොගතහොත් විනාඩි ~${redEta} කින් රතු වැඩ නැවැත්වීමේ සීමාවට ළඟා විය හැකිය.`;
    }
  }

  if (amberEta === null && redEta === null) {
    return assessment.tier === 'Red' ? null : NO_CROSSING_PROJECTED_COPY[lang];
  }

  return null;
}

export function buildDeterministicFallback(
  context: WorkerContext,
  assessment: RiskAssessment,
  forecast: ForecastOutput
): Record<SupportedLanguage, WorkerAlertCopy> {
  const degradedNote =
    assessment.scoringMode === 'environment_only_degraded'
      ? ` Sensor fault (${assessment.degradedReason}); using outdoor heat index only.`
      : '';

  const baseEn: WorkerAlertCopy =
    assessment.tier === 'Red'
      ? {
          headline: 'STOP WORK NOW — COOL DOWN',
          explanation: `High heat strain detected in ${context.zone}.${degradedNote}`,
          action: 'Move to shaded AC rest area, loosen PPE, and drink cool water immediately.',
          proactiveForecastNote: buildLocalizedProactiveNote('en', context, assessment, forecast),
          source: 'template_fallback',
          cached: false,
        }
      : assessment.tier === 'Amber'
        ? {
            headline: 'REST IN SHADE & HYDRATE',
            explanation: `Moderate heat strain building in ${context.zone}.${degradedNote}`,
            action: 'Take a mandatory 15-minute shaded rest break and drink 300 ml water now.',
            proactiveForecastNote: buildLocalizedProactiveNote('en', context, assessment, forecast),
            source: 'template_fallback',
            cached: false,
          }
        : {
            headline: 'SAFE TO WORK — HYDRATE',
            explanation: `Heat strain is within safe limits in ${context.zone}.${degradedNote}`,
            action: 'Keep steady pace and drink water every 20 minutes.',
            proactiveForecastNote: buildLocalizedProactiveNote('en', context, assessment, forecast),
            source: 'template_fallback',
            cached: false,
          };

  const hi: WorkerAlertCopy =
    assessment.tier === 'Red'
      ? {
          headline: 'काम तुरंत रोकें — छाया में जाएं',
          explanation: `${context.zone} में अधिक गर्मी का दबाव है।`,
          action: 'तुरंत ठंडी छाया वाली जगह पर जाएं, भारी पीपीई ढीली करें और पानी पिएं।',
          proactiveForecastNote: buildLocalizedProactiveNote('hi', context, assessment, forecast),
          source: 'template_fallback',
          cached: false,
        }
      : assessment.tier === 'Amber'
        ? {
            headline: 'छाया में आराम करें और पानी पिएं',
            explanation: `${context.zone} में शरीर पर गर्मी का असर बढ़ रहा है।`,
            action: 'अभी 15 मिनट छाया में रुकें और ठंडा पानी पिएं।',
            proactiveForecastNote: buildLocalizedProactiveNote('hi', context, assessment, forecast),
            source: 'template_fallback',
            cached: false,
          }
        : {
            headline: 'स्थिति सामान्य — पानी पीते रहें',
            explanation: `${context.zone} में गर्मी का स्तर सुरक्षित सीमा में है।`,
            action: 'सामान्य गति से काम जारी रखें और हर 20 मिनट में पानी पिएं।',
            proactiveForecastNote: buildLocalizedProactiveNote('hi', context, assessment, forecast),
            source: 'template_fallback',
            cached: false,
          };

  const ur: WorkerAlertCopy =
    assessment.tier === 'Red'
      ? {
          headline: 'کام فوراً روکیں — سائے میں جائیں',
          explanation: `${context.zone} میں شدید گرمی کا دباؤ ہے۔`,
          action: 'فوراً ٹھنڈی جگہ پر آرام کریں، حفاظتی لباس ڈھیلا کریں اور پانی پئیں۔',
          proactiveForecastNote: buildLocalizedProactiveNote('ur', context, assessment, forecast),
          source: 'template_fallback',
          cached: false,
        }
      : assessment.tier === 'Amber'
        ? {
            headline: 'سائے میں آرام کریں اور پانی پئیں',
            explanation: `${context.zone} میں گرمی کا دباؤ بڑھ رہا ہے۔`,
            action: 'ابھی 15 منٹ سائے میں آرام کریں اور ٹھنڈا پانی پئیں۔',
            proactiveForecastNote: buildLocalizedProactiveNote('ur', context, assessment, forecast),
            source: 'template_fallback',
            cached: false,
          }
        : {
            headline: 'حالت محفوظ ہے — پانی پیتے رہیں',
            explanation: `${context.zone} میں گرمی کی سطح محفوظ حد میں ہے۔`,
            action: 'معمول کے مطابق کام جاری رکھیں اور ہر 20 منٹ بعد پانی پئیں۔',
            proactiveForecastNote: buildLocalizedProactiveNote('ur', context, assessment, forecast),
            source: 'template_fallback',
            cached: false,
          };

  const bn: WorkerAlertCopy =
    assessment.tier === 'Red'
      ? {
          headline: 'এখনই কাজ বন্ধ করুন — ছায়ায় যান',
          explanation: `${context.zone}-এ অতিরিক্ত তাপজনিত চাপ দেখা যাচ্ছে।`,
          action: 'এখনই ঠান্ডা বিশ্রামাগারে যান, ভারী পিপিই আলগা করুন এবং পানি পান করুন।',
          proactiveForecastNote: buildLocalizedProactiveNote('bn', context, assessment, forecast),
          source: 'template_fallback',
          cached: false,
        }
      : assessment.tier === 'Amber'
        ? {
            headline: 'ছায়ায় বিশ্রাম নিন ও পানি পান করুন',
            explanation: `${context.zone}-এ তাপজনিত চাপ বাড়ছে।`,
            action: 'এখন ১৫ মিনিট ছায়ায় বিশ্রাম নিন এবং ঠান্ডা পানি পান করুন।',
            proactiveForecastNote: buildLocalizedProactiveNote('bn', context, assessment, forecast),
            source: 'template_fallback',
            cached: false,
          }
        : {
            headline: 'কাজ নিরাপদ — পানি পান চালিয়ে যান',
            explanation: `${context.zone}-এ তাপচাপ নিরাপদ সীমার মধ্যে আছে।`,
            action: 'স্বাভাবিক গতিতে কাজ করুন এবং প্রতি ২০ মিনিটে পানি পান করুন।',
            proactiveForecastNote: buildLocalizedProactiveNote('bn', context, assessment, forecast),
            source: 'template_fallback',
            cached: false,
          };

  const tl: WorkerAlertCopy =
    assessment.tier === 'Red'
      ? {
          headline: 'ITIGIL ANG TRABAHO — MAGPALAMIG',
          explanation: `Mataas ang heat strain sa ${context.zone}.`,
          action: 'Pumunta agad sa malamig at lilim na lugar, luwagan ang PPE, at uminom ng tubig.',
          proactiveForecastNote: buildLocalizedProactiveNote('tl', context, assessment, forecast),
          source: 'template_fallback',
          cached: false,
        }
      : assessment.tier === 'Amber'
        ? {
            headline: 'MAGPAHINGA SA LILIM AT UMINOM',
            explanation: `Tumataas ang heat strain sa ${context.zone}.`,
            action: 'Magpahinga nang 15 minuto sa lilim at uminom ng malamig na tubig ngayon.',
            proactiveForecastNote: buildLocalizedProactiveNote('tl', context, assessment, forecast),
            source: 'template_fallback',
            cached: false,
          }
        : {
            headline: 'LIGTAS ANG LAGAY — UMINOM NG TUBIG',
            explanation: `Nasa ligtas na antas ang heat strain sa ${context.zone}.`,
            action: 'Ipagpatuloy ang maayos na ritmo at uminom ng tubig tuwing 20 minuto.',
            proactiveForecastNote: buildLocalizedProactiveNote('tl', context, assessment, forecast),
            source: 'template_fallback',
            cached: false,
          };

  const ar: WorkerAlertCopy =
    assessment.tier === 'Red'
      ? {
          headline: 'أوقف العمل فوراً — انتقل إلى التبريد',
          explanation: `تم رصد إجهاد حراري مرتفع في ${context.zone}.`,
          action: 'انتقل فوراً إلى منطقة استراحة مكيفة ومظللة، خفف معدات الوقاية واشرب ماءً بارداً.',
          proactiveForecastNote: buildLocalizedProactiveNote('ar', context, assessment, forecast),
          source: 'template_fallback',
          cached: false,
        }
      : assessment.tier === 'Amber'
        ? {
            headline: 'استرح في الظل واشرب الماء',
            explanation: `إجهاد حراري متوسط يتصاعد في ${context.zone}.`,
            action: 'خذ استراحة إلزامية لمدة 15 دقيقة في الظل واشرب 300 مل من الماء الآن.',
            proactiveForecastNote: buildLocalizedProactiveNote('ar', context, assessment, forecast),
            source: 'template_fallback',
            cached: false,
          }
        : {
            headline: 'الوضع آمن للعمل — استمر في الترطيب',
            explanation: `الإجهاد الحراري ضمن الحدود الآمنة في ${context.zone}.`,
            action: 'حافظ على وتيرة عمل مستقرة واشرب الماء كل 20 دقيقة.',
            proactiveForecastNote: buildLocalizedProactiveNote('ar', context, assessment, forecast),
            source: 'template_fallback',
            cached: false,
          };

  const ta: WorkerAlertCopy =
    assessment.tier === 'Red'
      ? {
          headline: 'உடனே வேலையை நிறுத்துங்கள் — குளிரூட்டவும்',
          explanation: `${context.zone} பகுதியில் அதிக வெப்ப அழுத்தம் கண்டறியப்பட்டது.`,
          action: 'உடனடியாக குளிரூட்டப்பட்ட நிழல் ஓய்வறைக்குச் சென்று PPE தளர்த்தி குளிர்ந்த நீர் குடியுங்கள்.',
          proactiveForecastNote: buildLocalizedProactiveNote('ta', context, assessment, forecast),
          source: 'template_fallback',
          cached: false,
        }
      : assessment.tier === 'Amber'
        ? {
            headline: 'நிழலில் ஓய்வெடுத்து தண்ணீர் குடியுங்கள்',
            explanation: `${context.zone} பகுதியில் வெப்ப அழுத்தம் உயர்கிறது.`,
            action: 'இப்போதே 15 நிமிடம் நிழலில் ஓய்வெடுத்து 300 ml குளிர்ந்த நீர் குடியுங்கள்.',
            proactiveForecastNote: buildLocalizedProactiveNote('ta', context, assessment, forecast),
            source: 'template_fallback',
            cached: false,
          }
        : {
            headline: 'வேலை செய்ய பாதுகாப்பானது — நீர் குடியுங்கள்',
            explanation: `${context.zone} பகுதியில் வெப்ப நிலை பாதுகாப்பான எல்லையில் உள்ளது.`,
            action: 'சீரான வேகத்தில் செயல்பட்டு 20 நிமிடத்திற்கு ஒருமுறை தண்ணீர் குடியுங்கள்.',
            proactiveForecastNote: buildLocalizedProactiveNote('ta', context, assessment, forecast),
            source: 'template_fallback',
            cached: false,
          };

  const ml: WorkerAlertCopy =
    assessment.tier === 'Red'
      ? {
          headline: 'ഉടൻ ജോലി നിർത്തുക — തണുപ്പിലേക്ക് മാറുക',
          explanation: `${context.zone} മേഖലയിൽ ഉയർന്ന ചൂട് സമ്മർദ്ദം കണ്ടെത്തി.`,
          action: 'ഉടൻ എസി വിശ്രമകേന്ദ്രത്തിലേക്ക് മാറി സുരക്ഷാ വസ്ത്രം അയച്ച് തണുത്ത വെള്ളം കുടിക്കുക.',
          proactiveForecastNote: buildLocalizedProactiveNote('ml', context, assessment, forecast),
          source: 'template_fallback',
          cached: false,
        }
      : assessment.tier === 'Amber'
        ? {
            headline: 'തണലിൽ വിശ്രമിച്ച് വെള്ളം കുടിക്കുക',
            explanation: `${context.zone} മേഖലയിൽ ചൂട് സമ്മർദ്ദം വർദ്ധിക്കുന്നു.`,
            action: 'ഇപ്പോൾ 15 മിനിറ്റ് തണലിൽ വിശ്രമിച്ച് 300 ml തണുത്ത വെള്ളം കുടിക്കുക.',
            proactiveForecastNote: buildLocalizedProactiveNote('ml', context, assessment, forecast),
            source: 'template_fallback',
            cached: false,
          }
        : {
            headline: 'ജോലി സുരക്ഷിതം — വെള്ളം കുടിച്ചുകൊണ്ടിരിക്കുക',
            explanation: `${context.zone} മേഖലയിലെ ചൂട് സുരക്ഷിത പരിധിയിലാണ്.`,
            action: 'സാധാരണ വേഗതയിൽ തുടരുക, ഓരോ 20 മിനിറ്റിലും വെള്ളം കുടിക്കുക.',
            proactiveForecastNote: buildLocalizedProactiveNote('ml', context, assessment, forecast),
            source: 'template_fallback',
            cached: false,
          };

  const ne: WorkerAlertCopy =
    assessment.tier === 'Red'
      ? {
          headline: 'तुरुन्त काम रोक्नुहोस् — चिसोमा जानुहोस्',
          explanation: `${context.zone} मा उच्च तापीय दबाब देखिएको छ।`,
          action: 'तुरुन्त एसी भएको छाया विश्रामस्थलमा जानुहोस्, PPE खुकुलो पार्नुहोस् र चिसो पानी पिउनुहोस्।',
          proactiveForecastNote: buildLocalizedProactiveNote('ne', context, assessment, forecast),
          source: 'template_fallback',
          cached: false,
        }
      : assessment.tier === 'Amber'
        ? {
            headline: 'छायामा आराम गर्नुहोस् र पानी पिउनुहोस्',
            explanation: `${context.zone} मा तापीय दबाब बढ्दैछ।`,
            action: 'अहिले १५ मिनेट छायामा विश्राम लिनुहोस् र ३०० ml चिसो पानी पिउनुहोस्।',
            proactiveForecastNote: buildLocalizedProactiveNote('ne', context, assessment, forecast),
            source: 'template_fallback',
            cached: false,
          }
        : {
            headline: 'काम गर्न सुरक्षित — पानी पिइरहनुहोस्',
            explanation: `${context.zone} मा तापीय दबाब सुरक्षित सीमाभित्र छ।`,
            action: 'सामान्य गतिमा काम गर्नुहोस् र हरेक २० मिनेटमा पानी पिउनुहोस्।',
            proactiveForecastNote: buildLocalizedProactiveNote('ne', context, assessment, forecast),
            source: 'template_fallback',
            cached: false,
          };

  const si: WorkerAlertCopy =
    assessment.tier === 'Red'
      ? {
          headline: 'වැඩ වහාම නවතන්න — සිසිල් වන්න',
          explanation: `${context.zone} ප්‍රදේශයේ ඉහළ තාප පීඩනයක් හඳුනාගෙන ඇත.`,
          action: 'වහාම AC සෙවණ විවේකාගාරයට ගොස් PPE ලිහිල් කර සිසිල් ජලය පානය කරන්න.',
          proactiveForecastNote: buildLocalizedProactiveNote('si', context, assessment, forecast),
          source: 'template_fallback',
          cached: false,
        }
      : assessment.tier === 'Amber'
        ? {
            headline: 'සෙවණේ විවේක ගෙන ජලය පානය කරන්න',
            explanation: `${context.zone} ප්‍රදේශයේ තාප පීඩනය වැඩි වෙමින් පවතී.`,
            action: 'දැන්ම විනාඩි 15ක් සෙවණේ විවේක ගෙන සිසිල් ජලය 300 ml පානය කරන්න.',
            proactiveForecastNote: buildLocalizedProactiveNote('si', context, assessment, forecast),
            source: 'template_fallback',
            cached: false,
          }
        : {
            headline: 'වැඩ කිරීමට ආරක්ෂිතයි — ජලය පානය කරන්න',
            explanation: `${context.zone} ප්‍රදේශයේ තාප මට්ටම ආරක්ෂිත සීමාව තුළ පවතී.`,
            action: 'සාමාන්‍ය වේගයෙන් වැඩ කරමින් සෑම විනාඩි 20 කට වරක් ජලය පානය කරන්න.',
            proactiveForecastNote: buildLocalizedProactiveNote('si', context, assessment, forecast),
            source: 'template_fallback',
            cached: false,
          };

  return { en: baseEn, ar, hi, ur, bn, tl, ta, ml, ne, si };
}

function normalizeUnicodeDigits(input: string): string {
  return input.replace(/[\u0966-\u096F\u0660-\u0669\u06F0-\u06F9\u09E6-\u09EF\u0BE6-\u0BEF\u0D66-\u0D6F]/g, (ch) => {
    const code = ch.charCodeAt(0);
    if (code >= 0x0966 && code <= 0x096f) return String(code - 0x0966);
    if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
    if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0);
    if (code >= 0x09e6 && code <= 0x09ef) return String(code - 0x09e6);
    if (code >= 0x0be6 && code <= 0x0bef) return String(code - 0x0be6);
    if (code >= 0x0d66 && code <= 0x0d6f) return String(code - 0x0d66);
    return ch;
  });
}

function extractEtaMinutesFromText(raw: string, stripHydrationBreaks: boolean): number[] {
  let text = normalizeUnicodeDigits(raw)
    .replace(/\bt\s*\+\s*(?:15|30)\b/gi, ' ')
    .replace(/\b30[-\s]+min(?:ute)?s?\s+(?:forecast\s+)?window\b/gi, ' ');

  if (stripHydrationBreaks) {
    // Do not confuse routine hydration/rest directives ("every 20 min", "15-min rest break") with crossing ETAs
    text = text
      .replace(
        /(?:every|per|كل|प्रत्येक|हर|ہر|প্রতি|tuwing|ஒவ்வொரு|ഓരോ|हरेक|සෑම)\s+(?:විනාඩි|මිනිත්තු)?\s*\d+\s*(?:min(?:ute)?s?|m\b|دقيقة|دقائق|मिनट|منٹ|مِنٹ|মিনিট|minuto|நிமிட[^\s,.]*|മിനിറ്റ്|മിനിറ്റിലും|मिनेट|කට\s*වරක්)?/gi,
        ' '
      )
      .replace(/\d+\s*நிமிட[^\s,.]*\s+ஒருமுறை/gi, ' ')
      .replace(/(?:විනාඩි|මිනිත්තු)\s+\d+\s*(?:කට\s*වරක්|ක්)?/gi, ' ')
      .replace(
        /\b\d+[-\s]+(?:min(?:ute)?s?|m\b|دقيقة|دقائق|मिनट|منٹ|مِنٹ|মিনিট|minuto|நிமிட(?:ம்)?|മിനിറ്റ്|मिनेट)\s+(?:rest|shade|break|shaded)/gi,
        ' '
      );
  }

  const values: number[] = [];
  const unitRegex =
    /~?\s*(\d+(?:\.\d+)?)\s*(?:min(?:ute)?s?|m\b|دقيقة|دقائق|मिनट|منٹ|مِنٹ|মিনিট|minuto|நிமிட(?:ம்|த்தில்|ங்களில்)?|മിനിറ്റ്|മിനിറ്റിൽ|मिनेट|විනාඩි|මිනිත්තු)/gi;
  let m: RegExpExecArray | null;
  while ((m = unitRegex.exec(text)) !== null) {
    const val = Number(m[1]);
    if (Number.isFinite(val)) values.push(val);
  }

  const crossingPhraseRegex =
    /(?:amber|red|threshold|limit|البرتقالي|الأحمر|अंबर|गंभीर|امبر|سرخ|সতর্ক|গুরুতর|ஆம்பர்|சிவப்பு|ആംബർ|റെഡ്|एम्बर|रातो|ඇම්බර්|රතු)\s+(?:in|within|after|sa|خلال)\s+~?(\d+(?:\.\d+)?)\b/gi;
  while ((m = crossingPhraseRegex.exec(text)) !== null) {
    const val = Number(m[1]);
    if (Number.isFinite(val)) values.push(val);
  }

  const siPrefixRegex = /(?:විනාඩි|මිනිත්තු)\s*~?(\d+(?:\.\d+)?)\s*(?:කින්|කට)?/gi;
  while ((m = siPrefixRegex.exec(text)) !== null) {
    const val = Number(m[1]);
    if (Number.isFinite(val)) values.push(val);
  }

  return values;
}

const THRESHOLD_CROSSING_INTENT_REGEX =
  /amber|red|threshold|cross|reach|projected|forecast|escalat|stop-work|البرتقالي|الأحمر|متوقع|تجاوز|अंबर|गंभीर|संभावित|امبر|متوقع|سنگین|সতর্ক|গুরুতর|সম্ভাব্য|inaasahan|umabot|ஆம்பர்|சிவப்பு|கணிப்பு|ആംബർ|റെഡ്|പ്രവചനം|एम्बर|रातो|अनुमान|ඇම්බර්|රතු|සීමාව|පුරෝකථනය/i;

/**
 * SERVER-SIDE RESPONSIBLE AI GUARD:
 * Validates LLM-generated alert text across ALL 10 Dubai/UAE languages against deterministic ForecastOutput.
 * If Gemini fabricates a crossing minute ETA when ETAs are null/falling, or diverges >±2 min
 * from projectedAmberCrossingMin/projectedRedCrossingMin, the offending field is discarded
 * and replaced with the deterministic template built directly from structured engine fields.
 */
export function enforceDeterministicForecastEtaGuard(
  copyMap: Record<SupportedLanguage, WorkerAlertCopy>,
  forecast: ForecastOutput,
  fallbackMap: Record<SupportedLanguage, WorkerAlertCopy>
): Record<SupportedLanguage, WorkerAlertCopy> {
  const allowedEtas: number[] = [];
  const positiveSlope = forecast.slopePerMin === null || forecast.slopePerMin > 0.015;
  if (forecast.status === 'ready' && positiveSlope) {
    if (forecast.projectedAmberCrossingMin !== null && forecast.projectedAmberCrossingMin > 0) {
      allowedEtas.push(forecast.projectedAmberCrossingMin);
    }
    if (forecast.projectedRedCrossingMin !== null && forecast.projectedRedCrossingMin > 0) {
      allowedEtas.push(forecast.projectedRedCrossingMin);
    }
  }

  const isClaimAllowed = (minutesClaim: number): boolean =>
    allowedEtas.some((eta) => Math.abs(minutesClaim - eta) <= 2);

  const sanitized = { ...copyMap };
  const violations: string[] = [];

  for (const lang of SUPPORTED_LANGUAGES) {
    const entry = sanitized[lang] ?? fallbackMap[lang];
    const fb = fallbackMap[lang];
    let nextEntry = { ...entry };

    // 1. Strict check on proactiveForecastNote
    if (nextEntry.proactiveForecastNote) {
      const noteClaims = extractEtaMinutesFromText(nextEntry.proactiveForecastNote, false);
      const invalidNote =
        (allowedEtas.length === 0 && noteClaims.length > 0) ||
        noteClaims.some((n) => !isClaimAllowed(n));

      if (invalidNote) {
        violations.push(`${lang}.proactiveForecastNote(${noteClaims.join(',')})`);
        nextEntry = {
          ...nextEntry,
          proactiveForecastNote: fb.proactiveForecastNote,
        };
      }
    }

    // 2. Check headline, explanation, action for fabricated time-to-threshold ETAs
    for (const field of ['headline', 'explanation', 'action'] as const) {
      const val = nextEntry[field];
      const claims = extractEtaMinutesFromText(val, true);
      if (claims.length === 0) continue;

      const hasCrossingContext = THRESHOLD_CROSSING_INTENT_REGEX.test(val);
      const hasInvalidClaim = claims.some((n) => !isClaimAllowed(n));
      if (hasInvalidClaim && (hasCrossingContext || allowedEtas.length === 0)) {
        violations.push(`${lang}.${field}(${claims.join(',')})`);
        nextEntry = {
          ...nextEntry,
          [field]: fb[field],
        };
      }
    }

    sanitized[lang] = nextEntry;
  }

  if (violations.length > 0) {
    console.warn(
      `[GeminiService][ETA-Guard] Replaced fabricated/inconsistent forecast ETAs (${violations.join('; ')}); allowedEtas=[${allowedEtas.join(',')}]`
    );
  }

  return sanitized;
}

/**
 * USE CASE 1 + 5 + 2 Combined & Cached Pipeline (Single gemini-4-hydrogen Call):
 * 1) Explains PSI + environmental factors & contextualizes deterministic forecast (Use Case 1 & 5)
 * 2) Renders natural translations in English, Hindi, Urdu, Bengali, and Tagalog (Use Case 2)
 */
async function explainAndTranslateWorkerAlert(
  ai: GoogleGenAI,
  context: WorkerContext,
  assessment: RiskAssessment,
  forecast: ForecastOutput,
  env: EnvironmentalObservation
): Promise<Record<SupportedLanguage, WorkerAlertCopy>> {
  const structuredForecast = {
    status: forecast.status,
    psiNow: forecast.psiNow,
    psi15Point: forecast.psi15?.point ?? null,
    predictedTier15: forecast.predictedTier15,
    psi30Point: forecast.psi30?.point ?? null,
    predictedTier30: forecast.predictedTier30,
    projectedAmberCrossingMin: forecast.status === 'ready' ? forecast.projectedAmberCrossingMin : null,
    projectedRedCrossingMin: forecast.status === 'ready' ? forecast.projectedRedCrossingMin : null,
    slopePerMin: forecast.slopePerMin,
  };

  const forecastSummary =
    forecast.status === 'ready'
      ? `Deterministic forecast: current=${forecast.psiNow}/10, t+15=${forecast.psi15?.point} (90% CI ${forecast.psi15?.low}–${forecast.psi15?.high}, tier ${forecast.predictedTier15}), t+30=${forecast.psi30?.point} (tier ${forecast.predictedTier30}), projected Amber crossing in ${forecast.projectedAmberCrossingMin ?? 'none'} min, Red crossing in ${forecast.projectedRedCrossingMin ?? 'none'} min.`
      : `Forecast status: insufficient trend data (${forecast.reason}). Do not invent a crossing time.`;

  const prompt = `You are SiteGuard's worker safety communicator for UAE (Dubai & Abu Dhabi) outdoor industrial crews.
Generate a calm, clear, non-alarming alert in English (en), plus accurate natural everyday translations in Arabic (ar), Hindi (hi), Urdu (ur), Bengali (bn), Tagalog (tl), Tamil (ta), Malayalam (ml), Nepali (ne), and Sinhala (si). Keep numbers and units exact.

Worker context: Role=${context.roleLabel}, Zone=${context.zone}, PPE=${context.ppeLevel}, Acclimatization=${context.acclimatizationDays} days, Hydration count=${context.hydrationCount}, Planned break=${context.plannedBreakTime}.
Current environment: Air ${env.airTempC}°C, Outdoor WBGT ${env.wbgtC}°C, UAE Midday Break active=${env.inUaeMiddayBreakWindow}.
Deterministic risk assessment: Tier=${assessment.tier}, Composite=${assessment.compositeScore}/10, Mode=${assessment.scoringMode}${assessment.degradedReason ? ` (Degraded due to: ${assessment.degradedReason})` : ''}.
Factors: ${assessment.contributingFactors.join('; ')}.
${forecastSummary}
Structured forecast JSON: ${JSON.stringify(structuredForecast)}

STRICT SAFETY RULES FOR THRESHOLD ETAs (NEVER VIOLATE):
1. projectedAmberCrossingMin and projectedRedCrossingMin above are the ONLY valid threshold-crossing times.
2. When BOTH projectedAmberCrossingMin and projectedRedCrossingMin are null (or slopePerMin <= 0.015), you MUST NOT mention any crossing minute number or invent an ETA like "in 1 minute" or "in 36 minutes" in ANY field. Instead, state clearly that no Amber/Red crossing is currently projected within the 30-minute window (or return "" if Red tier).
3. When forecast.status is "insufficient_trend_data", never state any minute ETA.
4. headline, explanation, and action must never state a crossing ETA that contradicts projectedAmberCrossingMin / projectedRedCrossingMin.

For each language (en, ar, hi, ur, bn, tl, ta, ml, ne, si), provide:
- headline: max 6 words, uppercase clarity, calm safety directive
- explanation: 1 short sentence explaining why in plain words (no jargon like "Moran PSI")
- action: 1 concrete immediate action sentence
- proactiveForecastNote: if projectedAmberCrossingMin or projectedRedCrossingMin is a positive integer, write 1 specific proactive sentence citing that exact minute value with upcoming break/hydration context; if both are null (or negative/flat trend), explicitly write "No Amber/Red crossing currently projected" translated naturally (or "" in Red tier).`;

  const res = await withRetry(() =>
    withTimeout(
      ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              en: makeAlertCopySchema(),
              ar: makeAlertCopySchema(),
              hi: makeAlertCopySchema(),
              ur: makeAlertCopySchema(),
              bn: makeAlertCopySchema(),
              tl: makeAlertCopySchema(),
              ta: makeAlertCopySchema(),
              ml: makeAlertCopySchema(),
              ne: makeAlertCopySchema(),
              si: makeAlertCopySchema(),
            },
            required: ['en', 'ar', 'hi', 'ur', 'bn', 'tl', 'ta', 'ml', 'ne', 'si'],
          },
        },
      }),
      8500
    )
  );

  const parsed = JSON.parse((res.text ?? '{}').trim()) as Partial<
    Record<
      SupportedLanguage,
      {
        headline: string;
        explanation: string;
        action: string;
        proactiveForecastNote?: string;
      }
    >
  >;

  const fallbackMap = buildDeterministicFallback(context, assessment, forecast);

  const normalize = (
    lang: SupportedLanguage,
    entry?: {
      headline?: string;
      explanation?: string;
      action?: string;
      proactiveForecastNote?: string;
    }
  ): WorkerAlertCopy => {
    if (!entry || !entry.headline) {
      return fallbackMap[lang];
    }
    const note = entry.proactiveForecastNote?.trim();
    return {
      headline: entry.headline,
      explanation: entry.explanation || fallbackMap[lang].explanation,
      action: entry.action || fallbackMap[lang].action,
      proactiveForecastNote: note ? note : null,
      source: 'gemini',
      cached: false,
    };
  };

  const rawMap = {} as Record<SupportedLanguage, WorkerAlertCopy>;
  for (const lang of SUPPORTED_LANGUAGES) {
    rawMap[lang] = normalize(lang, parsed[lang]);
  }

  return enforceDeterministicForecastEtaGuard(rawMap, forecast, fallbackMap);
}

export async function getMultilingualWorkerAlert(
  context: WorkerContext,
  assessment: RiskAssessment,
  forecast: ForecastOutput,
  env: EnvironmentalObservation
): Promise<Record<SupportedLanguage, WorkerAlertCopy>> {
  const fallback = buildDeterministicFallback(context, assessment, forecast);
  const key = buildCacheKey(assessment, forecast, context);
  const existing = alertCache.get(key);
  if (existing) {
    // Defensive re-guard even on cached entries
    const guarded = enforceDeterministicForecastEtaGuard(existing, forecast, fallback);
    const cachedResult = { ...guarded };
    for (const lang of Object.keys(cachedResult) as SupportedLanguage[]) {
      cachedResult[lang] = { ...cachedResult[lang], cached: true };
    }
    return cachedResult;
  }

  const cooldown = fallbackCooldown.get(key);
  if (cooldown && cooldown.expiresAt > Date.now()) {
    return cooldown.data;
  }

  const ai = getClient();
  if (!ai) {
    lastGeminiDiagnostic = 'no_api_key';
    return fallback;
  }

  if (Date.now() < dailyQuotaCooldownUntil || Date.now() < transientCooldownUntil) {
    lastGeminiDiagnostic = Date.now() < dailyQuotaCooldownUntil ? 'quota_exhausted' : 'fallback';
    return fallback;
  }

  const pending = inFlightAlerts.get(key);
  if (pending) {
    return pending;
  }

  const run = (async (): Promise<Record<SupportedLanguage, WorkerAlertCopy>> => {
    try {
      const result = await explainAndTranslateWorkerAlert(ai, context, assessment, forecast, env);
      alertCache.set(key, result);
      fallbackCooldown.delete(key);
      transientCooldownUntil = 0;
      lastGeminiDiagnostic = 'ok';
      return result;
    } catch (err) {
      if (isDailyQuotaError(err)) {
        dailyQuotaCooldownUntil = Date.now() + 5 * 60_000;
        lastGeminiDiagnostic = 'quota_exhausted';
      } else {
        transientCooldownUntil = Date.now() + 30_000;
        lastGeminiDiagnostic = 'fallback';
        console.info(`[GeminiService] Fallback templates applied (${err instanceof Error ? err.message : String(err)})`);
      }
      fallbackCooldown.set(key, { data: fallback, expiresAt: Date.now() + 60_000 });
      return fallback;
    } finally {
      inFlightAlerts.delete(key);
    }
  })();

  inFlightAlerts.set(key, run);
  return run;
}

/**
 * USE CASE 6: Immediate Worker Voice Safety Incident Transcription (gemini-3.5-transcribe).
 * Accepts recorded audio (base64 + mimeType) and transcribes spoken safety incident reports
 * in en/hi/ur/bn/tl cleanly on the server, falling back gracefully if quota-exhausted or offline.
 */
export async function transcribeWorkerVoiceIncident(params: {
  audioBase64?: string;
  mimeType?: string;
  language?: SupportedLanguage;
  fallbackTranscript?: string;
}): Promise<{
  transcript: string;
  source: 'gemini_transcribe' | 'browser_speech' | 'manual_note';
}> {
  const cleanFallback = (params.fallbackTranscript ?? '').trim();
  const base64Data = (params.audioBase64 ?? '').replace(/^data:[^;]+;base64,/, '').trim();
  const mimeType = (params.mimeType || 'audio/webm').split(';')[0].trim() || 'audio/webm';

  const ai = getClient();
  if (base64Data && ai && Date.now() >= dailyQuotaCooldownUntil) {
    try {
      const res = await withRetry(() =>
        withTimeout(
          ai.models.generateContent({
            model: 'gemini-3.5-transcribe',
            contents: {
              parts: [
                {
                  inlineData: {
                    mimeType,
                    data: base64Data,
                  },
                },
                {
                  text: `Transcribe this short industrial worker safety incident voice note accurately (preferred language hint: ${params.language ?? 'en'}). Return only the clean plain-text transcript without timestamps or speaker labels.`,
                },
              ],
            },
          }),
          20000
        )
      );
      const transcribed = (res.text ?? '').trim();
      if (transcribed.length > 0) {
        lastGeminiDiagnostic = 'ok';
        return { transcript: transcribed.slice(0, 500), source: 'gemini_transcribe' };
      }
    } catch (err) {
      if (isDailyQuotaError(err)) {
        dailyQuotaCooldownUntil = Date.now() + 5 * 60_000;
        lastGeminiDiagnostic = 'quota_exhausted';
      } else {
        lastGeminiDiagnostic = 'fallback';
        console.info(
          `[GeminiService] Voice transcription fallback (${err instanceof Error ? err.message : String(err)})`
        );
      }
    }
  }

  if (cleanFallback.length > 0) {
    return {
      transcript: cleanFallback.slice(0, 500),
      source: 'browser_speech',
    };
  }

  return {
    transcript: 'Worker submitted an immediate voice safety incident alert for supervisor review.',
    source: 'manual_note',
  };
}

/**
 * USE CASE 3: Synthetic Physiological Cohort Generation via Gemini (gemini-4-hydrogen).
 * Generates worker-day parameter profiles calibrated to cross ACGIH/NIOSH thresholds,
 * tagged explicitly with `source: 'SYNTHETIC_PHYSIOLOGICAL_COHORT'` and `generator: 'gemini_synthesized'`.
 */
export async function generateSyntheticCohortViaGemini(
  count = 12
): Promise<{ cohort: SyntheticWorkerDay[]; source: 'gemini' | 'deterministic_fallback' }> {
  const ai = getClient();
  if (!ai || Date.now() < dailyQuotaCooldownUntil) {
    if (Date.now() < dailyQuotaCooldownUntil) {
      lastGeminiDiagnostic = 'quota_exhausted';
    }
    return { cohort: [], source: 'deterministic_fallback' };
  }

  try {
    const prompt = `Generate ${count} realistic industrial heat-stress worker-day profiles for a UAE summer construction validation cohort (08:00–12:00 GST).
Roughly 65% should gradually escalate across ACGIH/NIOSH thresholds (Amber at ~90–140 min, Red PSI>=7.0 at ~130–200 min) and 35% should stay safely paced.
Return JSON array of worker profiles with: roleLabel, ppeLevel ("Standard Coverall" | "FR / Arc-Flash" | "Chemical / Tyvek"), acclimatizationDays (1..25), ageYears (22..52), hr0 (62..82), tc0 (36.6..36.9), peakHr (120..182), peakSkinTempC (34.8..37.9), escalationMinute (45..160 or 999 if no escalation).`;

    const res = await withRetry(() =>
      withTimeout(
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: prompt,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              roleLabel: { type: Type.STRING },
              ppeLevel: { type: Type.STRING },
              acclimatizationDays: { type: Type.INTEGER },
              ageYears: { type: Type.INTEGER },
              hr0: { type: Type.INTEGER },
              tc0: { type: Type.NUMBER },
              peakHr: { type: Type.INTEGER },
              peakSkinTempC: { type: Type.NUMBER },
              escalationMinute: { type: Type.INTEGER },
            },
            required: [
              'roleLabel',
              'ppeLevel',
              'acclimatizationDays',
              'ageYears',
              'hr0',
              'tc0',
              'peakHr',
              'peakSkinTempC',
                  'escalationMinute',
                ],
              },
            },
          },
        }),
        25000
      )
    );

    const specs = JSON.parse((res.text ?? '[]').trim()) as Array<{
      roleLabel: string;
      ppeLevel: string;
      acclimatizationDays: number;
      ageYears: number;
      hr0: number;
      tc0: number;
      peakHr: number;
      peakSkinTempC: number;
      escalationMinute: number;
    }>;

    const cohort: SyntheticWorkerDay[] = specs.slice(0, count).map((spec, idx) => {
      const ppe =
        spec.ppeLevel === 'Chemical / Tyvek' || spec.ppeLevel === 'FR / Arc-Flash'
          ? spec.ppeLevel
          : 'Standard Coverall';
      const points = [];
      for (let m = 0; m <= 240; m += 3) {
        const progress =
          spec.escalationMinute < 240
            ? Math.max(0, Math.min(1, (m - Math.max(15, spec.escalationMinute - 60)) / 110))
            : Math.min(0.45, m / 240);
        const hrBpm = Math.round(spec.hr0 + 14 + progress * (spec.peakHr - spec.hr0 - 14));
        const skinTempC = Number((33.5 + progress * (spec.peakSkinTempC - 33.5)).toFixed(2));
        const wbgtC = Number((32.0 + (m / 240) * 3.8).toFixed(2));
        const hrMax = Math.round(208 - 0.7 * spec.ageYears);
        const tcProxy = 36.8 + (skinTempC - 33.5) * 0.68;
        const psi =
          5 * ((hrBpm - spec.hr0) / Math.max(20, hrMax - spec.hr0)) +
          5 * ((tcProxy - spec.tc0) / Math.max(0.5, 39.5 - spec.tc0));

        points.push({
          minute: m,
          hrBpm,
          skinTempC,
          exertionIndex: Number((4.0 + progress * 4.5).toFixed(1)),
          wbgtC,
          trueHeatExhaustionEvent: psi >= 7.0,
        });
      }

      return {
        trajectoryId: `GEM-SYN-${String(idx + 1).padStart(3, '0')}`,
        source: 'SYNTHETIC_PHYSIOLOGICAL_COHORT',
        generator: 'gemini_synthesized',
        roleLabel: spec.roleLabel,
        ppeLevel: ppe,
        acclimatizationDays: Math.max(1, Math.min(30, spec.acclimatizationDays)),
        ageYears: Math.max(20, Math.min(60, spec.ageYears)),
        hr0: Math.max(55, Math.min(90, spec.hr0)),
        tc0: Number(Math.max(36.4, Math.min(37.1, spec.tc0)).toFixed(2)),
        points,
      };
    });

    lastGeminiDiagnostic = 'ok';
    return { cohort, source: 'gemini' };
  } catch (err) {
    if (isDailyQuotaError(err)) {
      dailyQuotaCooldownUntil = Date.now() + 5 * 60_000;
      lastGeminiDiagnostic = 'quota_exhausted';
    } else {
      lastGeminiDiagnostic = 'fallback';
      console.info(`[GeminiService] Synthetic cohort fallback (${err instanceof Error ? err.message : String(err)})`);
    }
    return { cohort: [], source: 'deterministic_fallback' };
  }
}

/**
 * USE CASE 4: Compliance Report Plain-Language Narrative Summary (gemini-4-hydrogen).
 * Turns structured UAE Midday Working Break compliance logs into a bilingual (EN/AR)
 * executive audit summary + actionable remediation checklist.
 */
export async function generateComplianceNarrative(params: {
  siteName: string;
  env: EnvironmentalObservation;
  breaks: BreakRecord[];
  incidents: IncidentLogEntry[];
  insurerRef: string;
  language?: 'en' | 'ar';
}): Promise<{
  narrative: string;
  language: 'en' | 'ar';
  remediationActions: string[];
  auditReadinessStatus: 'Audit Ready' | 'Remediation Needed';
  source: 'gemini' | 'template_fallback';
}> {
  const lang: 'en' | 'ar' = params.language === 'ar' ? 'ar' : 'en';
  const compliantCount = params.breaks.filter((b) => b.compliant).length;
  const pendingWorkers = params.breaks.filter((b) => !b.compliant);
  const totalCrew = params.breaks.length;
  const degradedEvents = params.incidents.filter(
    (i) => i.eventType === 'sensor_degradation' || i.eventType === 'gps_loss'
  ).length;
  const redEvents = params.incidents.filter((i) => i.severity === 'Red').length;
  const auditReadinessStatus: 'Audit Ready' | 'Remediation Needed' =
    pendingWorkers.length === 0 && redEvents === 0 ? 'Audit Ready' : 'Remediation Needed';

  const fallbackRemediation: string[] =
    lang === 'ar'
      ? pendingWorkers.length > 0
        ? [
            `جدولة استراحة ظل إلزامية فوراً لـ ${pendingWorkers.map((w) => w.workerId).join('، ')} لإتمام متطلبات فترة الراحة.`,
            `توثيق ${redEvents} إشعار توقف عمل ومراجعة جاهزية محطات التبريد قبل 12:30 بتوقيت الإمارات.`,
            `تأكيد استمرارية المراقبة الاحتياطية لعدد ${degradedEvents} حدث تدهور مستشعرات.`,
          ]
        : [
            'الالتزام كامل بنسبة 100% — حفظ السجل الموقّع لمراجعة وزارة الموارد البشرية والتوطين (MOHRE).',
            'الاستمرار في نقاط الترطيب كل 20 دقيقة خلال نافذة الظهيرة.',
          ]
      : pendingWorkers.length > 0
        ? [
            `Dispatch immediate shaded break completion for ${pendingWorkers.map((w) => `${w.workerId} (${w.zone})`).join(', ')}.`,
            `Verify AC recovery log closure for ${redEvents} Red stop-work escalation(s) prior to 12:30–15:00 GST audit lock.`,
            `Inspect wearable BLE/sensor health for ${degradedEvents} degraded telemetry event(s) at shift handover.`,
          ]
        : [
            '100% break compliance achieved — archive signed JSON/PDF bundle for UAE MOHRE & occupational insurer review.',
            'Maintain 20-minute electrolyte hydration cadence and automated WBGT threshold watch.',
          ];

  const fallbackNarrative =
    lang === 'ar'
      ? `ملخص الامتثال لمنصة SiteGuard لموقع ${params.siteName} (المرجع: ${params.insurerRef || 'UAE-MOHRE-2026'}): في ظل ظروف ${params.env.station} (حرارة الهواء ${params.env.airTempC}°C، مؤشر WBGT الخارجي ${params.env.wbgtC}°C)، استوفى ${compliantCount} من أصل ${totalCrew} عاملاً متطلبات فترة الراحة الإلزامية في الإمارات (12:30–15:00 GST). تم تسجيل ${redEvents} تنبيه توقف عمل حرج و${degradedEvents} حدث حماية احتياطية للمستشعرات بدون أي بيانات حيوية شخصية.`
      : `SiteGuard Compliance Summary for ${params.siteName} (Ref: ${params.insurerRef || 'UAE-MOHRE-2026'}): Under ${params.env.station} conditions (${params.env.airTempC}°C air, ${params.env.wbgtC}°C outdoor WBGT), ${compliantCount} of ${totalCrew} monitored crew members met the mandatory UAE Midday Working Break requirement (12:30–15:00 GST). ${redEvents} critical stop-work escalation(s) and ${degradedEvents} wearable sensor degradation event(s) were logged with automatic environment-only fallback protection.`;

  const ai = getClient();
  if (!ai || Date.now() < dailyQuotaCooldownUntil) {
    if (Date.now() < dailyQuotaCooldownUntil) {
      lastGeminiDiagnostic = 'quota_exhausted';
    }
    return {
      narrative: fallbackNarrative,
      language: lang,
      remediationActions: fallbackRemediation,
      auditReadinessStatus,
      source: 'template_fallback',
    };
  }

  try {
    const prompt = `Write an auditor-ready UAE MOHRE Ministerial Resolution No. 44 of 2022 executive compliance summary in ${lang === 'ar' ? 'Arabic (العربية)' : 'English'} (3–4 sentences, max 95 words) plus 2–3 concrete corrective remediation checklist items.
PRIVACY RULE: Never mention personal names or raw heart rate / skin temp / PSI numbers (use worker IDs/roles and zone break counts only).
Facts:
- Site: ${params.siteName}, Insurer/Regulator Reference: ${params.insurerRef || 'Pending'}
- Weather: ${params.env.station}, Air Temp ${params.env.airTempC}°C, Outdoor WBGT ${params.env.wbgtC}°C, Midday Break Window (12:30-15:00 GST) active=${params.env.inUaeMiddayBreakWindow}
- Break Compliance: ${compliantCount}/${totalCrew} workers compliant (${pendingWorkers.map((w) => w.workerId).join(', ') || 'none pending'})
- Logged Events: ${params.incidents.length} total events (${redEvents} Red stop-work alerts, ${degradedEvents} sensor degradation fallbacks).`;

    const res = await withRetry(() =>
      withTimeout(
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: prompt,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                narrative: { type: Type.STRING },
                remediationActions: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
              },
              required: ['narrative', 'remediationActions'],
            },
          },
        }),
        18000
      )
    );

    const parsed = JSON.parse((res.text ?? '{}').trim()) as {
      narrative?: string;
      remediationActions?: string[];
    };

    lastGeminiDiagnostic = 'ok';
    return {
      narrative: (parsed.narrative?.trim() || fallbackNarrative).slice(0, 900),
      language: lang,
      remediationActions:
        Array.isArray(parsed.remediationActions) && parsed.remediationActions.length > 0
          ? parsed.remediationActions.slice(0, 4)
          : fallbackRemediation,
      auditReadinessStatus,
      source: 'gemini',
    };
  } catch (err) {
    if (isDailyQuotaError(err)) {
      dailyQuotaCooldownUntil = Date.now() + 5 * 60_000;
      lastGeminiDiagnostic = 'quota_exhausted';
    } else {
      lastGeminiDiagnostic = 'fallback';
      console.info(
        `[GeminiService] Compliance narrative fallback (${err instanceof Error ? err.message : String(err)})`
      );
    }
    return {
      narrative: fallbackNarrative,
      language: lang,
      remediationActions: fallbackRemediation,
      auditReadinessStatus,
      source: 'template_fallback',
    };
  }
}

/**
 * USE CASE 7: Privacy-Enforced Supervisor AI Shift Triage & Crew Dispatch Briefing (gemini-4-hydrogen).
 * Consumes ONLY anonymized WorkerStatusPublic tiers, zones, breaks, and crossing forecasts.
 * Strictly strips any accidental bpm / PSI-<digit> / vital-sign phrases before returning.
 */
function sanitizeSupervisorSafeText(text: string): string {
  return text
    .replace(/\b\d+\s*bpm\b/gi, 'elevated strain')
    .replace(/\b(?:PSI|HR0|HRmax|Tc\s*proxy|Borg)\s*[:=]?\s*\d+(?:\.\d+)?/gi, 'strain band')
    .trim();
}

export async function generateSupervisorShiftBriefing(params: {
  crew: WorkerStatusPublic[];
  alerts: IncidentLogEntry[];
  env: EnvironmentalObservation;
  language?: SupportedLanguage;
}): Promise<SupervisorAiBriefing> {
  const language: SupportedLanguage = params.language ?? 'en';
  const redUnits = params.crew.filter((w) => w.tier === 'Red' || w.lastCheckIn?.status === 'help');
  const amberUnits = params.crew.filter((w) => w.tier === 'Amber');
  const upcomingAmber = params.crew.filter(
    (w) => w.tier === 'Green' && w.projectedAmberCrossingMin !== null && w.projectedAmberCrossingMin <= 25
  );
  const standbyUnits = params.crew.filter(
    (w) => w.tier === 'Green' && w.acclimatizationDays >= 14 && (w.projectedAmberCrossingMin === null || w.projectedAmberCrossingMin > 25)
  );

  const zoneCounts = new Map<string, number>();
  for (const u of [...redUnits, ...amberUnits]) {
    zoneCounts.set(u.zone, (zoneCounts.get(u.zone) ?? 0) + 1);
  }
  const topZone =
    Array.from(zoneCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ??
    params.crew[0]?.zone ??
    'Zone A';

  const fallbackBriefing = (): SupervisorAiBriefing => {
    if (language === 'ar') {
      return {
        language,
        executiveSummary: `ملخص المناوبة (WBGT ${params.env.wbgtC}°C): يوجد ${redUnits.length} حالة حرجة حمراء و${amberUnits.length} حالة برتقالية، مع ${upcomingAmber.length} وحدة تقترب من حد التحذير البرتقالي.`,
        priorityActions: [
          redUnits.length > 0
            ? `سحب فوري للوحدات (${redUnits.map((u) => u.workerId).join('، ')}) إلى خيمة التبريد المكيفة وإصدار أمر توقف عمل.`
            : 'لا توجد حالات إيقاف عمل حرجة حالياً — الحفاظ على مراقبة الظل.',
          amberUnits.length > 0
            ? `تطبيق استراحة 15 دقيقة وتدوير المهام للوحدات (${amberUnits.map((u) => u.workerId).join('، ')}) بمناوبة ${standbyUnits.map((u) => u.workerId).slice(0, 2).join('، ') || 'الاحتياط'}.`
            : 'متابعة جدول الترطيب كل 20 دقيقة عبر جميع المناطق.',
          upcomingAmber.length > 0
            ? `تبديل وقائي مبكر للوحدات (${upcomingAmber.map((u) => `${u.workerId} خلال ~${u.projectedAmberCrossingMin}د`).join('، ')}) قبل تصاعد الإجهاد.`
            : 'اتجاهات بقية الفريق مستقرة ضمن النطاق الآمن.',
        ],
        zoneFocus: `أولوية المراقبة الميدانية: ${topZone} بسبب تركز الإجهاد الحراري ومستوى معدات الوقاية.`,
        heatWindowAdvice: params.env.inUaeMiddayBreakWindow
          ? 'فترة حظر العمل وقت الظهيرة في الإمارات نشطة الآن (12:30–15:00 GST) — إلزامي التوقف الكامل تحت أشعة الشمس.'
          : `درجة WBGT الخارجية ${params.env.wbgtC}°C — تجهيز جداول التدوير قبل دخول نافذة الظهيرة الإماراتية.`,
        source: 'template_fallback',
        generatedAt: new Date().toISOString(),
      };
    }

    if (language === 'ta') {
      return {
        language,
        executiveSummary: `மேற்பார்வை சுருக்கம் (WBGT ${params.env.wbgtC}°C): ${redUnits.length} சிவப்பு அவசர அலகுகள், ${amberUnits.length} ஆம்பர் எச்சரிக்கை அலகுகள் மற்றும் ${upcomingAmber.length} முன்னறிவிப்பு சுழற்சி அலகுகள் உள்ளன.`,
        priorityActions: [
          redUnits.length > 0
            ? `${redUnits.map((u) => u.workerId).join(', ')} அலகுகளை உடனே குளிரூட்டப்பட்ட ஓய்வறைக்கு மாற்றவும்.`
            : 'தற்போது சிவப்பு நிறுத்த அலகுகள் இல்லை — நிலையான நிழல் கண்காணிப்பு தொடரவும்.',
          amberUnits.length > 0
            ? `${amberUnits.map((u) => u.workerId).join(', ')} அலகுகளுக்கு 15 நிமிட நிழல் ஓய்வு வழங்கி ${standbyUnits.map((u) => u.workerId).slice(0, 2).join(', ') || 'மாற்று'} குழுவுடன் சுழற்சி செய்யவும்.`
            : 'அனைத்து மண்டலங்களிலும் 20 நிமிட நீரேற்ற இடைவேளையைத் தொடரவும்.',
          upcomingAmber.length > 0
            ? `முன்கூட்டியே ${upcomingAmber.map((u) => `${u.workerId} (~${u.projectedAmberCrossingMin}m)`).join(', ')} அலகுகளுக்கு நிழல் மாற்றம் திட்டமிடவும்.`
            : 'மற்ற குழுவினரின் வெப்ப நிலை பாதுகாப்பான வரம்பில் உள்ளது.',
        ],
        zoneFocus: `முதன்மை மண்டலம்: ${topZone} (PPE மற்றும் வெப்ப அழுத்த செறிவு).`,
        heatWindowAdvice: params.env.inUaeMiddayBreakWindow
          ? 'UAE மதிய வேலை தடை நேரம் (12:30–15:00 GST) செயல்பாட்டில் உள்ளது — திறந்தவெளி வேலை முற்றிலும் நிறுத்தம்.'
          : `வெளிப்புற WBGT ${params.env.wbgtC}°C — மதிய தடை நேரத்திற்கு முன் சுழற்சி அட்டவணையை உறுதிப்படுத்தவும்.`,
        source: 'template_fallback',
        generatedAt: new Date().toISOString(),
      };
    }

    return {
      language,
      executiveSummary: `Shift Triage under ${params.env.wbgtC}°C WBGT: ${redUnits.length} critical Red unit(s), ${amberUnits.length} elevated Amber unit(s), and ${upcomingAmber.length} Green unit(s) approaching proactive break thresholds.`,
      priorityActions: [
        redUnits.length > 0
          ? `Immediate AC recovery pull & stop-work check for ${redUnits.map((u) => `${u.workerId} (${u.zone})`).join(', ')}.`
          : 'No active Red stop-work alerts; maintain shaded rotation cadence.',
        amberUnits.length > 0
          ? `Assign 15-min shaded break to ${amberUnits.map((u) => u.workerId).join(', ')} and backfill with acclimatized standby (${standbyUnits.map((u) => u.workerId).slice(0, 2).join(', ') || 'Zone D'}).`
          : 'Continue standard 20-min hydration cadence across active zones.',
        upcomingAmber.length > 0
          ? `Pre-empt Amber crossing via early shade swap for ${upcomingAmber.map((u) => `${u.workerId} (~${u.projectedAmberCrossingMin}m ETA)`).join(', ')}.`
          : 'All remaining units show stable prospective strain trends.',
      ],
      zoneFocus: `Highest thermal risk concentration in ${topZone}; audit heavy PPE compliance and shaded hydration proximity.`,
      heatWindowAdvice: params.env.inUaeMiddayBreakWindow
        ? 'UAE Midday Break window (12:30–15:00 GST) is ACTIVE — enforce full direct-sun work halt.'
        : `Outdoor WBGT ${params.env.wbgtC}°C (${params.env.sourceLabel}) — stage crew swaps ahead of peak solar load.`,
      source: 'template_fallback',
      generatedAt: new Date().toISOString(),
    };
  };

  const ai = getClient();
  if (!ai || Date.now() < dailyQuotaCooldownUntil) {
    if (Date.now() < dailyQuotaCooldownUntil) {
      lastGeminiDiagnostic = 'quota_exhausted';
    }
    return fallbackBriefing();
  }

  try {
    const safeCrewSummary = params.crew.map((w) => ({
      workerId: w.workerId,
      role: w.roleLabel,
      zone: w.zone,
      ppe: w.ppeLevel,
      acclimatizationDays: w.acclimatizationDays,
      tier: w.tier,
      predictedTier15: w.predictedTier15,
      amberEtaMin: w.projectedAmberCrossingMin,
      breaksTakenMin: w.breaksTakenTodayMin,
      sosHelp: w.lastCheckIn?.status === 'help',
      faults: w.faultSummary,
    }));
    const recentIncidents = params.alerts.slice(0, 5).map((a) => ({
      workerId: a.workerId,
      severity: a.severity,
      type: a.eventType,
      zone: a.zone,
    }));

    const prompt = `You are SiteGuard's HSE Supervisor Dispatch Co-Pilot for a Dubai/Abu Dhabi industrial site.
Write the briefing in language code "${language}" (keep worker IDs like W-101 and zone names intact).
CRITICAL PRIVACY & SAFETY RULES:
- NEVER mention heart rate, bpm, skin temperature, core temperature, exertion scores, or numeric PSI values.
- Focus exclusively on risk tiers (Red/Amber/Green), zones, PPE load, acclimatization days, crossing ETAs, and crew rotation actions.
Environment: ${params.env.station}, Air ${params.env.airTempC}°C, Outdoor WBGT ${params.env.wbgtC}°C, UAE Midday Break active=${params.env.inUaeMiddayBreakWindow}.
Anonymized Crew Tiers JSON: ${JSON.stringify(safeCrewSummary)}
Recent Dispatch Events JSON: ${JSON.stringify(recentIncidents)}

Return JSON with:
- executiveSummary (1-2 concise sentences)
- priorityActions (3 concrete dispatch & rotation bullets citing exact workerIds)
- zoneFocus (1 sentence highlighting highest-risk zone and PPE/acclimatization driver)
- heatWindowAdvice (1 sentence covering UAE Midday Break readiness)`;

    const res = await withRetry(() =>
      withTimeout(
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: prompt,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                executiveSummary: { type: Type.STRING },
                priorityActions: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                zoneFocus: { type: Type.STRING },
                heatWindowAdvice: { type: Type.STRING },
              },
              required: ['executiveSummary', 'priorityActions', 'zoneFocus', 'heatWindowAdvice'],
            },
          },
        }),
        18000
      )
    );

    const parsed = JSON.parse((res.text ?? '{}').trim()) as {
      executiveSummary?: string;
      priorityActions?: string[];
      zoneFocus?: string;
      heatWindowAdvice?: string;
    };

    const fb = fallbackBriefing();
    lastGeminiDiagnostic = 'ok';
    return {
      language,
      executiveSummary: sanitizeSupervisorSafeText(parsed.executiveSummary || fb.executiveSummary),
      priorityActions:
        Array.isArray(parsed.priorityActions) && parsed.priorityActions.length > 0
          ? parsed.priorityActions.slice(0, 4).map(sanitizeSupervisorSafeText)
          : fb.priorityActions,
      zoneFocus: sanitizeSupervisorSafeText(parsed.zoneFocus || fb.zoneFocus),
      heatWindowAdvice: sanitizeSupervisorSafeText(parsed.heatWindowAdvice || fb.heatWindowAdvice),
      source: 'gemini',
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    if (isDailyQuotaError(err)) {
      dailyQuotaCooldownUntil = Date.now() + 5 * 60_000;
      lastGeminiDiagnostic = 'quota_exhausted';
    } else {
      lastGeminiDiagnostic = 'fallback';
      console.info(
        `[GeminiService] Supervisor briefing fallback (${err instanceof Error ? err.message : String(err)})`
      );
    }
    return fallbackBriefing();
  }
}

/**
 * USE CASE 8: Post-Hoc Validation & Forecast Ablation AI Analyst (gemini-4-hydrogen).
 * Explains deterministic Backtest & Prospective Forecast Validation metrics without modifying numbers.
 */
export async function generateValidationAiInsights(
  payload:
    | { kind: 'backtest'; report: BacktestReport }
    | { kind: 'forecast'; report: ForecastValidationReport }
): Promise<ValidationAiInsights> {
  const buildFallback = (): ValidationAiInsights => {
    if (payload.kind === 'backtest') {
      const r = payload.report;
      const falsePositives = r.trajectories.filter((t) => t.outcome === 'False Positive').length;
      const falseNegatives = r.trajectories.filter((t) => t.outcome === 'False Negative').length;
      const avgAcclimEvents = r.trajectories
        .filter((t) => t.hadTrueEvent)
        .reduce((acc, t, _, arr) => acc + t.acclimatizationDays / Math.max(1, arr.length), 0);
      return {
        kind: 'backtest',
        headline: `ACGIH + Moran PSI Replay: ${r.sensitivityPct}% Recall with ${r.meanLeadTimeMin ?? 0} min Mean Lead Time`,
        summary: `Across ${r.cohortSize} simulated UAE worker-days (${r.totalMinutesEvaluated} min), SiteGuard detected ${r.detectedEventsCount}/${r.trueEventsCount} heat exhaustion threshold crossings while holding false-alarm rate at ${r.falseAlarmRatePct}% (Specificity ${r.specificityPct}%, F1 ${r.f1Score}).`,
        keyFindings: [
          `Early Warning Horizon: Median lead time is ${r.medianLeadTimeMin ?? 0} min before PSI ≥ 7.0 crossing, giving supervisors ample window for shaded rotation.`,
          `Cohort Risk Driver: True positive escalations averaged ${avgAcclimEvents.toFixed(1)}d acclimatization, reflecting heightened strain under enclosed PPE.`,
          `Error Profile: ${falsePositives} false-positive trajectory(s) and ${falseNegatives} false-negative miss(es) bounded safely within industrial screening tolerances.`,
        ],
        engineeringRecommendations: [
          'Keep deterministic Moran PSI + ACGIH WBGT thresholds locked; pair Amber triggers with proactive 15-min hydration breaks to absorb borderline false positives safely.',
          'Prioritize unacclimatized (<7d) and Chemical/Tyvek crews for earlier proactive break prompts.',
        ],
        source: 'template_fallback',
        generatedAt: new Date().toISOString(),
      };
    }

    const f = payload.report;
    const delta15 = Number((f.ridgeAblation15.maePsi - f.baseline15.maePsi).toFixed(3));
    const winner15 = delta15 >= 0 ? 'Weighted Damped Trend' : 'Lagged Ridge Ablation';
    return {
      kind: 'forecast',
      headline: `${winner15} Achieves ${f.baseline15.maePsi} PSI MAE & ${f.baseline15.tierAccuracyPct}% Tier Accuracy at t+15m`,
      summary: `Walk-forward evaluation across ${f.samplesEvaluated15} (t+15m) and ${f.samplesEvaluated30} (t+30m) held-out samples confirms calibrated 90% CI coverage (${f.baseline15.ci90CoveragePct}% at t+15m, ${f.baseline30.ci90CoveragePct}% at t+30m) without LLM numeric extrapolation.`,
      keyFindings: [
        `t+15m Horizon: Damped Trend achieves ${f.baseline15.maePsi} PSI MAE (RMSE ${f.baseline15.rmsePsi}) vs. Lagged Ridge ${f.ridgeAblation15.maePsi} PSI MAE (Δ ${delta15 >= 0 ? '+' : ''}${delta15}).`,
        `Horizon Decay (15m → 30m): Error increases realistically from ${f.baseline15.maePsi} to ${f.baseline30.maePsi} PSI as physiological uncertainty compounds over 30 minutes.`,
        `Uncertainty Calibration: 90% CI covers ${f.baseline15.ci90CoveragePct}% (t+15m) and ${f.baseline30.ci90CoveragePct}% (t+30m) of realized future scores.`,
      ],
      engineeringRecommendations: [
        'Retain Weighted Damped Trend as the primary edge-safe forecaster on wearables due to zero matrix overhead and bounded exponential damping.',
        'Maintain the 4-clean-sample post-fault warmup gate so noisy recovery spikes do not widen or bias crossing ETAs.',
      ],
      source: 'template_fallback',
      generatedAt: new Date().toISOString(),
    };
  };

  const ai = getClient();
  if (!ai || Date.now() < dailyQuotaCooldownUntil) {
    if (Date.now() < dailyQuotaCooldownUntil) {
      lastGeminiDiagnostic = 'quota_exhausted';
    }
    return buildFallback();
  }

  try {
    const summaryPayload =
      payload.kind === 'backtest'
        ? {
            cohortSize: payload.report.cohortSize,
            generator: payload.report.cohortGenerator,
            sensitivityPct: payload.report.sensitivityPct,
            specificityPct: payload.report.specificityPct,
            falseAlarmRatePct: payload.report.falseAlarmRatePct,
            precisionPct: payload.report.precisionPct,
            f1Score: payload.report.f1Score,
            meanLeadTimeMin: payload.report.meanLeadTimeMin,
            medianLeadTimeMin: payload.report.medianLeadTimeMin,
            outcomes: payload.report.trajectories.map((t) => ({
              ppe: t.ppeLevel,
              acclimDays: t.acclimatizationDays,
              leadTimeMin: t.leadTimeMin,
              outcome: t.outcome,
            })),
          }
        : {
            cohortSize: payload.report.cohortSize,
            samplesEvaluated15: payload.report.samplesEvaluated15,
            samplesEvaluated30: payload.report.samplesEvaluated30,
            baseline15: payload.report.baseline15,
            baseline30: payload.report.baseline30,
            ridgeAblation15: payload.report.ridgeAblation15,
            ridgeAblation30: payload.report.ridgeAblation30,
          };

    const prompt = `You are an Occupational Heat-Safety Data Scientist auditing SiteGuard's deterministic ${payload.kind === 'backtest' ? 'Backtest Validation' : 'Prospective Forecast Ablation'} results.
Cite the exact metrics from the JSON below without inventing or altering any number. Explain clinical/operational significance clearly.
Metrics JSON: ${JSON.stringify(summaryPayload)}

Return JSON with:
- headline (concise analytical takeaway <= 14 words)
- summary (2 concise sentences)
- keyFindings (3 concise data-backed observations)
- engineeringRecommendations (2 practical threshold/operational recommendations)`;

    const res = await withRetry(() =>
      withTimeout(
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: prompt,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                headline: { type: Type.STRING },
                summary: { type: Type.STRING },
                keyFindings: { type: Type.ARRAY, items: { type: Type.STRING } },
                engineeringRecommendations: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
              required: ['headline', 'summary', 'keyFindings', 'engineeringRecommendations'],
            },
          },
        }),
        18000
      )
    );

    const parsed = JSON.parse((res.text ?? '{}').trim()) as {
      headline?: string;
      summary?: string;
      keyFindings?: string[];
      engineeringRecommendations?: string[];
    };
    const fb = buildFallback();
    lastGeminiDiagnostic = 'ok';
    return {
      kind: payload.kind,
      headline: parsed.headline?.trim() || fb.headline,
      summary: parsed.summary?.trim() || fb.summary,
      keyFindings:
        Array.isArray(parsed.keyFindings) && parsed.keyFindings.length > 0
          ? parsed.keyFindings.slice(0, 4)
          : fb.keyFindings,
      engineeringRecommendations:
        Array.isArray(parsed.engineeringRecommendations) && parsed.engineeringRecommendations.length > 0
          ? parsed.engineeringRecommendations.slice(0, 3)
          : fb.engineeringRecommendations,
      source: 'gemini',
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    if (isDailyQuotaError(err)) {
      dailyQuotaCooldownUntil = Date.now() + 5 * 60_000;
      lastGeminiDiagnostic = 'quota_exhausted';
    } else {
      lastGeminiDiagnostic = 'fallback';
      console.info(
        `[GeminiService] Validation insights fallback (${err instanceof Error ? err.message : String(err)})`
      );
    }
    return buildFallback();
  }
}

export function getLatestBacktestSummaryNote(report: BacktestReport): string {
  return `Sensitivity ${report.sensitivityPct}%, False-Alarm Rate ${report.falseAlarmRatePct}%, Mean Lead Time ${report.meanLeadTimeMin ?? 0} min across ${report.cohortSize} worker-days.`;
}

export interface ParsedVoiceCommandPlan {
  intent: VoiceCommandIntent;
  workerId?: string;
  hubId?: UaeSiteHubId;
  navigateTo?: '/worker' | '/supervisor' | '/compliance' | '/validation' | '/forecast-validation';
  language: SupportedLanguage;
  spokenReply: string;
  actionSummary: string;
  source: 'gemini' | 'deterministic_router';
}

function deterministicParseVoicePlan(
  rawText: string,
  crew: WorkerStatusPublic[],
  env: EnvironmentalObservation,
  preferredLanguage: SupportedLanguage
): ParsedVoiceCommandPlan {
  const lower = rawText.toLowerCase();
  const workerMatch = rawText.match(/\b(W-\d{3})\b/i);
  const explicitWorker = workerMatch ? workerMatch[1].toUpperCase() : undefined;
  const highestRiskWorker =
    crew.find((w) => w.tier === 'Red') ??
    crew.find((w) => w.tier === 'Amber') ??
    crew[0];
  const targetWorker = explicitWorker ?? highestRiskWorker?.workerId;

  if (/\b(marina|dubai marina)\b/i.test(lower)) {
    return {
      intent: 'switch_hub',
      hubId: 'dubai_marina',
      language: preferredLanguage,
      spokenReply:
        'Switched active telemetry simulation to Dubai Marina Tower Deck. Updating coastal WBGT and crew limits.',
      actionSummary: 'Switched site telemetry to Dubai · Marina Tower',
      source: 'deterministic_router',
    };
  }
  if (/\b(jebel ali|port)\b/i.test(lower)) {
    return {
      intent: 'switch_hub',
      hubId: 'dubai_jebel_ali',
      language: preferredLanguage,
      spokenReply:
        'Switched active site simulation to Dubai Jebel Ali Port Logistics Pier.',
      actionSummary: 'Switched site telemetry to Dubai · Jebel Ali Port',
      source: 'deterministic_router',
    };
  }
  if (/\b(expo|solar|desert)\b/i.test(lower)) {
    return {
      intent: 'switch_hub',
      hubId: 'dubai_expo_city',
      language: preferredLanguage,
      spokenReply:
        'Switched active site simulation to Dubai Expo City Solar Corridor.',
      actionSummary: 'Switched site telemetry to Dubai · Expo City Solar',
      source: 'deterministic_router',
    };
  }
  if (/\b(abu dhabi|mussafah)\b/i.test(lower)) {
    return {
      intent: 'switch_hub',
      hubId: 'abu_dhabi_mussafah',
      language: preferredLanguage,
      spokenReply:
        'Restored primary station to Abu Dhabi Mussafah Infrastructure Lot 07.',
      actionSummary: 'Switched site telemetry to Abu Dhabi · Mussafah',
      source: 'deterministic_router',
    };
  }
  if (/\b(midday|12:30|13:00|14:00|ban|peak heat)\b/i.test(lower)) {
    return {
      intent: 'simulate_midday',
      language: preferredLanguage,
      spokenReply:
        'Simulating peak 13:00 GST UAE Midday Working Break conditions across active zones.',
      actionSummary: 'Activated 13:00 GST UAE Midday Halt simulation',
      source: 'deterministic_router',
    };
  }
  if (/\b(escalate|medic|emergency|sos|red)\b/i.test(lower) && targetWorker) {
    return {
      intent: 'escalate',
      workerId: targetWorker,
      language: preferredLanguage,
      spokenReply: `Emergency HSE escalation triggered for ${targetWorker}. Medic dispatch logged.`,
      actionSummary: `Escalated ${targetWorker} to HSE Medic dispatch`,
      source: 'deterministic_router',
    };
  }
  if (/\b(rotate|rotation|zone d|shade)\b/i.test(lower) && targetWorker) {
    return {
      intent: 'apply_rotation',
      workerId: targetWorker,
      language: preferredLanguage,
      spokenReply: `Rotating ${targetWorker} to Zone D shaded cooling staging and logging rest credit.`,
      actionSummary: `Rotated ${targetWorker} to Zone D Shaded Staging`,
      source: 'deterministic_router',
    };
  }
  if (/\b(break|rest|hydrate|water|pause|ஓய்வு|راحة)\b/i.test(lower) && targetWorker) {
    return {
      intent: 'order_break',
      workerId: targetWorker,
      language: preferredLanguage,
      spokenReply: `Ordered mandatory 15-minute shaded hydration break for ${targetWorker}.`,
      actionSummary: `Ordered 15m shaded break for ${targetWorker}`,
      source: 'deterministic_router',
    };
  }
  if (/\b(compliance|mohre|report|audit)\b/i.test(lower) && !/\b(read|speak)\b/i.test(lower)) {
    return {
      intent: 'navigate',
      navigateTo: '/compliance',
      language: preferredLanguage,
      spokenReply: 'Opening UAE Midday Break Compliance console.',
      actionSummary: 'Navigated to /compliance',
      source: 'deterministic_router',
    };
  }
  if (/\b(backtest|validation|sensitivity)\b/i.test(lower) && !/\b(read|speak)\b/i.test(lower)) {
    return {
      intent: 'navigate',
      navigateTo: '/validation',
      language: preferredLanguage,
      spokenReply: 'Opening Historical Heat-Wave Backtest Validation.',
      actionSummary: 'Navigated to /validation',
      source: 'deterministic_router',
    };
  }
  if (/\b(forecast|ablation|ridge)\b/i.test(lower) && !/\b(read|speak)\b/i.test(lower)) {
    return {
      intent: 'navigate',
      navigateTo: '/forecast-validation',
      language: preferredLanguage,
      spokenReply: 'Opening Prospective Forecast Validation & Model Ablation.',
      actionSummary: 'Navigated to /forecast-validation',
      source: 'deterministic_router',
    };
  }
  if (/\b(read|speak|briefing|summarize|summary|listen|படிக்கவும்|اقرأ)\b/i.test(lower)) {
    const redCount = crew.filter((w) => w.tier === 'Red').length;
    const amberCount = crew.filter((w) => w.tier === 'Amber').length;
    return {
      intent: 'read_summary',
      language: preferredLanguage,
      spokenReply: sanitizeSupervisorSafeText(
        `SiteGuard briefing for ${env.station}: ambient WBGT is ${env.wbgtC}°C. ${redCount} critical Red unit(s) and ${amberCount} Amber unit(s) require active rotation or break supervision.`
      ),
      actionSummary: 'Read live executive safety briefing',
      source: 'deterministic_router',
    };
  }

  const redCount = crew.filter((w) => w.tier === 'Red').length;
  const amberCount = crew.filter((w) => w.tier === 'Amber').length;
  return {
    intent: 'status_query',
    language: preferredLanguage,
    spokenReply: sanitizeSupervisorSafeText(
      `${env.station} is reporting WBGT ${env.wbgtC}°C across ${crew.length} monitored units: ${redCount} Red and ${amberCount} Amber.`
    ),
    actionSummary: 'Answered live site status query',
    source: 'deterministic_router',
  };
}

export async function parseVoiceCopilotCommand(params: {
  commandText: string;
  crew: WorkerStatusPublic[];
  env: EnvironmentalObservation;
  language?: SupportedLanguage;
  currentRoute?: string;
}): Promise<ParsedVoiceCommandPlan> {
  const language: SupportedLanguage = params.language ?? 'en';
  const fallback = deterministicParseVoicePlan(params.commandText, params.crew, params.env, language);
  const ai = getClient();
  if (!ai || Date.now() < dailyQuotaCooldownUntil || params.commandText.trim().length < 3) {
    if (Date.now() < dailyQuotaCooldownUntil) {
      lastGeminiDiagnostic = 'quota_exhausted';
    }
    return fallback;
  }

  try {
    const prompt = `You are SiteGuard's Hands-Free Voice Command AI Co-Pilot in the UAE (Abu Dhabi & Dubai).
Interpret the supervisor/inspector voice command and map it to a single structured action.
PRIVACY RULE: Never output heart rate (bpm), raw PSI numbers, core temperature, or personal names. Use only worker IDs, risk tiers, and WBGT.
Respond with spokenReply in language code "${language}".

Current Route: ${params.currentRoute ?? '/supervisor'}
Current Env: ${params.env.station}, WBGT ${params.env.wbgtC}°C, Air ${params.env.airTempC}°C
Crew Tiers: ${JSON.stringify(params.crew.map((w) => ({ id: w.workerId, zone: w.zone, tier: w.tier, eta: w.projectedAmberCrossingMin })))}
Available Hubs: abu_dhabi_mussafah, dubai_marina, dubai_jebel_ali, dubai_expo_city
Voice Command: "${params.commandText.slice(0, 240)}"`;

    const res = await withRetry(() =>
      withTimeout(
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: prompt,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                intent: {
                  type: Type.STRING,
                  enum: [
                    'order_break',
                    'escalate',
                    'apply_rotation',
                    'switch_hub',
                    'simulate_midday',
                    'generate_briefing',
                    'navigate',
                    'read_summary',
                    'status_query',
                  ],
                },
                workerId: { type: Type.STRING, nullable: true },
                hubId: {
                  type: Type.STRING,
                  enum: ['abu_dhabi_mussafah', 'dubai_marina', 'dubai_jebel_ali', 'dubai_expo_city'],
                  nullable: true,
                },
                navigateTo: {
                  type: Type.STRING,
                  enum: ['/worker', '/supervisor', '/compliance', '/validation', '/forecast-validation'],
                  nullable: true,
                },
                spokenReply: { type: Type.STRING },
                actionSummary: { type: Type.STRING },
              },
              required: ['intent', 'spokenReply', 'actionSummary'],
            },
          },
        }),
        12000
      )
    );

    const parsed = JSON.parse((res.text ?? '{}').trim()) as Partial<ParsedVoiceCommandPlan>;
    lastGeminiDiagnostic = 'ok';
    return {
      intent: parsed.intent ?? fallback.intent,
      workerId: parsed.workerId ?? fallback.workerId,
      hubId: parsed.hubId ?? fallback.hubId,
      navigateTo: parsed.navigateTo ?? fallback.navigateTo,
      language,
      spokenReply: sanitizeSupervisorSafeText(parsed.spokenReply?.trim() || fallback.spokenReply),
      actionSummary: sanitizeSupervisorSafeText(parsed.actionSummary?.trim() || fallback.actionSummary),
      source: 'gemini',
    };
  } catch (err) {
    if (isDailyQuotaError(err)) {
      dailyQuotaCooldownUntil = Date.now() + 5 * 60_000;
      lastGeminiDiagnostic = 'quota_exhausted';
    } else {
      lastGeminiDiagnostic = 'fallback';
    }
    return fallback;
  }
}

const globalAlertCache = new Map<string, WorkerAlertCopy>();

export async function translateWorkerAlertGlobal(params: {
  context: WorkerContext;
  assessment: RiskAssessment;
  forecast: ForecastOutput;
  env: EnvironmentalObservation;
  target: {
    code: string;
    name: string;
    nativeName: string;
  };
  baseCopyOverride?: {
    headline: string;
    explanation: string;
    action: string;
    proactiveForecastNote?: string | null;
  };
}): Promise<WorkerAlertCopy> {
  const { context, assessment, forecast, env, target, baseCopyOverride } = params;
  const baseEn =
    baseCopyOverride ??
    buildDeterministicFallback(context, assessment, forecast).en;

  if (target.code === 'en') {
    return {
      headline: baseEn.headline,
      explanation: baseEn.explanation,
      action: baseEn.action,
      proactiveForecastNote: baseEn.proactiveForecastNote ?? null,
      source: 'template_fallback',
      cached: true,
    };
  }

  const cacheKey = [
    'global-v1',
    buildCacheKey(assessment, forecast, context),
    target.code,
    baseEn.headline,
  ].join('|');

  const hit = globalAlertCache.get(cacheKey);
  if (hit) {
    return { ...hit, cached: true };
  }

  const fallbackCopy: WorkerAlertCopy = {
    headline: `[${target.nativeName}] ${baseEn.headline}`,
    explanation: baseEn.explanation,
    action: baseEn.action,
    proactiveForecastNote: baseEn.proactiveForecastNote ?? null,
    source: 'template_fallback',
    cached: false,
  };

  const ai = getClient();
  if (!ai || Date.now() < dailyQuotaCooldownUntil || Date.now() < transientCooldownUntil) {
    lastGeminiDiagnostic = !ai
      ? 'no_api_key'
      : Date.now() < dailyQuotaCooldownUntil
        ? 'quota_exhausted'
        : 'fallback';
    return fallbackCopy;
  }

  try {
    const prompt = `Translate this industrial heat-safety wearable guidance for a worker in Abu Dhabi / Dubai (UAE) into ${target.name} (${target.nativeName}, BCP-47 code "${target.code}") in clear, natural spoken phrasing appropriate for an industrial worker.
Preserve exact numbers, temperatures, and minute values accurately. Do NOT invent any new minute ETAs.

Source English Guidance:
- Tier: ${assessment.tier} (Station: ${env.station}, WBGT ${env.wbgtC}°C)
- headline: ${baseEn.headline}
- explanation: ${baseEn.explanation}
- action: ${baseEn.action}
- proactiveForecastNote: ${baseEn.proactiveForecastNote ?? ''}

Return JSON with keys: headline, explanation, action, proactiveForecastNote (return "" if input proactiveForecastNote is empty).`;

    const res = await withRetry(() =>
      withTimeout(
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: prompt,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: makeAlertCopySchema(),
          },
        }),
        12000
      )
    );

    const parsed = JSON.parse((res.text ?? '{}').trim()) as {
      headline?: string;
      explanation?: string;
      action?: string;
      proactiveForecastNote?: string;
    };

    const result: WorkerAlertCopy = {
      headline: parsed.headline?.trim() || baseEn.headline,
      explanation: parsed.explanation?.trim() || baseEn.explanation,
      action: parsed.action?.trim() || baseEn.action,
      proactiveForecastNote: parsed.proactiveForecastNote?.trim()
        ? parsed.proactiveForecastNote.trim()
        : baseEn.proactiveForecastNote ?? null,
      source: 'gemini',
      cached: false,
    };

    globalAlertCache.set(cacheKey, result);
    lastGeminiDiagnostic = 'ok';
    return result;
  } catch (err) {
    if (isDailyQuotaError(err)) {
      dailyQuotaCooldownUntil = Date.now() + 5 * 60_000;
      lastGeminiDiagnostic = 'quota_exhausted';
    } else {
      lastGeminiDiagnostic = 'fallback';
    }
    return fallbackCopy;
  }
}

export type WorkerTtsResult =
  | {
      ok: true;
      audioBase64: string;
      mimeType: string;
      language: string;
      localeTag: string;
      voiceName: string;
      model: 'gemini-3.8-flash-lite-tts';
      cached: boolean;
      source: 'gemini_tts';
    }
  | {
      ok: false;
      fallback: 'web_speech';
      reason: 'no_api_key' | 'quota_exhausted' | 'tts_error';
      error: string;
    };

/**
 * Gemini 3.8 unary TTS defaults to complete WAV (`audio/wav` with 44-byte RIFF header, 24kHz mono 16-bit).
 * Only wrap with a RIFF WAV header when raw PCM (`audio/pcm` / `audio/l16`) without a RIFF header is returned.
 */
export function ensurePlayableWavBuffer(
  bytes: Buffer,
  rawMimeType?: string
): { buffer: Buffer; mimeType: string } {
  const normalizedMime = (rawMimeType || 'audio/wav').split(';')[0].trim().toLowerCase();
  const hasRiffHeader =
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WAVE';

  if (hasRiffHeader) {
    return { buffer: bytes, mimeType: 'audio/wav' };
  }

  if (normalizedMime === 'audio/l16' || normalizedMime === 'audio/pcm') {
    const sampleRate = 24000;
    const channels = 1;
    const bitsPerSample = 16;
    const byteRate = (sampleRate * channels * bitsPerSample) / 8;
    const blockAlign = (channels * bitsPerSample) / 8;
    const header = Buffer.alloc(44);
    header.write('RIFF', 0, 'ascii');
    header.writeUInt32LE(36 + bytes.length, 4);
    header.write('WAVE', 8, 'ascii');
    header.write('fmt ', 12, 'ascii');
    header.writeUInt32LE(16, 16); // PCM chunk size
    header.writeUInt16LE(1, 20); // PCM format
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36, 'ascii');
    header.writeUInt32LE(bytes.length, 40);
    return { buffer: Buffer.concat([header, bytes]), mimeType: 'audio/wav' };
  }

  return {
    buffer: bytes,
    mimeType: normalizedMime.startsWith('audio/') ? normalizedMime : 'audio/wav',
  };
}

/**
 * USE CASE 9: Server-Side Multilingual Worker Safety Cloud TTS (`gemini-3.8-flash-lite-tts`).
 * Generates authentic native pronunciation across all 10 UAE crew languages & 114+ global languages
 * without relying on OS-installed Web Speech SAPI voices.
 */
export async function synthesizeWorkerSpeech(params: {
  text: string;
  language: string;
  localeTag?: string;
  languageName?: string;
  severity?: 'nominal' | 'amber' | 'red';
}): Promise<WorkerTtsResult> {
  const cleanText = params.text.trim().slice(0, 1200);
  const language = params.language.trim() || 'en';
  const localeTag = params.localeTag?.trim() || 'en-US';
  const languageName = params.languageName?.trim() || language;
  const severity = params.severity ?? 'amber';
  const voiceName = severity === 'red' ? 'Fenrir' : 'Kore';

  const cacheKey = `${language}|${localeTag}|${severity}|${cleanText}`;
  const cached = ttsAudioCache.get(cacheKey);
  if (cached) {
    return {
      ok: true,
      audioBase64: cached.audioBase64,
      mimeType: cached.mimeType,
      language,
      localeTag,
      voiceName: cached.voiceName,
      model: 'gemini-3.8-flash-lite-tts',
      cached: true,
      source: 'gemini_tts',
    };
  }

  const ai = getClient();
  if (!ai) {
    lastGeminiDiagnostic = 'no_api_key';
    return {
      ok: false,
      fallback: 'web_speech',
      reason: 'no_api_key',
      error: 'GEMINI_API_KEY is not configured on the server; use offline Web Speech fallback.',
    };
  }

  if (Date.now() < dailyQuotaCooldownUntil) {
    lastGeminiDiagnostic = 'quota_exhausted';
    return {
      ok: false,
      fallback: 'web_speech',
      reason: 'quota_exhausted',
      error: 'Gemini API daily quota cooldown active; use offline Web Speech fallback.',
    };
  }

  try {
    const style =
      severity === 'red'
        ? `Urgent, crystal-clear industrial safety stop-work alert spoken natively in ${languageName} (${localeTag})`
        : severity === 'amber'
          ? `Calm, authoritative heat safety advisory spoken natively in ${languageName} (${localeTag})`
          : `Friendly, clear hydration and safety guidance spoken natively in ${languageName} (${localeTag})`;

    const response = await withRetry(() =>
      withTimeout(
        ai.models.generateContent({
          model: 'gemini-3.8-flash-lite-tts',
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: cleanText,
                  speechMetadata: { style },
                },
              ],
            },
          ],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName },
              },
            },
          },
        }),
        20000
      )
    );

    const part = response.candidates?.[0]?.content?.parts?.find((p) => Boolean(p.inlineData?.data));
    const rawData = part?.inlineData?.data;
    if (!rawData) {
      lastGeminiDiagnostic = 'fallback';
      return {
        ok: false,
        fallback: 'web_speech',
        reason: 'tts_error',
        error: 'Cloud TTS response did not include audio inlineData.',
      };
    }

    const decoded = Buffer.from(rawData, 'base64');
    const normalized = ensurePlayableWavBuffer(decoded, part?.inlineData?.mimeType);
    const audioBase64 = normalized.buffer.toString('base64');

    if (ttsAudioCache.size >= 80) {
      const oldestKey = ttsAudioCache.keys().next().value;
      if (oldestKey) ttsAudioCache.delete(oldestKey);
    }
    ttsAudioCache.set(cacheKey, {
      audioBase64,
      mimeType: normalized.mimeType,
      voiceName,
    });

    lastGeminiDiagnostic = 'ok';
    return {
      ok: true,
      audioBase64,
      mimeType: normalized.mimeType,
      language,
      localeTag,
      voiceName,
      model: 'gemini-3.8-flash-lite-tts',
      cached: false,
      source: 'gemini_tts',
    };
  } catch (err) {
    if (isDailyQuotaError(err)) {
      dailyQuotaCooldownUntil = Date.now() + 5 * 60_000;
      lastGeminiDiagnostic = 'quota_exhausted';
      return {
        ok: false,
        fallback: 'web_speech',
        reason: 'quota_exhausted',
        error: 'Gemini TTS quota exhausted.',
      };
    }
    lastGeminiDiagnostic = 'fallback';
    const message = err instanceof Error ? err.message : String(err);
    console.info(`[GeminiService] Cloud TTS fallback (${message})`);
    return {
      ok: false,
      fallback: 'web_speech',
      reason: 'tts_error',
      error: message,
    };
  }
}


