import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mic, MicOff, Send, Volume2, VolumeX } from 'lucide-react';
import { SG_SURFACES } from '../shared/designTokens';
import {
  TTS_LOCALE_BY_LANGUAGE,
  type EnvironmentalObservation,
  type SupportedLanguage,
  type VoiceCommandResponse,
} from '../shared/types';

export function useVoiceSpeechOutput() {
  const [speaking, setSpeaking] = useState(false);
  const seqRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const cleanupAudio = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    if (audioRef.current) {
      try {
        audioRef.current.pause();
        audioRef.current.removeAttribute('src');
      } catch {
        // Ignore cleanup errors
      }
      audioRef.current = null;
    }
    if (objectUrlRef.current) {
      try {
        URL.revokeObjectURL(objectUrlRef.current);
      } catch {
        // Ignore revoke errors
      }
      objectUrlRef.current = null;
    }
    try {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    } catch {
      // Ignore synthesis cancellation errors in headless environments
    }
  }, []);

  const stopSpeaking = useCallback(() => {
    seqRef.current += 1;
    cleanupAudio();
    setSpeaking(false);
  }, [cleanupAudio]);

  const speakWebFallback = useCallback((text: string, lang: SupportedLanguage, seq: number) => {
    if (seqRef.current !== seq) return;
    try {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        setSpeaking(false);
        return;
      }
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = TTS_LOCALE_BY_LANGUAGE[lang] ?? 'en-US';
      utterance.rate = 1.02;
      utterance.pitch = 1.0;
      utterance.onend = () => {
        if (seqRef.current === seq) setSpeaking(false);
      };
      utterance.onerror = () => {
        if (seqRef.current === seq) setSpeaking(false);
      };
      setSpeaking(true);
      window.speechSynthesis.speak(utterance);
    } catch {
      if (seqRef.current === seq) setSpeaking(false);
    }
  }, []);

  const speak = useCallback(
    async (text: string, lang: SupportedLanguage = 'en') => {
      if (!text.trim()) return;
      const seq = ++seqRef.current;
      cleanupAudio();

      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        speakWebFallback(text, lang, seq);
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        setSpeaking(true);
        const res = await fetch('/api/worker/W-101/speak', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            language: lang,
            localeTag: TTS_LOCALE_BY_LANGUAGE[lang] ?? 'en-US',
            severity: 'nominal',
          }),
          signal: controller.signal,
        });
        if (seqRef.current !== seq) return;

        if (!res.ok) {
          speakWebFallback(text, lang, seq);
          return;
        }
        const data = (await res.json()) as { audioBase64?: string; mimeType?: string };
        if (seqRef.current !== seq || !data.audioBase64) {
          if (seqRef.current === seq) speakWebFallback(text, lang, seq);
          return;
        }

        const binary = window.atob(data.audioBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
          bytes[i] = binary.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: data.mimeType || 'audio/wav' });
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;

        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => {
          if (seqRef.current === seq) setSpeaking(false);
        };
        audio.onerror = () => {
          if (seqRef.current === seq) setSpeaking(false);
        };
        await audio.play();
      } catch (err) {
        if (controller.signal.aborted || seqRef.current !== seq) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        speakWebFallback(text, lang, seq);
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    },
    [cleanupAudio, speakWebFallback]
  );

  useEffect(() => () => stopSpeaking(), [stopSpeaking]);

  return { speaking, speak, stopSpeaking };
}

export function VoiceWaveform({ active }: { active: boolean }) {
  return (
    <span className="inline-flex items-center gap-0.5 h-3.5" aria-hidden="true">
      {[0.45, 0.85, 1, 0.65, 0.9, 0.5].map((scale, i) => (
        <span
          key={i}
          className={`w-0.5 rounded-full transition-all duration-200 ${
            active ? 'bg-[#787aff] animate-pulse' : 'bg-slate-600'
          }`}
          style={{
            height: active ? `${Math.round(scale * 14)}px` : '4px',
            animationDelay: `${i * 90}ms`,
          }}
        />
      ))}
    </span>
  );
}

