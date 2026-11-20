import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const STATES_GALLERY = path.resolve('test-results/wearable-states');

test.describe('Wearable Safety Alerts & Sensor Telemetry Specifications', () => {
  test.beforeEach(async ({ request }) => {
    const res = await request.post('/api/system/reset', { data: { scenario: 'default' } });
    expect(res.ok()).toBeTruthy();
  });

  test('Alert State Switcher toggles cleanly across all 4 alert specs, keeps Gemma 4 Edge pill visible on wearable display, and supports 5 languages + °C/°F', async ({
    page,
  }) => {
    fs.mkdirSync(STATES_GALLERY, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/worker');

    const switcher = page.getByTestId('alert-state-switcher');
    await expect(switcher).toBeVisible();

    // Gemma 4 Edge Offline Mode status pill is clearly visible on the wearable display
    const wearableEdgePill = page.getByTestId('wearable-edge-pill');
    await expect(wearableEdgePill).toBeVisible();
    await expect(wearableEdgePill).toContainText('Gemma 4 Edge Offline Mode');

    // State 1 [Amber Forecast]
    await page.getByTestId('alert-state-tab-amber_forecast').click();
    await expect(page.getByTestId('spec-banner-amber-forecast')).toContainText(
      'Amber In ~1 min — Projected by trend forecast. Start break early'
    );
    await expect(page.getByTestId('watchface-active')).toContainText('4.0');
    await expect(page.getByTestId('watchface-forecast-subline')).toContainText('t+15m: 5.2');
    await expect(page.getByTestId('watchface-forecast-subline')).toContainText('+1.2');
    await expect(wearableEdgePill).toHaveText('Gemma 4 Edge Offline Mode');
    await expect(page.getByText('47.1°C').first()).toBeVisible();
    await expect(page.getByText('29%').first()).toBeVisible();
    await expect(page.getByText('37.2°C').first()).toBeVisible();
    await page.screenshot({ path: path.join(STATES_GALLERY, 'state-1-amber-forecast.png'), fullPage: true });

    // State 2 [Hydration Alert]
    await page.getByTestId('alert-state-tab-hydration_alert').click();
    await expect(page.getByTestId('watchface-hydration')).toBeVisible();
    await expect(page.getByText('SAFE TO WORK — HYDRATE (Drink water every 20 min)')).toBeVisible();
    await expect(page.getByText('36.0°C').first()).toBeVisible();
    await expect(page.getByText('RH 29%').first()).toBeVisible();
    await expect(page.getByText('0.8 ml/hr (Optimal)').first()).toBeVisible();
    await expect(wearableEdgePill).toHaveText('Gemma 4 Edge Offline Mode');
    await page.screenshot({ path: path.join(STATES_GALLERY, 'state-2-hydration-alert.png'), fullPage: true });

    // State 3 [High Heat / WBGT]
    await page.getByTestId('alert-state-tab-high_heat').click();
    await expect(page.getByTestId('watchface-high-heat')).toBeVisible();
    await expect(page.getByTestId('env-heat-stress-card')).toBeVisible();
    await expect(page.getByTestId('high-risk-wbgt-dial')).toBeVisible();
    await expect(page.getByTestId('high-risk-wbgt-dial')).toContainText('37–40°C High Risk');
    await expect(page.getByTestId('env-heat-stress-card')).toContainText('37.2°C');
    await expect(page.getByTestId('env-heat-stress-card')).toContainText('47.1°C');
    await page.screenshot({ path: path.join(STATES_GALLERY, 'state-3-high-heat-wbgt.png'), fullPage: true });

    // State 4 [SOS Active]
    await page.getByTestId('alert-state-tab-sos_active').click();
    await expect(page.getByTestId('spec-banner-sos-active')).toContainText(
      'SOS ACTIVE — SUPERVISOR & MEDIC NOTIFIED'
    );
    await expect(page.getByTestId('watchface-sos-active')).toBeVisible();
    await expect(page.getByTestId('sos-escalation-stream')).toBeVisible();
    await expect(page.getByText('HR 98 bpm').first()).toBeVisible();
    await expect(page.getByText('36.0°C').first()).toBeVisible();
    await page.screenshot({ path: path.join(STATES_GALLERY, 'state-4-sos-active.png'), fullPage: true });

    // 10-language Dubai/UAE switcher works cleanly inside alert spec states (Arabic RTL, Urdu RTL, Tamil, Malayalam, Nepali, Sinhala)
    const arResp = page.waitForResponse(
      (r) => r.url().includes('/api/worker/W-101/language') && r.request().method() === 'POST'
    );
    await page.getByRole('button', { name: 'العربية' }).click();
    await arResp;
    await expect(page.locator('div[dir="rtl"]').first()).toContainText(/[\u0600-\u06FF]{3,}/);

    const taResp = page.waitForResponse(
      (r) => r.url().includes('/api/worker/W-101/language') && r.request().method() === 'POST'
    );
    await page.getByRole('button', { name: 'தமிழ்' }).click();
    await taResp;
    await expect(page.locator('main')).toContainText(/[\u0B80-\u0BFF]{3,}/);

    const mlResp = page.waitForResponse(
      (r) => r.url().includes('/api/worker/W-101/language') && r.request().method() === 'POST'
    );
    await page.getByRole('button', { name: 'മലയാളം' }).click();
    await mlResp;
    await expect(page.locator('main')).toContainText(/[\u0D00-\u0D7F]{3,}/);

    const neResp = page.waitForResponse(
      (r) => r.url().includes('/api/worker/W-101/language') && r.request().method() === 'POST'
    );
    await page.getByRole('button', { name: 'नेपाली' }).click();
    await neResp;
    await expect(page.locator('main')).toContainText(/[\u0900-\u097F]{3,}/);

    const siResp = page.waitForResponse(
      (r) => r.url().includes('/api/worker/W-101/language') && r.request().method() === 'POST'
    );
    await page.getByRole('button', { name: 'සිංහල' }).click();
    await siResp;
    await expect(page.locator('main')).toContainText(/[\u0D80-\u0DFF]{3,}/);

    const urResp = page.waitForResponse(
      (r) => r.url().includes('/api/worker/W-101/language') && r.request().method() === 'POST'
    );
    await page.getByRole('button', { name: 'اردو' }).click();
    await urResp;
    await expect(page.locator('div[dir="rtl"]').first()).toContainText(/[\u0600-\u06FF]{3,}/);

    // Switch back to English and Live Telemetry cleanly
    const enResp = page.waitForResponse(
      (r) => r.url().includes('/api/worker/W-101/language') && r.request().method() === 'POST'
    );
    await page.getByRole('button', { name: 'English' }).click();
    await enResp;

    await page.getByTestId('alert-state-tab-live').click();
    await expect(page.getByText('GREEN · NOMINAL')).toBeVisible();
  });
});
