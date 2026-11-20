import { predictCompositeTrajectory } from '../shared/forecastEngine.ts';
import { RISK_TIER_THRESHOLDS, assessWorkerHeatRisk } from '../shared/riskEngine.ts';
import {
  SUPPORTED_LANGUAGES,
  type BLETelemetryFrame,
  type BreakRecord,
  type ComplianceNarrativeRecord,
  type CustomAlertMessages,
  type EnvironmentalObservation,
  type FaultFlags,
  type ForecastOutput,
  type IncidentLogEntry,
  type RiskAssessment,
  type RiskTier,
  type ShiftRotationSuggestion,
  type SupportedLanguage,
  type TelemetryHistoryPoint,
  type TemperatureThresholdConfig,
  type UaeSiteHubId,
  type VoiceIncidentSeverity,
  type WorkerAlertCopy,
  type WorkerContext,
  type WorkerStateSelf,
  type WorkerStatusPublic,
} from '../shared/types.ts';
import {
  ABU_DHABI_COORDS,
  estimateAbuDhabiSolarWm2,
  getAbuDhabiGstTimeParts,
  synthesizeGemma4EdgeObservation,
} from '../shared/edgeWeatherFallback.ts';
import {
  UAE_SITE_HUBS,
  computeOutdoorWbgt,
  getHistoricalObservationForHour,
  isInMiddayBreakWindow,
} from '../shared/uaeWeatherData.ts';
import {
  buildDeterministicFallback,
  clearAlertTranslationCache,
  getMultilingualWorkerAlert,
} from './geminiService.ts';

interface InternalWorkerRecord {
  context: WorkerContext;
  latestFrame: BLETelemetryFrame;
  faults: FaultFlags;
  assessment: RiskAssessment;
  forecast: ForecastOutput;
  history: TelemetryHistoryPoint[];
  alertTranslations: Record<SupportedLanguage, WorkerAlertCopy>;
  lastCheckIn: { status: 'okay' | 'help'; timestamp: string } | null;
  acknowledged: boolean;
  supervisorDirective: string | null;
  simulatedClockMin: number;
  heatRampActive: boolean;
}

class SiteGuardStore {
  private env: EnvironmentalObservation;
  private selectedHeatwaveHour = 11; // 11:00 GST peak ramp pre-midday break
  private selectedHubId: UaeSiteHubId = 'abu_dhabi_mussafah';
  private lastKnownLiveEnv: EnvironmentalObservation | null = null;
  private simulateEdgeOffline = false;
  private envGeneration = 0;
  private openWeatherDisabledUntil = 0;
  private openWeatherDisabledKey: string | null = null;
  private workers = new Map<string, InternalWorkerRecord>();
  private incidents: IncidentLogEntry[] = [];
  private complianceNarrative: ComplianceNarrativeRecord | null = null;
  private alertPolicy: TemperatureThresholdConfig;

  constructor() {
    this.env = getHistoricalObservationForHour(this.selectedHeatwaveHour, this.selectedHubId);
    this.alertPolicy = this.createDefaultAlertPolicy();
    this.seedInitialCrew();
    void this.bootstrapLiveFeed();
  }

  private async bootstrapLiveFeed(): Promise<void> {
    const bootGen = this.envGeneration;
    await this.fetchLiveAbuDhabiWeather({ expectedGen: bootGen });
  }

  private createDefaultAlertPolicy(): TemperatureThresholdConfig {
    return {
      enabled: false,
      amberWbgtThresholdC: 26.0,
      redWbgtThresholdC: 29.0,
      customMessages: {
        en: {
          amberHeadline: 'CUSTOM HEAT ALERT — SHADE REST',
          amberAction: 'Site threshold reached: pause heavy tasks and take a 15-min shaded hydration break.',
          redHeadline: 'CRITICAL SITE HEAT LIMIT — STOP WORK',
          redAction: 'Critical WBGT limit exceeded: halt outdoor work immediately and move to AC recovery.',
        },
        ar: {
          amberHeadline: 'تنبيه حرارة مخصص — استراحة في الظل',
          amberAction: 'تم بلوغ حد الموقع: أوقف الأعمال الشاقة وخذ استراحة ترطيب لمدة 15 دقيقة في الظل.',
          redHeadline: 'حد حرارة حرج بالموقع — أوقف العمل',
          redAction: 'تم تجاوز حد WBGT الحرج: أوقف العمل الخارجي فوراً وانتقل إلى نقطة التبريد المكيفة.',
        },
        hi: {
          amberHeadline: 'कस्टम हीट अलर्ट — छाया में आराम करें',
          amberAction: 'साइट तापमान सीमा पार हो गई है: भारी काम रोकें और 15 मिनट छाया में पानी पिएं।',
          redHeadline: 'गंभीर तापमान सीमा — काम तुरंत रोकें',
          redAction: 'खतरनाक WBGT स्तर: तुरंत काम बंद करें और एसी कूलिंग स्टेशन जाएं।',
        },
        ur: {
          amberHeadline: 'حسبِ ضرورت گرمی الرٹ — سائے میں آرام کریں',
          amberAction: 'سائٹ درجہ حرارت کی حد پوری ہو گئی ہے: کام روکیں اور 15 منٹ سائے میں پانی پئیں۔',
          redHeadline: 'انتہائی گرمی کی حد — کام فوراً بند کریں',
          redAction: 'خطرناک WBGT حد سے تجاوز: فوری طور پر کام روکیں اور ٹھنڈی جگہ پر منتقل ہوں۔',
        },
        bn: {
          amberHeadline: 'কাস্টম হিট অ্যালার্ট — ছায়ায় বিশ্রাম নিন',
          amberAction: 'সাইটের তাপমাত্রা সীমা অতিক্রম করেছে: ভারী কাজ থামিয়ে ১৫ মিনিট ছায়ায় পানি পান করুন।',
          redHeadline: 'গুরুতর তাপমাত্রা সীমা — কাজ এখনই বন্ধ করুন',
          redAction: 'বিপজ্জনক WBGT সীমা অতিক্রম হয়েছে: দ্রুত কাজ বন্ধ করে শীতল স্থানে যান।',
        },
        tl: {
          amberHeadline: 'PASADYANG BABALA SA INIT — MAGPAHINGA',
          amberAction: 'Naabot ang limitasyon ng site: ihinto muna ang mabigat na trabaho at uminom ng tubig sa lilim.',
          redHeadline: 'KRITIKAL NA LIMITASYON — ITIGIL ANG TRABAHO',
          redAction: 'Lumampas sa ligtas na WBGT: itigil agad ang trabaho at pumunta sa malamig na lugar.',
        },
        ta: {
          amberHeadline: 'தள வெப்ப எச்சரிக்கை — நிழலில் ஓய்வெடுங்கள்',
          amberAction: 'தள வெப்ப எல்லை எட்டப்பட்டது: கடின வேலையை நிறுத்தி 15 நிமிடம் நிழலில் தண்ணீர் குடிக்கவும்.',
          redHeadline: 'அபாய வெப்ப எல்லை — உடனே வேலையை நிறுத்துங்கள்',
          redAction: 'அபாய WBGT அளவைத் தாண்டியது: வெளிப்புற வேலையை உடனே நிறுத்தி ஏசி ஓய்வறைக்குச் செல்லுங்கள்.',
        },
        ml: {
          amberHeadline: 'കസ്റ്റം ഹീറ്റ് അലർട്ട് — തണലിൽ വിശ്രമിക്കുക',
          amberAction: 'സൈറ്റ് പരിധി എത്തി: ഭാരമേറിയ ജോലികൾ നിർത്തി 15 മിനിറ്റ് തണലിൽ വെള്ളം കുടിക്കുക.',
          redHeadline: 'അതീവ താപ പരിധി — ഉടൻ ജോലി നിർത്തുക',
          redAction: 'അപകടകരമായ WBGT പരിധി കടന്നു: ഉടൻ ജോലി നിർത്തി എസി വിശ്രമകേന്ദ്രത്തിലേക്ക് മാറുക.',
        },
        ne: {
          amberHeadline: 'कस्टम ताप चेतावनी — छायामा विश्राम लिनुहोस्',
          amberAction: 'साइट सीमा पुगेको छ: भारी काम रोक्नुहोस् र १५ मिनेट छायामा पानी पिउनुहोस्।',
          redHeadline: 'गम्भीर ताप सीमा — काम तुरुन्त रोक्नुहोस्',
          redAction: 'खतरनाक WBGT सीमा पार भयो: तुरुन्त काम रोकी एसी विश्रामस्थलमा जानुहोस्।',
        },
        si: {
          amberHeadline: 'අභිරුචි තාප අනතුරු ඇඟවීම — සෙවණේ විවේක ගන්න',
          amberAction: 'වැඩබිමේ උෂ්ණත්ව සීමාව ළඟා විය: බර වැඩ නවතා සෙවණේ විනාඩි 15ක් ජලය පානය කරන්න.',
          redHeadline: 'බරපතල තාප සීමාව — වැඩ වහාම නවතන්න',
          redAction: 'අනතුරුදායක WBGT සීමාව ඉක්මවා ඇත: එළිමහන් වැඩ වහාම නවතා AC විවේකාගාරයට යන්න.',
        },
      },
      updatedAt: new Date().toISOString(),
    };
  }

