const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const ROOT_DIR = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT_DIR, 'store-assets', 'screenshots');
const CURRENT_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'manifest.json'), 'utf8')).version;

function findChromeExecutable() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    process.env.CHROME_FOR_TESTING_PATH,
    process.env.CHROME_PATH,
    chromium.executablePath(),
    '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ].filter(Boolean);

  const found = candidates.find(candidate => fs.existsSync(candidate));
  if (!found) {
    throw new Error('Chromium / Chrome for Testing が見つかりません。CHROME_PATH を指定してください。');
  }
  return found;
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
    } catch (_error) {
      // Retry until deadline.
    }
  }

  throw new Error('拡張機能の service worker を検出できませんでした。');
}

function storeFavorites() {
  return [
    {
      url: 'https://suumo.jp/ms/chuko/tokyo/sc_chuo/nc_123456/',
      name: '晴海テストタワー 21階',
      site: 'SUUMO',
      price: 12000,
      currentPrice: 10800,
      previousPrice: 11500,
      area: 70,
      tsubotanka: 510,
      managementFee: 18000,
      repairFund: 12600,
      monthlyCost: 323944,
      station: '徒歩9分',
      age: '築12年',
      memo: '南向き。眺望と騒音を内見で確認。',
      addedAt: '2026-06-01T10:00:00.000Z',
      lastCheckedAt: '2026-06-12T09:00:00.000Z',
      priceUpdatedAt: '2026-06-12T09:00:00.000Z',
      listingStatus: 'active',
      listingCheckedAt: '2026-06-12T09:00:00.000Z',
      repairFundRisk: { level: 'medium', label: 'やや低め' },
      viewingChecklist: { sunlight: true, noise: true, storage: false },
      viewingNote: '日当たり、共用部、駐車場空き状況を確認',
      priceHistory: [
        { previousPrice: 12000, currentPrice: 11500, diff: -500, checkedAt: '2026-06-06T09:00:00.000Z' },
        { previousPrice: 11500, currentPrice: 10800, diff: -700, checkedAt: '2026-06-12T09:00:00.000Z' }
      ]
    },
    {
      url: 'https://www.rehouse.co.jp/buy/mansion/bkdetail/F1FAGA2C/',
      name: 'リハウステストレジデンス 12階',
      site: 'REHOUSE',
      price: 14180,
      currentPrice: 14180,
      previousPrice: 14180,
      area: 86.4,
      tsubotanka: 542,
      managementFee: 28900,
      repairFund: 21600,
      monthlyCost: 437832,
      station: '徒歩6分',
      age: '築8年',
      memo: '駅距離は良い。管理費が高めなので総額比較。',
      addedAt: '2026-06-02T10:00:00.000Z',
      lastCheckedAt: '2026-06-11T09:00:00.000Z',
      listingStatus: 'active',
      listingCheckedAt: '2026-06-11T09:00:00.000Z',
      repairFundRisk: { level: 'low', label: '適正水準' },
      viewingChecklist: { sunlight: true, noise: false, storage: true },
      priceHistory: []
    },
    {
      url: 'https://www.homes.co.jp/mansion/b-1193620002052/',
      name: 'HOMESベイサイドタワー',
      site: 'HOMES',
      price: 9280,
      currentPrice: 9580,
      previousPrice: 9280,
      area: 75.8,
      tsubotanka: 417,
      managementFee: 19800,
      repairFund: 15160,
      monthlyCost: 294120,
      station: '徒歩11分',
      age: '築15年',
      memo: '値上がり後。周辺相場と比較して保留。',
      addedAt: '2026-06-03T10:00:00.000Z',
      lastCheckedAt: '2026-06-10T09:00:00.000Z',
      priceUpdatedAt: '2026-06-10T09:00:00.000Z',
      listingStatus: 'active',
      listingCheckedAt: '2026-06-10T09:00:00.000Z',
      repairFundRisk: { level: 'high', label: '目安以下' },
      viewingChecklist: { sunlight: false, noise: false, storage: false },
      priceHistory: [
        { previousPrice: 9280, currentPrice: 9580, diff: 300, checkedAt: '2026-06-10T09:00:00.000Z' }
      ]
    },
    {
      url: 'https://www.athome.co.jp/mansion/1012995991/',
      name: 'アットホーム日本橋レジデンス',
      site: 'ATHOME',
      price: 7620,
      currentPrice: 7620,
      area: 45,
      tsubotanka: 560,
      managementFee: 12000,
      repairFund: 9000,
      monthlyCost: 228760,
      station: '徒歩4分',
      age: '築18年',
      memo: '単価は高いが駅近。広さが足りるか確認。',
      addedAt: '2026-06-04T10:00:00.000Z',
      lastCheckedAt: '2026-06-09T09:00:00.000Z',
      listingStatus: 'ended',
      listingCheckedAt: '2026-06-09T09:00:00.000Z',
      listingEndedAt: '2026-06-09T09:00:00.000Z',
      repairFundRisk: { level: 'medium', label: 'やや低め' },
      viewingChecklist: { sunlight: true, noise: true, storage: true },
      priceHistory: []
    }
  ];
}

