export type RiskTier = 'Green' | 'Amber' | 'Red';

export type SupportedLanguage =
  | 'en'
  | 'ar'
  | 'hi'
  | 'ur'
  | 'bn'
  | 'tl'
  | 'ta'
  | 'ml'
  | 'ne'
  | 'si';

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  'en',
  'ar',
  'hi',
  'ur',
  'bn',
  'tl',
  'ta',
  'ml',
  'ne',
  'si',
];

export const LANGUAGE_LABELS: Record<
  SupportedLanguage,
  { name: string; native: string; rtl?: boolean }
> = {
  en: { name: 'English', native: 'English' },
  ar: { name: 'Arabic', native: 'العربية', rtl: true },
  hi: { name: 'Hindi', native: 'हिन्दी' },
  ur: { name: 'Urdu', native: 'اردو', rtl: true },
  bn: { name: 'Bengali', native: 'বাংলা' },
  tl: { name: 'Tagalog', native: 'Tagalog' },
  ta: { name: 'Tamil', native: 'தமிழ்' },
  ml: { name: 'Malayalam', native: 'മലയാളം' },
  ne: { name: 'Nepali', native: 'नेपाली' },
  si: { name: 'Sinhala', native: 'සිංහල' },
};

export function isRtlLanguage(lang: SupportedLanguage): boolean {
  return lang === 'ar' || lang === 'ur';
}

export const TTS_LOCALE_BY_LANGUAGE: Record<SupportedLanguage, string> = {
  en: 'en-US',
  ar: 'ar-AE',
  hi: 'hi-IN',
  ur: 'ur-PK',
  bn: 'bn-BD',
  tl: 'fil-PH',
  ta: 'ta-IN',
  ml: 'ml-IN',
  ne: 'ne-NP',
  si: 'si-LK',
};

export type PPELevel = 'Standard Coverall' | 'FR / Arc-Flash' | 'Chemical / Tyvek';

export type EnvironmentFeedStatus =
  | 'live_abu_dhabi_feed'
  | 'gemma4_edge_offline_mode'
  | 'historical_calibration';

export type UaeSiteHubId =
  | 'abu_dhabi_mussafah'
  | 'dubai_marina'
  | 'dubai_jebel_ali'
  | 'dubai_expo_city';

export interface UaeSiteHubSpec {
  id: UaeSiteHubId;
  emirate: 'Abu Dhabi' | 'Dubai';
  name: string;
  shortLabel: string;
  station: string;
  lat: number;
  lon: number;
  airDeltaC: number;
  humidityDeltaPct: number;
  solarMultiplier: number;
  microclimateNote: string;
}

export interface EnvironmentalObservation {
  timestampIso: string;
  hourGst: number;
  station: string;
  lat: number;
  lon: number;
  airTempC: number;
  relHumidityPct: number;
  windSpeedMs: number;
  solarWm2: number;
  wetBulbC: number;
  globeTempC: number;
  wbgtC: number;
  heatIndexC: number;
  mode: 'historical_heatwave' | 'live_abu_dhabi';
  sourceLabel: string;
  inUaeMiddayBreakWindow: boolean;
  hubId?: UaeSiteHubId;
  emirate?: 'Abu Dhabi' | 'Dubai';
  feedStatus?: EnvironmentFeedStatus;
  provider?: 'OpenWeatherMap' | 'Open-Meteo' | 'Gemma 4 Edge Local Inference' | 'Historical UAE CSV';
  edgeOfflineActive?: boolean;
  lastLiveSyncIso?: string | null;
  resilienceReason?: string | null;
}

/**
 * Hardware-agnostic BLE Wearable Telemetry Contract.
 * Any physical BLE wearable gateway (Garmin/Polar/Zephyr/Custom ESP32 BLE band)
 * posts this exact JSON schema to POST /api/ble/telemetry.
 */
export interface BLETelemetryFrame {
  deviceId: string;
  workerId: string;
  timestamp: string;
  hrBpm: number;
  skinTempC: number;
  exertionIndex: number; // 0..10 Borg CR10 / metabolic load proxy
  batteryPct: number; // 0..100
  rssiDbm: number; // e.g., -58 normal, -999 disconnected
  gpsFix: boolean;
  signalQuality: number; // 0..1 (1 = clean, <0.5 = motion artifact / sensor noise)
  simulatedClockMin?: number;
}

export interface FaultFlags {
  bleDisconnected: boolean;
  lowBattery: boolean;
  sensorNoise: boolean;
  gpsLoss: boolean;
}

export interface WorkerContext {
  workerId: string; // Anonymized ID only — NO real PII
  deviceId: string;
  roleLabel: string;
  zone: string;
  ppeLevel: PPELevel;
  acclimatizationDays: number;
  ageYears: number;
  hr0: number; // Shift-start resting HR
  tc0: number; // Shift-start baseline core-temp proxy
  preferredLanguage: SupportedLanguage;
  plannedBreakTime: string;
  hydrationCount: number;
  breaksTakenTodayMin: number;
}

