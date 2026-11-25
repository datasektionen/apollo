import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

function resolvePlaywrightEntry() {
  const candidates = [
    path.resolve(process.cwd(), '.ui-eval/node_modules/playwright-core/index.mjs'),
  ];
  try {
    const gitCommonDir = execSync('git rev-parse --git-common-dir', { encoding: 'utf8' }).trim();
    const primaryRoot = path.resolve(gitCommonDir, '..');
    candidates.push(path.join(primaryRoot, '.ui-eval/node_modules/playwright-core/index.mjs'));
  } catch {
    // Fallback below if git is unavailable
  }
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error(`playwright-core not found. Run 'npm --prefix .ui-eval install' first. Checked: ${candidates.join(', ')}`);
  }
  return pathToFileURL(found).href;
}

const { chromium } = await import(resolvePlaywrightEntry());

const BASE_URL = process.env.APOLLO_URL || 'https://localhost:3000';
const PROJECT_ID = process.env.APOLLO_DAW_PROJECT_ID || '9cf120fb-2e84-45f6-a9ed-71e9fd68e0f9'; // 0.0 - Dumb Ways to Die
const TARGET_DIR_NAME = process.argv[2] || 'daw-current';
const OUT_DIR = path.resolve(process.cwd(), '.ui-eval', TARGET_DIR_NAME);

function mintAliceToken() {
  return execSync(
    `docker exec apollo-api-1 node --input-type=module -e "import { signAccessToken } from './src/auth.js'; process.stdout.write(signAccessToken({ id: 'e37d6db8-53ff-44cb-847a-80b4307c29d6', username: 'alice.example.com', isAdmin: true }));"`,
    { encoding: 'utf8' }
  ).trim();
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const token = mintAliceToken();
  const consoleErrors = [];
  const pageErrors = [];

  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--disable-gpu-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      ignoreHTTPSErrors: true,
      permissions: ['microphone'],
    });
    await context.addCookies([
      {
        name: 'apollo_access_token',
        value: token,
        url: BASE_URL,
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      },
    ]);

    const page = await context.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => {
      pageErrors.push(String(err));
    });

    await page.goto(`${BASE_URL}/daw/projects/${PROJECT_ID}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.locator('[aria-label="Timeline tracks"]').waitFor({ state: 'visible', timeout: 25000 });
    await page.locator('[data-tree-row-id]').first().waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(2800);

    // Select a track row so selected track styling is visible on desktop baseline
    const squådisRow = page.locator('[data-tree-row-id]', { hasText: 'Squådis' }).first();
    if (await squådisRow.count()) {
      await squådisRow.click();
    } else {
      await page.locator('[data-tree-row-id]').first().click();
    }
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT_DIR, 'daw-desktop.png') });
    console.log(`Captured ${path.join(OUT_DIR, 'daw-desktop.png')}`);

    // Interactive state: select an unmuted leaf audio track (arms bright red Record button) + hover its volume slider (shows gold fill + white circular knob)
    const leafRows = page.locator('[data-tree-row-id]', { has: page.locator('input[type="range"].volume-slider') });
    const leafCount = await leafRows.count();
    let armedRow = null;
    for (let i = 0; i < leafCount; i += 1) {
      const candidate = leafRows.nth(i);
      const isGroupChevron = await candidate.locator('button[title="Expand group"], button[title="Collapse group"]').count();
      const isMuted = await candidate.locator('button[title="Unmute"]').count();
      if (!isGroupChevron && !isMuted) {
        armedRow = candidate;
        break;
      }
    }
    if (armedRow) {
      await armedRow.click();
      await page.waitForTimeout(150);
      const slider = armedRow.locator('input[type="range"].volume-slider').first();
      if (await slider.count()) {
        await slider.hover();
        await page.waitForTimeout(200);
      }
      await page.screenshot({ path: path.join(OUT_DIR, 'daw-interactive-desktop.png') });
      console.log(`Captured ${path.join(OUT_DIR, 'daw-interactive-desktop.png')}`);
    }

    // Re-select Squådis before context menu capture
    if (await squådisRow.count()) {
      await squådisRow.click();
      await page.waitForTimeout(150);
    }

    // Right-click track row -> open context menu + hover "Change type"
    const targetRow = (await squådisRow.count()) ? squådisRow : page.locator('[data-tree-row-id]').first();
    await targetRow.click({ button: 'right' });
    const changeTypeItem = page.locator('text=Change type').first();
    await changeTypeItem.waitFor({ state: 'visible', timeout: 5000 });
    await changeTypeItem.hover();
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT_DIR, 'daw-context-menu.png') });
    console.log(`Captured ${path.join(OUT_DIR, 'daw-context-menu.png')}`);
    // Dismiss context menu outside
    await page.mouse.click(900, 120);
    await page.waitForTimeout(200);

    // Settings dialog (DAW tab)
    await page.locator('button[title="Settings"]').click();
    const dawTabBtn = page.getByRole('button', { name: 'DAW', exact: true });
    await dawTabBtn.waitFor({ state: 'visible', timeout: 5000 });
    await dawTabBtn.click();
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT_DIR, 'daw-settings-desktop.png') });
    console.log(`Captured ${path.join(OUT_DIR, 'daw-settings-desktop.png')}`);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.waitForTimeout(200);

    // Export dialog
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await page.locator('text=Format').first().waitFor({ state: 'visible', timeout: 8000 });
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT_DIR, 'daw-export-desktop.png') });
    console.log(`Captured ${path.join(OUT_DIR, 'daw-export-desktop.png')}`);
    const exportHeaderClose = page.locator('div.fixed h2').locator('..').locator('button').last();
    await exportHeaderClose.click();
    await page.waitForTimeout(200);

    // Import dialog
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await page.locator('text=Import Audio Files').waitFor({ state: 'visible', timeout: 8000 });
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT_DIR, 'daw-import-desktop.png') });
    console.log(`Captured ${path.join(OUT_DIR, 'daw-import-desktop.png')}`);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.waitForTimeout(200);

    // Mobile / narrow viewport
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT_DIR, 'daw-mobile.png') });
    console.log(`Captured ${path.join(OUT_DIR, 'daw-mobile.png')}`);

    assert.equal(consoleErrors.length, 0, `Console errors during capture: ${JSON.stringify(consoleErrors)}`);
    assert.equal(pageErrors.length, 0, `Page errors during capture: ${JSON.stringify(pageErrors)}`);
    console.log(`All DAW screenshots captured cleanly in ${OUT_DIR}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('DAW CAPTURE FAILED:', err);
  process.exit(1);
});