async function seedExtensionStorage(context, extensionId) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.evaluate(({ favorites, version }) => new Promise(resolve => {
    chrome.storage.local.set({
      favorites,
      loanSettings: {
        annualRatePercent: 0.8,
        years: 35,
        downPaymentMan: 0
      },
      highlightSettings: {
        enabled: false,
        maxTsuboPrice: '',
        repairFundMode: 'none',
        monthlyCostLimit: ''
      },
      lastSeenReleaseNotesVersion: version
    }, resolve);
  }), { favorites: storeFavorites(), version: CURRENT_VERSION });
  await page.close();
}

function commonSiteCss() {
  return `
    :root {
      color-scheme: light;
      --ink: #172033;
      --muted: #64748b;
      --line: #dbe4ee;
      --soft: #f7f9fc;
      --blue: #0f3f8f;
      --orange: #e85d04;
      --green: #15803d;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #f4f7fb;
      color: var(--ink);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 14px;
    }
    a { color: inherit; text-decoration: none; }
    .mock-header {
      position: sticky;
      top: 0;
      z-index: 20;
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 72px;
      padding: 0 36px;
      background: rgba(255, 255, 255, 0.96);
      border-bottom: 1px solid var(--line);
      box-shadow: 0 8px 24px rgba(15, 23, 42, 0.05);
    }
    .mock-brand {
      display: flex;
      align-items: center;
      gap: 12px;
      font-weight: 900;
      font-size: 22px;
      color: var(--blue);
    }
    .mock-brand-mark {
      display: grid;
      place-items: center;
      width: 34px;
      height: 34px;
      border-radius: 8px;
      background: var(--blue);
      color: #fff;
      font-size: 16px;
    }
    .mock-nav {
      display: flex;
      gap: 16px;
      color: var(--muted);
      font-size: 13px;
      font-weight: 700;
    }
    .shot-title {
      position: fixed;
      left: 34px;
      top: 92px;
      z-index: 40;
      display: grid;
      gap: 4px;
      max-width: 520px;
      padding: 16px 18px;
      border: 1px solid rgba(15, 63, 143, 0.16);
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.96);
      box-shadow: 0 16px 42px rgba(15, 23, 42, 0.14);
    }
    .shot-title strong {
      font-size: 24px;
      line-height: 1.2;
      letter-spacing: 0;
      color: #0f172a;
    }
    .shot-title span {
      color: #475569;
      font-size: 13px;
      line-height: 1.45;
      font-weight: 700;
    }
    .mock-main {
      max-width: 1100px;
      margin: 34px auto 56px;
      padding: 0 28px;
    }
    .mock-search {
      display: grid;
      grid-template-columns: 1fr auto auto;
      align-items: center;
      gap: 12px;
      margin-bottom: 18px;
      padding: 16px;
      background: #fff;
      border: 1px solid var(--line);
      border-radius: 8px;
    }
    .mock-search input {
      min-width: 0;
      height: 38px;
      padding: 0 12px;
      border: 1px solid var(--line);
      border-radius: 6px;
      font: inherit;
    }
    .mock-search button,
    .mock-pill {
      height: 38px;
      padding: 0 14px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #fff;
      color: var(--blue);
      font-weight: 800;
    }
    .mock-count {
      margin: 0 0 12px;
      color: var(--muted);
      font-size: 13px;
      font-weight: 700;
    }
  `;
}

