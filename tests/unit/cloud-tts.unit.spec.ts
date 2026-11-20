import { beforeEach, describe, expect, it, vi } from 'vitest';

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

function createMinimalWavBase64(pcmPayloadSize = 16): string {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcmPayloadSize, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24);
  header.writeUInt32LE(48000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcmPayloadSize, 40);
  const pcm = Buffer.alloc(pcmPayloadSize, 0x11);
  return Buffer.concat([header, pcm]).toString('base64');
}

describe('Server-Side Cloud TTS (`gemini-3.8-flash-lite-tts`)', () => {
  beforeEach(async () => {
    generateContentMock.mockReset();
    process.env.GEMINI_API_KEY = 'unit-test-cloud-tts-key';
    const { clearAlertTranslationCache, resetGeminiCircuitBreaker } = await import(
      '../../src/server/geminiService.ts'
    );
    clearAlertTranslationCache();
    resetGeminiCircuitBreaker();
  });

  it('returns explicit no_api_key fallback metadata without fake audio when GEMINI_API_KEY is missing', async () => {
    delete process.env.GEMINI_API_KEY;
    const { synthesizeWorkerSpeech } = await import('../../src/server/geminiService.ts');

    const res = await synthesizeWorkerSpeech({
      text: 'අවදානම — වහාම සෙවණට යන්න',
      language: 'si',
      localeTag: 'si-LK',
      languageName: 'Sinhala',
      severity: 'red',
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.fallback).toBe('web_speech');
      expect(res.reason).toBe('no_api_key');
    }
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it('invokes gemini-3.8-flash-lite-tts with speechMetadata, passes RIFF WAV untouched, and caches repeat requests', async () => {
    const wavB64 = createMinimalWavBase64(24);
    generateContentMock.mockResolvedValueOnce({
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  mimeType: 'audio/wav',
                  data: wavB64,
                },
              },
            ],
          },
        },
      ],
    });

    const { synthesizeWorkerSpeech } = await import('../../src/server/geminiService.ts');
    const first = await synthesizeWorkerSpeech({
      text: 'වැඩ වහාම නවතන්න — සිසිල් වන්න',
      language: 'si',
      localeTag: 'si-LK',
      languageName: 'Sinhala',
      severity: 'red',
    });

    expect(generateContentMock).toHaveBeenCalledTimes(1);
    const callArg = generateContentMock.mock.calls[0][0];
    expect(callArg.model).toBe('gemini-3.8-flash-lite-tts');
    expect(callArg.config.responseModalities).toEqual(['AUDIO']);
    expect(callArg.config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Fenrir');
    expect(callArg.contents[0].parts[0].text).toBe('වැඩ වහාම නවතන්න — සිසිල් වන්න');
    expect(callArg.contents[0].parts[0].speechMetadata.style).toContain('Sinhala (si-LK)');

    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.mimeType).toBe('audio/wav');
      expect(first.audioBase64).toBe(wavB64);
      expect(first.cached).toBe(false);
      expect(first.voiceName).toBe('Fenrir');
      expect(first.source).toBe('gemini_tts');
    }

    // Second identical request hits cache without extra API call
    const second = await synthesizeWorkerSpeech({
      text: 'වැඩ වහාම නවතන්න — සිසිල් වන්න',
      language: 'si',
      localeTag: 'si-LK',
      languageName: 'Sinhala',
      severity: 'red',
    });
    expect(generateContentMock).toHaveBeenCalledTimes(1);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.cached).toBe(true);
    }
  });

  it('wraps raw PCM (audio/l16) in a valid 44-byte RIFF/WAVE header without corrupting existing WAVs', async () => {
    const { ensurePlayableWavBuffer } = await import('../../src/server/geminiService.ts');

    const rawPcm = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
    const wrapped = ensurePlayableWavBuffer(rawPcm, 'audio/l16;rate=24000');
    expect(wrapped.mimeType).toBe('audio/wav');
    expect(wrapped.buffer.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(wrapped.buffer.subarray(8, 12).toString('ascii')).toBe('WAVE');
    expect(wrapped.buffer.length).toBe(44 + rawPcm.length);

    // Passing that WAV back must NOT double-wrap a second RIFF header
    const passthrough = ensurePlayableWavBuffer(wrapped.buffer, 'audio/wav');
    expect(passthrough.buffer.length).toBe(wrapped.buffer.length);
  });
});
