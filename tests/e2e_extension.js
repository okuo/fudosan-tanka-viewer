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
  'property-matcher.js',
  'observed-listings-store.js',
  'sidepanel.html',
  'sidepanel.js',
  'sidepanel.css',
  'icons/icon16.png',
  'icons/icon32.png',
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
      <h2><a href="/ms/chuko/tokyo/sc_chuo/nc_123456/">晴海クロノレジデンス</a></h2>
      <div class="dottable-value">1億2,000万円</div>
      <dl>
        <dt>物件名</dt><dd>晴海クロノレジデンス</dd>
        <dt>所在地</dt><dd>東京都中央区晴海2-3-30</dd>
        <dt>専有面積</dt><dd>72.91㎡</dd>
      </dl>
      <p>48階 3LDK 管理費 22,000円 修繕積立金 15,000円</p>
    </div>
  </main>
</body>
</html>`;
}

function buildRehouseDetailFixture() {
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>REHOUSE E2E fixture</title>
</head>
<body>
  <main class="property-detail">
    <div class="property-detail-information">
      <div class="building-else-price-info">
        <h1>晴海クロノレジデンス</h1>
        <div class="building-content">
          <div class="building-info">3LDK/72.91㎡(約22.05坪)</div>
        </div>
      </div>
      <div class="building-price-info">
        <p class="text-price-regular price-size"><span class="amount">12,100</span><span class="unit">万円</span></p>
      </div>
    </div>
    <section class="property-detail-infos">
      <table>
        <tbody>
          <tr class="table-row"><td class="table-header label">価格</td><td class="table-data content">12,100万円</td></tr>
          <tr class="table-row"><td class="table-header label">所在地</td><td class="table-data content">東京都中央区晴海2-3-30</td></tr>
          <tr class="table-row"><td class="table-header label">間取り</td><td class="table-data content">3LDK</td></tr>
          <tr class="table-row"><td class="table-header label">管理費等</td><td class="table-data content"><span>22,000円</span></td></tr>
          <tr class="table-row"><td class="table-header label">修繕積立金</td><td class="table-data content"><span>15,000円</span></td></tr>
          <tr class="table-row"><td class="table-header label">専有面積</td><td class="table-data content">72.91㎡(約22.05坪)</td></tr>
          <tr class="table-row"><td class="table-header label">階数 / 階建</td><td class="table-data content">48階 / 地上50階 地下2階建</td></tr>
          <tr class="table-row"><td class="table-header label">総戸数</td><td class="table-data content">387戸</td></tr>
        </tbody>
      </table>
    </section>
  </main>
</body>
</html>`;
}

function buildAthomeDetailFixture() {
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>ATHOME E2E fixture</title>
</head>
<body>
  <main>
    <h1>晴海クロノレジデンス</h1>
    <section class="property-outline">
      <table>
        <tbody>
          <tr><td class="label">価格</td><td class="value">1億2,200万円</td></tr>
          <tr><td class="label">所在地</td><td class="value">東京都中央区晴海2-3-30</td></tr>
          <tr><td class="label">間取り</td><td class="value">3LDK</td></tr>
          <tr><td class="label">専有面積</td><td class="value">72.91m²（壁芯）</td></tr>
          <tr><td class="label">管理費</td><td class="value">22,000円/月</td></tr>
          <tr><td class="label">修繕積立金</td><td class="value">15,000円/月</td></tr>
          <tr><td class="label">所在階</td><td class="value">48階</td></tr>
          <tr><td class="label">階建</td><td class="value">50階建</td></tr>
          <tr><td class="label">総戸数</td><td class="value">120戸</td></tr>
        </tbody>
      </table>
    </section>
  </main>
</body>
</html>`;
}

function buildHomesDetailFixture() {
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>HOMES E2E fixture</title>
</head>
<body>
  <main>
    <h1 class="heading">
      <span id="chk-bkh-name">晴海クロノレジデンス</span>
      <span id="chk-bkh-room">48階</span>
    </h1>
    <div class="mod-detailTopSale">
      <div class="line">
        <dl>
          <dt>価格</dt>
          <dd>1億2,300万円</dd>
        </dl>
      </div>
      <div class="line">
        <dl>
          <dt>専有面積</dt>
          <dd id="chk-bkc-housearea">72.91m² (壁心)</dd>
        </dl>
      </div>
      <div class="line">
        <dl>
          <dt>管理費</dt>
          <dd>22,000円/月</dd>
        </dl>
      </div>
      <div class="line">
        <dl>
          <dt>修繕積立金</dt>
          <dd>15,000円/月</dd>
        </dl>
      </div>
    </div>
    <div class="mod-bukkenSpecDetail">
      <table>
        <tbody>
          <tr>
            <th>所在地</th><td>東京都中央区晴海2-3-30</td>
            <th>間取り</th><td>3LDK</td>
          </tr>
          <tr>
            <th>総戸数</th><td id="chk-bkd-allunit">883戸</td>
            <th>所在階 / 階数</th><td id="chk-bkd-housekai">48階 / 50階建 (地下1階)</td>
          </tr>
        </tbody>
      </table>
    </div>
  </main>
</body>
</html>`;
}