function buildSuumoListFixture() {
  const cards = [
    {
      title: '晴海テストタワー 21階',
      href: '/ms/chuko/tokyo/sc_chuo/nc_123456/',
      price: '1億800万円',
      address: '東京都中央区晴海1',
      area: '70.00㎡',
      layout: '3LDK',
      age: '築12年',
      station: '都営大江戸線「勝どき」徒歩9分',
      fee: '管理費 18,000円 修繕積立金 12,600円',
      tag: '値下がり確認'
    },
    {
      title: '月島リバーサイドレジデンス',
      href: '/ms/chuko/tokyo/sc_chuo/nc_222222/',
      price: '8,980万円',
      address: '東京都中央区月島3',
      area: '62.40㎡',
      layout: '2LDK',
      age: '築9年',
      station: '東京メトロ有楽町線「月島」徒歩5分',
      fee: '管理費 15,800円 修繕積立金 11,200円',
      tag: '駅近'
    },
    {
      title: '日本橋グランコート',
      href: '/ms/chuko/tokyo/sc_chuo/nc_333333/',
      price: '7,680万円',
      address: '東京都中央区日本橋浜町2',
      area: '45.10㎡',
      layout: '1LDK',
      age: '築18年',
      station: '都営新宿線「浜町」徒歩4分',
      fee: '管理費 12,000円 修繕積立金 9,000円',
      tag: '単価高め'
    }
  ];

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>SUUMO screenshot fixture</title>
  <style>
    ${commonSiteCss()}
    .result-list { display: grid; gap: 14px; }
    .dottable--cassette {
      display: grid;
      grid-template-columns: 168px minmax(0, 1fr) 286px;
      gap: 20px;
      min-height: 176px;
      padding: 18px;
      background: #fff;
      border: 1px solid #dbe4ee;
      border-radius: 8px;
      box-shadow: 0 10px 26px rgba(15, 23, 42, 0.06);
    }
    .property-photo {
      border-radius: 6px;
      background:
        linear-gradient(135deg, rgba(15, 63, 143, 0.12), rgba(232, 93, 4, 0.08)),
        linear-gradient(160deg, #dbeafe 0%, #f8fafc 46%, #cbd5e1 100%);
      border: 1px solid #dbe4ee;
      position: relative;
      overflow: hidden;
    }
    .property-photo::before,
    .property-photo::after {
      content: "";
      position: absolute;
      background: rgba(255, 255, 255, 0.66);
      border: 1px solid rgba(15, 63, 143, 0.08);
    }
    .property-photo::before {
      left: 28px;
      bottom: 0;
      width: 74px;
      height: 126px;
      box-shadow: 16px 0 0 rgba(255, 255, 255, 0.48), 32px 0 0 rgba(255, 255, 255, 0.36);
    }
    .property-photo::after {
      right: 18px;
      bottom: 0;
      width: 44px;
      height: 92px;
    }
    .property-main { min-width: 0; }
    .property-main h2 {
      margin: 0 0 9px;
      font-size: 20px;
      line-height: 1.25;
      color: #0f172a;
    }
    .property-main p {
      margin: 5px 0;
      color: #475569;
      line-height: 1.5;
      font-weight: 600;
    }
    .property-main dl {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 3px 10px;
      margin: 10px 0 0;
      color: #334155;
    }
    .property-main dt {
      color: #64748b;
      font-size: 12px;
      font-weight: 800;
    }
    .property-main dd {
      margin: 0;
      font-weight: 700;
    }
    .property-price {
      align-self: start;
      padding: 14px;
      border: 1px solid #fde2c7;
      border-radius: 8px;
      background: #fffaf5;
    }
    .dottable-value {
      color: #dc2626;
      font-size: 27px;
      line-height: 1.1;
      font-weight: 900;
    }
    .property-tag {
      display: inline-flex;
      margin-bottom: 8px;
      padding: 3px 8px;
      border-radius: 999px;
      background: #e0f2fe;
      color: #0369a1;
      font-size: 11px;
      font-weight: 900;
    }
  </style>
</head>
<body>
  <header class="mock-header">
    <div class="mock-brand"><span class="mock-brand-mark">住</span> 中古マンション検索</div>
    <nav class="mock-nav"><span>沿線から探す</span><span>地図から探す</span><span>お気に入り</span></nav>
  </header>
  <main class="mock-main">
    <section class="mock-search">
      <input value="東京都中央区 中古マンション" aria-label="検索条件">
      <span class="mock-pill">価格: 7,000万円以上</span>
      <button type="button">条件変更</button>
    </section>
    <p class="mock-count">検索結果 128件 / 価格更新順</p>
    <section class="result-list">
      ${cards.map(card => `
      <article class="dottable--cassette">
        <a class="property-photo" href="${card.href}" aria-label="${card.title}"></a>
        <div class="property-main">
          <h2><a href="${card.href}">${card.title}</a></h2>
          <span class="property-tag">${card.tag}</span>
          <p>${card.station}</p>
          <p>${card.layout} / ${card.age} / ${card.fee}</p>
          <dl>
            <dt>物件名</dt><dd>${card.title}</dd>
            <dt>所在地</dt><dd>${card.address}</dd>
            <dt>専有面積</dt><dd>${card.area}</dd>
          </dl>
        </div>
        <div class="property-price">
          <div class="dottable-value">${card.price}</div>
        </div>
      </article>`).join('')}
    </section>
  </main>
</body>
</html>`;
}

function buildRehouseDetailFixture() {
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>REHOUSE screenshot fixture</title>
  <style>
    ${commonSiteCss()}
    .detail-wrap {
      max-width: 1100px;
      margin: 34px auto 56px;
      padding: 0 28px;
      display: grid;
      grid-template-columns: minmax(0, 1fr) 360px;
      gap: 24px;
      align-items: start;
    }
    .hero-photo {
      min-height: 312px;
      border-radius: 10px;
      border: 1px solid #dbe4ee;
      background:
        linear-gradient(145deg, rgba(15, 63, 143, 0.14), rgba(21, 128, 61, 0.08)),
        linear-gradient(160deg, #dbeafe 0%, #f8fafc 48%, #cbd5e1 100%);
      position: relative;
      overflow: hidden;
    }
    .hero-photo::before {
      content: "";
      position: absolute;
      left: 210px;
      bottom: 0;
      width: 150px;
      height: 252px;
      background: rgba(255, 255, 255, 0.68);
      border: 1px solid rgba(15, 63, 143, 0.1);
      box-shadow: 34px 0 0 rgba(255,255,255,0.5), 68px 0 0 rgba(255,255,255,0.38);
    }
    .hero-photo::after {
      content: "";
      position: absolute;
      right: 82px;
      bottom: 0;
      width: 80px;
      height: 190px;
      background: rgba(255, 255, 255, 0.54);
      border: 1px solid rgba(15, 63, 143, 0.08);
    }
    .detail-card,
    .property-detail-infos {
      background: #fff;
      border: 1px solid #dbe4ee;
      border-radius: 10px;
      box-shadow: 0 12px 32px rgba(15, 23, 42, 0.08);
    }
    .detail-card {
      padding: 22px;
    }
    .detail-card h1 {
      margin: 0 0 10px;
      font-size: 24px;
      line-height: 1.25;
    }
    .building-info {
      margin: 0 0 14px;
      color: #475569;
      font-weight: 800;
    }
    .text-price-regular {
      margin: 0;
      color: #dc2626;
      font-size: 34px;
      line-height: 1;
      font-weight: 950;
    }
    .text-price-regular .unit {
      font-size: 18px;
      margin-left: 2px;
    }
    .property-detail-information {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .property-detail-infos {
      grid-column: 1 / -1;
      overflow: hidden;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    td {
      padding: 14px 18px;
      border-top: 1px solid #e2e8f0;
      vertical-align: top;
    }
    tr:first-child td {
      border-top: none;
    }
    .table-header {
      width: 210px;
      background: #f8fafc;
      color: #475569;
      font-weight: 900;
    }
    .table-data {
      color: #172033;
      font-weight: 700;
    }
  </style>
</head>
<body>
  <header class="mock-header">
    <div class="mock-brand"><span class="mock-brand-mark">住</span> 物件詳細</div>
    <nav class="mock-nav"><span>概要</span><span>費用</span><span>周辺環境</span></nav>
  </header>
  <main class="detail-wrap">
    <section class="hero-photo" aria-label="外観写真"></section>
    <aside class="detail-card">
      <div class="property-detail-information">
        <div class="property-detail-title">
          <h1>リハウステストレジデンス 12階</h1>
          <div class="building-info">3LDK / 100.00㎡ (約30.25坪)</div>
        </div>
        <div class="building-price-info">
          <p class="text-price-regular price-size"><span class="amount">10,000</span><span class="unit">万円</span></p>
        </div>
      </div>
    </aside>
    <section class="property-detail-infos">
      <table>
        <tbody>
          <tr class="table-row"><td class="table-header label">価格</td><td class="table-data content">10,000万円</td></tr>
          <tr class="table-row"><td class="table-header label">管理費等</td><td class="table-data content"><span>33,900円 / 月</span></td></tr>
          <tr class="table-row"><td class="table-header label">修繕積立金</td><td class="table-data content"><span>30,500円 / 月</span></td></tr>
          <tr class="table-row"><td class="table-header label">専有面積</td><td class="table-data content">100.00㎡ (約30.25坪)</td></tr>
          <tr class="table-row"><td class="table-header label">階数 / 階建</td><td class="table-data content">20階 / 地上32階 地下2階建</td></tr>
          <tr class="table-row"><td class="table-header label">総戸数</td><td class="table-data content">387戸</td></tr>
        </tbody>
      </table>
    </section>
  </main>
</body>
</html>`;
}

async function addShotTitle(page, title, subtitle) {
  await page.evaluate(({ title, subtitle }) => {
    document.querySelector('.shot-title')?.remove();
    const el = document.createElement('div');
    el.className = 'shot-title';
    el.innerHTML = `<strong>${title}</strong><span>${subtitle}</span>`;
    document.body.appendChild(el);
  }, { title, subtitle });
}

async function hideScreenshotDistractions(page) {
  await page.addStyleTag({
    content: `
      #fudosan-highlight-panel,
      .fudosan-ai-memo {
        display: none !important;
      }
    `
  });
}

async function addCsvPreview(page) {
  await page.evaluate(() => {
    document.querySelector('.csv-preview')?.remove();
    const style = document.createElement('style');
    style.textContent = `
      .csv-preview {
        position: fixed;
        right: 34px;
        bottom: 34px;
        z-index: 30;
        width: 548px;
        overflow: hidden;
        border: 1px solid #cbd5e1;
        border-radius: 10px;
        background: #ffffff;
        box-shadow: 0 18px 46px rgba(15, 23, 42, 0.18);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .csv-preview-header {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        padding: 13px 16px;
        background: #f8fafc;
        border-bottom: 1px solid #e2e8f0;
        color: #0f172a;
        font-weight: 900;
      }
      .csv-preview table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
      }
      .csv-preview th,
      .csv-preview td {
        padding: 9px 11px;
        border-bottom: 1px solid #edf2f7;
        text-align: left;
        white-space: nowrap;
      }
      .csv-preview th {
        background: #eff6ff;
        color: #1d4ed8;
        font-size: 11px;
      }
      .csv-preview td {
        color: #334155;
        font-weight: 700;
      }
    `;
    document.head.appendChild(style);
    const preview = document.createElement('aside');
    preview.className = 'csv-preview';
    preview.innerHTML = `
      <div class="csv-preview-header">
        <span>CSV出力イメージ</span>
        <span>物件比較.xlsx に貼り付け</span>
      </div>
      <table>
        <thead>
          <tr><th>物件名</th><th>価格</th><th>専有面積</th><th>坪単価</th><th>管理費</th><th>修繕積立金</th></tr>
        </thead>
        <tbody>
          <tr><td>晴海テストタワー</td><td>10,800万円</td><td>70.00㎡</td><td>510万円</td><td>18,000円</td><td>12,600円</td></tr>
          <tr><td>月島リバーサイド</td><td>8,980万円</td><td>62.40㎡</td><td>475万円</td><td>15,800円</td><td>11,200円</td></tr>
          <tr><td>日本橋グランコート</td><td>7,680万円</td><td>45.10㎡</td><td>563万円</td><td>12,000円</td><td>9,000円</td></tr>
        </tbody>
      </table>
    `;
    document.body.appendChild(preview);
  });
}

function screenshotPath(fileName) {
  return path.join(OUT_DIR, fileName);
}

async function captureListPage(context) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('https://suumo.jp/ms/chuko/tokyo/sc_chuo/');
  await page.waitForSelector('.fudosan-unit-price', { timeout: 10000 });
  await page.waitForSelector('.fudosan-csv-export-button', { timeout: 10000 });
  await hideScreenshotDistractions(page);
  await addShotTitle(
    page,
    '坪単価・平米単価を自動表示',
    "SUUMOやHOME'Sの一覧ページで、月額コストとお気に入り登録までその場で確認できます。"
  );
  await page.screenshot({ path: screenshotPath('01-list-unit-price.png'), fullPage: false });
  await page.close();
}