  private applyCustomMessageOverrides(
    assessment: RiskAssessment,
    translations: Record<SupportedLanguage, WorkerAlertCopy>
  ): Record<SupportedLanguage, WorkerAlertCopy> {
    if (!this.alertPolicy.enabled || assessment.tier === 'Green') {
      return translations;
    }
    const next = { ...translations };
    for (const lang of SUPPORTED_LANGUAGES) {
      const rule = this.alertPolicy.customMessages[lang];
      const existing = next[lang];
      if (!rule || !existing) continue;
      if (assessment.tier === 'Red') {
        next[lang] = {
          ...existing,
          headline: rule.redHeadline.trim() || existing.headline,
          action: rule.redAction.trim() || existing.action,
        };
      } else if (assessment.tier === 'Amber') {
        next[lang] = {
          ...existing,
          headline: rule.amberHeadline.trim() || existing.headline,
          action: rule.amberAction.trim() || existing.action,
        };
      }
    }
    return next;
  }

  private seedInitialCrew() {
    const nowIso = new Date().toISOString();
    const initialSpecs: Array<{
      context: WorkerContext;
      hrBpm: number;
      skinTempC: number;
      exertion: number;
      trendSlope: number;
      faults?: Partial<FaultFlags>;
    }> = [
      {
        context: {
          workerId: 'W-101',
          deviceId: 'BLE-BAND-101',
          roleLabel: 'Steel Fixer',
          zone: 'Zone A · Rebar Deck',
          ppeLevel: 'Standard Coverall',
          acclimatizationDays: 3, // Unacclimatized
          ageYears: 29,
          hr0: 68,
          tc0: 36.7,
          preferredLanguage: 'en',
          plannedBreakTime: '12:30',
          hydrationCount: 2,
          breaksTakenTodayMin: 20,
        },
        hrBpm: 90,
        skinTempC: 34.0,
        exertion: 5.5,
        trendSlope: 0.14, // Starts Green (~3.8) and climbs -> triggers proactive Amber forecast!
      },
      {
        context: {
          workerId: 'W-102',
          deviceId: 'BLE-BAND-102',
          roleLabel: 'Scaffold Rigger',
          zone: 'Zone B · Tower West',
          ppeLevel: 'FR / Arc-Flash',
          acclimatizationDays: 14,
          ageYears: 34,
          hr0: 70,
          tc0: 36.75,
          preferredLanguage: 'ur',
          plannedBreakTime: '12:30',
          hydrationCount: 3,
          breaksTakenTodayMin: 35,
        },
        hrBpm: 138,
        skinTempC: 36.0,
        exertion: 7.4,
        trendSlope: 0.08, // Already Amber
      },
      {
        context: {
          workerId: 'W-103',
          deviceId: 'BLE-BAND-103',
          roleLabel: 'Concrete Pour Crew',
          zone: 'Zone A · Foundation Slab',
          ppeLevel: 'Standard Coverall',
          acclimatizationDays: 18,
          ageYears: 27,
          hr0: 66,
          tc0: 36.65,
          preferredLanguage: 'bn',
          plannedBreakTime: '12:30',
          hydrationCount: 4,
          breaksTakenTodayMin: 45,
        },
        hrBpm: 104,
        skinTempC: 34.4,
        exertion: 5.0,
        trendSlope: 0.02, // Green
      },
      {
        context: {
          workerId: 'W-104',
          deviceId: 'BLE-BAND-104',
          roleLabel: 'Tank Coating Tech',
          zone: 'Zone C · Enclosed Bay',
          ppeLevel: 'Chemical / Tyvek',
          acclimatizationDays: 5,
          ageYears: 38,
          hr0: 72,
          tc0: 36.8,
          preferredLanguage: 'tl',
          plannedBreakTime: '12:30',
          hydrationCount: 2,
          breaksTakenTodayMin: 15,
        },
        hrBpm: 156,
        skinTempC: 36.9,
        exertion: 8.2,
        trendSlope: 0.12, // Red critical strain
      },
      {
        context: {
          workerId: 'W-105',
          deviceId: 'BLE-BAND-105',
          roleLabel: 'Electrical Maintenance',
          zone: 'Zone B · Substation Pad',
          ppeLevel: 'FR / Arc-Flash',
          acclimatizationDays: 12,
          ageYears: 41,
          hr0: 69,
          tc0: 36.7,
          preferredLanguage: 'en',
          plannedBreakTime: '12:30',
          hydrationCount: 3,
          breaksTakenTodayMin: 30,
        },
        hrBpm: 108,
        skinTempC: 34.6,
        exertion: 4.5,
        trendSlope: 0.01,
      },
      {
        context: {
          workerId: 'W-106',
          deviceId: 'BLE-BAND-106',
          roleLabel: 'Crane Signalman',
          zone: 'Zone D · Laydown Yard',
          ppeLevel: 'Standard Coverall',
          acclimatizationDays: 21,
          ageYears: 31,
          hr0: 65,
          tc0: 36.65,
          preferredLanguage: 'hi',
          plannedBreakTime: '12:30',
          hydrationCount: 4,
          breaksTakenTodayMin: 40,
        },
        hrBpm: 98,
        skinTempC: 34.1,
        exertion: 3.5,
        trendSlope: 0.01,
      },
    ];

    for (const spec of initialSpecs) {
      const faults: FaultFlags = {
        bleDisconnected: false,
        lowBattery: false,
        sensorNoise: false,
        gpsLoss: false,
        ...spec.faults,
      };

      // Seed 12 minutes (5 samples at -12, -9, -6, -3, 0) so forecast trend window is populated realistically
      const history: TelemetryHistoryPoint[] = [];
      let lastAssessment!: RiskAssessment;
      let lastFrame!: BLETelemetryFrame;

      const seedBatMap: Record<string, number> = {
        'W-101': 95,
        'W-102': 79,
        'W-103': 92,
        'W-104': 68,
        'W-105': 89,
        'W-106': 84,
      };
      const baseSeedBat = seedBatMap[spec.context.workerId] ?? 90;

      for (let step = 0; step < 5; step++) {
        const minOffset = step * 3;
        const backSteps = 4 - step;
        const hr = Math.max(spec.context.hr0 + 6, Math.round(spec.hrBpm - backSteps * spec.trendSlope * 45));
        const skin = Number(Math.max(33.4, spec.skinTempC - backSteps * spec.trendSlope * 1.4).toFixed(2));
        const frame: BLETelemetryFrame = {
          deviceId: spec.context.deviceId,
          workerId: spec.context.workerId,
          timestamp: new Date(Date.now() - backSteps * 180_000).toISOString(),
          hrBpm: hr,
          skinTempC: skin,
          exertionIndex: spec.exertion,
          batteryPct: Math.max(15, baseSeedBat - Math.floor(step / 2)),
          rssiDbm: -61,
          gpsFix: true,
          signalQuality: 0.97,
          simulatedClockMin: minOffset,
        };
        lastAssessment = assessWorkerHeatRisk(spec.context, frame, this.env, faults, this.alertPolicy);
        lastFrame = frame;
        history.push({
          minuteOffset: minOffset,
          timestamp: frame.timestamp,
          psi: lastAssessment.psi,
          compositeScore: lastAssessment.compositeScore,
          wbgtC: this.env.wbgtC,
          degraded: lastAssessment.scoringMode === 'environment_only_degraded',
        });
      }

      const forecast = predictCompositeTrajectory(history, 0.45);
      // Use deterministic fallback synchronously at boot; live API calls invoke Gemini and cache
      const alertTranslations = this.applyCustomMessageOverrides(
        lastAssessment,
        buildDeterministicFallback(spec.context, lastAssessment, forecast)
      );

      this.workers.set(spec.context.workerId, {
        context: spec.context,
        latestFrame: lastFrame,
        faults,
        assessment: lastAssessment,
        forecast,
        history,
        alertTranslations,
        lastCheckIn: null,
        acknowledged: false,
        supervisorDirective: null,
        simulatedClockMin: 12,
        heatRampActive: spec.context.workerId === 'W-101',
      });

      if (lastAssessment.tier === 'Red') {
        this.logIncident({
          workerId: spec.context.workerId,
          roleLabel: spec.context.roleLabel,
          zone: spec.context.zone,
          eventType: 'red_stop_work',
          severity: 'Red',
          summary: `Composite strain ${lastAssessment.compositeScore}/10 in ${spec.context.ppeLevel}`,
          actionTaken: 'Automatic Stop-Work triggered; escalated to Site Supervisor.',
        });
      } else if (lastAssessment.tier === 'Amber') {
        this.logIncident({
          workerId: spec.context.workerId,
          roleLabel: spec.context.roleLabel,
          zone: spec.context.zone,
          eventType: 'amber_rest_order',
          severity: 'Amber',
          summary: `Elevated heat strain (${lastAssessment.compositeScore}/10) under WBGT ${this.env.wbgtC}°C`,
          actionTaken: 'Mandatory 15-min shaded rest break queued.',
        });
      }
    }
  }

