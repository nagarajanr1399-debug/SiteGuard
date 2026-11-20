import { formatTemperature, type TemperatureUnit } from './temperature';
import type { SupportedLanguage } from './types';

export type WearableAlertStateId =
  | 'live'
  | 'amber_forecast'
  | 'hydration_alert'
  | 'high_heat'
  | 'sos_active';

export interface WearableAlertStateMeta {
  id: WearableAlertStateId;
  shortLabel: string;
  badgeText: string;
  accentHex: string;
}

export const WEARABLE_ALERT_STATE_OPTIONS: WearableAlertStateMeta[] = [
  {
    id: 'live',
    shortLabel: 'Live Telemetry',
    badgeText: 'LIVE',
    accentHex: '#787aff',
  },
  {
    id: 'amber_forecast',
    shortLabel: '1. Amber Forecast',
    badgeText: 'STATE 1',
    accentHex: '#f59e0b',
  },
  {
    id: 'hydration_alert',
    shortLabel: '2. Hydration Alert',
    badgeText: 'STATE 2',
    accentHex: '#06b6d4',
  },
  {
    id: 'high_heat',
    shortLabel: '3. High Heat / WBGT',
    badgeText: 'STATE 3',
    accentHex: '#ef4444',
  },
  {
    id: 'sos_active',
    shortLabel: '4. SOS Active',
    badgeText: 'STATE 4',
    accentHex: '#fa114f',
  },
];

export const WEARABLE_SPEC_TELEMETRY = {
  amberForecast: {
    dialScore: 4.0,
    dialStatus: 'Nominal',
    projectedT15: 5.2,
    deltaT15: 1.2,
    airTempC: 47.1,
    relHumidityPct: 29,
    wbgtC: 37.2,
  },
  hydrationAlert: {
    skinTempC: 36.0,
    relHumidityPct: 29,
    sweatRateMlHr: 0.8,
    sweatStatus: 'Optimal',
    intervalMin: 20,
  },
  highHeat: {
    wbgtC: 37.2,
    airTempC: 47.1,
    relHumidityPct: 29,
    globeTempC: 54.8,
    solarWm2: 940,
    windSpeedMs: 1.9,
    highRiskMinC: 37,
    highRiskMaxC: 40,
  },
  sosActive: {
    hrBpm: 98,
    skinTempC: 36.0,
    distressSensorStatus: 'ACTIVE',
  },
} as const;

export interface EscalationEventSpec {
  id: string;
  offsetLabel: string;
  channel: string;
  message: string;
  status: 'Confirmed' | 'Dispatched' | 'Active';
}

export const SOS_ESCALATION_TIMELINE: EscalationEventSpec[] = [
  {
    id: 'esc-1',
    offsetLabel: 'T+00s',
    channel: 'Distress Sensor',
    message: 'Wearable Distress Sensor triggered · HR 98 bpm · Skin Temp 36.0°C locked',
    status: 'Active',
  },
  {
    id: 'esc-2',
    offsetLabel: 'T+01s',
    channel: 'Gemma 4 Edge',
    message: 'Gemma 4 Edge Offline Mode buffered alert packet & beacon zone (Zone A · Rebar Deck)',
    status: 'Confirmed',
  },
  {
    id: 'esc-3',
    offsetLabel: 'T+02s',
    channel: 'HSE Supervisor',
    message: 'Site HSE Supervisor console alerted · Stop-Work dispatch issued',
    status: 'Confirmed',
  },
  {
    id: 'esc-4',
    offsetLabel: 'T+04s',
    channel: 'Site Medic',
    message: 'Zone A Medical Response Team dispatched with ice-slurry & electrolyte kit',
    status: 'Dispatched',
  },
  {
    id: 'esc-5',
    offsetLabel: 'T+06s',
    channel: 'AC Recovery',
    message: 'Shaded AC Recovery Bay #2 cleared and standby confirmed',
    status: 'Confirmed',
  },
];

export interface WearableAlertLocalizedSpec {
  bannerTitle: string;
  headline: string;
  action: string;
  secondaryDetail: string;
}