async function captureDetailPage(context) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('https://www.rehouse.co.jp/buy/mansion/bkdetail/F1FAGA2C/');
  await page.waitForSelector('.fudosan-monthly-cost', { timeout: 10000 });
  await page.waitForSelector('.fudosan-repair-fund', { timeout: 10000 });
  await hideScreenshotDistractions(page);
  await addShotTitle(
    page,
    '月額コストと修繕積立金を確認',
    'ローン返済額、管理費、修繕積立金を合算し、修繕積立金の平米単価も目安と比較します。'
  );
  await page.screenshot({ path: screenshotPath('02-detail-monthly-repair.png'), fullPage: false });
  await page.close();
}

async function capturePopupRaw(context, extensionId) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 420, height: 720 });
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.waitForSelector('.favorite-item', { timeout: 10000 });
  await page.locator('#sort-select').selectOption('updated_desc');
  await page.waitForTimeout(250);
  const buffer = await page.screenshot({ fullPage: false });
  await page.close();
  return buffer;
}

async function captureSidePanelRaw(context, extensionId) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 540, height: 800 });
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await page.waitForSelector('.side-compare-table', { timeout: 10000 });
  await page.waitForTimeout(250);
  const buffer = await page.screenshot({ fullPage: false });
  await page.close();
  return buffer;
}

