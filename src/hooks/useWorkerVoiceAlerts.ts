import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GlobalLanguageOption } from '../shared/globalLanguages';
import type { TemperatureUnit } from '../shared/temperature';
import {
  LANGUAGE_LABELS,
  TTS_LOCALE_BY_LANGUAGE,
  type SupportedLanguage,
  type WorkerAlertCopy,
  type WorkerStateSelf,
} from '../shared/types';
import {
  getWearableAlertSpecCopy,
  type WearableAlertStateId,
} from '../shared/wearableAlertSpecs';

const STORAGE_KEY_ENABLED = 'siteguard_worker_voice_alerts_enabled';

export interface GlobalLanguageOverride {
  option: GlobalLanguageOption;
  copy: WorkerAlertCopy;
}

export interface HeatThresholdVoiceEvaluation {
  exceeded: boolean;
  severity: 'nominal' | 'amber' | 'red';
  reason: string;
  headline: string;
  actionText: string;
  spokenText: string;
  localeTag: string;
  language: SupportedLanguage;
  speechLanguageCode: string;
  languageName: string;
  languageLabel: string;
  signature: string;
}

export interface SpokenAlertRecord {
  text: string;
  language: SupportedLanguage;
  localeTag: string;
  severity: 'nominal' | 'amber' | 'red';
  autoTriggered: boolean;
  source: 'cloud_tts' | 'web_speech';
  voiceName?: string;
  timestampIso: string;
}

export function evaluateHeatThresholdForVoice(params: {
  workerState: WorkerStateSelf | null;
  alertPreviewState: WearableAlertStateId;
  tempUnit: TemperatureUnit;
  globalLanguageOverride?: GlobalLanguageOverride | null;
}): HeatThresholdVoiceEvaluation {
  const { workerState, alertPreviewState, tempUnit, globalLanguageOverride } = params;
  if (!workerState) {
    return {
      exceeded: false,
      severity: 'nominal',
      reason: 'Awaiting telemetry',
      headline: '',
      actionText: '',
      spokenText: '',
      localeTag: 'en-US',
      language: 'en',
      speechLanguageCode: 'en',
      languageName: 'English',
      languageLabel: 'English',
      signature: 'none',
    };
  }

  const language = workerState.context.preferredLanguage;
  const activeLocaleTag =
    globalLanguageOverride?.option.bcp47 ??
    TTS_LOCALE_BY_LANGUAGE[language] ??
    'en-US';
  const activeLangCode = globalLanguageOverride?.option.code ?? language;
  const activeLangName =
    globalLanguageOverride?.option.name ?? LANGUAGE_LABELS[language]?.name ?? 'English';
  const activeLangLabel =
    globalLanguageOverride?.option.nativeName ?? LANGUAGE_LABELS[language]?.native ?? language;

  if (alertPreviewState !== 'live') {
    const specCopy = getWearableAlertSpecCopy(alertPreviewState, language, tempUnit);
    const activeHeadline = globalLanguageOverride?.copy.headline ?? specCopy.headline;
    const activeAction = globalLanguageOverride?.copy.action ?? specCopy.action;
    const exceeded = alertPreviewState !== 'hydration_alert';
    const severity: 'nominal' | 'amber' | 'red' =
      alertPreviewState === 'hydration_alert'
        ? 'nominal'
        : alertPreviewState === 'amber_forecast'
          ? 'amber'
          : 'red';
    const reason =
      alertPreviewState === 'amber_forecast'
        ? 'Projected Amber heat threshold crossing (~1 min)'
        : alertPreviewState === 'high_heat'
          ? 'WBGT High Risk heat threshold exceeded'
          : alertPreviewState === 'sos_active'
            ? 'SOS Distress sensor active'
            : 'Hydration reminder active (Nominal)';

    const spokenText = `${activeHeadline}. ${activeAction}`;
    return {
      exceeded,
      severity,
      reason,
      headline: activeHeadline,
      actionText: activeAction,
      spokenText,
      localeTag: activeLocaleTag,
      language,
      speechLanguageCode: activeLangCode,
      languageName: activeLangName,
      languageLabel: activeLangLabel,
      signature: `${workerState.context.workerId}|${alertPreviewState}|${severity}|${exceeded}|${activeLangCode}|${activeHeadline}`,
    };
  }

  const copy =
    globalLanguageOverride?.copy ??
    workerState.alertTranslations[language] ??
    workerState.alertTranslations.en;
  const { tier, effectiveWbgtC } = workerState.assessment;
  const exceeded = tier === 'Amber' || tier === 'Red';
  const severity: 'nominal' | 'amber' | 'red' =
    tier === 'Red' ? 'red' : tier === 'Amber' ? 'amber' : 'nominal';

  const reason =
    tier === 'Red'
      ? `Critical Red heat-strain threshold exceeded (Eff. WBGT ${effectiveWbgtC.toFixed(1)}°C)`
      : tier === 'Amber'
        ? `Amber heat-strain threshold exceeded (Eff. WBGT ${effectiveWbgtC.toFixed(1)}°C)`
        : 'Within safe thermal limits';

  const spokenText = `${copy.headline}. ${copy.action}`;

  return {
    exceeded,
    severity,
    reason,
    headline: copy.headline,
    actionText: copy.action,
    spokenText,
    localeTag: activeLocaleTag,
    language,
    speechLanguageCode: activeLangCode,
    languageName: activeLangName,
    languageLabel: activeLangLabel,
    signature: `${workerState.context.workerId}|live|${severity}|${exceeded}|${activeLangCode}|${copy.headline}`,
  };
}

