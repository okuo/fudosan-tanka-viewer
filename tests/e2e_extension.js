/**
 * Chrome拡張として読み込んだ状態のE2Eテスト
 *
 * 通常実行:
 *   npm install
 *   npm run test:e2e
 *
 * Chromeの場所を明示する場合:
 *   CHROME_PATH="/path/to/Chromium or Chrome for Testing" npm run test:e2e
 */

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const ROOT_DIR = path.resolve(__dirname, '..');
const CURRENT_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'manifest.json'), 'utf8')).version;
const EXTENSION_FILES = [
  'manifest.json',
  'background.js',
  'content.js',
  'styles.css',
  'popup.html',
  'popup.js',
  'popup.css',
  'icons/icon16.png',
  'icons/icon48.png',
  'icons/icon128.png'
];

function findChromeExecutable() {
  const playwrightExecutable = chromium.executablePath();
  const candidates = [
    process.env.CHROMIUM_PATH,
    process.env.CHROME_FOR_TESTING_PATH,
    process.env.CHROME_PATH,
    playwrightExecutable,
    '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ].filter(Boolean);

  const found = candidates.find(candidate => fs.existsSync(candidate));
  if (!found) {
    throw new Error(
      'Chromium / Chrome for Testing が見つかりません。' +
      'npm install 後に `npx playwright install chromium` を実行するか、' +
      'CHROME_PATH で Chromium 系ブラウザを指定してください。'
    );
  }

  return found;
}

function createExtensionDir() {
  const extensionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fudosan-extension-'));

  for (const file of EXTENSION_FILES) {
    const source = path.join(ROOT_DIR, file);
    const destination = path.join(extensionDir, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }

  return extensionDir;
}

async function getExtensionId(context) {
  const deadline = Date.now() + 10000;

  while (Date.now() < deadline) {
    const worker = context.serviceWorkers().find(sw => sw.url().startsWith('chrome-extension://'));
    if (worker) return new URL(worker.url()).host;

    try {
      const nextWorker = await context.waitForEvent('serviceworker', { timeout: 1000 });
      if (nextWorker.url().startsWith('chrome-extension://')) {
        return new URL(nextWorker.url()).host;
      }
    } catch (error) {
      // retry until deadline
    }
  }

  throw new Error('拡張機能の service worker を検出できませんでした。');
}

function buildSuumoFixture() {
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>SUUMO E2E fixture</title>
</head>
<body>
  <main>
    <div class="dottable--cassette">
      <h2><a href="/ms/chuko/tokyo/sc_chuo/nc_123456/">晴海テストタワー</a></h2>
      <div class="dottable-value">2億5990万円</div>
      <dl>
        <dt>物件名</dt><dd>晴海テストタワー</dd>
        <dt>所在地</dt><dd>東京都中央区晴海1</dd>
        <dt>専有面積</dt><dd>70.00㎡</dd>
      </dl>
      <p>3LDK 築12年 徒歩9分 管理費 18,000円 修繕積立金 12,600円</p>
    </div>
  </main>
</body>
</html>`;
}

async function testContentScript(context) {
  await context.route('https://suumo.jp/**', route => {
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: buildSuumoFixture()
    });
  });

  const page = await context.newPage();
  await page.goto('https://suumo.jp/ms/chuko/tokyo/sc_chuo/');
  await page.waitForSelector('.fudosan-unit-price', { timeout: 10000 });

  const unitText = await page.locator('.fudosan-unit-price').innerText();
  assert.match(unitText, /坪単価/);
  assert.match(unitText, /平米単価/);
  assert.match(unitText, /月々概算/);

  const exportButtonText = await page.locator('.fudosan-csv-export-button').innerText();
  assert.match(exportButtonText, /CSVエクスポート/);

  const favoriteButtonText = await page.locator('.fudosan-favorite-btn').innerText();
  assert.match(favoriteButtonText, /坪たんに登録/);

  await page.close();
}

async function setPopupStorage(page, extensionVersion) {
  const favorites = [
    {
      url: 'https://suumo.jp/ms/chuko/tokyo/sc_chuo/nc_123456/',
      name: '晴海テストタワー',
      site: 'SUUMO',
      price: 12000,
      currentPrice: 10800,
      previousPrice: 11500,
      area: 70,
      tsubotanka: 510,
      memo: '眺望確認',
      addedAt: '2026-06-01T10:00:00.000Z',
      lastCheckedAt: '2026-06-07T09:00:00.000Z',
      priceUpdatedAt: '2026-06-07T09:00:00.000Z',
      listingStatus: 'active',
      listingCheckedAt: '2026-06-07T09:00:00.000Z',
      priceHistory: [
        { previousPrice: 12000, currentPrice: 11500, diff: -500, checkedAt: '2026-06-03T09:00:00.000Z' },
        { previousPrice: 11500, currentPrice: 10800, diff: -700, checkedAt: '2026-06-07T09:00:00.000Z' }
      ]
    },
    {
      url: 'https://www.rehouse.co.jp/buy/mansion/bkdetail/F1FAGA2C/',
      name: 'リハウステストレジデンス',
      site: 'REHOUSE',
      price: 14180,
      currentPrice: 14180,
      area: 70,
      tsubotanka: 669,
      memo: '',
      addedAt: '2026-06-02T10:00:00.000Z',
      lastCheckedAt: '2026-06-05T09:00:00.000Z',
      listingStatus: 'ended',
      listingCheckedAt: '2026-06-07T08:30:00.000Z',
      listingEndedAt: '2026-06-07T08:30:00.000Z',
      priceHistory: []
    }
  ];

  await page.evaluate(({ favorites, extensionVersion }) => new Promise((resolve) => {
    chrome.storage.local.set({
      favorites,
      loanSettings: {
        annualRatePercent: 0.8,
        years: 35,
        downPaymentMan: 0
      },
      lastSeenReleaseNotesVersion: extensionVersion
    }, resolve);
  }), { favorites, extensionVersion });
}

async function testPopup(context, extensionId) {
  const popupUrl = `chrome-extension://${extensionId}/popup.html`;
  const page = await context.newPage();

  await page.goto(popupUrl);
  await page.waitForSelector('#release-notes-dialog:not([hidden])', { timeout: 10000 });
  const releaseText = await page.locator('#release-notes-body').innerText();
  assert.match(releaseText, /更新に気づきやすく改善/);
  assert.match(releaseText, /坪たんに登録/);
  assert.match(releaseText, /お気に入りの価格ウォッチを強化/);
  assert.match(releaseText, /CSVエクスポートを4サイト正式対応/);

  await page.evaluate(() => new Promise((resolve) => {
    chrome.action.setBadgeText({ text: 'NEW' }, resolve);
  }));

  await page.locator('#release-notes-close').click();
  await page.waitForFunction(() => document.querySelector('#release-notes-dialog')?.hidden, { timeout: 5000 });
  await page.waitForFunction(() => new Promise((resolve) => {
    chrome.action.getBadgeText({}, text => resolve(text === ''));
  }), { timeout: 5000 });

  await setPopupStorage(page, CURRENT_VERSION);
  await page.reload();
  await page.waitForSelector('.favorite-item', { timeout: 10000 });

  assert.equal(await page.locator('.favorite-item').count(), 2);
  assert.equal(await page.locator('.favorite-price-history').count(), 1);

  const statusText = await page.locator('.favorite-listing-status--ended').innerText();
  assert.match(statusText, /掲載終了の可能性/);

  await page.evaluate(() => new Promise((resolve) => {
    chrome.storage.local.set({ favorites: [] }, resolve);
  }));

  await page.locator('#recheck-favorites').click();
  await page.waitForFunction(() => {
    const text = document.querySelector('#recheck-status')?.textContent || '';
    return text.includes('確認対象はありません');
  }, { timeout: 15000 });

  await page.close();
}

async function main() {
  const chromeExecutable = findChromeExecutable();
  const extensionDir = createExtensionDir();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fudosan-extension-e2e-'));

  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: chromeExecutable,
    headless: false,
    ignoreDefaultArgs: ['--disable-extensions'],
    viewport: { width: 1280, height: 900 },
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      '--disable-search-engine-choice-screen',
      '--no-first-run',
      '--no-default-browser-check'
    ]
  });

  try {
    const extensionId = await getExtensionId(context);

    await testContentScript(context);
    await testPopup(context, extensionId);

    console.log('extension E2E tests passed');
  } finally {
    await context.close();
    fs.rmSync(extensionDir, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