function imageDataUrl(buffer) {
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

async function composePanelScreenshot(context, options) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  const panelData = imageDataUrl(options.panelBuffer);
  await page.setContent(`<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>${options.title}</title>
  <style>
    ${commonSiteCss()}
    body {
      width: 1280px;
      height: 800px;
      overflow: hidden;
      background:
        radial-gradient(circle at 25% 10%, rgba(29, 78, 216, 0.12), transparent 30%),
        linear-gradient(135deg, #f8fafc 0%, #eef2f7 100%);
    }
    .compose {
      display: grid;
      grid-template-columns: minmax(0, 1fr) ${options.panelWidth}px;
      gap: 28px;
      height: 100%;
      padding: 42px;
    }
    .compose-copy {
      align-self: center;
      display: grid;
      gap: 22px;
      max-width: 610px;
    }
    .compose-copy h1 {
      margin: 0;
      color: #0f172a;
      font-size: 42px;
      line-height: 1.12;
      letter-spacing: 0;
    }
    .compose-copy p {
      margin: 0;
      color: #475569;
      font-size: 17px;
      line-height: 1.7;
      font-weight: 700;
    }
    .mock-card-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
      margin-top: 6px;
    }
    .mock-card {
      padding: 16px;
      border: 1px solid #dbe4ee;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.92);
      box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08);
    }
    .mock-card span {
      display: block;
      color: #64748b;
      font-size: 12px;
      font-weight: 900;
    }
    .mock-card strong {
      display: block;
      margin-top: 6px;
      color: #0f172a;
      font-size: 22px;
      line-height: 1.2;
    }
    .panel-shell {
      align-self: center;
      justify-self: end;
      overflow: hidden;
      border: 1px solid #cbd5e1;
      border-radius: 14px;
      background: #fff;
      box-shadow: 0 24px 70px rgba(15, 23, 42, 0.24);
    }
    .panel-shell img {
      display: block;
      width: ${options.panelWidth}px;
      height: ${options.panelHeight}px;
      object-fit: cover;
    }
  </style>
</head>
<body>
  <main class="compose">
    <section class="compose-copy">
      <div class="mock-brand"><span class="mock-brand-mark">坪</span> 坪たん</div>
      <h1>${options.title}</h1>
      <p>${options.subtitle}</p>
      <div class="mock-card-grid">
        ${options.cards.map(card => `
          <div class="mock-card"><span>${card.label}</span><strong>${card.value}</strong></div>
        `).join('')}
      </div>
    </section>
    <section class="panel-shell" aria-label="${options.title}">
      <img src="${panelData}" alt="">
    </section>
  </main>
</body>
</html>`);
  await page.screenshot({ path: screenshotPath(options.fileName), fullPage: false });
  await page.close();
}