function buildHomesListFixture() {
  return `<!doctype html>
<html lang="ja">
<body>
  <section class="bukkenSpec">
    <table>
      <tbody>
        <tr><th class="bukkenName"><a href="/mansion/b-222/">晴海クロノレジデンス</a></th></tr>
        <tr><td class="bukkenAdress">東京都中央区晴海2-3-30</td></tr>
        <tr><td class="price">1億2,300万円</td><td class="space">72.91m²</td></tr>
        <tr><td>48階 3LDK 管理費 23,000円 修繕積立金 16,000円</td></tr>
      </tbody>
    </table>
  </section>
</body>
</html>`;
}

function buildSuumoDetailObservedFixture() {
  return `<!doctype html><html lang="ja"><body>
    <h1>晴海クロノレジデンス</h1>
    <div class="mt7 b">1億2,000万円</div>
    <table><tbody>
      <tr><th>価格</th><td>1億2,000万円</td></tr>
      <tr><th>専有面積</th><td>72.91㎡（壁芯）</td></tr>
      <tr><th>所在地</th><td>東京都中央区晴海2-3-30</td></tr>
      <tr><th>間取り</th><td>3LDK</td></tr>
      <tr><th>所在階</th><td>48階 / 50階建</td></tr>
      <tr><th>管理費</th><td>22,000円</td></tr>
      <tr><th>修繕積立金</th><td>15,000円</td></tr>
    </tbody></table>
  </body></html>`;
}

function buildRehouseListObservedFixture() {
  return `<!doctype html><html lang="ja"><body>
    <article class="property-index-card">
      <h2 class="property-card-title"><a href="/buy/mansion/bkdetail/RH-LIST-777/">晴海クロノレジデンス</a></h2>
      <p class="property-card-address">東京都中央区晴海2-3-30</p>
      <strong class="price-text">1億2,100万円</strong>
      <p class="paragraph-body">専有面積 72.91㎡</p>
      <p>48階 3LDK 管理費 22,000円 修繕積立金 15,000円</p>
    </article>
  </body></html>`;
}