interface VoiceCopilotBarProps {
  currentRoute: string;
  language?: SupportedLanguage;
  quickPrompts?: string[];
  summaryToRead?: string;
  onAfterCommand?: (payload: {
    result: VoiceCommandResponse;
    snapshot?: unknown;
    env?: EnvironmentalObservation;
  }) => void;
}

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  0: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export function VoiceCopilotBar({
  currentRoute,
  language = 'en',
  quickPrompts = [
    'Order break for W-104',
    'Simulate Dubai Marina',
    'Simulate 13:00 Midday Ban',
    'Read briefing',
  ],
  summaryToRead,
  onAfterCommand,
}: VoiceCopilotBarProps) {
  const navigate = useNavigate();
  const [commandInput, setCommandInput] = useState('');
  const [listening, setListening] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [lastResult, setLastResult] = useState<VoiceCommandResponse | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const { speaking, speak, stopSpeaking } = useVoiceSpeechOutput();

  const executeCommand = useCallback(
    async (text: string) => {
      const cleaned = text.trim();
      if (!cleaned) return;
      setProcessing(true);
      try {
        const res = await fetch('/api/voice/command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            commandText: cleaned,
            language,
            currentRoute,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as {
          result: VoiceCommandResponse;
          snapshot?: unknown;
          env?: EnvironmentalObservation;
        };
        setLastResult(json.result);
        setCommandInput('');
        onAfterCommand?.(json);
        const replyText =
          json.result.intent === 'read_summary' && summaryToRead
            ? summaryToRead
            : json.result.spokenReply;
        speak(replyText, json.result.language);
        if (json.result.intent === 'navigate' && json.result.navigateTo) {
          navigate(json.result.navigateTo);
        }
      } catch {
        // Keep UI smooth if offline
      } finally {
        setProcessing(false);
      }
    },
    [currentRoute, language, navigate, onAfterCommand, speak, summaryToRead]
  );

  const toggleMic = () => {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Ctor = win.SpeechRecognition ?? win.webkitSpeechRecognition;
    if (!Ctor) {
      void executeCommand(commandInput || quickPrompts[0]);
      return;
    }
    try {
      const rec = new Ctor();
      rec.lang = TTS_LOCALE_BY_LANGUAGE[language] ?? 'en-US';
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.onresult = (ev) => {
        const transcript = ev.results?.[0]?.[0]?.transcript ?? '';
        if (transcript) {
          setCommandInput(transcript);
          void executeCommand(transcript);
        }
      };
      rec.onerror = () => setListening(false);
      rec.onend = () => setListening(false);
      recognitionRef.current = rec;
      setListening(true);
      rec.start();
    } catch {
      setListening(false);
    }
  };

  return (
    <section
      data-testid="voice-copilot-bar"
      className={`${SG_SURFACES.panel} p-4 sm:p-5 border border-[#787aff]/25 bg-gradient-to-r from-[#141821] via-[#151b2c] to-[#141821]`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={toggleMic}
            aria-label={listening ? 'Stop voice command listening' : 'Start voice AI command'}
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all cursor-pointer shrink-0 ${
              listening
                ? 'bg-[#fa114f] text-white shadow-[0_0_20px_rgba(250,17,79,0.5)]'
                : 'bg-[#787aff]/20 border border-[#787aff]/45 text-[#a5a7ff] hover:bg-[#787aff]/30'
            }`}
          >
            {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-white">
              <span>Voice AI Dispatch &amp; Neural Briefing Co-Pilot</span>
              <VoiceWaveform active={listening || speaking || processing} />
            </div>
            <p className="text-[11px] text-slate-400">
              Hands-free voice dispatch, Dubai/Abu Dhabi hub switching, and 10-language Cloud TTS readout.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {summaryToRead && (
            <button
              type="button"
              onClick={() => (speaking ? stopSpeaking() : speak(summaryToRead, language))}
              className={`${SG_SURFACES.buttonSecondary} px-3 py-1.5 text-xs flex items-center gap-1.5`}
            >
              {speaking ? (
                <>
                  <VolumeX className="w-3.5 h-3.5 text-[#fa114f]" />
                  <span>Stop Audio</span>
                </>
              ) : (
                <>
                  <Volume2 className="w-3.5 h-3.5 text-[#10b981]" />
                  <span>Speak Briefing</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void executeCommand(commandInput);
        }}
        className="mt-3 flex flex-wrap items-center gap-2"
      >
        <input
          type="text"
          aria-label="Voice AI command input"
          value={commandInput}
          onChange={(e) => setCommandInput(e.target.value)}
          placeholder='Speak or type a command (e.g., "Order break for W-104", "Simulate Dubai Marina", "Read briefing")'
          className={`flex-1 min-w-[240px] px-3.5 py-2 text-xs ${SG_SURFACES.input}`}
        />
        <button
          type="submit"
          disabled={processing || !commandInput.trim()}
          className={`${SG_SURFACES.buttonPrimary} px-3.5 py-2 text-xs disabled:opacity-50 flex items-center gap-1.5`}
        >
          <Send className="w-3.5 h-3.5" />
          <span>{processing ? 'Executing...' : 'Run Voice Command'}</span>
        </button>
      </form>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {quickPrompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            disabled={processing}
            onClick={() => void executeCommand(prompt)}
            className="px-2.5 py-1 rounded-lg bg-[#0c111d] border border-white/10 hover:border-[#787aff]/45 text-[11px] text-slate-300 hover:text-white transition-colors cursor-pointer whitespace-nowrap"
          >
            {prompt}
          </button>
        ))}
      </div>

      {lastResult && (
        <div
          data-testid="voice-copilot-response"
          className="mt-3 rounded-xl bg-[#0c111d] border border-[#787aff]/30 px-3.5 py-2.5 text-xs flex flex-wrap items-center justify-between gap-2"
        >
          <div className="text-slate-200">
            <span className="font-mono text-[#a5a7ff] mr-2">[{lastResult.actionSummary}]</span>
            <span>{lastResult.spokenReply}</span>
          </div>
          <span className="text-[11px] font-mono text-slate-400">
            {lastResult.source === 'gemini' ? 'Gemini 4 Hydrogen Voice' : 'Edge Voice Router'}
          </span>
        </div>
      )}
    </section>
  );
}