async function capturePopup(context, extensionId) {
  const buffer = await capturePopupRaw(context, extensionId);
  await composePanelScreenshot(context, {
    panelBuffer: buffer,
    panelWidth: 420,
    panelHeight: 720,
    fileName: '03-popup-favorites-watch.png',
    title: '物件を保存して価格ウォッチ',
    subtitle: 'お気に入り、メモ、価格履歴、掲載状態をポップアップでまとめて確認できます。',
    cards: [
      { label: '候補', value: '4件' },
      { label: '値下がり', value: '1件' },
      { label: '並び替え', value: '坪単価・価格改定順' },
      { label: '保存先', value: 'ブラウザ内のみ' }
    ]
  });
}

async function captureSidePanel(context, extensionId) {
  const buffer = await captureSidePanelRaw(context, extensionId);
  await composePanelScreenshot(context, {
    panelBuffer: buffer,
    panelWidth: 540,
    panelHeight: 800,
    fileName: '04-sidepanel-compare.png',
    title: 'Side Panelで見ながら比較',
    subtitle: '物件ページを開いたまま、比較表、類似候補、内見メモ、価格ウォッチを横に置けます。',
    cards: [
      { label: '比較', value: '価格・坪単価・月額' },
      { label: '内見', value: '確認メモ' },
      { label: '価格', value: '値下がり検知' },
      { label: '出力', value: 'CSV対応' }
    ]
  });
}