export interface RiskAssessment {
  workerId: string;
  timestamp: string;
  psi: number | null; // Moran et al. 0..10 (null when degraded to env-only)
  tcProxyC: number | null;
  hrMaxEstimated: number;
  effectiveWbgtC: number;
  acgihActionLimitC: number;
  acgihTlvLimitC: number;
  envRiskScore: number; // 0..10
  compositeScore: number; // 0..10
  tier: RiskTier;
  scoringMode: 'physiological_plus_env' | 'environment_only_degraded';
  degradedReason: string | null;
  gpsDegraded: boolean;
  contributingFactors: string[];
  recommendedAction: string;
}

export interface ConfidenceInterval {
  point: number;
  low: number;
  high: number;
}

export interface ForecastOutput {
  status: 'ready' | 'insufficient_trend_data';
  reason?: string;
  cleanWindowSamples: number;
  windowMinutes: number;
  psiNow: number | null;
  psi15: ConfidenceInterval | null;
  psi30: ConfidenceInterval | null;
  predictedTier15: RiskTier | null;
  predictedTier30: RiskTier | null;
  projectedAmberCrossingMin: number | null;
  projectedRedCrossingMin: number | null;
  slopePerMin: number | null;
  modelLabel: string;
}

export interface TelemetryHistoryPoint {
  minuteOffset: number;
  timestamp: string;
  psi: number | null;
  compositeScore: number;
  wbgtC: number;
  degraded: boolean;
}

export interface WorkerAlertCopy {
  headline: string;
  explanation: string;
  action: string;
  proactiveForecastNote: string | null;
  source: 'gemini' | 'template_fallback';
  cached: boolean;
}

export interface RiskTierThresholds {
  greenMax: number;
  amberMin: number;
  redMin: number;
  maxScore: number;
}

export interface WorkerStateSelf {
  context: WorkerContext;
  latestFrame: BLETelemetryFrame;
  faults: FaultFlags;
  assessment: RiskAssessment;
  forecast: ForecastOutput;
  history: TelemetryHistoryPoint[];
  alertTranslations: Record<SupportedLanguage, WorkerAlertCopy>;
  lastCheckIn: { status: 'okay' | 'help'; timestamp: string } | null;
  supervisorDirective: string | null;
  simulatedClockMin: number;
  tierThresholds?: RiskTierThresholds;
}

/**
 * Privacy-enforced DTO for Supervisor & Admin endpoints.
 * ARCHITECTURAL INVARIANT: Raw physiological vitals (hrBpm, skinTempC,
 * exertionIndex, hr0, tc0, hrMaxEstimated) MUST NEVER exist on this interface
 * or be serialized in /api/supervisor/* responses.
 */
export interface WorkerStatusPublic {
  workerId: string;
  roleLabel: string;
  zone: string;
  ppeLevel: PPELevel;
  acclimatizationDays: number;
  tier: RiskTier;
  riskBandLabel: string;
  scoringMode: 'physiological_plus_env' | 'environment_only_degraded';
  degradedReason: string | null;
  gpsDegraded: boolean;
  recommendedAction: string;
  faultSummary: string[];
  forecastStatus: 'ready' | 'insufficient_trend_data';
  predictedTier15: RiskTier | null;
  predictedTier30: RiskTier | null;
  projectedAmberCrossingMin: number | null;
  projectedRedCrossingMin: number | null;
  sparklineComposite: number[];
  sparklineProjected: number[];
  lastCheckIn: { status: 'okay' | 'help'; timestamp: string } | null;
  acknowledged: boolean;
  supervisorDirective: string | null;
  breaksTakenTodayMin: number;
  hydrationCount: number;
  deviceBatteryPct?: number;
  simulatedClockMin?: number;
  lastUpdated: string;
}

export interface ShiftRotationSuggestion {
  id: string;
  workerId: string;
  roleLabel: string;
  currentZone: string;
  suggestedAction: string;
  rationale: string;
  priority: 'Immediate' | 'Upcoming';
}

export interface IncidentLogEntry {
  id: string;
  timestamp: string;
  workerId: string;
  roleLabel: string;
  zone: string;
  eventType:
    | 'amber_rest_order'
    | 'red_stop_work'
    | 'sensor_degradation'
    | 'gps_loss'
    | 'worker_help_request'
    | 'worker_voice_report'
    | 'supervisor_escalation'
    | 'supervisor_ack'
    | 'midday_break_logged';
  severity: RiskTier | 'System';
  summary: string;
  actionTaken: string;
  resolved: boolean;
}

export type VoiceIncidentSeverity = 'Low' | 'Medium' | 'High';

export interface CustomAlertMessages {
  amberHeadline: string;
  amberAction: string;
  redHeadline: string;
  redAction: string;
}

