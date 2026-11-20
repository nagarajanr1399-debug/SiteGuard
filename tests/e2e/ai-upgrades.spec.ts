import { expect, test } from '@playwright/test';

const FORBIDDEN_VITAL_KEYS = new Set([
  'hrbpm',
  'skintempc',
  'exertionindex',
  'hr0',
  'tc0',
  'hrmaxestimated',
  'tcproxyc',
  'psi',
  'latestframe',
]);

function findForbiddenKeys(value: unknown, currentPath = '$'): string[] {
  const leaks: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((item, idx) => {
      leaks.push(...findForbiddenKeys(item, `${currentPath}[${idx}]`));
    });
  } else if (value !== null && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const nextPath = `${currentPath}.${key}`;
      if (FORBIDDEN_VITAL_KEYS.has(key.toLowerCase())) {
        leaks.push(nextPath);
      }
      leaks.push(...findForbiddenKeys(nested, nextPath));
    }
  }
  return leaks;
}

test.describe('Hybrid AI Co-Pilots Across Supervisor, Compliance, Backtest & Forecast', () => {
  test.beforeEach(async ({ request }) => {
    const res = await request.post('/api/system/reset', { data: { scenario: 'default' } });
    expect(res.ok()).toBeTruthy();
  });

  test('/supervisor AI Shift Triage Briefing generates 10-language briefings with zero raw vital leaks', async ({
    page,
  }) => {
    const apiPayloads: Array<{ url: string; leaks: string[] }> = [];
    page.on('response', async (response) => {
      const url = response.url();
      if (!url.includes('/api/')) return;
      const contentType = response.headers()['content-type'] ?? '';
      if (!contentType.includes('application/json')) return;
      const body = await response.json();
      apiPayloads.push({ url, leaks: findForbiddenKeys(body) });
    });

    await page.goto('/supervisor');
    const panel = page.getByTestId('supervisor-ai-briefing-panel');
    await expect(panel).toBeVisible();

    const langSelect = page.getByLabel('Supervisor AI briefing language');
    await expect(langSelect.locator('option')).toHaveCount(10);

    const enReq = page.waitForResponse(
      (r) => r.url().includes('/api/supervisor/ai-briefing') && r.request().method() === 'POST'
    );
    await page.getByRole('button', { name: 'Generate AI Shift Briefing' }).click();
    await enReq;

    const body = page.getByTestId('supervisor-ai-briefing-body');
    await expect(body).toBeVisible();
    await expect(body).toHaveAttribute('dir', 'ltr');

    // Switch AI briefing language to Arabic (RTL)
    const arReq = page.waitForResponse(
      (r) => r.url().includes('/api/supervisor/ai-briefing') && r.request().method() === 'POST'
    );
    await langSelect.selectOption('ar');
    await arReq;
    await expect(body).toHaveAttribute('dir', 'rtl');
    await expect(body).toContainText(/[\u0600-\u06FF]{3,}/);

    for (const p of apiPayloads) {
      expect(p.leaks, `Privacy leak in ${p.url}`).toEqual([]);
    }
    const mainText = await page.locator('main').innerText();
    expect(mainText).not.toMatch(/\b\d+\s*bpm\b/i);
    expect(mainText).not.toMatch(/\bHR0\b|\bHRmax\b|\bTc proxy\b|\bBorg\b/i);
    expect(mainText).not.toMatch(/\bPSI\s*\d/i);
  });

  test('/compliance generates English & Arabic (MOHRE) AI narratives with remediation checklists', async ({
    page,
  }) => {
    await page.goto('/compliance');

    const arButton = page.getByRole('button', { name: 'العربية (MOHRE)' });
    await expect(arButton).toBeVisible();
    await arButton.click();

    const narrativeReq = page.waitForResponse(
      (r) => r.url().includes('/api/compliance/narrative') && r.request().method() === 'POST'
    );
    await page.getByRole('button', { name: 'Generate Summary with Gemini' }).click();
    await narrativeReq;

    const narrativeBox = page.getByTestId('compliance-ai-narrative');
    await expect(narrativeBox).toBeVisible();
    await expect(narrativeBox).toHaveAttribute('dir', 'rtl');
    await expect(narrativeBox).toContainText(/[\u0600-\u06FF]{3,}/);
    await expect(narrativeBox).not.toContainText('hrBpm');
    await expect(narrativeBox).not.toContainText('skinTempC');
  });

  test('/validation & /forecast-validation generate AI analytical insights without altering deterministic metrics', async ({
    page,
    request,
  }) => {
    await request.post('/api/validation/generate-cohort', {
      data: { mode: 'deterministic', count: 24 },
    });

    await page.goto('/validation');
    const backtestPanel = page.getByTestId('backtest-ai-insights');
    await expect(backtestPanel).toBeVisible();

    const btReq = page.waitForResponse(
      (r) => r.url().includes('/api/validation/ai-insights') && r.request().method() === 'POST'
    );
    await page.getByRole('button', { name: 'Analyze Backtest with Gemini' }).click();
    await btReq;
    await expect(backtestPanel).toContainText(/Key Replay Findings/i);
    await expect(backtestPanel).toContainText(/Engineering Recommendations/i);

    await page.goto('/forecast-validation');
    const forecastPanel = page.getByTestId('forecast-ai-insights');
    await expect(forecastPanel).toBeVisible();

    // Verify interactive Forecast Replay Play/Pause & timeline scrubber
    const scrubber = page.getByLabel('Replay timeline scrubber');
    await expect(scrubber).toBeVisible();
    await page.getByRole('button', { name: 'Play Replay' }).click();
    await expect(page.getByRole('button', { name: 'Pause Replay' })).toBeVisible();
    await page.getByRole('button', { name: 'Pause Replay' }).click();

    const fcReq = page.waitForResponse(
      (r) => r.url().includes('/api/validation/ai-insights') && r.request().method() === 'POST'
    );
    await page.getByRole('button', { name: 'Analyze Forecast Ablation with Gemini' }).click();
    await fcReq;
    await expect(forecastPanel).toContainText(/Ablation & Horizon Insights/i);
    await expect(forecastPanel).toContainText(/Deployment Recommendations/i);
  });

  test('UAE Dubai & Abu Dhabi Hub Simulation, Spatial Zone Radar, and Voice AI Co-Pilot work seamlessly end-to-end', async ({
    page,
  }) => {
    await page.goto('/supervisor');
    await expect(page.getByTestId('uae-hub-simulator')).toBeVisible();
    await expect(page.getByTestId('supervisor-zone-radar')).toBeVisible();
    await expect(page.getByTestId('voice-copilot-bar')).toBeVisible();

    // Switch simulation from Abu Dhabi to Dubai Marina
    const hubReq = page.waitForResponse(
      (r) => r.url().includes('/api/environment/hub') && r.request().method() === 'POST'
    );
    await page.getByTestId('hub-btn-dubai_marina').click();
    await hubReq;
    await expect(page.getByTestId('hub-btn-dubai_marina')).toContainText('ACTIVE STATION');

    // Run Voice AI Command
    const voiceReq = page.waitForResponse(
      (r) => r.url().includes('/api/voice/command') && r.request().method() === 'POST'
    );
    await page.getByRole('button', { name: 'Order break for W-104' }).click();
    await voiceReq;
    const voiceResp = page.getByTestId('voice-copilot-response');
    await expect(voiceResp).toBeVisible();
    await expect(voiceResp).toContainText('W-104');
    await expect(voiceResp).not.toContainText(/\b\d+\s*bpm\b/i);

    // Verify Compliance dynamically reflects Dubai Marina hub & UAE solar timeline
    await page.goto('/compliance');
    await expect(page.locator('main')).toContainText('Dubai Marina Tower Deck Site 04');
    await expect(page.locator('main')).toContainText('12:30–15:00 Mandatory Halt');

    // Verify Backtest What-If Threshold Sandbox slider responds cleanly
    await page.goto('/validation');
    const slider = page.getByLabel('What-If Amber Trigger Threshold');
    await expect(slider).toBeVisible();
    await slider.fill('4.5');
    await expect(page.locator('main')).toContainText('4.5 / 10');
  });
});