function buildAthomeListObservedFixture() {
  return `<!doctype html><html lang="ja"><body>
    <article class="card-box-inner">
      <h3 class="title-wrap__title-text"><a class="select-link" href="/mansion/7777777777/">晴海クロノレジデンス</a></h3>
      <p class="property-address">東京都中央区晴海2-3-30</p>
      <div class="card-box-inner__detail">
        <strong class="property-price">1億2,200万円</strong>
        <div class="property-detail-table__block">専有面積 <span>72.91m²</span></div>
        <p>48階 3LDK 管理費 22,000円 修繕積立金 15,000円</p>
      </div>
    </article>
  </body></html>`;
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

async function assertObservedRecord(storageProbe, expected) {
  const recordIdentity = {
    site: expected.site,
    pageType: expected.pageType,
    sourceListingId: expected.sourceListingId
  };
  const deadline = Date.now() + 10000;
  let record = null;
  while (!record && Date.now() < deadline) {
    const candidate = await readObservedRecord(storageProbe, recordIdentity);
    if (candidate && Date.parse(candidate.lastSeenAt) >= (expected.observedAfter || 0)) {
      record = candidate;
    }
    if (!record) await storageProbe.waitForTimeout(50);
  }
  assert.ok(record, `observed record not found: ${recordIdentity.site}:${recordIdentity.sourceListingId}`);
  const actual = {
    rawName: record.rawName,
    rawAddress: record.rawAddress,
    normalizedBuildingName: record.normalizedBuildingName,
    addressBlockKey: record.addressBlockKey,
    areaSqm: record.areaSqm,
    floor: record.floor,
    layout: record.layout
  };
  assert.deepEqual(actual, expected.record, `${expected.site} ${expected.pageType} extraction mismatch`);
  return record;
}

async function readObservedRecord(storageProbe, { site, pageType, sourceListingId }) {
  return storageProbe.evaluate(({ targetSite, targetPageType, targetSourceListingId }) => new Promise((resolve) => {
    chrome.storage.local.get({ observedListingsV1: { version: 1, items: [] } }, (result) => {
      resolve(result.observedListingsV1.items.find(item => (
        item.site === targetSite &&
        (!targetPageType || item.pageType === targetPageType) &&
        item.sourceListingId === targetSourceListingId
      )) || null);
    });
  }), { targetSite: site, targetPageType: pageType, targetSourceListingId: sourceListingId });
}

async function removeObservedRecord(storageProbe, { site, sourceListingId }) {
  await storageProbe.evaluate(({ site: targetSite, sourceListingId: targetSourceListingId }) => new Promise((resolve) => {
    const listingKey = `${targetSite}:${targetSourceListingId}`;
    chrome.storage.local.get({ observedListingsV1: { version: 1, items: [] } }, (result) => {
      chrome.storage.local.set({
        observedListingsV1: {
          ...result.observedListingsV1,
          items: result.observedListingsV1.items.filter(item => item.listingKey !== listingKey)
        }
      }, resolve);
    });
  }), { site, sourceListingId });
}

async function testCrossSiteContentBadge(context, extensionId) {
  await context.route('https://www.homes.co.jp/mansion/chuko/list/**', route => route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: buildHomesListFixture()
  }));
  const storageProbe = await context.newPage();
  await storageProbe.goto(`chrome-extension://${extensionId}/popup.html`);
  const suumoPage = await context.newPage();
  await suumoPage.goto('https://suumo.jp/ms/chuko/tokyo/sc_chuo/');
  await storageProbe.waitForFunction(() => new Promise((resolve) => {
    chrome.storage.local.get({ observedListingsV1: { items: [] } }, result => (
      resolve(result.observedListingsV1.items.some(item => item.site === 'SUUMO'))
    ));
  }));

  const homesPage = await context.newPage();
  await homesPage.goto('https://www.homes.co.jp/mansion/chuko/list/');
  await homesPage.waitForSelector('.fudosan-cross-site-badge', { timeout: 10000 });
  assert.match(await homesPage.locator('.fudosan-cross-site-badge').innerText(), /横断一致 2サイト/);
  assert.match(await homesPage.locator('.fudosan-cross-site-caption').innerText(), /閲覧履歴内/);
  await suumoPage.reload();
  await suumoPage.waitForSelector('.fudosan-cross-site-badge', { timeout: 10000 });
  await suumoPage.evaluate(() => {
    window.__crossSiteOriginalAnchor = document.querySelector('.fudosan-unit-price');
    window.__crossSiteDetachedMutations = 0;
    const observer = new MutationObserver((mutations) => {
      window.__crossSiteDetachedMutations += mutations.length;
    });
    observer.observe(window.__crossSiteOriginalAnchor, { childList: true, subtree: true });
    const externalNode = document.createElement('section');
    externalNode.className = 'external-list-update';
    document.body.appendChild(externalNode);
  });
  await suumoPage.waitForFunction(() => (
    document.querySelector('.fudosan-unit-price') !== window.__crossSiteOriginalAnchor &&
    Boolean(document.querySelector('.fudosan-cross-site-badge'))
  ));
  assert.equal(await suumoPage.evaluate(() => window.__crossSiteDetachedMutations), 0);
  await storageProbe.evaluate(() => new Promise(resolve => chrome.storage.local.set({
    crossSiteMatchingSettingsV1: { enabled: false, retentionDays: 90 }
  }, resolve)));
  await homesPage.waitForFunction(() => !document.querySelector('.fudosan-cross-site-badge'));
  assert.equal(await homesPage.locator('.fudosan-cross-site-badge').count(), 0);
  await storageProbe.evaluate(() => new Promise(resolve => chrome.storage.local.set({
    crossSiteMatchingSettingsV1: { enabled: true, retentionDays: 90 }
  }, resolve)));
  await storageProbe.close();
  await homesPage.close();
  await suumoPage.close();
  await context.unroute('https://www.homes.co.jp/mansion/chuko/list/**');
}