  private logIncident(entry: Omit<IncidentLogEntry, 'id' | 'timestamp' | 'resolved'>) {
    this.incidents.unshift({
      id: `EVT-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 900 + 100)}`,
      timestamp: new Date().toISOString(),
      resolved: false,
      ...entry,
    });
    if (this.incidents.length > 60) {
      this.incidents = this.incidents.slice(0, 60);
    }
  }

  public getEnvironment(): EnvironmentalObservation {
    return this.env;
  }

  public getSelectedHubId(): UaeSiteHubId {
    return this.selectedHubId;
  }

  public async setActiveHub(
    hubId: UaeSiteHubId,
    options?: { hourGst?: number; mode?: 'historical_heatwave' | 'live_abu_dhabi' }
  ): Promise<EnvironmentalObservation> {
    this.selectedHubId = UAE_SITE_HUBS[hubId] ? hubId : 'abu_dhabi_mussafah';
    const targetMode = options?.mode ?? (typeof options?.hourGst === 'number' ? 'historical_heatwave' : this.env.mode);
    if (targetMode === 'live_abu_dhabi' && typeof options?.hourGst !== 'number') {
      return this.fetchLiveAbuDhabiWeather({ simulateOffline: this.simulateEdgeOffline });
    }
    return this.setHistoricalHour(options?.hourGst ?? this.selectedHeatwaveHour, this.selectedHubId);
  }

  public setHistoricalHour(hourGst: number, hubId?: UaeSiteHubId): EnvironmentalObservation {
    if (hubId && UAE_SITE_HUBS[hubId]) {
      this.selectedHubId = hubId;
    }
    this.envGeneration += 1;
    this.simulateEdgeOffline = false;
    this.selectedHeatwaveHour = Math.max(6, Math.min(19, Math.round(hourGst)));
    this.env = getHistoricalObservationForHour(this.selectedHeatwaveHour, this.selectedHubId);
    this.recomputeAllWorkersSync();
    return this.env;
  }

  private getUsableOpenWeatherApiKey(): string | null {
    const apiKey = process.env.OPENWEATHER_API_KEY?.trim();
    if (!apiKey) return null;
    if (/^(my_|your_|placeholder|demo|test|replace|changeme|<)/i.test(apiKey) || apiKey.length < 16) {
      return null;
    }
    if (this.openWeatherDisabledKey === apiKey && Date.now() < this.openWeatherDisabledUntil) {
      return null;
    }
    return apiKey;
  }