function pickBestSpeechVoice(
  voices: SpeechSynthesisVoice[],
  localeTag: string
): SpeechSynthesisVoice | null {
  if (!voices || voices.length === 0) return null;
  const targetLower = localeTag.toLowerCase();
  const exact = voices.find((v) => v.lang.toLowerCase() === targetLower);
  if (exact) return exact;

  const primary = targetLower.split('-')[0];
  const candidates = primary === 'fil' ? ['fil', 'tl'] : [primary];
  for (const prefix of candidates) {
    const match = voices.find((v) => {
      const vl = v.lang.toLowerCase();
      return vl === prefix || vl.startsWith(`${prefix}-`);
    });
    if (match) return match;
  }
  return null;
}

function base64ToAudioBlobUrl(audioBase64: string, mimeType: string): string {
  const binaryString = window.atob(audioBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i += 1) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: mimeType || 'audio/wav' });
  return URL.createObjectURL(blob);
}

function readInitialEnabled(): boolean {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_ENABLED);
    if (raw === 'false') return false;
    return true;
  } catch {
    return true;
  }
}

export function useWorkerVoiceAlerts(params: {
  workerState: WorkerStateSelf | null;
  alertPreviewState: WearableAlertStateId;
  tempUnit: TemperatureUnit;
  globalLanguageOverride?: GlobalLanguageOverride | null;
}) {
  const { workerState, alertPreviewState, tempUnit, globalLanguageOverride } = params;
  const [enabled, setEnabledState] = useState<boolean>(readInitialEnabled);
  const [speaking, setSpeaking] = useState(false);
  const [lastSpokenAlert, setLastSpokenAlert] = useState<SpokenAlertRecord | null>(null);
  const [voicesVersion, setVoicesVersion] = useState(0);

  const lastTriggeredSignatureRef = useRef<string | null>(null);
  const utteranceSeqRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const speechSupported =
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof window.SpeechSynthesisUtterance !== 'undefined';

  useEffect(() => {
    if (!speechSupported) return;
    const synth = window.speechSynthesis;
    const handleVoicesChanged = () => setVoicesVersion((v) => v + 1);
    if (typeof synth.addEventListener === 'function') {
      synth.addEventListener('voiceschanged', handleVoicesChanged);
      return () => synth.removeEventListener('voiceschanged', handleVoicesChanged);
    }
    return undefined;
  }, [speechSupported]);

  const evaluation = useMemo(
    () =>
      evaluateHeatThresholdForVoice({
        workerState,
        alertPreviewState,
        tempUnit,
        globalLanguageOverride,
      }),
    [workerState, alertPreviewState, tempUnit, globalLanguageOverride]
  );

  const revokeObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      try {
        URL.revokeObjectURL(objectUrlRef.current);
      } catch {
        // Ignore URL cleanup errors
      }
      objectUrlRef.current = null;
    }
  }, []);

  const stopActivePlayback = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    const audioEl = audioRef.current;
    if (audioEl) {
      try {
        audioEl.pause();
        audioEl.removeAttribute('src');
        audioEl.load();
      } catch {
        // Ignore audio element cleanup errors
      }
    }
    revokeObjectUrl();
    try {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    } catch {
      // Ignore synthesis cancellation errors in headless environments
    }
  }, [revokeObjectUrl]);

  const stopSpeaking = useCallback(() => {
    utteranceSeqRef.current += 1;
    stopActivePlayback();
    setSpeaking(false);
  }, [stopActivePlayback]);

  const speakViaWebSpeechFallback = useCallback(
    (
      text: string,
      language: SupportedLanguage,
      localeTag: string,
      severity: 'nominal' | 'amber' | 'red',
      autoTriggered: boolean,
      seq: number
    ) => {
      if (utteranceSeqRef.current !== seq) return;

      setLastSpokenAlert({
        text,
        language,
        localeTag,
        severity,
        autoTriggered,
        source: 'web_speech',
        timestampIso: new Date().toISOString(),
      });

      try {
        if (
          typeof window === 'undefined' ||
          !('speechSynthesis' in window) ||
          typeof window.SpeechSynthesisUtterance === 'undefined'
        ) {
          setSpeaking(false);
          return;
        }
        const synth = window.speechSynthesis;
        synth.cancel();

        const UtteranceCtor = window.SpeechSynthesisUtterance;
        const utterance = new UtteranceCtor(text);
        utterance.lang = localeTag;
        utterance.rate = severity === 'red' ? 1.06 : 1.0;
        utterance.pitch = severity === 'red' ? 1.08 : 1.0;

        const availableVoices =
          typeof synth.getVoices === 'function' ? synth.getVoices() : [];
        const matchedVoice = pickBestSpeechVoice(availableVoices, localeTag);
        if (matchedVoice) {
          utterance.voice = matchedVoice;
        }

        utterance.onend = () => {
          if (utteranceSeqRef.current === seq) {
            setSpeaking(false);
          }
        };
        utterance.onerror = () => {
          if (utteranceSeqRef.current === seq) {
            setSpeaking(false);
          }
        };

        setSpeaking(true);
        synth.speak(utterance);
      } catch {
        if (utteranceSeqRef.current === seq) {
          setSpeaking(false);
        }
      }
    },
    // voicesVersion ensures latest voices list is considered if available
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [voicesVersion]
  );

  const synthesizeAlert = useCallback(
    async (
      text: string,
      language: SupportedLanguage,
      speechLanguageCode: string,
      languageName: string,
      localeTag: string,
      severity: 'nominal' | 'amber' | 'red',
      autoTriggered: boolean
    ) => {
      if (!text.trim()) return;
      const seq = ++utteranceSeqRef.current;
      stopActivePlayback();

      const workerId = workerState?.context.workerId ?? 'W-101';

      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        speakViaWebSpeechFallback(text, language, localeTag, severity, autoTriggered, seq);
        return;
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        setSpeaking(true);
        const res = await fetch(`/api/worker/${encodeURIComponent(workerId)}/speak`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            language: speechLanguageCode,
            localeTag,
            languageName,
            severity,
          }),
          signal: controller.signal,
        });

        if (utteranceSeqRef.current !== seq) return;

        if (!res.ok) {
          speakViaWebSpeechFallback(text, language, localeTag, severity, autoTriggered, seq);
          return;
        }

        const data = (await res.json()) as {
          audioBase64?: string;
          mimeType?: string;
          voiceName?: string;
        };

        if (utteranceSeqRef.current !== seq) return;

        if (!data.audioBase64) {
          speakViaWebSpeechFallback(text, language, localeTag, severity, autoTriggered, seq);
          return;
        }

        const mimeType = data.mimeType || 'audio/wav';
        const objectUrl = base64ToAudioBlobUrl(data.audioBase64, mimeType);
        revokeObjectUrl();
        objectUrlRef.current = objectUrl;

        const audioEl = audioRef.current ?? new Audio();
        audioEl.onended = () => {
          if (utteranceSeqRef.current === seq) {
            setSpeaking(false);
          }
        };
        audioEl.onerror = () => {
          if (utteranceSeqRef.current === seq) {
            setSpeaking(false);
          }
        };
        audioEl.src = objectUrl;

        setLastSpokenAlert({
          text,
          language,
          localeTag,
          severity,
          autoTriggered,
          source: 'cloud_tts',
          voiceName: data.voiceName,
          timestampIso: new Date().toISOString(),
        });

        try {
          await audioEl.play();
        } catch (playErr) {
          if (utteranceSeqRef.current !== seq) return;
          const errName = playErr instanceof Error ? playErr.name : '';
          if (errName === 'NotSupportedError') {
            speakViaWebSpeechFallback(text, language, localeTag, severity, autoTriggered, seq);
          } else {
            // Autoplay blocked prior to user gesture or interrupted cleanly: preserve cloud_tts state
            setSpeaking(false);
          }
        }
      } catch (err) {
        if (controller.signal.aborted || utteranceSeqRef.current !== seq) {
          return;
        }
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        speakViaWebSpeechFallback(text, language, localeTag, severity, autoTriggered, seq);
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    },
    [revokeObjectUrl, speakViaWebSpeechFallback, stopActivePlayback, workerState?.context.workerId]
  );

  // Automatic voice-synthesis trigger whenever heat thresholds are exceeded
  // or worker switches preferred language while threshold remains exceeded
  useEffect(() => {
    if (!enabled) {
      lastTriggeredSignatureRef.current = null;
      return;
    }

    if (!evaluation.exceeded) {
      lastTriggeredSignatureRef.current = null;
      return;
    }

    if (lastTriggeredSignatureRef.current === evaluation.signature) {
      return;
    }

    lastTriggeredSignatureRef.current = evaluation.signature;
    void synthesizeAlert(
      evaluation.spokenText,
      evaluation.language,
      evaluation.speechLanguageCode,
      evaluation.languageName,
      evaluation.localeTag,
      evaluation.severity,
      true
    );
  }, [enabled, evaluation, synthesizeAlert]);

  useEffect(() => () => stopSpeaking(), [stopSpeaking]);

  const setEnabled = useCallback(
    (next: boolean) => {
      setEnabledState(next);
      try {
        window.localStorage.setItem(STORAGE_KEY_ENABLED, next ? 'true' : 'false');
      } catch {
        // Ignore storage write errors
      }
      if (!next) {
        lastTriggeredSignatureRef.current = null;
        stopSpeaking();
      }
    },
    [stopSpeaking]
  );

  const speakNow = useCallback(() => {
    if (!evaluation.spokenText) return;
    void synthesizeAlert(
      evaluation.spokenText,
      evaluation.language,
      evaluation.speechLanguageCode,
      evaluation.languageName,
      evaluation.localeTag,
      evaluation.severity,
      false
    );
  }, [evaluation, synthesizeAlert]);

  return {
    enabled,
    setEnabled,
    speaking,
    speechSupported: true,
    audioRef,
    evaluation,
    lastSpokenAlert,
    speakNow,
    stopSpeaking,
  };
}