async function testDetailObservationIsStable(context, extensionId) {
  const fixtureCase = {
    site: 'SUUMO',
    pageType: 'detail',
    sourceListingId: '999999',
    url: 'https://suumo.jp/ms/chuko/tokyo/sc_chuo/nc_999999/',
    record: {
      rawName: '晴海クロノレジデンス',
      rawAddress: '東京都中央区晴海2-3-30',
      normalizedBuildingName: '晴海クロノレジデンス',
      addressBlockKey: '東京都中央区晴海2-3-30',
      areaSqm: 72.91,
      floor: 48,
      layout: '3LDK'
    }
  };
  const storageProbe = await context.newPage();
  await storageProbe.goto(`chrome-extension://${extensionId}/popup.html`);
  await removeObservedRecord(storageProbe, fixtureCase);
  fixtureCase.observedAfter = Date.now();
  await context.route(fixtureCase.url, route => route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: buildSuumoDetailObservedFixture()
  }));
  const page = await context.newPage();
  await page.goto(fixtureCase.url);
  await page.waitForSelector('.fudosan-unit-price', { timeout: 10000 });
  const firstRecord = await assertObservedRecord(storageProbe, fixtureCase);

  await page.evaluate(() => {
    window.__detailOriginalAnchor = document.querySelector('.fudosan-unit-price:not(.fudosan-unit-price--compact)');
    const externalNode = document.createElement('section');
    externalNode.className = 'external-detail-update';
    document.body.appendChild(externalNode);
  });
  await page.waitForTimeout(650);

  await page.waitForFunction(() => (
    document.querySelector('.fudosan-unit-price:not(.fudosan-unit-price--compact)') !== window.__detailOriginalAnchor
  ));
  assert.equal(
    await page.locator('.fudosan-unit-price:not(.fudosan-unit-price--compact)').first().getAttribute('data-cross-site-listing-key'),
    'SUUMO:999999'
  );
  const secondRecord = await readObservedRecord(storageProbe, fixtureCase);
  assert.equal(secondRecord.lastSeenAt, firstRecord.lastSeenAt);

  await storageProbe.evaluate(() => new Promise(resolve => chrome.storage.local.set({
    crossSiteMatchingSettingsV1: { enabled: false, retentionDays: 90 }
  }, resolve)));
  await page.waitForTimeout(100);
  await storageProbe.evaluate(() => new Promise(resolve => chrome.storage.local.set({
    crossSiteMatchingSettingsV1: { enabled: true, retentionDays: 90 }
  }, resolve)));
  const reflushDeadline = Date.now() + 10000;
  let reenabledRecord = secondRecord;
  while (reenabledRecord.lastSeenAt === firstRecord.lastSeenAt && Date.now() < reflushDeadline) {
    await storageProbe.waitForTimeout(50);
    reenabledRecord = await readObservedRecord(storageProbe, fixtureCase);
  }
  assert.notEqual(reenabledRecord.lastSeenAt, firstRecord.lastSeenAt);

  await page.close();
  await storageProbe.close();
  await context.unroute(fixtureCase.url);
}