export function getWearableAlertSpecCopy(
  stateId: Exclude<WearableAlertStateId, 'live'>,
  language: SupportedLanguage,
  tempUnit: TemperatureUnit
): WearableAlertLocalizedSpec {
  const air = formatTemperature(47.1, tempUnit, 1);
  const wbgt = formatTemperature(37.2, tempUnit, 1);
  const skin = formatTemperature(36.0, tempUnit, 1);
  const rangeLow = formatTemperature(37, tempUnit, 0);
  const rangeHigh = formatTemperature(40, tempUnit, 0);

  if (stateId === 'amber_forecast') {
    const byLang: Record<SupportedLanguage, WearableAlertLocalizedSpec> = {
      en: {
        bannerTitle: 'Amber In ~1 min — Projected by trend forecast. Start break early',
        headline: 'Amber In ~1 min — Projected by trend forecast. Start break early',
        action: `Current dial at 4.0 Nominal with t+15m projection at 5.2 (+1.2). Gemma 4 Edge Offline Mode active (${air} Air, 29% RH, ${wbgt} WBGT).`,
        secondaryDetail: 'Proactive shade break recommended before Amber strain threshold is crossed.',
      },
      ar: {
        bannerTitle: 'تحذير برتقالي خلال ~1 دقيقة — متوقع حسب الاتجاه. ابدأ الاستراحة مبكراً',
        headline: 'تحذير برتقالي خلال ~1 دقيقة — متوقع حسب الاتجاه. ابدأ الاستراحة مبكراً',
        action: `المؤشر الحالي 4.0 طبيعي والتوقع بعد 15 دقيقة هو 5.2 (+1.2). وضع Gemma 4 Edge غير المتصل نشط (الهواء ${air}، الرطوبة 29%، WBGT ${wbgt}).`,
        secondaryDetail: 'يوصى ببدء استراحة الظل مبكراً قبل تجاوز حد الإجهاد البرتقالي.',
      },
      hi: {
        bannerTitle: 'लगभग 1 मिनट में एम्बर — ट्रेंड पूर्वानुमान द्वारा अनुमानित। जल्दी ब्रेक लें',
        headline: 'लगभग 1 मिनट में एम्बर — ट्रेंड पूर्वानुमान द्वारा अनुमानित। जल्दी ब्रेक लें',
        action: `वर्तमान डायल 4.0 सामान्य और t+15m अनुमान 5.2 (+1.2)। Gemma 4 एज ऑफ़लाइन मोड सक्रिय (हवा ${air}, नमी 29%, WBGT ${wbgt})।`,
        secondaryDetail: 'एम्बर सीमा पार होने से पहले छाया में विश्राम शुरू करें।',
      },
      ur: {
        bannerTitle: 'تقریباً 1 منٹ میں امبر — ٹرینڈ پیشگوئی کے مطابق۔ وقفہ جلدی شروع کریں',
        headline: 'تقریباً 1 منٹ میں امبر — ٹرینڈ پیشگوئی کے مطابق۔ وقفہ جلدی شروع کریں',
        action: `موجودہ اسکور 4.0 نارمل اور t+15m پیشگوئی 5.2 (+1.2)۔ Gemma 4 ایج آف لائن موڈ فعال (ہوا ${air}، نمی 29%، WBGT ${wbgt})۔`,
        secondaryDetail: 'امبر حد عبور ہونے سے پہلے سایہ دار آرام کا وقفہ شروع کریں۔',
      },
      bn: {
        bannerTitle: 'প্রায় ১ মিনিটে অ্যাম্বার — ট্রেন্ড পূর্বাভাস অনুযায়ী। দ্রুত বিরতি নিন',
        headline: 'প্রায় ১ মিনিটে অ্যাম্বার — ট্রেন্ড পূর্বাভাস অনুযায়ী। দ্রুত বিরতি নিন',
        action: `বর্তমান ডায়াল 4.0 স্বাভাবিক এবং t+15m পূর্বাভাস 5.2 (+1.2)। Gemma 4 এজ অফলাইন মোড সক্রিয় (বায়ু ${air}, আর্দ্রতা 29%, WBGT ${wbgt})।`,
        secondaryDetail: 'অ্যাম্বার সীমা অতিক্রম করার আগেই ছায়ায় বিশ্রাম শুরু করুন।',
      },
      tl: {
        bannerTitle: 'Amber sa ~1 min — Tinataya ng trend forecast. Simulan ang pahinga nang maaga',
        headline: 'Amber sa ~1 min — Tinataya ng trend forecast. Simulan ang pahinga nang maaga',
        action: `Kasalukuyang dial ay 4.0 Nominal at t+15m forecast na 5.2 (+1.2). Aktibo ang Gemma 4 Edge Offline Mode (Hangin ${air}, RH 29%, WBGT ${wbgt}).`,
        secondaryDetail: 'Magpahinga sa lilim bago umabot sa Amber threshold.',
      },
      ta: {
        bannerTitle: 'சுமார் 1 நிமிடத்தில் ஆம்பர் எச்சரிக்கை — முன்னறிவிப்பு கணிப்பு. முன்கூட்டியே ஓய்வு எடுங்கள்',
        headline: 'சுமார் 1 நிமிடத்தில் ஆம்பர் எச்சரிக்கை — முன்னறிவிப்பு கணிப்பு. முன்கூட்டியே ஓய்வு எடுங்கள்',
        action: `தற்போதைய அளவு 4.0 சாதாரணம்; t+15m கணிப்பு 5.2 (+1.2). Gemma 4 எட்ஜ் ஆஃப்லைன் நிலை செயல்பாட்டில் (காற்று ${air}, ஈரப்பதம் 29%, WBGT ${wbgt}).`,
        secondaryDetail: 'ஆம்பர் அபாய எல்லையைத் தாண்டும் முன் நிழலில் ஓய்வு தொடங்குங்கள்.',
      },
      ml: {
        bannerTitle: 'ഏകദേശം 1 മിനിറ്റിൽ ആംബർ — ട്രെൻഡ് പ്രവചനം. വിശ്രമം നേരത്തെ തുടങ്ങുക',
        headline: 'ഏകദേശം 1 മിനിറ്റിൽ ആംബർ — ട്രെൻഡ് പ്രവചനം. വിശ്രമം നേരത്തെ തുടങ്ങുക',
        action: `നിലവിലെ ഡയൽ 4.0 നോർമൽ, t+15m പ്രവചനം 5.2 (+1.2). Gemma 4 എഡ്ജ് ഓഫ്‌ലൈൻ മോഡ് സജീവം (വായു ${air}, RH 29%, WBGT ${wbgt}).`,
        secondaryDetail: 'ആംബർ പരിധി കടക്കുന്നതിന് മുമ്പ് തണലിൽ വിശ്രമം ആരംഭിക്കുക.',
      },
      ne: {
        bannerTitle: 'करिब १ मिनेटमा एम्बर — ट्रेन्ड पूर्वानुमान। छिट्टै विश्राम सुरु गर्नुहोस्',
        headline: 'करिब १ मिनेटमा एम्बर — ट्रेन्ड पूर्वानुमान। छिट्टै विश्राम सुरु गर्नुहोस्',
        action: `हालको डायल 4.0 सामान्य र t+15m अनुमान 5.2 (+1.2) छ। Gemma 4 एज अफलाइन मोड सक्रिय (हावा ${air}, RH 29%, WBGT ${wbgt})।`,
        secondaryDetail: 'एम्बर सीमा पार हुनुअघि नै छायामा विश्राम सुरु गर्नुहोस्।',
      },
      si: {
        bannerTitle: 'විනාඩි ~1 කින් ඇම්බර් — ප්‍රවණතා පුරෝකථනය. විවේකය ඉක්මනින් අරඹන්න',
        headline: 'විනාඩි ~1 කින් ඇම්බර් — ප්‍රවණතා පුරෝකථනය. විවේකය ඉක්මනින් අරඹන්න',
        action: `වත්මන් අගය 4.0 සාමාන්‍ය සහ t+15m පුරෝකථනය 5.2 (+1.2). Gemma 4 එජ් නොබැඳි මාදිලිය සක්‍රීයයි (වාතය ${air}, ආර්ද්‍රතාව 29%, WBGT ${wbgt}).`,
        secondaryDetail: 'ඇම්බර් තාප සීමාව ඉක්මවීමට පෙර සෙවණේ විවේක ගැනීම අරඹන්න.',
      },
    };
    return byLang[language];
  }

  if (stateId === 'hydration_alert') {
    const byLang: Record<SupportedLanguage, WearableAlertLocalizedSpec> = {
      en: {
        bannerTitle: 'SAFE TO WORK — HYDRATE (Drink water every 20 min)',
        headline: 'SAFE TO WORK — HYDRATE (Drink water every 20 min)',
        action: `Skin Temp ${skin} · RH 29% · Sweat Rate 0.8 ml/hr (Optimal). Drink 250 ml cool electrolyte water on schedule.`,
        secondaryDetail: 'Hydration ring active · continuous sweat-rate & skin thermal monitoring.',
      },
      ar: {
        bannerTitle: 'العمل آمن — اشرب الماء (كل 20 دقيقة)',
        headline: 'العمل آمن — اشرب الماء (كل 20 دقيقة)',
        action: `حرارة الجلد ${skin} · الرطوبة 29% · معدل التعرق 0.8 ml/hr (مثالي). اشرب 250 مل ماء بارد مع أملاح بانتظام.`,
        secondaryDetail: 'حلقة الترطيب نشطة · مراقبة مستمرة لمعدل التعرق وحرارة الجلد.',
      },
      hi: {
        bannerTitle: 'काम करने के लिए सुरक्षित — पानी पिएं (हर 20 मिनट में)',
        headline: 'काम करने के लिए सुरक्षित — पानी पिएं (हर 20 मिनट में)',
        action: `त्वचा तापमान ${skin} · नमी 29% · पसीना दर 0.8 ml/hr (उत्तम)। हर 20 मिनट में 250 ml ठंडा पानी पिएं।`,
        secondaryDetail: 'हाइड्रेशन रिंग सक्रिय · निरंतर पसीना दर और त्वचा तापमान निगरानी।',
      },
      ur: {
        bannerTitle: 'کام کے لیے محفوظ — پانی پئیں (ہر 20 منٹ بعد)',
        headline: 'کام کے لیے محفوظ — پانی پئیں (ہر 20 منٹ بعد)',
        action: `جلد کا درجہ حرارت ${skin} · نمی 29% · پسینے کی شرح 0.8 ml/hr (بہترین)۔ ہر 20 منٹ میں ٹھنڈا پانی پئیں۔`,
        secondaryDetail: 'ہائیڈریشن رنگ فعال · پسینے کی شرح اور جلد کی حرارت کی مسلسل نگرانی۔',
      },
      bn: {
        bannerTitle: 'কাজের জন্য নিরাপদ — পানি পান করুন (প্রতি ২০ মিনিটে)',
        headline: 'কাজের জন্য নিরাপদ — পানি পান করুন (প্রতি ২০ মিনিটে)',
        action: `ত্বকের তাপমাত্রা ${skin} · আর্দ্রতা 29% · ঘামের হার 0.8 ml/hr (সর্বোত্তম)। প্রতি ২০ মিনিটে ২৫০ মি.লি. ঠান্ডা পানি পান করুন।`,
        secondaryDetail: 'হাইড্রেশন রিং সক্রিয় · ঘামের হার ও ত্বকের তাপমাত্রা পর্যবেক্ষণ চলছে।',
      },
      tl: {
        bannerTitle: 'LIGTAS MAGTRABAHO — UMINOM NG TUBIG (Tuwing 20 min)',
        headline: 'LIGTAS MAGTRABAHO — UMINOM NG TUBIG (Tuwing 20 min)',
        action: `Skin Temp ${skin} · RH 29% · Sweat Rate 0.8 ml/hr (Optimal). Uminom ng 250 ml na malamig na tubig tuwing 20 minuto.`,
        secondaryDetail: 'Aktibo ang hydration ring · patuloy na pagsubaybay sa pawis at temperatura ng balat.',
      },
      ta: {
        bannerTitle: 'வேலை செய்ய பாதுகாப்பானது — தண்ணீர் குடியுங்கள் (20 நிமிடத்திற்கு ஒருமுறை)',
        headline: 'வேலை செய்ய பாதுகாப்பானது — தண்ணீர் குடியுங்கள் (20 நிமிடத்திற்கு ஒருமுறை)',
        action: `தோல் வெப்பநிலை ${skin} · ஈரப்பதம் 29% · வியர்வை விகிதம் 0.8 ml/hr (சிறந்தது). 20 நிமிடத்திற்கு ஒருமுறை 250 ml குளிர்ந்த நீர் குடிக்கவும்.`,
        secondaryDetail: 'நீரேற்ற வளையம் செயல்பாட்டில் · வியர்வை மற்றும் தோல் வெப்பநிலை தொடர்ந்து கண்காணிக்கப்படுகிறது.',
      },
      ml: {
        bannerTitle: 'ജോലി ചെയ്യാൻ സുരക്ഷിതം — വെള്ളം കുടിക്കുക (ഓരോ 20 മിനിറ്റിലും)',
        headline: 'ജോലി ചെയ്യാൻ സുരക്ഷിതം — വെള്ളം കുടിക്കുക (ഓരോ 20 മിനിറ്റിലും)',
        action: `ചർമ്മ താപനില ${skin} · RH 29% · വിയർപ്പ് നിരക്ക് 0.8 ml/hr (അനുയോജ്യം). ഓരോ 20 മിനിറ്റിലും 250 ml തണുത്ത വെള്ളം കുടിക്കുക.`,
        secondaryDetail: 'ഹൈഡ്രേഷൻ റിംഗ് സജീവം · വിയർപ്പ് നിരക്കും ചർമ്മ താപനിലയും തുടർച്ചയായി നിരീക്ഷിക്കുന്നു.',
      },
      ne: {
        bannerTitle: 'काम गर्न सुरक्षित — पानी पिउनुहोस् (हरेक २० मिनेटमा)',
        headline: 'काम गर्न सुरक्षित — पानी पिउनुहोस् (हरेक २० मिनेटमा)',
        action: `छालाको तापक्रम ${skin} · RH 29% · पसिना दर 0.8 ml/hr (उत्तम)। हरेक २० मिनेटमा २५० ml चिसो पानी पिउनुहोस्।`,
        secondaryDetail: 'हाइड्रेसन रिङ सक्रिय · पसिना दर र छालाको तापक्रम निरन्तर निगरानी।',
      },
      si: {
        bannerTitle: 'වැඩ කිරීමට ආරක්ෂිතයි — ජලය පානය කරන්න (සෑම විනාඩි 20 කට වරක්)',
        headline: 'වැඩ කිරීමට ආරක්ෂිතයි — ජලය පානය කරන්න (සෑම විනාඩි 20 කට වරක්)',
        action: `සමේ උෂ්ණත්වය ${skin} · RH 29% · දහඩිය අනුපාතය 0.8 ml/hr (ප්‍රශස්ත). සෑම විනාඩි 20 කට වරක් සිසිල් ජලය 250 ml පානය කරන්න.`,
        secondaryDetail: 'ජල පාන වළල්ල සක්‍රීයයි · දහඩිය සහ සමේ උෂ්ණත්වය අඛණ්ඩව නිරීක්ෂණය කෙරේ.',
      },
    };
    return byLang[language];
  }

  if (stateId === 'high_heat') {
    const byLang: Record<SupportedLanguage, WearableAlertLocalizedSpec> = {
      en: {
        bannerTitle: `HIGH HEAT / WBGT — ${wbgt} WBGT (${rangeLow}–${rangeHigh} High Risk)`,
        headline: `HIGH HEAT STRESS — WBGT ${wbgt} · AIR ${air}`,
        action: `Environmental Heat Stress Sensors detect ${rangeLow}–${rangeHigh} High Risk band. Mandatory shade rotation & cooling vest inspection.`,
        secondaryDetail: 'Amber-to-red arc gauge active under Gemma 4 Edge Offline Mode.',
      },
      ar: {
        bannerTitle: `حرارة عالية / WBGT — ${wbgt} (${rangeLow}–${rangeHigh} خطر مرتفع)`,
        headline: `إجهاد حراري مرتفع — WBGT ${wbgt} · الهواء ${air}`,
        action: `رصدت مستشعرات الإجهاد الحراري نطاق الخطر المرتفع ${rangeLow}–${rangeHigh}. التبديل إلى الظل وفحص سترة التبريد إلزامي.`,
        secondaryDetail: 'مقياس القوس البرتقالي إلى الأحمر نشط ضمن وضع Gemma 4 Edge غير المتصل.',
      },
      hi: {
        bannerTitle: `अत्यधिक गर्मी / WBGT — ${wbgt} (${rangeLow}–${rangeHigh} उच्च जोखिम)`,
        headline: `उच्च ताप तनाव — WBGT ${wbgt} · हवा ${air}`,
        action: `पर्यावरणीय ताप सेंसर ${rangeLow}–${rangeHigh} उच्च जोखिम दिखा रहे हैं। छाया रोटेशन अनिवार्य है।`,
        secondaryDetail: 'Gemma 4 एज ऑफ़लाइन मोड के अंतर्गत एम्बर-से-रेड आर्क गेज सक्रिय।',
      },
      ur: {
        bannerTitle: `شدید گرمی / WBGT — ${wbgt} (${rangeLow}–${rangeHigh} زیادہ خطرہ)`,
        headline: `شدید حرارتی دباؤ — WBGT ${wbgt} · ہوا ${air}`,
        action: `ماحولیاتی سینسرز ${rangeLow}–${rangeHigh} زیادہ خطرے کی نشاندہی کر رہے ہیں۔ سایہ میں فوری آرام کریں۔`,
        secondaryDetail: 'Gemma 4 ایج آف لائن موڈ کے تحت امبر تا سرخ آرک گیج فعال۔',
      },
      bn: {
        bannerTitle: `তীব্র তাপ / WBGT — ${wbgt} (${rangeLow}–${rangeHigh} উচ্চ ঝুঁকি)`,
        headline: `উচ্চ তাপ চাপ — WBGT ${wbgt} · বায়ু ${air}`,
        action: `পরিবেশগত তাপ সেন্সরে ${rangeLow}–${rangeHigh} উচ্চ ঝুঁকি শনাক্ত হয়েছে। ছায়ায় বিরতি বাধ্যতামূলক।`,
        secondaryDetail: 'Gemma 4 এজ অফলাইন মোডের অধীনে অ্যাম্বার-টু-রেড আর্ক গেজ সক্রিয়।',
      },
      tl: {
        bannerTitle: `MATAAS NA INIT / WBGT — ${wbgt} (${rangeLow}–${rangeHigh} Mataas na Panganib)`,
        headline: `MATAAS NA HEAT STRESS — WBGT ${wbgt} · HANGIN ${air}`,
        action: `Natukoy ng Environmental Heat Stress Sensors ang ${rangeLow}–${rangeHigh} High Risk. Magpahinga sa lilim agad.`,
        secondaryDetail: 'Aktibo ang amber-to-red arc gauge sa Gemma 4 Edge Offline Mode.',
      },
      ta: {
        bannerTitle: `அதிக வெப்பம் / WBGT — ${wbgt} (${rangeLow}–${rangeHigh} அதிக ஆபத்து)`,
        headline: `உயர் வெப்ப அழுத்தம் — WBGT ${wbgt} · காற்று ${air}`,
        action: `சுற்றுச்சூழல் வெப்ப சென்சார்கள் ${rangeLow}–${rangeHigh} அதிக ஆபத்தைக் காட்டுகின்றன. நிழல் சுழற்சி மற்றும் குளிரூட்டும் உடை ஆய்வு கட்டாயம்.`,
        secondaryDetail: 'Gemma 4 எட்ஜ் ஆஃப்லைன் நிலையில் ஆம்பர்-சிவப்பு அளவுகோல் செயல்பாட்டில்.',
      },
      ml: {
        bannerTitle: `ഉയർന്ന ചൂട് / WBGT — ${wbgt} (${rangeLow}–${rangeHigh} ഉയർന്ന അപകടസാധ്യത)`,
        headline: `കടുത്ത ചൂട് സമ്മർദ്ദം — WBGT ${wbgt} · വായു ${air}`,
        action: `പരിസ്ഥിതി താപ സെൻസറുകൾ ${rangeLow}–${rangeHigh} ഉയർന്ന അപകടമേഖല കണ്ടെത്തി. തണലിലേക്കുള്ള മാറ്റം നിർബന്ധമാണ്.`,
        secondaryDetail: 'Gemma 4 എഡ്ജ് ഓഫ്‌ലൈൻ മോഡിൽ ആംബർ-ടു-റെഡ് ആർക്ക് ഗേജ് സജീവം.',
      },
      ne: {
        bannerTitle: `उच्च ताप / WBGT — ${wbgt} (${rangeLow}–${rangeHigh} उच्च जोखिम)`,
        headline: `उच्च ताप दबाब — WBGT ${wbgt} · हावा ${air}`,
        action: `वातावरणीय ताप सेन्सरले ${rangeLow}–${rangeHigh} उच्च जोखिम देखाएको छ। छायामा विश्राम अनिवार्य छ।`,
        secondaryDetail: 'Gemma 4 एज अफलाइन मोडमा एम्बर-टु-रेड आर्क गेज सक्रिय।',
      },
      si: {
        bannerTitle: `අධික තාපය / WBGT — ${wbgt} (${rangeLow}–${rangeHigh} අධි අවදානම්)`,
        headline: `අධික තාප පීඩනය — WBGT ${wbgt} · වාතය ${air}`,
        action: `පාරිසරික තාප සංවේදක ${rangeLow}–${rangeHigh} අධි අවදානම් කලාපය පෙන්වයි. සෙවණේ විවේකය අනිවාර්ය වේ.`,
        secondaryDetail: 'Gemma 4 එජ් නොබැඳි මාදිලිය යටතේ ඇම්බර්-රතු මාපකය සක්‍රීයයි.',
      },
    };
    return byLang[language];
  }

  // sos_active
  const byLang: Record<SupportedLanguage, WearableAlertLocalizedSpec> = {
    en: {
      bannerTitle: 'SOS ACTIVE — SUPERVISOR & MEDIC NOTIFIED',
      headline: 'SOS ACTIVE — SUPERVISOR & MEDIC NOTIFIED',
      action: `Distress Sensor ACTIVE · HR 98 bpm · Skin Temp ${skin}. Live escalation stream active — remain still in shaded recovery zone.`,
      secondaryDetail: 'Site HSE Supervisor and Medical Response Unit dispatched to Zone A · Rebar Deck.',
    },
    ar: {
      bannerTitle: 'نداء استغاثة SOS نشط — تم إشعار المشرف والمسعف',
      headline: 'نداء استغاثة SOS نشط — تم إشعار المشرف والمسعف',
      action: `مستشعر الطوارئ نشط · النبض 98 bpm · حرارة الجلد ${skin}. بث التصعيد المباشر نشط — ابقَ ساكناً في منطقة الظل.`,
      secondaryDetail: 'تم إرسال مشرف السلامة وفريق الإسعاف إلى Zone A · Rebar Deck.',
    },
    hi: {
      bannerTitle: 'SOS सक्रिय — पर्यवेक्षक और चिकित्सक को सूचित किया गया',
      headline: 'SOS सक्रिय — पर्यवेक्षक और चिकित्सक को सूचित किया गया',
      action: `डिस्ट्रेस सेंसर सक्रिय · हृदय गति 98 bpm · त्वचा तापमान ${skin}। लाइव एस्केलेशन स्ट्रीम चालू — छाया में शांत रहें।`,
      secondaryDetail: 'साइट HSE पर्यवेक्षक और मेडिकल टीम Zone A · Rebar Deck के लिए रवाना।',
    },
    ur: {
      bannerTitle: 'SOS فعال — سپروائزر اور میڈیکل ٹیم کو مطلع کر دیا گیا',
      headline: 'SOS فعال — سپروائزر اور میڈیکل ٹیم کو مطلع کر دیا گیا',
      action: `ڈسٹریس سینسر فعال · دل کی دھڑکن 98 bpm · جلد کا درجہ حرارت ${skin}۔ لائیو ایسکلیشن اسٹریم جاری ہے۔`,
      secondaryDetail: 'سائٹ سپروائزر اور میڈیکل ٹیم Zone A · Rebar Deck روانہ ہو چکے ہیں۔',
    },
    bn: {
      bannerTitle: 'SOS সক্রিয় — সুপারভাইজার ও মেডিকেল টিমকে জানানো হয়েছে',
      headline: 'SOS সক্রিয় — সুপারভাইজার ও মেডিকেল টিমকে জানানো হয়েছে',
      action: `ডিস্ট্রেস সেন্সর সক্রিয় · HR 98 bpm · ত্বকের তাপমাত্রা ${skin}। লাইভ এসকেলেশন স্ট্রিম চালু — ছায়ায় স্থির থাকুন।`,
      secondaryDetail: 'সাইট সুপারভাইজার ও মেডিকেল রেসপন্স টিম Zone A · Rebar Deck-এ পাঠানো হয়েছে।',
    },
    tl: {
      bannerTitle: 'SOS AKTIBO — NAABISUHAN NA ANG SUPERVISOR AT MEDIC',
      headline: 'SOS AKTIBO — NAABISUHAN NA ANG SUPERVISOR AT MEDIC',
      action: `Distress Sensor AKTIBO · HR 98 bpm · Skin Temp ${skin}. Aktibo ang live escalation stream — manatili sa lilim.`,
      secondaryDetail: 'Papunta na ang Site HSE Supervisor at Medic sa Zone A · Rebar Deck.',
    },
    ta: {
      bannerTitle: 'SOS செயல்பாட்டில் — மேற்பார்வையாளர் & மருத்துவருக்கு தகவல் அனுப்பப்பட்டது',
      headline: 'SOS செயல்பாட்டில் — மேற்பார்வையாளர் & மருத்துவருக்கு தகவல் அனுப்பப்பட்டது',
      action: `அவசர சென்சார் செயல்பாட்டில் · இதயத் துடிப்பு 98 bpm · தோல் வெப்பநிலை ${skin}. நிழல் பகுதியில் அமைதியாக இருங்கள்.`,
      secondaryDetail: 'தள HSE மேற்பார்வையாளர் மற்றும் மருத்துவக் குழு Zone A · Rebar Deck நோக்கி புறப்பட்டுள்ளனர்.',
    },
    ml: {
      bannerTitle: 'SOS സജീവം — സൂപ്പർവൈസറെയും മെഡിക്കിനെയും അറിയിച്ചു',
      headline: 'SOS സജീവം — സൂപ്പർവൈസറെയും മെഡിക്കിനെയും അറിയിച്ചു',
      action: `ഡിസ്ട്രസ് സെൻസർ സജീവം · HR 98 bpm · ചർമ്മ താപനില ${skin}. തണലിൽ വിശ്രമിക്കുക; തത്സമയ സഹായം വരുന്നു.`,
      secondaryDetail: 'സൈറ്റ് HSE സൂപ്പർവൈസറും മെഡിക്കൽ ടീമും Zone A · Rebar Deck-ലേക്ക് പുറപ്പെട്ടു.',
    },
    ne: {
      bannerTitle: 'SOS सक्रिय — सुपरभाइजर र मेडिकल टोलीलाई सूचित गरियो',
      headline: 'SOS सक्रिय — सुपरभाइजर र मेडिकल टोलीलाई सूचित गरियो',
      action: `डिस्ट्रेस सेन्सर सक्रिय · HR 98 bpm · छालाको तापक्रम ${skin}। छायामा स्थिर बस्नुहोस्, सहयोग आउँदैछ।`,
      secondaryDetail: 'साइट HSE सुपरभाइजर र मेडिकल टोली Zone A · Rebar Deck तर्फ प्रस्थान गरिसकेका छन्।',
    },
    si: {
      bannerTitle: 'SOS සක්‍රීයයි — පරීක්ෂකවරයා සහ වෛද්‍ය කණ්ඩායම දැනුවත් කළා',
      headline: 'SOS සක්‍රීයයි — පරීක්ෂකවරයා සහ වෛද්‍ය කණ්ඩායම දැනුවත් කළා',
      action: `හදිසි සංවේදකය සක්‍රීයයි · හෘද ස්පන්දනය 98 bpm · සමේ උෂ්ණත්වය ${skin}. සෙවණේ නිසලව සිටින්න, සජීවී සහාය පැමිණේ.`,
      secondaryDetail: 'වැඩබිමේ HSE පරීක්ෂකවරයා සහ වෛද්‍ය කණ්ඩායම Zone A · Rebar Deck වෙත පිටත් වී ඇත.',
    },
  };
  return byLang[language];
}