  private async fetchFromOpenWeatherMap(): Promise<EnvironmentalObservation | null> {
    const apiKey = this.getUsableOpenWeatherApiKey();
    if (!apiKey) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    try {
      const hub = UAE_SITE_HUBS[this.selectedHubId] ?? UAE_SITE_HUBS.abu_dhabi_mussafah;
      const targetLat = hub.id === 'abu_dhabi_mussafah' ? ABU_DHABI_COORDS.lat : hub.lat;
      const targetLon = hub.id === 'abu_dhabi_mussafah' ? ABU_DHABI_COORDS.lon : hub.lon;
      const url = `https://api.openweathermap.org/data/2.5/weather?lat=${targetLat}&lon=${targetLon}&units=metric&appid=${encodeURIComponent(apiKey)}`;
      const resp = await fetch(url, { signal: controller.signal });
      if (resp.status === 401 || resp.status === 403) {
        this.openWeatherDisabledKey = apiKey;
        this.openWeatherDisabledUntil = Date.now() + 30 * 60_000;
        console.info(
          `[Env] OpenWeatherMap key unauthorized (HTTP ${resp.status}); routing Live Abu Dhabi Feed to Open-Meteo.`
        );
        return null;
      }
      if (!resp.ok) {
        console.info(
          `[Env] OpenWeatherMap returned HTTP ${resp.status}; routing Live Abu Dhabi Feed to Open-Meteo.`
        );
        return null;
      }
      const json = (await resp.json()) as {
        dt?: number;
        name?: string;
        main?: { temp?: number; humidity?: number };
        wind?: { speed?: number };
        clouds?: { all?: number };
      };
      const airTemp = json.main?.temp;
      const humidity = json.main?.humidity;
      if (typeof airTemp !== 'number' || !Number.isFinite(airTemp) || typeof humidity !== 'number' || !Number.isFinite(humidity)) {
        throw new Error('OpenWeatherMap response missing valid temperature/humidity');
      }

      const windMs = Number(Math.max(0.4, json.wind?.speed ?? 2.8).toFixed(1));
      const obsDate = typeof json.dt === 'number' ? new Date(json.dt * 1000) : new Date();
      const { hourGst, minuteGst } = getAbuDhabiGstTimeParts(obsDate);
      const solarWm2 = Math.round(estimateAbuDhabiSolarWm2(hourGst, json.clouds?.all ?? 8) * hub.solarMultiplier);
      const { wetBulbC, globeTempC, wbgtC, heatIndexC } = computeOutdoorWbgt(
        airTemp,
        humidity,
        windMs,
        solarWm2
      );
      const nowIso = new Date().toISOString();

      return {
        timestampIso: obsDate.toISOString(),
        hourGst,
        station:
          hub.id === 'abu_dhabi_mussafah'
            ? `Abu Dhabi Live Station (OpenWeatherMap · ${json.name || 'Abu Dhabi'} 24.45°N, 54.38°E)`
            : `${hub.station} (OpenWeatherMap · ${targetLat.toFixed(2)}°N, ${targetLon.toFixed(2)}°E)`,
        lat: targetLat,
        lon: targetLon,
        airTempC: Number(airTemp.toFixed(1)),
        relHumidityPct: Math.round(humidity),
        windSpeedMs: windMs,
        solarWm2,
        wetBulbC,
        globeTempC,
        wbgtC,
        heatIndexC,
        mode: 'live_abu_dhabi',
        hubId: hub.id,
        emirate: hub.emirate,
        sourceLabel:
          hub.id === 'abu_dhabi_mussafah'
            ? 'Live Abu Dhabi Feed (OpenWeatherMap API)'
            : `Live ${hub.shortLabel} Feed (OpenWeatherMap API)`,
        inUaeMiddayBreakWindow: isInMiddayBreakWindow(hourGst, minuteGst),
        feedStatus: 'live_abu_dhabi_feed',
        provider: 'OpenWeatherMap',
        edgeOfflineActive: false,
        lastLiveSyncIso: nowIso,
        resilienceReason: null,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchFromOpenMeteo(): Promise<EnvironmentalObservation> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);
    try {
      const hub = UAE_SITE_HUBS[this.selectedHubId] ?? UAE_SITE_HUBS.abu_dhabi_mussafah;
      const targetLat = hub.id === 'abu_dhabi_mussafah' ? ABU_DHABI_COORDS.lat : hub.lat;
      const targetLon = hub.id === 'abu_dhabi_mussafah' ? ABU_DHABI_COORDS.lon : hub.lon;
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${targetLat}&longitude=${targetLon}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,shortwave_radiation&timezone=Asia%2FDubai`;
      const resp = await fetch(url, { signal: controller.signal });
      if (!resp.ok) throw new Error(`Open-Meteo HTTP ${resp.status}`);
      const json = (await resp.json()) as {
        current?: {
          time: string;
          temperature_2m: number;
          relative_humidity_2m: number;
          wind_speed_10m: number;
          shortwave_radiation: number;
        };
      };
      const cur = json.current;
      if (
        !cur ||
        typeof cur.temperature_2m !== 'number' ||
        !Number.isFinite(cur.temperature_2m) ||
        typeof cur.relative_humidity_2m !== 'number' ||
        !Number.isFinite(cur.relative_humidity_2m)
      ) {
        throw new Error('Open-Meteo response missing valid current weather payload');
      }

      const windMs = Number(Math.max(0.4, (cur.wind_speed_10m ?? 10) / 3.6).toFixed(1));
      const { hourGst: fallbackHour, minuteGst: fallbackMin } = getAbuDhabiGstTimeParts();
      const dt = new Date(cur.time);
      const hourGst = isNaN(dt.getHours()) ? fallbackHour : dt.getHours();
      const minGst = isNaN(dt.getMinutes()) ? fallbackMin : dt.getMinutes();
      const solarWm2 = Math.round(
        (typeof cur.shortwave_radiation === 'number' && Number.isFinite(cur.shortwave_radiation)
          ? cur.shortwave_radiation
          : estimateAbuDhabiSolarWm2(hourGst, 8)) * hub.solarMultiplier
      );

      const { wetBulbC, globeTempC, wbgtC, heatIndexC } = computeOutdoorWbgt(
        cur.temperature_2m,
        cur.relative_humidity_2m,
        windMs,
        solarWm2
      );
      const nowIso = new Date().toISOString();

      return {
        timestampIso: cur.time,
        hourGst,
        station:
          hub.id === 'abu_dhabi_mussafah'
            ? 'Abu Dhabi Live Station (Open-Meteo 24.45°N, 54.38°E)'
            : `${hub.station} (Open-Meteo ${targetLat.toFixed(2)}°N, ${targetLon.toFixed(2)}°E)`,
        lat: targetLat,
        lon: targetLon,
        airTempC: Number(cur.temperature_2m.toFixed(1)),
        relHumidityPct: Math.round(cur.relative_humidity_2m),
        windSpeedMs: windMs,
        solarWm2,
        wetBulbC,
        globeTempC,
        wbgtC,
        heatIndexC,
        mode: 'live_abu_dhabi',
        hubId: hub.id,
        emirate: hub.emirate,
        sourceLabel:
          hub.id === 'abu_dhabi_mussafah'
            ? 'Live Abu Dhabi Feed (Open-Meteo API)'
            : `Live ${hub.shortLabel} Feed (Open-Meteo API)`,
        inUaeMiddayBreakWindow: isInMiddayBreakWindow(hourGst, minGst),
        feedStatus: 'live_abu_dhabi_feed',
        provider: 'Open-Meteo',
        edgeOfflineActive: false,
        lastLiveSyncIso: nowIso,
        resilienceReason: null,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  public async fetchLiveAbuDhabiWeather(options?: {
    simulateOffline?: boolean;
    expectedGen?: number;
  }): Promise<EnvironmentalObservation> {
    if (options?.expectedGen === undefined) {
      this.envGeneration += 1;
    }
    const activeGen = options?.expectedGen ?? this.envGeneration;

    if (typeof options?.simulateOffline === 'boolean') {
      this.simulateEdgeOffline = options.simulateOffline;
    }

    if (this.simulateEdgeOffline) {
      if (activeGen !== this.envGeneration) return this.env;
      this.env = synthesizeGemma4EdgeObservation(
        this.lastKnownLiveEnv,
        'Edge offline mode active — Gemma 4 local inference sustaining worker predictions'
      );
      this.recomputeAllWorkersSync();
      return this.env;
    }

    try {
      let liveEnv: EnvironmentalObservation | null = null;
      if (this.getUsableOpenWeatherApiKey()) {
        try {
          liveEnv = await this.fetchFromOpenWeatherMap();
        } catch {
          console.info('[Env] OpenWeatherMap unavailable; routing Live Abu Dhabi Feed to Open-Meteo.');
        }
      }

      if (!liveEnv) {
        liveEnv = await this.fetchFromOpenMeteo();
      }

      if (activeGen !== this.envGeneration) {
        return this.env;
      }

      this.lastKnownLiveEnv = liveEnv;
      this.env = liveEnv;
      this.recomputeAllWorkersSync();
      return this.env;
    } catch {
      if (activeGen !== this.envGeneration) {
        return this.env;
      }
      console.info('[Env] Live Abu Dhabi weather API unreachable — Gemma 4 Edge Offline Mode active.');
      this.env = synthesizeGemma4EdgeObservation(
        this.lastKnownLiveEnv,
        'Live weather API unreachable — seamlessly switched to Gemma 4 Edge Offline Mode'
      );
      this.recomputeAllWorkersSync();
      return this.env;
    }
  }

  private recomputeAllWorkersSync() {
    for (const rec of this.workers.values()) {
      rec.assessment = assessWorkerHeatRisk(rec.context, rec.latestFrame, this.env, rec.faults, this.alertPolicy);
      if (rec.history.length > 0) {
        const last = rec.history[rec.history.length - 1];
        rec.history[rec.history.length - 1] = {
          ...last,
          psi: rec.assessment.psi,
          compositeScore: rec.assessment.compositeScore,
          wbgtC: this.env.wbgtC,
          degraded: rec.assessment.scoringMode === 'environment_only_degraded',
        };
      }
      rec.forecast = predictCompositeTrajectory(rec.history, 0.45);
      rec.alertTranslations = this.applyCustomMessageOverrides(
        rec.assessment,
        buildDeterministicFallback(rec.context, rec.assessment, rec.forecast)
      );
    }
  }

  /**
   * Hardware-Agnostic BLE Ingestion Endpoint handler.
   * Both the UI wearable simulator AND a real BLE gateway call this exact flow.
   */
  public async ingestBleTelemetry(
    frame: BLETelemetryFrame,
    skipGemini = false
  ): Promise<WorkerStateSelf> {
    const rec = this.workers.get(frame.workerId);
    if (!rec) {
      throw new Error(`Unknown workerId: ${frame.workerId}`);
    }

    const prevTier = rec.assessment.tier;
    const prevMode = rec.assessment.scoringMode;

    // Sync fault flags inferred from incoming BLE frame hardware fields
    const effectiveFaults: FaultFlags = {
      bleDisconnected: rec.faults.bleDisconnected || frame.rssiDbm <= -120,
      lowBattery: rec.faults.lowBattery || frame.batteryPct < 10,
      sensorNoise: rec.faults.sensorNoise || frame.signalQuality < 0.5,
      gpsLoss: rec.faults.gpsLoss || !frame.gpsFix,
    };

    rec.simulatedClockMin = frame.simulatedClockMin ?? rec.simulatedClockMin + 3;
    rec.latestFrame = { ...frame, simulatedClockMin: rec.simulatedClockMin };
    rec.faults = effectiveFaults;

    rec.assessment = assessWorkerHeatRisk(rec.context, rec.latestFrame, this.env, rec.faults, this.alertPolicy);

    rec.history.push({
      minuteOffset: rec.simulatedClockMin,
      timestamp: rec.latestFrame.timestamp,
      psi: rec.assessment.psi,
      compositeScore: rec.assessment.compositeScore,
      wbgtC: this.env.wbgtC,
      degraded: rec.assessment.scoringMode === 'environment_only_degraded',
    });
    if (rec.history.length > 24) {
      rec.history = rec.history.slice(rec.history.length - 24);
    }

    rec.forecast = predictCompositeTrajectory(rec.history, 0.45);

    // Log tier escalations or fault degradations
    if (prevMode !== rec.assessment.scoringMode && rec.assessment.scoringMode === 'environment_only_degraded') {
      this.logIncident({
        workerId: rec.context.workerId,
        roleLabel: rec.context.roleLabel,
        zone: rec.context.zone,
        eventType: 'sensor_degradation',
        severity: 'System',
        summary: `Degraded to environment-only WBGT scoring: ${rec.assessment.degradedReason}`,
        actionTaken: 'Physiological stream isolated; scoring via ACGIH WBGT + PPE limits.',
      });
    }

    if (prevTier !== rec.assessment.tier) {
      if (rec.assessment.tier === 'Red') {
        rec.acknowledged = false;
        this.logIncident({
          workerId: rec.context.workerId,
          roleLabel: rec.context.roleLabel,
          zone: rec.context.zone,
          eventType: 'red_stop_work',
          severity: 'Red',
          summary: `Entered Red Critical Strain (${rec.assessment.compositeScore}/10)`,
          actionTaken: 'Stop-work alert issued to wearable; supervisor escalation logged.',
        });
      } else if (rec.assessment.tier === 'Amber') {
        rec.acknowledged = false;
        this.logIncident({
          workerId: rec.context.workerId,
          roleLabel: rec.context.roleLabel,
          zone: rec.context.zone,
          eventType: 'amber_rest_order',
          severity: 'Amber',
          summary: `Entered Amber Elevated Strain (${rec.assessment.compositeScore}/10)`,
          actionTaken: 'Mandatory 15-min shade rest order sent.',
        });
      }
    }

    if (!skipGemini) {
      const baseTranslations = await getMultilingualWorkerAlert(
        rec.context,
        rec.assessment,
        rec.forecast,
        this.env
      );
      rec.alertTranslations = this.applyCustomMessageOverrides(rec.assessment, baseTranslations);
    }

    return this.toWorkerSelf(rec);
  }

  public async setWorkerFault(
    workerId: string,
    faultKey: keyof FaultFlags | 'clear_all',
    active: boolean
  ): Promise<WorkerStateSelf> {
    const rec = this.workers.get(workerId);
    if (!rec) throw new Error(`Unknown workerId: ${workerId}`);

    if (faultKey === 'clear_all') {
      rec.faults = {
        bleDisconnected: false,
        lowBattery: false,
        sensorNoise: false,
        gpsLoss: false,
      };
      const cleanFrame: BLETelemetryFrame = {
        ...rec.latestFrame,
        batteryPct: Math.max(82, rec.latestFrame.batteryPct),
        rssiDbm: -60,
        gpsFix: true,
        signalQuality: 0.97,
        timestamp: new Date().toISOString(),
        simulatedClockMin: rec.simulatedClockMin + 3,
      };
      // Reset clean physiological trend tail after fault recovery -> forces "insufficient trend data" until 4 clean points arrive!
      return this.ingestBleTelemetry(cleanFrame);
    }

    rec.faults = { ...rec.faults, [faultKey]: active };
    const updatedFrame: BLETelemetryFrame = {
      ...rec.latestFrame,
      rssiDbm: rec.faults.bleDisconnected ? -999 : -61,
      batteryPct: rec.faults.lowBattery ? 6 : Math.max(82, rec.latestFrame.batteryPct),
      signalQuality: rec.faults.sensorNoise ? 0.22 : 0.97,
      gpsFix: !rec.faults.gpsLoss,
      timestamp: new Date().toISOString(),
      simulatedClockMin: rec.simulatedClockMin + 3,
    };

    if (faultKey === 'gpsLoss' && active) {
      this.logIncident({
        workerId: rec.context.workerId,
        roleLabel: rec.context.roleLabel,
        zone: rec.context.zone,
        eventType: 'gps_loss',
        severity: 'System',
        summary: 'Wearable GPS fix lost; falling back to last known work zone.',
        actionTaken: 'Zone telemetry pinned to last verified beacon.',
      });
    }

    return this.ingestBleTelemetry(updatedFrame);
  }

  /**
   * Advances simulated clock by +3 or +6 minutes along a realistic heat-strain trajectory
   * so users can watch the prospective forecast banner fire and then observe the predicted
   * tier crossing actually occur minutes later.
   */
  public async stepSimulatedClock(
    workerId: string,
    action: 'step_3m' | 'step_6m' | 'reset_cool'
  ): Promise<WorkerStateSelf> {
    const rec = this.workers.get(workerId);
    if (!rec) throw new Error(`Unknown workerId: ${workerId}`);

    if (action === 'reset_cool') {
      rec.faults = { bleDisconnected: false, lowBattery: false, sensorNoise: false, gpsLoss: false };
      rec.history = [];
      rec.simulatedClockMin = 0;
      const baseHr = rec.context.hr0 + 36;
      const baseSkin = 34.4;
      for (let i = 0; i < 4; i++) {
        const frame: BLETelemetryFrame = {
          deviceId: rec.context.deviceId,
          workerId: rec.context.workerId,
          timestamp: new Date(Date.now() - (3 - i) * 180_000).toISOString(),
          hrBpm: baseHr + i * 4,
          skinTempC: Number((baseSkin + i * 0.16).toFixed(2)),
          exertionIndex: 6.2,
          batteryPct: 88,
          rssiDbm: -59,
          gpsFix: true,
          signalQuality: 0.98,
          simulatedClockMin: i * 3,
        };
        await this.ingestBleTelemetry(frame, i < 3);
      }
      return this.getWorkerState(workerId);
    }

    const steps = action === 'step_6m' ? 2 : 1;
    let latest!: WorkerStateSelf;
    for (let s = 0; s < steps; s++) {
      const f = rec.latestFrame;
      // Realistic heat-accumulation step under high UAE WBGT
      const nextHr = Math.min(182, Math.round(f.hrBpm + (rec.faults.bleDisconnected ? 0 : 6)));
      const nextSkin = Number(Math.min(37.9, f.skinTempC + (rec.faults.bleDisconnected ? 0 : 0.24)).toFixed(2));
      const nextExertion = Number(Math.min(9.5, f.exertionIndex + 0.2).toFixed(1));
      const nextBat = rec.faults.lowBattery ? 6 : Math.max(14, f.batteryPct - 1);
      latest = await this.ingestBleTelemetry(
        {
          ...f,
          hrBpm: nextHr,
          skinTempC: nextSkin,
          exertionIndex: nextExertion,
          batteryPct: nextBat,
          timestamp: new Date().toISOString(),
          simulatedClockMin: rec.simulatedClockMin + 3,
        },
        s < steps - 1
      );
    }
    return latest;
  }

  public async setWorkerLanguage(workerId: string, lang: SupportedLanguage): Promise<WorkerStateSelf> {
    const rec = this.workers.get(workerId);
    if (!rec) throw new Error(`Unknown workerId: ${workerId}`);
    rec.context.preferredLanguage = lang;
    const baseTranslations = await getMultilingualWorkerAlert(
      rec.context,
      rec.assessment,
      rec.forecast,
      this.env
    );
    rec.alertTranslations = this.applyCustomMessageOverrides(rec.assessment, baseTranslations);
    return this.toWorkerSelf(rec);
  }

  public recordWorkerCheckIn(workerId: string, status: 'okay' | 'help'): WorkerStateSelf {
    const rec = this.workers.get(workerId);
    if (!rec) throw new Error(`Unknown workerId: ${workerId}`);
    const prevStatus = rec.lastCheckIn?.status;
    rec.lastCheckIn = { status, timestamp: new Date().toISOString() };
    if (status === 'help') {
      rec.acknowledged = false;
      rec.supervisorDirective =
        'SOS ACTIVE: Supervisor & Site HSE Medic alerted. Stop work and remain in shade.';
      this.logIncident({
        workerId: rec.context.workerId,
        roleLabel: rec.context.roleLabel,
        zone: rec.context.zone,
        eventType: 'worker_help_request',
        severity: 'Red',
        summary: 'Worker pressed NEED HELP on wearable unit.',
        actionTaken: 'Immediate supervisor & medic dispatch queued.',
      });
    } else {
      rec.context.hydrationCount += 1;
      if (prevStatus === 'help') {
        rec.supervisorDirective = 'Worker confirmed OKAY — SOS standing down; continue hydration.';
        this.logIncident({
          workerId: rec.context.workerId,
          roleLabel: rec.context.roleLabel,
          zone: rec.context.zone,
          eventType: 'supervisor_ack',
          severity: rec.assessment.tier,
          summary: `Worker ${rec.context.workerId} confirmed OKAY after help alert.`,
          actionTaken: 'SOS cleared by worker check-in; hydration logged.',
        });
      }
    }
    return this.toWorkerSelf(rec);
  }

  public recordVoiceIncident(
    workerId: string,
    params: {
      transcript: string;
      language: SupportedLanguage;
      source: 'gemini_transcribe' | 'browser_speech' | 'manual_note';
      severity?: VoiceIncidentSeverity;
    }
  ): { state: WorkerStateSelf; incident: IncidentLogEntry; selectedSeverity: VoiceIncidentSeverity } {
    const rec = this.workers.get(workerId);
    if (!rec) throw new Error(`Unknown workerId: ${workerId}`);

    const cleanTranscript = params.transcript.trim().slice(0, 500);
    const urgentPattern =
      /collapse|faint|dizzy|chest|heatstroke|vomit|emergency|medic|help|unconscious|blurry|fall|injury/i;

    const selectedSeverity: VoiceIncidentSeverity =
      params.severity === 'Low' || params.severity === 'Medium' || params.severity === 'High'
        ? params.severity
        : urgentPattern.test(cleanTranscript) || rec.assessment.tier === 'Red'
          ? 'High'
          : 'Medium';

    const severity: RiskTier =
      selectedSeverity === 'High' ? 'Red' : selectedSeverity === 'Medium' ? 'Amber' : 'Green';

    if (severity === 'Red') {
      rec.acknowledged = false;
      rec.supervisorDirective =
        'Voice Incident Escalated (High Severity): Stop work, remain in shade, supervisor & HSE medic notified.';
    }

    const entry: IncidentLogEntry = {
      id: `EVT-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 900 + 100)}`,
      timestamp: new Date().toISOString(),
      workerId: rec.context.workerId,
      roleLabel: rec.context.roleLabel,
      zone: rec.context.zone,
      eventType: 'worker_voice_report',
      severity,
      summary: `Voice Incident (${params.language.toUpperCase()} · ${selectedSeverity}): "${cleanTranscript}"`,
      actionTaken:
        params.source === 'gemini_transcribe'
          ? `Transcribed via Gemini Voice Incident Intake (${selectedSeverity} severity) & dispatched to supervisor feed.`
          : `Voice incident (${selectedSeverity} severity) logged directly to supervisor alert feed.`,
      resolved: false,
    };

    this.incidents.unshift(entry);
    if (this.incidents.length > 60) {
      this.incidents = this.incidents.slice(0, 60);
    }

    return {
      state: this.toWorkerSelf(rec),
      incident: entry,
      selectedSeverity,
    };
  }

  public async getWorkerState(workerId: string): Promise<WorkerStateSelf> {
    const rec = this.workers.get(workerId);
    if (!rec) throw new Error(`Unknown workerId: ${workerId}`);
    if (rec.alertTranslations.en.source === 'template_fallback' && process.env.GEMINI_API_KEY) {
      const baseTranslations = await getMultilingualWorkerAlert(
        rec.context,
        rec.assessment,
        rec.forecast,
        this.env
      );
      rec.alertTranslations = this.applyCustomMessageOverrides(rec.assessment, baseTranslations);
    } else {
      rec.alertTranslations = this.applyCustomMessageOverrides(rec.assessment, rec.alertTranslations);
    }
    return this.toWorkerSelf(rec);
  }

  public listWorkerIds(): { workerId: string; roleLabel: string; zone: string }[] {
    return Array.from(this.workers.values()).map((r) => ({
      workerId: r.context.workerId,
      roleLabel: r.context.roleLabel,
      zone: r.context.zone,
    }));
  }

  private toWorkerSelf(rec: InternalWorkerRecord): WorkerStateSelf {
    return {
      context: { ...rec.context },
      latestFrame: { ...rec.latestFrame },
      faults: { ...rec.faults },
      assessment: { ...rec.assessment },
      forecast: { ...rec.forecast },
      history: [...rec.history],
      alertTranslations: { ...rec.alertTranslations },
      lastCheckIn: rec.lastCheckIn ? { ...rec.lastCheckIn } : null,
      supervisorDirective: rec.supervisorDirective,
      simulatedClockMin: rec.simulatedClockMin,
      tierThresholds: { ...RISK_TIER_THRESHOLDS },
    };
  }

  /**
   * PRIVACY-ENFORCED SUPERVISOR PROJECTION.
   * Deliberately constructs WorkerStatusPublic containing ZERO raw vitals
   * (no hrBpm, no skinTempC, no exertionIndex, no hr0, no tc0, no psi raw).
   */
  public getSupervisorSnapshot(): {
    crew: WorkerStatusPublic[];
    needsBreakQueue: WorkerStatusPublic[];
    rotationSuggestions: ShiftRotationSuggestion[];
    alerts: IncidentLogEntry[];
    env: EnvironmentalObservation;
    privacyEnforced: true;
  } {
    const crew: WorkerStatusPublic[] = Array.from(this.workers.values()).map((rec) => {
      const faultSummary: string[] = [];
      if (rec.faults.bleDisconnected) faultSummary.push('BLE Disconnected');
      if (rec.faults.lowBattery) faultSummary.push('Battery <10%');
      if (rec.faults.sensorNoise) faultSummary.push('Sensor Noise');
      if (rec.faults.gpsLoss) faultSummary.push('GPS Loss');

      const sparklineComposite = rec.history.slice(-8).map((h) => h.compositeScore);
      const sparklineProjected: number[] =
        rec.forecast.status === 'ready' && rec.forecast.psi15 && rec.forecast.psi30
          ? [rec.assessment.compositeScore, rec.forecast.psi15.point, rec.forecast.psi30.point]
          : [];

      const riskBandLabel =
        rec.assessment.tier === 'Red'
          ? 'Critical Strain (Stop Work)'
          : rec.assessment.tier === 'Amber'
            ? 'Elevated Strain (Rest Required)'
            : 'Nominal (Safe Operating Band)';

      return {
        workerId: rec.context.workerId,
        roleLabel: rec.context.roleLabel,
        zone: rec.context.zone,
        ppeLevel: rec.context.ppeLevel,
        acclimatizationDays: rec.context.acclimatizationDays,
        tier: rec.assessment.tier,
        riskBandLabel,
        scoringMode: rec.assessment.scoringMode,
        degradedReason: rec.assessment.degradedReason,
        gpsDegraded: rec.assessment.gpsDegraded,
        recommendedAction: rec.assessment.recommendedAction,
        faultSummary,
        forecastStatus: rec.forecast.status,
        predictedTier15: rec.forecast.predictedTier15,
        predictedTier30: rec.forecast.predictedTier30,
        projectedAmberCrossingMin: rec.forecast.projectedAmberCrossingMin,
        projectedRedCrossingMin: rec.forecast.projectedRedCrossingMin,
        sparklineComposite,
        sparklineProjected,
        lastCheckIn: rec.lastCheckIn,
        acknowledged: rec.acknowledged,
        supervisorDirective: rec.supervisorDirective,
        breaksTakenTodayMin: rec.context.breaksTakenTodayMin,
        hydrationCount: rec.context.hydrationCount,
        deviceBatteryPct: rec.latestFrame.batteryPct,
        simulatedClockMin: rec.simulatedClockMin,
        lastUpdated: rec.latestFrame.timestamp,
      };
    });

    const tierRank = (w: WorkerStatusPublic) => {
      if (w.lastCheckIn?.status === 'help') return 0;
      if (w.tier === 'Red') return 1;
      if (w.tier === 'Amber') return 2;
      if (w.predictedTier15 === 'Red' || w.predictedTier15 === 'Amber') return 3;
      return 4;
    };

    const needsBreakQueue = [...crew].sort((a, b) => {
      const diff = tierRank(a) - tierRank(b);
      if (diff !== 0) return diff;
      const crossA = a.projectedAmberCrossingMin ?? 999;
      const crossB = b.projectedAmberCrossingMin ?? 999;
      return crossA - crossB;
    });

    const rotationSuggestions: ShiftRotationSuggestion[] = [];
    for (const w of needsBreakQueue) {
      if (w.tier === 'Red' || w.tier === 'Amber') {
        rotationSuggestions.push({
          id: `ROT-${w.workerId}`,
          workerId: w.workerId,
          roleLabel: w.roleLabel,
          currentZone: w.zone,
          suggestedAction:
            w.tier === 'Red'
              ? `Pull ${w.workerId} to AC recovery tent; rotate in acclimatized standby from Zone D.`
              : `Rotate ${w.workerId} to shaded staging duty for 20 min; swap with Zone D crew.`,
          rationale: `${w.ppeLevel} PPE + ${w.acclimatizationDays}d acclimatization under ${this.env.wbgtC}°C WBGT.`,
          priority: w.tier === 'Red' ? 'Immediate' : 'Upcoming',
        });
      } else if (w.projectedAmberCrossingMin !== null && w.projectedAmberCrossingMin <= 25) {
        rotationSuggestions.push({
          id: `ROT-${w.workerId}`,
          workerId: w.workerId,
          roleLabel: w.roleLabel,
          currentZone: w.zone,
          suggestedAction: `Schedule early hydration/shade rotation for ${w.workerId} within ${w.projectedAmberCrossingMin} min.`,
          rationale: `Prospective trend predicts Amber crossing in ~${w.projectedAmberCrossingMin} min (${w.acclimatizationDays}d acclimatized).`,
          priority: 'Upcoming',
        });
      }
    }

    return {
      crew,
      needsBreakQueue,
      rotationSuggestions,
      alerts: this.incidents.slice(0, 25),
      env: this.env,
      privacyEnforced: true,
    };
  }

  public performSupervisorAction(
    workerId: string,
    action: 'acknowledge' | 'order_break' | 'escalate' | 'apply_rotation'
  ) {
    const rec = this.workers.get(workerId);
    if (!rec) throw new Error(`Unknown workerId: ${workerId}`);

    if (action === 'acknowledge') {
      rec.acknowledged = true;
      this.logIncident({
        workerId,
        roleLabel: rec.context.roleLabel,
        zone: rec.context.zone,
        eventType: 'supervisor_ack',
        severity: rec.assessment.tier,
        summary: `Supervisor acknowledged ${rec.assessment.tier} alert for ${workerId}.`,
        actionTaken: 'Acknowledged on crew board.',
      });
    } else if (action === 'order_break') {
      rec.acknowledged = true;
      rec.context.breaksTakenTodayMin += 15;
      rec.context.hydrationCount += 1;
      rec.supervisorDirective = 'Mandatory 15-min shaded hydration break ordered by Supervisor.';
      this.logIncident({
        workerId,
        roleLabel: rec.context.roleLabel,
        zone: rec.context.zone,
        eventType: 'midday_break_logged',
        severity: rec.assessment.tier,
        summary: `Supervisor ordered 15-min shaded break for ${workerId}.`,
        actionTaken: '15 min logged toward UAE Midday Break compliance.',
      });
    } else if (action === 'escalate') {
      rec.acknowledged = false;
      rec.supervisorDirective = 'ESCALATED: Site HSE Medic dispatched to your zone — stop work immediately.';
      this.logIncident({
        workerId,
        roleLabel: rec.context.roleLabel,
        zone: rec.context.zone,
        eventType: 'supervisor_escalation',
        severity: 'Red',
        summary: `Supervisor escalated ${workerId} to HSE Medic / Emergency Response.`,
        actionTaken: 'Medic dispatch triggered & timestamped.',
      });
    } else if (action === 'apply_rotation') {
      rec.acknowledged = true;
      rec.context.zone = 'Zone D · Shaded Staging';
      rec.context.breaksTakenTodayMin += 20;
      rec.supervisorDirective = 'Rotated to Zone D · Shaded Staging for heat recovery.';
      this.logIncident({
        workerId,
        roleLabel: rec.context.roleLabel,
        zone: rec.context.zone,
        eventType: 'midday_break_logged',
        severity: 'Amber',
        summary: `Crew rotation executed: ${workerId} moved to shaded staging.`,
        actionTaken: 'Zone assignment updated & break logged.',
      });
    }

    return this.getSupervisorSnapshot();
  }

  public getComplianceReport() {
    const requiredMin = 30; // Tracked morning/midday preventive rest compliance threshold (150 min full 12:30-15:00 halt)
    const breaks: BreakRecord[] = Array.from(this.workers.values()).map((rec) => {
      const taken = rec.context.breaksTakenTodayMin;
      const compliant = taken >= requiredMin;
      return {
        workerId: rec.context.workerId,
        roleLabel: rec.context.roleLabel,
        zone: rec.context.zone,
        requiredMiddayWindow: '12:30–15:00 GST (Jun 15 – Sep 15)',
        breaksTakenMin: taken,
        requiredMin,
        compliant,
        status: compliant
          ? 'Compliant'
          : rec.assessment.tier !== 'Green'
            ? 'Action Required'
            : 'Break In Progress',
      };
    });

    const compliantPct = Math.round(
      (breaks.filter((b) => b.compliant).length / Math.max(1, breaks.length)) * 100
    );

    const hub = UAE_SITE_HUBS[this.selectedHubId] ?? UAE_SITE_HUBS.abu_dhabi_mussafah;
    return {
      siteName: hub.name,
      emirate: `${hub.emirate}, UAE`,
      regulationReference: 'UAE Ministerial Resolution No. 44 of 2022 (Midday Working Break: 12:30–15:00 GST, Jun–Sep)',
      env: this.env,
      compliantPct,
      breaks,
      incidents: this.incidents,
      cachedNarrative: this.complianceNarrative,
      generatedAt: new Date().toISOString(),
    };
  }

  public setComplianceNarrative(
    narrative: string,
    source: 'gemini' | 'template_fallback',
    extras?: {
      language?: 'en' | 'ar';
      remediationActions?: string[];
      auditReadinessStatus?: 'Audit Ready' | 'Remediation Needed';
    }
  ) {
    this.complianceNarrative = {
      narrative,
      language: extras?.language ?? 'en',
      remediationActions: extras?.remediationActions,
      auditReadinessStatus: extras?.auditReadinessStatus,
      source,
      updatedAt: new Date().toISOString(),
    };
    return this.complianceNarrative;
  }

  public getAlertPolicy(): TemperatureThresholdConfig {
    const clonedMessages = {} as Record<SupportedLanguage, CustomAlertMessages>;
    for (const lang of SUPPORTED_LANGUAGES) {
      clonedMessages[lang] = { ...this.alertPolicy.customMessages[lang] };
    }
    return {
      ...this.alertPolicy,
      customMessages: clonedMessages,
    };
  }

  public updateAlertPolicy(
    input: Partial<Omit<TemperatureThresholdConfig, 'customMessages' | 'updatedAt'>> & {
      customMessages?: Partial<Record<SupportedLanguage, Partial<CustomAlertMessages>>>;
    }
  ): TemperatureThresholdConfig {
    const nextAmber =
      typeof input.amberWbgtThresholdC === 'number' && Number.isFinite(input.amberWbgtThresholdC)
        ? Number(Math.max(15, Math.min(50, input.amberWbgtThresholdC)).toFixed(1))
        : this.alertPolicy.amberWbgtThresholdC;
    const nextRed =
      typeof input.redWbgtThresholdC === 'number' && Number.isFinite(input.redWbgtThresholdC)
        ? Number(Math.max(16, Math.min(55, input.redWbgtThresholdC)).toFixed(1))
        : this.alertPolicy.redWbgtThresholdC;

    if (nextAmber >= nextRed) {
      throw new Error('Amber threshold must be strictly lower than Red Stop-Work threshold.');
    }

    const mergedMessages = { ...this.alertPolicy.customMessages };
    for (const lang of SUPPORTED_LANGUAGES) {
      const patch = input.customMessages?.[lang];
      mergedMessages[lang] = {
        amberHeadline: (patch?.amberHeadline ?? mergedMessages[lang].amberHeadline).slice(0, 120),
        amberAction: (patch?.amberAction ?? mergedMessages[lang].amberAction).slice(0, 240),
        redHeadline: (patch?.redHeadline ?? mergedMessages[lang].redHeadline).slice(0, 120),
        redAction: (patch?.redAction ?? mergedMessages[lang].redAction).slice(0, 240),
      };
    }

    this.alertPolicy = {
      enabled: typeof input.enabled === 'boolean' ? input.enabled : this.alertPolicy.enabled,
      amberWbgtThresholdC: nextAmber,
      redWbgtThresholdC: nextRed,
      customMessages: mergedMessages,
      updatedAt: new Date().toISOString(),
    };

    clearAlertTranslationCache();
    this.recomputeAllWorkersSync();

    this.logIncident({
      workerId: 'SITE-POLICY',
      roleLabel: 'Supervisor Policy',
      zone: 'All Site Zones',
      eventType: 'supervisor_ack',
      severity: this.alertPolicy.enabled ? 'Amber' : 'System',
      summary: this.alertPolicy.enabled
        ? `Custom safety thresholds active: Amber ${nextAmber}°C / Red ${nextRed}°C WBGT.`
        : 'Supervisor reverted custom safety thresholds to ACGIH defaults.',
      actionTaken: 'Multilingual alert rules synced across crew wearable units.',
    });

    return this.getAlertPolicy();
  }

  public resetScenario(scenario: 'default' | 'zero_violations' = 'default') {
    clearAlertTranslationCache();
    this.envGeneration += 1;
    this.simulateEdgeOffline = false;
    this.selectedHeatwaveHour = 11;
    this.selectedHubId = 'abu_dhabi_mussafah';
    this.env = getHistoricalObservationForHour(this.selectedHeatwaveHour, this.selectedHubId);
    this.alertPolicy = this.createDefaultAlertPolicy();
    this.workers.clear();
    this.incidents = [];
    this.complianceNarrative = null;
    this.seedInitialCrew();

    if (scenario === 'zero_violations') {
      for (const rec of this.workers.values()) {
        rec.faults = { bleDisconnected: false, lowBattery: false, sensorNoise: false, gpsLoss: false };
        rec.context.breaksTakenTodayMin = 40;
        rec.context.hydrationCount = 4;
        rec.lastCheckIn = null;
        rec.acknowledged = true;
        rec.supervisorDirective = null;
        const coolHr = rec.context.hr0 + 16;
        const coolSkin = 33.8;
        rec.history = [];
        for (let step = 0; step < 5; step++) {
          const minOffset = step * 3;
          const frame: BLETelemetryFrame = {
            deviceId: rec.context.deviceId,
            workerId: rec.context.workerId,
            timestamp: new Date(Date.now() - (4 - step) * 180_000).toISOString(),
            hrBpm: coolHr,
            skinTempC: coolSkin,
            exertionIndex: 3.5,
            batteryPct: 92,
            rssiDbm: -58,
            gpsFix: true,
            signalQuality: 0.99,
            simulatedClockMin: minOffset,
          };
          rec.latestFrame = frame;
          rec.assessment = assessWorkerHeatRisk(rec.context, frame, this.env, rec.faults, this.alertPolicy);
          rec.history.push({
            minuteOffset: minOffset,
            timestamp: frame.timestamp,
            psi: rec.assessment.psi,
            compositeScore: rec.assessment.compositeScore,
            wbgtC: this.env.wbgtC,
            degraded: false,
          });
        }
        rec.forecast = predictCompositeTrajectory(rec.history, 0.2);
        rec.alertTranslations = buildDeterministicFallback(rec.context, rec.assessment, rec.forecast);
      }
      this.incidents = [];
    }
  }
}

export const siteGuardStore = new SiteGuardStore();
