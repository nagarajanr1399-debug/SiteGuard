import { expect, test, type Locator, type Page } from '@playwright/test';

async function dragSliderToFraction(page: Page, slider: Locator, fraction: number) {
  await slider.scrollIntoViewIfNeeded();
  const box = await slider.boundingBox();
  if (!box) throw new Error('Slider boundingBox unavailable');
  const min = Number((await slider.getAttribute('min')) ?? 0);
  const max = Number((await slider.getAttribute('max')) ?? 100);
  const cur = Number(await slider.inputValue());
  const curFrac = Math.max(0, Math.min(1, (cur - min) / Math.max(1e-6, max - min)));

  const thumbInset = 8;
  const usableW = Math.max(10, box.width - thumbInset * 2);
  const startX = box.x + thumbInset + usableW * curFrac;
  const targetX = box.x + thumbInset + usableW * Math.max(0, Math.min(1, fraction));
  const y = box.y + box.height / 2;

  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(targetX, y, { steps: 5 });
  await page.mouse.up();
}

test.describe('Worker Flow & Cross-Page Check-In', () => {
  test.beforeEach(async ({ request }) => {
    const res = await request.post('/api/system/reset', { data: { scenario: 'default' } });
    expect(res.ok()).toBeTruthy();
  });

  test('loads /worker in Green tier by default with baseline copy', async ({ page }) => {
    await page.goto('/worker');
    await expect(page.getByRole('heading', { name: /Worker Wearable/i })).toBeVisible();
    await expect(page.getByText('GREEN · NOMINAL')).toBeVisible();
    await expect(page.getByText(/SAFE TO WORK/i)).toBeVisible();
    await expect(page.getByText(/Composite \d+\.\d\/10 · PSI \d+\.\d/)).toBeVisible();
  });

  test('dragging HR/skin-temp/exertion sliders into Amber and Red updates tier, alert copy, and icon', async ({
    page,
  }) => {
    await page.goto('/worker');
    await expect(page.getByText('GREEN · NOMINAL')).toBeVisible();

    // Expand demoted Developer / BLE Simulator drawer before interacting with sliders
    await page.getByRole('button', { name: /Developer \/ BLE Simulator/i }).click();

    const hrSlider = page.locator('#hr-slider');
    const skinSlider = page.locator('#skin-slider');
    const exertionSlider = page.locator('#exertion-slider');

    // Drag into Amber physiological zone and wait for final debounced BLE ingestion POST
    await dragSliderToFraction(page, hrSlider, 0.45);
    await dragSliderToFraction(page, skinSlider, 0.34);
    const amberPost = page.waitForResponse(
      (r) => r.url().includes('/api/ble/telemetry') && r.request().method() === 'POST'
    );
    await dragSliderToFraction(page, exertionSlider, 0.45);
    await amberPost;

    await expect(page.getByText('AMBER · REST IN SHADE')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/REST IN SHADE|15-min|shaded/i).first()).toBeVisible();

    // Drag further into Critical Red zone
    await dragSliderToFraction(page, hrSlider, 0.94);
    await dragSliderToFraction(page, skinSlider, 0.92);
    const redPost = page.waitForResponse(
      (r) => r.url().includes('/api/ble/telemetry') && r.request().method() === 'POST'
    );
    await dragSliderToFraction(page, exertionSlider, 0.95);
    await redPost;

    await expect(page.getByText('RED · STOP WORK')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/STOP WORK NOW/i)).toBeVisible();
    // Tier SVG icon inside wearable banner must render visibly
    await expect(page.locator('section svg').first()).toBeVisible();
  });

  test('renders translated alert text in multiple supported languages when selector changes', async ({
    page,
  }) => {
    await page.goto('/worker');
    await expect(page.getByText(/SAFE TO WORK/i)).toBeVisible();

    // Switch to Hindi (हिन्दी) and assert actual Devanagari script is rendered
    const hiResp = page.waitForResponse(
      (r) => r.url().includes('/api/worker/W-101/language') && r.request().method() === 'POST'
    );
    await page.getByRole('button', { name: 'हिन्दी' }).click();
    await hiResp;
    const alertBox = page.locator('div[dir]').first();
    await expect(alertBox).toHaveAttribute('dir', 'ltr');
    await expect(alertBox).toContainText(/[\u0900-\u097F]{3,}/);

    // Switch to Urdu (اردو) and assert RTL layout + Arabic/Urdu script
    const urResp = page.waitForResponse(
      (r) => r.url().includes('/api/worker/W-101/language') && r.request().method() === 'POST'
    );
    await page.getByRole('button', { name: 'اردو' }).click();
    await urResp;
    await expect(alertBox).toHaveAttribute('dir', 'rtl');
    await expect(alertBox).toContainText(/[\u0600-\u06FF]{3,}/);

    // Switch to Tagalog and assert Tagalog safety copy
    const tlResp = page.waitForResponse(
      (r) => r.url().includes('/api/worker/W-101/language') && r.request().method() === 'POST'
    );
    await page.getByRole('button', { name: 'Tagalog' }).click();
    await tlResp;
    await expect(alertBox).toContainText(/LIGTAS|TUBIG|MAGPAHINGA|ITIGIL/i);
  });

  test('"I\'m Okay" and "Need Help" clicks produce status confirmation and propagate to /supervisor', async ({
    page,
  }) => {
    await page.goto('/worker');

    const okResp = page.waitForResponse(
      (r) => r.url().includes('/api/worker/W-101/checkin') && r.request().method() === 'POST'
    );
    await page.getByRole('button', { name: "I'm Okay" }).click();
    await okResp;
    await expect(page.getByRole('status')).toContainText('CHECK-IN CONFIRMED · WORKER OKAY');

    const helpResp = page.waitForResponse(
      (r) => r.url().includes('/api/worker/W-101/checkin') && r.request().method() === 'POST'
    );
    await page.getByRole('button', { name: 'Need Help' }).click();
    await helpResp;
    await expect(page.getByRole('status')).toContainText('SOS ACTIVE · SUPERVISOR & MEDIC NOTIFIED');

    // Cross-page assertion onto /supervisor
    await page.goto('/supervisor');
    await expect(page.getByText('WORKER REQUESTED HELP')).toBeVisible();
    await expect(page.getByText('Worker pressed NEED HELP on wearable unit.').first()).toBeVisible();
  });

  test('toggles all environmental and wearable temperature readings between Celsius and Fahrenheit', async ({
    page,
  }) => {
    await page.goto('/worker');

    // Default Celsius readouts (11:00 GST: Air 44.4°C, WBGT 35.0°C, W-101 skin 34.0°C)
    await expect(page.getByText('Air 44.4°C')).toBeVisible();
    await expect(page.getByText('35.0°C')).toBeVisible();
    await expect(page.getByText('Skin 34.0°C')).toBeVisible();

    const unitSwitch = page.getByRole('switch', {
      name: /Toggle temperature unit between Celsius and Fahrenheit/i,
    });
    await expect(unitSwitch).toHaveAttribute('aria-checked', 'false');

    // Toggle to Fahrenheit: 44.4°C -> 111.9°F, 35.0°C -> 95.0°F, 34.0°C -> 93.2°F
    await unitSwitch.click();
    await expect(unitSwitch).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText('Air 111.9°F')).toBeVisible();
    await expect(page.getByText('95.0°F')).toBeVisible();
    await expect(page.getByText('Skin 93.2°F')).toBeVisible();

    // Persists across route navigation and toggles cleanly back to Celsius
    await page.goto('/supervisor');
    await expect(page.getByText('Air 111.9°F')).toBeVisible();
    await expect(page.getByText('95.0°F').first()).toBeVisible();

    await page
      .getByRole('switch', { name: /Toggle temperature unit between Celsius and Fahrenheit/i })
      .click();
    await expect(page.getByText('Air 44.4°C')).toBeVisible();
  });

  test('falls back to multilingual Web Speech alerts when server Cloud TTS is unavailable (offline/no_api_key)', async ({
    page,
  }) => {
    await page.route('**/api/worker/*/speak', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'GEMINI_API_KEY is not configured on the server; use offline Web Speech fallback.',
          fallback: 'web_speech',
          reason: 'no_api_key',
        }),
      });
    });

    await page.addInitScript(() => {
      const spokenLog: Array<{ text: string; lang: string }> = [];
      (window as unknown as { __spokenAlerts: typeof spokenLog }).__spokenAlerts = spokenLog;
      class MockUtterance {
        text: string;
        lang = 'en-US';
        rate = 1;
        pitch = 1;
        voice: SpeechSynthesisVoice | null = null;
        onend: (() => void) | null = null;
        onerror: (() => void) | null = null;
        constructor(text: string) {
          this.text = text;
        }
      }
      Object.defineProperty(window, 'SpeechSynthesisUtterance', {
        configurable: true,
        writable: true,
        value: MockUtterance,
      });
      Object.defineProperty(window, 'speechSynthesis', {
        configurable: true,
        writable: true,
        value: {
          cancel: () => {},
          getVoices: () => [],
          addEventListener: () => {},
          removeEventListener: () => {},
          speak: (u: { text: string; lang: string }) => {
            spokenLog.push({ text: u.text, lang: u.lang });
          },
        },
      });
    });

    await page.goto('/worker');
    await expect(page.getByTestId('worker-voice-alert-status')).toContainText('ARMED · STANDBY');

    const initialCount = await page.evaluate(
      () => (window as unknown as { __spokenAlerts: Array<{ text: string; lang: string }> }).__spokenAlerts.length
    );
    expect(initialCount).toBe(0);

    // Trigger Critical heat threshold via BLE Simulator Critical preset
    await page.getByRole('button', { name: /Developer \/ BLE Simulator/i }).click();
    const redPost = page.waitForResponse(
      (r) => r.url().includes('/api/ble/telemetry') && r.request().method() === 'POST'
    );
    await page.getByRole('button', { name: 'Critical', exact: true }).click();
    await redPost;

    await expect(page.getByText('RED · STOP WORK')).toBeVisible();
    await expect(page.getByTestId('worker-voice-alert-status')).toContainText(
      /AUDIBLE ALERT TRIGGERED|SPEAKING ALERT/i
    );
    await expect(page.getByTestId('worker-voice-alert-status')).toHaveAttribute(
      'data-voice-source',
      'web_speech'
    );

    const afterRed = await page.evaluate(
      () => (window as unknown as { __spokenAlerts: Array<{ text: string; lang: string }> }).__spokenAlerts
    );
    expect(afterRed.length).toBeGreaterThanOrEqual(1);
    expect(afterRed[afterRed.length - 1].lang).toBe('en-US');
    expect(afterRed[afterRed.length - 1].text).toMatch(/STOP WORK/i);

    // Switch worker language to Tamil while threshold is exceeded -> speaks in ta-IN
    const taResp = page.waitForResponse(
      (r) => r.url().includes('/api/worker/W-101/language') && r.request().method() === 'POST'
    );
    await page.getByRole('button', { name: 'தமிழ்' }).click();
    await taResp;
    await expect(page.getByTestId('worker-voice-locale')).toContainText('ta-IN');
    await expect
      .poll(async () =>
        page.evaluate(
          () => (window as unknown as { __spokenAlerts: Array<{ text: string; lang: string }> }).__spokenAlerts.at(-1)?.lang
        )
      )
      .toBe('ta-IN');

    // Switch worker language to Arabic while threshold is exceeded -> speaks in ar-AE
    const arResp = page.waitForResponse(
      (r) => r.url().includes('/api/worker/W-101/language') && r.request().method() === 'POST'
    );
    await page.getByRole('button', { name: 'العربية' }).click();
    await arResp;
    await expect
      .poll(async () =>
        page.evaluate(
          () => (window as unknown as { __spokenAlerts: Array<{ text: string; lang: string }> }).__spokenAlerts.at(-1)?.lang
        )
      )
      .toBe('ar-AE');

    // Switch worker language to Sinhala while threshold is exceeded -> speaks in si-LK
    const siResp = page.waitForResponse(
      (r) => r.url().includes('/api/worker/W-101/language') && r.request().method() === 'POST'
    );
    await page.getByRole('button', { name: 'සිංහල' }).click();
    await siResp;
    await expect
      .poll(async () =>
        page.evaluate(
          () => (window as unknown as { __spokenAlerts: Array<{ text: string; lang: string }> }).__spokenAlerts.at(-1)?.lang
        )
      )
      .toBe('si-LK');
    const afterSi = await page.evaluate(
      () => (window as unknown as { __spokenAlerts: Array<{ text: string; lang: string }> }).__spokenAlerts.at(-1)
    );
    expect(afterSi?.text).toMatch(/[\u0D80-\u0DFF]{3,}/);

    // Mute toggle stops/silences auto alerts cleanly
    await page.getByTestId('worker-voice-alert-toggle').click();
    await expect(page.getByTestId('worker-voice-alert-toggle')).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    await expect(page.getByTestId('worker-voice-alert-status')).toContainText(/muted/i);
  });

  test('plays server-side Cloud TTS audio via <audio> ahead of Web Speech across English, Tamil, Arabic, and Sinhala', async ({
    page,
    request,
  }) => {
    // 1. Validate /api/worker/:id/speak backend API contract
    const emptyTextRes = await request.post('/api/worker/W-101/speak', {
      data: { text: '   ', language: 'ta' },
    });
    expect(emptyTextRes.status()).toBe(400);

    const missingWorkerRes = await request.post('/api/worker/UNKNOWN-999/speak', {
      data: { text: 'Drink water', language: 'en' },
    });
    expect(missingWorkerRes.status()).toBe(404);

    const liveSpeakRes = await request.post('/api/worker/W-101/speak', {
      data: {
        text: 'වැඩ වහාම නවතන්න — සිසිල් වන්න',
        language: 'si',
        localeTag: 'si-LK',
        severity: 'red',
      },
    });
    expect([200, 503]).toContain(liveSpeakRes.status());
    const liveSpeakBody = await liveSpeakRes.json();
    if (liveSpeakRes.status() === 200) {
      expect(typeof liveSpeakBody.audioBase64).toBe('string');
      expect(liveSpeakBody.mimeType).toBe('audio/wav');
      expect(liveSpeakBody.source).toBe('gemini_tts');
    } else {
      expect(liveSpeakBody.fallback).toBe('web_speech');
    }

    // 2. Verify client plays Cloud TTS <audio> blob when /speak succeeds and never invokes Web Speech fallback
    const minimalWavBytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x2c, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
      0x66, 0x6d, 0x74, 0x20, 0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
      0xc0, 0x5d, 0x00, 0x00, 0x80, 0xbb, 0x00, 0x00, 0x02, 0x00, 0x10, 0x00,
      0x64, 0x61, 0x74, 0x61, 0x08, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    const minimalWavBase64 = Buffer.from(minimalWavBytes).toString('base64');
    const speakRequests: Array<{ language: string; localeTag: string; text: string }> = [];

    await page.route('**/api/worker/*/speak', async (route) => {
      const payload = route.request().postDataJSON() as {
        language: string;
        localeTag: string;
        text: string;
      };
      speakRequests.push(payload);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          audioBase64: minimalWavBase64,
          mimeType: 'audio/wav',
          language: payload.language,
          localeTag: payload.localeTag,
          voiceName: 'Fenrir',
          model: 'gemini-3.8-flash-lite-tts',
          cached: false,
          source: 'gemini_tts',
        }),
      });
    });

    await page.addInitScript(() => {
      const webSpeechCalls: string[] = [];
      const audioPlaySrcs: string[] = [];
      (window as unknown as { __webSpeechCalls: string[]; __audioPlaySrcs: string[] }).__webSpeechCalls =
        webSpeechCalls;
      (window as unknown as { __audioPlaySrcs: string[] }).__audioPlaySrcs = audioPlaySrcs;

      Object.defineProperty(window, 'speechSynthesis', {
        configurable: true,
        writable: true,
        value: {
          cancel: () => {},
          getVoices: () => [],
          addEventListener: () => {},
          removeEventListener: () => {},
          speak: (u: { text: string }) => {
            webSpeechCalls.push(u.text);
          },
        },
      });

      HTMLMediaElement.prototype.play = function () {
        audioPlaySrcs.push(this.src);
        return Promise.resolve();
      };
    });

    await page.goto('/worker');
    await page.getByRole('button', { name: /Developer \/ BLE Simulator/i }).click();
    const redPost = page.waitForResponse(
      (r) => r.url().includes('/api/ble/telemetry') && r.request().method() === 'POST'
    );
    await page.getByRole('button', { name: 'Critical', exact: true }).click();
    await redPost;

    await expect(page.getByTestId('worker-voice-alert-status')).toHaveAttribute(
      'data-voice-source',
      'cloud_tts'
    );
    await expect(page.getByTestId('worker-voice-locale')).toContainText('Gemini Cloud TTS (Fenrir)');

    const audioEl = page.getByTestId('worker-voice-audio');
    await expect(audioEl).toHaveAttribute('src', /^blob:/);

    for (const langBtn of ['தமிழ்', 'العربية', 'සිංහල']) {
      const langResp = page.waitForResponse(
        (r) => r.url().includes('/api/worker/W-101/language') && r.request().method() === 'POST'
      );
      await page.getByRole('button', { name: langBtn }).click();
      await langResp;
    }

    await expect.poll(() => speakRequests.length).toBeGreaterThanOrEqual(4);
    expect(speakRequests.map((r) => r.localeTag)).toEqual(
      expect.arrayContaining(['en-US', 'ta-IN', 'ar-AE', 'si-LK'])
    );

    const runtimeCounts = await page.evaluate(() => ({
      webSpeechCalls: (window as unknown as { __webSpeechCalls: string[] }).__webSpeechCalls.length,
      audioPlays: (window as unknown as { __audioPlaySrcs: string[] }).__audioPlaySrcs.length,
    }));
    expect(runtimeCounts.audioPlays).toBeGreaterThanOrEqual(4);
    expect(runtimeCounts.webSpeechCalls).toBe(0);
  });

  test('displays live Abu Dhabi GST clock, dynamic per-worker battery, and 114+ global language translator', async ({
    page,
  }) => {
    await page.goto('/worker');

    await expect(page.getByTestId('topnav-abudhabi-clock')).toContainText(/AUH \d{2}:\d{2}:\d{2} GST/);
    await expect(page.getByTestId('watch-abudhabi-clock')).toContainText(/\d{2}:\d{2}:\d{2}/);
    await expect(page.getByTestId('watch-abudhabi-clock')).toContainText('GST · T+12m');
    await expect(page.getByTestId('watch-battery-complication')).toContainText('93%');

    // Switch to W-102 and confirm battery dynamically updates (77% instead of frozen 86%)
    await page.locator('#worker-select').selectOption('W-102');
    await expect(page.getByTestId('watch-battery-complication')).toContainText('77%');

    // Step simulated clock +3 min -> watch clock advances to T+15m and battery drains dynamically to 76%
    const step1 = page.waitForResponse((r) => r.url().includes('/sim-step'));
    await page.getByRole('button', { name: '+3 min Step' }).click();
    await step1;
    await expect(page.getByTestId('watch-abudhabi-clock')).toContainText('T+15m');
    await expect(page.getByTestId('watch-battery-complication')).toContainText('76%');

    // Open 114+ Global Languages picker, search Telugu, and translate via /translate-global
    await page.getByTestId('global-language-picker-btn').click();
    await expect(page.getByTestId('global-language-drawer')).toBeVisible();
    await page.getByTestId('global-language-search').fill('Telugu');

    const trResp = page.waitForResponse(
      (r) => r.url().includes('/translate-global') && r.request().method() === 'POST'
    );
    await page.getByTestId('global-lang-te').click();
    await trResp;

    await expect(page.getByText('Wearable Safety Guidance (తెలుగు)')).toBeVisible();
    await expect(page.getByTestId('worker-voice-locale')).toContainText('te-IN');
  });
});