async function captureCsvPage(context) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('https://suumo.jp/ms/chuko/tokyo/sc_chuo/');
  await page.waitForSelector('.fudosan-csv-export-button', { timeout: 10000 });
  await hideScreenshotDistractions(page);
  await addShotTitle(
    page,
    '物件データをCSVで一括出力',
    '価格、専有面積、坪単価、管理費、修繕積立金などをスプレッドシートで比較できます。'
  );
  await addCsvPreview(page);
  await page.screenshot({ path: screenshotPath('05-csv-export.png'), fullPage: false });
  await page.close();
}

async function setupRoutes(context) {
  await context.route('https://suumo.jp/**', route => route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: buildSuumoListFixture()
  }));

  await context.route('https://www.rehouse.co.jp/**', route => route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: buildRehouseDetailFixture()
  }));
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fudosan-store-shot-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: findChromeExecutable(),
    headless: false,
    ignoreDefaultArgs: ['--disable-extensions'],
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    args: [
      `--disable-extensions-except=${ROOT_DIR}`,
      `--load-extension=${ROOT_DIR}`,
      '--disable-search-engine-choice-screen',
      '--disable-sync',
      '--no-first-run',
      '--no-default-browser-check'
    ]
  });

  try {
    const extensionId = await getExtensionId(context);
    await seedExtensionStorage(context, extensionId);
    await setupRoutes(context);

    await captureListPage(context);
    await captureDetailPage(context);
    await capturePopup(context, extensionId);
    await captureSidePanel(context, extensionId);
    await captureCsvPage(context);

    console.log(`Store screenshots written to ${OUT_DIR}`);
    for (const name of fs.readdirSync(OUT_DIR).filter(name => name.endsWith('.png')).sort()) {
      console.log(path.join(OUT_DIR, name));
    }
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