async function testObservedExtractionMatrix(context, extensionId) {
  const storageProbe = await context.newPage();
  await storageProbe.goto(`chrome-extension://${extensionId}/popup.html`);
  const cases = [
    { site: 'SUUMO', pageType: 'list', sourceListingId: '123456', url: 'https://suumo.jp/ms/chuko/tokyo/sc_chuo/', fixture: buildSuumoFixture, record: { rawName: '晴海クロノレジデンス', rawAddress: '東京都中央区晴海2-3-30', normalizedBuildingName: '晴海クロノレジデンス', addressBlockKey: '東京都中央区晴海2-3-30', areaSqm: 72.91, floor: 48, layout: '3LDK' } },
    { site: 'SUUMO', pageType: 'detail', sourceListingId: '888888', url: 'https://suumo.jp/ms/chuko/tokyo/sc_chuo/nc_888888/', fixture: buildSuumoDetailObservedFixture, record: { rawName: '晴海クロノレジデンス', rawAddress: '東京都中央区晴海2-3-30', normalizedBuildingName: '晴海クロノレジデンス', addressBlockKey: '東京都中央区晴海2-3-30', areaSqm: 72.91, floor: 48, layout: '3LDK' } },
    { site: 'REHOUSE', pageType: 'list', sourceListingId: 'RH-LIST-777', url: 'https://www.rehouse.co.jp/buy/mansion/prefecture/13/city/13102/', fixture: buildRehouseListObservedFixture, record: { rawName: '晴海クロノレジデンス', rawAddress: '東京都中央区晴海2-3-30', normalizedBuildingName: '晴海クロノレジデンス', addressBlockKey: '東京都中央区晴海2-3-30', areaSqm: 72.91, floor: 48, layout: '3LDK' } },
    { site: 'REHOUSE', pageType: 'detail', sourceListingId: 'F1FAGA2C', url: 'https://www.rehouse.co.jp/buy/mansion/bkdetail/F1FAGA2C/', fixture: buildRehouseDetailFixture, record: { rawName: '晴海クロノレジデンス', rawAddress: '東京都中央区晴海2-3-30', normalizedBuildingName: '晴海クロノレジデンス', addressBlockKey: '東京都中央区晴海2-3-30', areaSqm: 72.91, floor: 48, layout: '3LDK' } },
    { site: 'ATHOME', pageType: 'list', sourceListingId: '7777777777', url: 'https://www.athome.co.jp/mansion/chuko/tokyo/chuo-city/list/', fixture: buildAthomeListObservedFixture, record: { rawName: '晴海クロノレジデンス', rawAddress: '東京都中央区晴海2-3-30', normalizedBuildingName: '晴海クロノレジデンス', addressBlockKey: '東京都中央区晴海2-3-30', areaSqm: 72.91, floor: 48, layout: '3LDK' } },
    { site: 'ATHOME', pageType: 'detail', sourceListingId: '1234567890', url: 'https://www.athome.co.jp/mansion/1234567890/', fixture: buildAthomeDetailFixture, record: { rawName: '晴海クロノレジデンス', rawAddress: '東京都中央区晴海2-3-30', normalizedBuildingName: '晴海クロノレジデンス', addressBlockKey: '東京都中央区晴海2-3-30', areaSqm: 72.91, floor: 48, layout: '3LDK' } },
    { site: 'HOMES', pageType: 'list', sourceListingId: '222', url: 'https://www.homes.co.jp/mansion/chuko/list/', fixture: buildHomesListFixture, record: { rawName: '晴海クロノレジデンス', rawAddress: '東京都中央区晴海2-3-30', normalizedBuildingName: '晴海クロノレジデンス', addressBlockKey: '東京都中央区晴海2-3-30', areaSqm: 72.91, floor: 48, layout: '3LDK' } },
    { site: 'HOMES', pageType: 'detail', sourceListingId: '1193620002052', url: 'https://www.homes.co.jp/mansion/b-1193620002052/', fixture: buildHomesDetailFixture, record: { rawName: '晴海クロノレジデンス', rawAddress: '東京都中央区晴海2-3-30', normalizedBuildingName: '晴海クロノレジデンス', addressBlockKey: '東京都中央区晴海2-3-30', areaSqm: 72.91, floor: 48, layout: '3LDK' } }
  ];

  for (const fixtureCase of cases) {
    await removeObservedRecord(storageProbe, fixtureCase);
    const observedAfter = Date.now();
    await context.route(fixtureCase.url, route => route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: fixtureCase.fixture()
    }));
    const page = await context.newPage();
    await page.goto(fixtureCase.url);
    await page.waitForSelector('.fudosan-unit-price', { timeout: 10000 });
    await assertObservedRecord(storageProbe, { ...fixtureCase, observedAfter });
    await page.close();
    await context.unroute(fixtureCase.url);
  }
  await storageProbe.close();
}

