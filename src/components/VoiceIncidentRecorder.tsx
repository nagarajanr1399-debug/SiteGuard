import { useEffect, useRef, useState } from 'react';
import { Mic, Send, Square } from 'lucide-react';
import {
  isRtlLanguage,
  type SupportedLanguage,
  type VoiceIncidentSeverity,
  type WorkerStateSelf,
} from '../shared/types';

interface VoiceIncidentRecorderProps {
  workerId: string;
  language: SupportedLanguage;
  onReportLogged: (state: WorkerStateSelf, transcript: string) => void;
}

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const SPEECH_LOCALE_MAP: Record<SupportedLanguage, string> = {
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

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const idx = result.indexOf(',');
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('Audio read error'));
    reader.readAsDataURL(blob);
  });
}

export function VoiceIncidentRecorder({
  workerId,
  language,
  onReportLogged,
}: VoiceIncidentRecorderProps) {
  const [severity, setSeverity] = useState<VoiceIncidentSeverity>('Medium');
  const [recording, setRecording] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [draftTranscript, setDraftTranscript] = useState('');
  const [lastLogged, setLastLogged] = useState<{
    transcript: string;
    source: string;
    severity: VoiceIncidentSeverity;
  } | null>(null);
  const [micError, setMicError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const speechRef = useRef<SpeechRecognitionLike | null>(null);
  const timerRef = useRef<number | null>(null);
  const speechTranscriptRef = useRef('');
  const severityRef = useRef<VoiceIncidentSeverity>('Medium');

  useEffect(() => {
    severityRef.current = severity;
  }, [severity]);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      speechRef.current?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const submitVoicePayload = async (
    audioBlob: Blob | null,
    transcriptText: string,
    selectedSeverity: VoiceIncidentSeverity
  ) => {
    setSubmitting(true);
    setMicError(null);
    try {
      const audioBase64 = audioBlob && audioBlob.size > 0 ? await blobToBase64(audioBlob) : undefined;
      const mimeType = audioBlob?.type || 'audio/webm';
      const res = await fetch(`/api/worker/${workerId}/voice-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioBase64,
          mimeType,
          transcript: transcriptText.trim(),
          language,
          severity: selectedSeverity,
        }),
      });
      const json = (await res.json()) as {
        state?: WorkerStateSelf;
        transcript?: string;
        source?: string;
        severity?: VoiceIncidentSeverity;
        error?: string;
      };
      if (!res.ok || !json.state || !json.transcript) {
        throw new Error(json.error ?? 'Failed to log voice incident');
      }
      setLastLogged({
        transcript: json.transcript,
        source: json.source ?? 'voice',
        severity: json.severity ?? selectedSeverity,
      });
      setDraftTranscript('');
      speechTranscriptRef.current = '';
      onReportLogged(json.state, json.transcript);
    } catch (err) {
      setMicError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleStartRecording = async () => {
    setMicError(null);
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      setMicError('Microphone API unavailable in this browser; enter a quick note below to report.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      speechTranscriptRef.current = '';

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          chunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        if (timerRef.current) {
          window.clearInterval(timerRef.current);
          timerRef.current = null;
        }
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const text = (speechTranscriptRef.current || draftTranscript).trim();
        submitVoicePayload(blob, text, severityRef.current);
      };

      // Optional browser SpeechRecognition live preview alongside MediaRecorder
      const SpeechCtor = getSpeechRecognitionCtor();
      if (SpeechCtor) {
        try {
          const rec = new SpeechCtor();
          rec.lang = SPEECH_LOCALE_MAP[language] ?? 'en-US';
          rec.interimResults = true;
          rec.continuous = true;
          rec.onresult = (event) => {
            let combined = '';
            for (let i = 0; i < event.results.length; i++) {
              combined += event.results[i][0]?.transcript ?? '';
            }
            speechTranscriptRef.current = combined.trim();
            setDraftTranscript(combined.trim());
          };
          rec.onerror = () => {};
          rec.start();
          speechRef.current = rec;
        } catch {
          speechRef.current = null;
        }
      }

      setElapsedSec(0);
      setRecording(true);
      timerRef.current = window.setInterval(() => {
        setElapsedSec((s) => s + 1);
      }, 1000);
      recorder.start();
    } catch {
      setMicError('Microphone permission denied or no mic detected. Type a quick incident note below.');
    }
  };

  const handleStopRecording = () => {
    setRecording(false);
    try {
      speechRef.current?.stop();
    } catch {
      // ignore SpeechRecognition stop errors
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  return (
    <div
      data-testid="voice-incident-panel"
      className="mt-2 pt-2 space-y-2.5"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-200">
          Voice Safety Incident Report
        </span>
        {recording && (
          <span className="text-[11px] font-mono tabular-nums text-[#ff5c8a]">
            REC {String(Math.floor(elapsedSec / 60)).padStart(2, '0')}:
            {String(elapsedSec % 60).padStart(2, '0')}
          </span>
        )}
      </div>

      {/* Pre-transcription Incident Severity Dropdown (Low, Medium, High) */}
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor="voice-incident-severity"
          className="text-xs font-medium text-slate-400 shrink-0"
        >
          Incident Severity
        </label>
        <select
          id="voice-incident-severity"
          disabled={recording || submitting}
          value={severity}
          onChange={(e) => setSeverity(e.target.value as VoiceIncidentSeverity)}
          className="flex-1 bg-[#212121] border border-white/15 rounded-xl px-2.5 py-1.5 text-xs font-medium text-slate-100 focus:outline-none focus:border-[#787aff] disabled:opacity-60 cursor-pointer"
        >
          <option value="Low">Low — Minor observation</option>
          <option value="Medium">Medium — Needs shade / check</option>
          <option value="High">High — Urgent safety hazard</option>
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {!recording ? (
          <button
            type="button"
            disabled={submitting}
            onClick={handleStartRecording}
            className="flex-1 min-h-[40px] px-3 py-2 rounded-xl border border-[#787aff]/50 bg-[#787aff]/20 hover:bg-[#787aff]/30 active:scale-[0.99] disabled:opacity-50 text-slate-100 text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer"
          >
            <Mic className="w-4 h-4 text-[#787aff] shrink-0" />
            <span>{submitting ? 'Transcribing Incident...' : 'Record Voice Incident'}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={handleStopRecording}
            className="flex-1 min-h-[40px] px-3 py-2 rounded-xl border border-[#fa114f] bg-[#fa114f] hover:brightness-110 active:scale-[0.99] text-white text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer"
          >
            <Square className="w-3.5 h-3.5 fill-current shrink-0" />
            <span>Stop &amp; Transcribe</span>
          </button>
        )}
      </div>

      {/* Live spoken / fallback text incident note input */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          dir={isRtlLanguage(language) ? 'rtl' : 'ltr'}
          aria-label="Voice incident transcript or fallback note"
          value={draftTranscript}
          onChange={(e) => {
            speechTranscriptRef.current = e.target.value;
            setDraftTranscript(e.target.value);
          }}
          placeholder="Optional note or live spoken preview (e.g., dizziness in Zone A)..."
          className="flex-1 bg-[#212121] border border-white/12 rounded-xl px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-[#787aff]"
        />
        <button
          type="button"
          disabled={recording || submitting || !draftTranscript.trim()}
          onClick={() => submitVoicePayload(null, draftTranscript, severity)}
          className="px-2.5 py-1.5 rounded-xl bg-[#787aff] hover:bg-[#898bff] active:scale-[0.99] disabled:opacity-40 text-white text-xs font-medium flex items-center gap-1 transition-all cursor-pointer"
        >
          <Send className="w-3 h-3" />
          <span>Send</span>
        </button>
      </div>

      {micError && (
        <div role="alert" className="text-[11px] text-amber-200 bg-[#f59e0b]/15 border border-[#f59e0b]/40 rounded-xl px-2.5 py-1.5">
          {micError}
        </div>
      )}

      {lastLogged && (
        <div
          data-testid="voice-incident-logged"
          className="text-[11px] text-slate-100 bg-[#787aff]/15 border border-[#787aff]/45 rounded-xl px-2.5 py-2 leading-relaxed"
        >
          <div className="font-mono font-semibold text-[#a5a7ff]">
            VOICE INCIDENT LOGGED · {lastLogged.severity.toUpperCase()} (
            {lastLogged.source === 'gemini_transcribe' ? 'Gemini Transcribe' : 'Logged'})
          </div>
          <div dir={isRtlLanguage(language) ? 'rtl' : 'ltr'} className="mt-0.5">
            &ldquo;{lastLogged.transcript}&rdquo;
          </div>
        </div>
      )}
    </div>
  );
}