export interface TemperatureThresholdConfig {
  enabled: boolean;
  amberWbgtThresholdC: number;
  redWbgtThresholdC: number;
  customMessages: Record<SupportedLanguage, CustomAlertMessages>;
  updatedAt: string;
}

export interface BreakRecord {
  workerId: string;
  roleLabel: string;
  zone: string;
  requiredMiddayWindow: string; // "12:30–15:00 GST"
  breaksTakenMin: number;
  requiredMin: number;
  compliant: boolean;
  status: 'Compliant' | 'Break In Progress' | 'Action Required';
}

export interface SyntheticTrajectoryPoint {
  minute: number;
  hrBpm: number;
  skinTempC: number;
  exertionIndex: number;
  wbgtC: number;
  trueHeatExhaustionEvent: boolean; // Ground truth crossing of physiological safety limit
}

export interface SyntheticWorkerDay {
  trajectoryId: string;
  source: 'SYNTHETIC_PHYSIOLOGICAL_COHORT';
  generator: 'deterministic_calibrated' | 'gemini_synthesized';
  roleLabel: string;
  ppeLevel: PPELevel;
  acclimatizationDays: number;
  ageYears: number;
  hr0: number;
  tc0: number;
  points: SyntheticTrajectoryPoint[];
}

export interface BacktestTrajectorySummary {
  trajectoryId: string;
  roleLabel: string;
  ppeLevel: PPELevel;
  acclimatizationDays: number;
  hadTrueEvent: boolean;
  firstCrossingMin: number | null;
  firstAlertMin: number | null;
  leadTimeMin: number | null;
  falseAlarmsCount: number;
  outcome: 'True Positive' | 'False Negative' | 'True Negative' | 'False Positive';
}

export interface BacktestReport {
  cohortSize: number;
  cohortGenerator: 'deterministic_calibrated' | 'gemini_synthesized';
  weatherDataset: string;
  totalMinutesEvaluated: number;
  trueEventsCount: number;
  detectedEventsCount: number;
  sensitivityPct: number;
  specificityPct: number;
  falseAlarmRatePct: number;
  precisionPct: number;
  f1Score: number;
  meanLeadTimeMin: number | null;
  medianLeadTimeMin: number | null;
  trajectories: BacktestTrajectorySummary[];
  methodologyNote: string;
  limitations: string[];
  generatedAt: string;
}

export interface ForecastMethodMetrics {
  modelName: string;
  horizonMin: 15 | 30;
  samplesEvaluated: number;
  maePsi: number;
  rmsePsi: number;
  tierAccuracyPct: number;
  ci90CoveragePct: number;
}

export interface ForecastReplaySample {
  minute: number;
  actualPsi: number;
  predicted15Baseline: number | null;
  predicted15Low: number | null;
  predicted15High: number | null;
  predicted15Ridge: number | null;
}

export interface ForecastValidationReport {
  cohortSize: number;
  samplesEvaluated15: number;
  samplesEvaluated30: number;
  baseline15: ForecastMethodMetrics;
  baseline30: ForecastMethodMetrics;
  ridgeAblation15: ForecastMethodMetrics;
  ridgeAblation30: ForecastMethodMetrics;
  sampleReplayTrajectoryId: string;
  sampleReplay: ForecastReplaySample[];
  methodologyNote: string;
  generatedAt: string;
}

export interface SupervisorAiBriefing {
  language: SupportedLanguage;
  executiveSummary: string;
  priorityActions: string[];
  zoneFocus: string;
  heatWindowAdvice: string;
  source: 'gemini' | 'template_fallback';
  generatedAt: string;
}

export interface ComplianceNarrativeRecord {
  narrative: string;
  language?: 'en' | 'ar';
  remediationActions?: string[];
  auditReadinessStatus?: 'Audit Ready' | 'Remediation Needed';
  source: 'gemini' | 'template_fallback';
  updatedAt: string;
}

export interface ValidationAiInsights {
  kind: 'backtest' | 'forecast';
  headline: string;
  summary: string;
  keyFindings: string[];
  engineeringRecommendations: string[];
  source: 'gemini' | 'template_fallback';
  generatedAt: string;
}

export type VoiceCommandIntent =
  | 'order_break'
  | 'escalate'
  | 'apply_rotation'
  | 'switch_hub'
  | 'simulate_midday'
  | 'generate_briefing'
  | 'navigate'
  | 'read_summary'
  | 'status_query';

export interface VoiceCommandResponse {
  intent: VoiceCommandIntent;
  executed: boolean;
  workerId?: string;
  hubId?: UaeSiteHubId;
  navigateTo?: '/worker' | '/supervisor' | '/compliance' | '/validation' | '/forecast-validation';
  language: SupportedLanguage;
  spokenReply: string;
  actionSummary: string;
  source: 'gemini' | 'deterministic_router';
}