async function testRehouseDetailPage(context) {
  await context.route('https://www.rehouse.co.jp/**', route => {
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: buildRehouseDetailFixture()
    });
  });

  const page = await context.newPage();
  await page.goto('https://www.rehouse.co.jp/buy/mansion/bkdetail/F1FAGA2C/');
  await page.waitForSelector('.fudosan-repair-fund', { timeout: 10000 });
  await page.waitForSelector('.fudosan-monthly-cost', { timeout: 10000 });

  const repairText = await page.locator('.fudosan-repair-fund').innerText();
  assert.match(repairText, /修繕積立金単価/);
  assert.match(repairText, /206円\/㎡\/月/);
  assert.match(repairText, /338円\/㎡/);

  const monthlyText = await page.locator('.fudosan-monthly-cost').innerText();
  assert.match(monthlyText, /管理費 22,000円/);
  assert.match(monthlyText, /修繕 15,000円/);

  await page.close();
}

async function testAthomeDetailPage(context) {
  await context.route('https://www.athome.co.jp/**', route => {
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: buildAthomeDetailFixture()
    });
  });

  const page = await context.newPage();
  await page.goto('https://www.athome.co.jp/mansion/1234567890/');
  await page.waitForSelector('.fudosan-repair-fund', { timeout: 10000 });
  await page.waitForSelector('.fudosan-monthly-cost', { timeout: 10000 });

  const unitText = await page.locator('.fudosan-unit-price:not(.fudosan-repair-fund)').first().innerText();
  assert.match(unitText, /坪単価/);

  const repairText = await page.locator('.fudosan-repair-fund').innerText();
  assert.match(repairText, /修繕積立金単価/);
  assert.match(repairText, /206円\/㎡\/月/);

  const monthlyText = await page.locator('.fudosan-monthly-cost').innerText();
  assert.match(monthlyText, /管理費 22,000円/);
  assert.match(monthlyText, /修繕 15,000円/);

  await page.close();
}

async function testHomesDetailPage(context) {
  await context.route('https://www.homes.co.jp/**', route => {
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: buildHomesDetailFixture()
    });
  });

  const page = await context.newPage();
  await page.goto('https://www.homes.co.jp/mansion/b-1193620002052/');
  await page.waitForSelector('.fudosan-repair-fund', { timeout: 10000 });
  await page.waitForSelector('.fudosan-monthly-cost', { timeout: 10000 });

  const unitText = await page.locator('.fudosan-unit-price:not(.fudosan-repair-fund)').first().innerText();
  assert.match(unitText, /坪単価/);

  const repairText = await page.locator('.fudosan-repair-fund').innerText();
  assert.match(repairText, /修繕積立金単価/);
  assert.match(repairText, /206円\/㎡\/月/);

  const monthlyText = await page.locator('.fudosan-monthly-cost').innerText();
  assert.match(monthlyText, /管理費 22,000円/);
  assert.match(monthlyText, /修繕 15,000円/);

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
  assert.match(releaseText, /詳細ページの費用取得を改善/);
  assert.match(releaseText, /三井のリハウスで管理費・修繕積立金/);
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
    await testRehouseDetailPage(context);
    await testAthomeDetailPage(context);
    await testHomesDetailPage(context);
    await testCrossSiteContentBadge(context, extensionId);
    await testObservedExtractionMatrix(context, extensionId);
    await testDetailObservationIsStable(context, extensionId);
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
