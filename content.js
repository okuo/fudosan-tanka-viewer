/**
 * 不動産坪単価・平米単価表示 Chrome拡張
 * 不動産サイトの物件の価格と面積から坪単価・平米単価を自動計算して表示
 * 対応サイト: SUUMO、三井のリハウス、アットホーム、ホームズ
 */

// 既に処理済みの要素を追跡するためのSet
const processedElements = new Set();

// 計算結果をキャッシュするためのMap（価格_面積 -> {tsuboPrice, heiheiPrice}）
const calculationCache = new Map();

// お気に入りURLのSetをキャッシュ（ページ内での高速参照用）
let favoriteUrls = new Set();
let favoriteDataByUrl = new Map();
const syncedFavoriteUrls = new Set();
let lastLoanSettingsSaveAt = 0;

const DEFAULT_LOAN_SETTINGS = {
  annualRatePercent: 0.8,
  years: 35,
  downPaymentMan: 0
};

const DEFAULT_HIGHLIGHT_SETTINGS = {
  enabled: false,
  tsuboPriceLimit: '',
  repairFundMode: 'none',
  monthlyCostLimit: ''
};

let currentLoanSettings = { ...DEFAULT_LOAN_SETTINGS };
let currentHighlightSettings = { ...DEFAULT_HIGHLIGHT_SETTINGS };

// 現在のサイトを判定
const SITE_TYPE = window.location.hostname.includes('rehouse.co.jp')
  ? 'REHOUSE'
  : window.location.hostname.includes('athome.co.jp')
    ? 'ATHOME'
    : window.location.hostname.includes('homes.co.jp')
      ? 'HOMES'
      : 'SUUMO';

// ============================================================
// ユーティリティ関数
// ============================================================

/**
 * ログ出力（サイト名付きプレフィックス）
 */
function log(...args) {
  console.log(`[${SITE_TYPE}坪単価]`, ...args);
}

/**
 * エラーログ出力（サイト名付きプレフィックス）
 */
function logError(...args) {
  console.error(`[${SITE_TYPE}坪単価]`, ...args);
}

/**
 * 文字列から数値を抽出（カンマ区切り、億円表記、面積表記に対応）
 * @param {string} text - 抽出元の文字列
 * @returns {number|null} - 抽出された数値（万円単位または㎡）、失敗時はnull
 */
function extractNumber(text) {
  if (!text) return null;

  // 「専有面積107.19m2」のような形式から面積を抽出
  if (text.includes('専有面積')) {
    const areaMatch = text.match(/専有面積[^\d]*(\d+(?:\.\d+)?)/);
    if (areaMatch) {
      return parseFloat(areaMatch[1]);
    }
  }

  // 「107.19m2」「135.24㎡」のような形式（m2/㎡の前の数値を抽出）
  if (text.includes('m') || text.includes('㎡')) {
    const areaMatch = text.match(/(\d+(?:\.\d+)?)\s*[m㎡]/);
    if (areaMatch) {
      return parseFloat(areaMatch[1]);
    }
  }

  // 「1億2900万円」のような形式に対応
  // 億の部分を抽出
  const okuMatch = text.match(/(\d+(?:\.\d+)?)億/);
  const manMatch = text.match(/(\d+(?:,\d+)?(?:\.\d+)?)万/);

  let totalMan = 0;

  if (okuMatch) {
    // 億を万円に変換（1億 = 10000万円）
    totalMan += parseFloat(okuMatch[1]) * 10000;
  }

  if (manMatch) {
    // 万円部分を追加
    totalMan += parseFloat(manMatch[1].replace(/,/g, ''));
  }

  if (totalMan > 0) {
    return totalMan;
  }

  // 上記でマッチしない場合は従来の方法
  const match = text.replace(/,/g, '').match(/[\d.]+/);
  return match ? parseFloat(match[0]) : null;
}

/**
 * 坪単価を計算
 * @param {number} price - 物件価格（万円）
 * @param {number} area - 専有面積（㎡）
 * @returns {number} - 坪単価（万円/坪）
 */
function calculateTsuboPrice(price, area) {
  const tsubo = area / 3.3058;
  return Math.round(price / tsubo);
}

/**
 * 平米単価を計算
 * @param {number} price - 物件価格（万円）
 * @param {number} area - 専有面積（㎡）
 * @returns {number} - 平米単価（万円/㎡）
 */
function calculateHeiheiPrice(price, area) {
  return Math.round(price / area);
}

/**
 * 元利均等返済の月々返済額を計算
 * @param {number} principal - 借入額（円）
 * @param {number} annualRate - 年利（例: 0.005 = 0.5%）
 * @param {number} years - 返済年数
 * @returns {number} - 月々返済額（円）、小数点以下四捨五入
 */
function calculateMonthlyLoanPayment(principal, annualRate, years) {
  if (principal <= 0 || years <= 0) return 0;
  if (annualRate <= 0) {
    // 金利0%の場合は単純分割
    return Math.round(principal / (years * 12));
  }
  const monthlyRate = annualRate / 12;
  const totalMonths = years * 12;
  const factor = Math.pow(1 + monthlyRate, totalMonths);
  return Math.round(principal * monthlyRate * factor / (factor - 1));
}

/**
 * テキストから金額（円）を抽出する
 * 例: "12,000円/月" -> 12000, "15,000円（税込）" -> 15000
 * @param {string} text - 金額を含むテキスト
 * @returns {number|null} - 抽出された金額（円）、失敗時はnull
 */
function extractYenAmount(text) {
  if (!text) return null;
  const cleaned = text.replace(/,/g, '');

  // 「1万2630円」「2万円」のような万を含む形式に対応
  const manMatch = cleaned.match(/(\d+)万\s*(\d*)\s*円/);
  if (manMatch) {
    const manPart = parseInt(manMatch[1], 10) * 10000;
    const remainder = manMatch[2] ? parseInt(manMatch[2], 10) : 0;
    const amount = manPart + remainder;
    return amount > 0 ? amount : null;
  }

  // 通常の形式: "12630円"
  const match = cleaned.match(/(\d+(?:\.\d+)?)\s*円/);
  if (match) {
    const amount = parseFloat(match[1]);
    return amount > 0 ? amount : null;
  }
  return null;
}

/**
 * 指定ミリ秒待機する
 * @param {number} ms - 待機時間（ミリ秒）
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getStorageData(defaults) {
  return new Promise((resolve) => {
    chrome.storage.local.get(defaults, resolve);
  });
}

function setStorageData(data) {
  return new Promise((resolve) => {
    chrome.storage.local.set(data, resolve);
  });
}

function normalizeLoanSettings(settings = {}) {
  const annualRatePercent = Number(settings.annualRatePercent);
  const years = parseInt(settings.years, 10);
  const downPaymentMan = Number(settings.downPaymentMan);

  return {
    annualRatePercent: Number.isFinite(annualRatePercent) && annualRatePercent >= 0
      ? annualRatePercent
      : DEFAULT_LOAN_SETTINGS.annualRatePercent,
    years: Number.isFinite(years) && years > 0
      ? years
      : DEFAULT_LOAN_SETTINGS.years,
    downPaymentMan: Number.isFinite(downPaymentMan) && downPaymentMan >= 0
      ? downPaymentMan
      : DEFAULT_LOAN_SETTINGS.downPaymentMan
  };
}

function normalizeHighlightSettings(settings = {}) {
  return {
    enabled: Boolean(settings.enabled),
    tsuboPriceLimit: settings.tsuboPriceLimit ?? '',
    repairFundMode: settings.repairFundMode || 'none',
    monthlyCostLimit: settings.monthlyCostLimit ?? ''
  };
}

/**
 * 修繕積立金の平米単価を計算し、国交省ガイドラインと比較
 * @param {string} repairFundText - 修繕積立金テキスト（例: "12,000円/月"）
 * @param {number} area - 専有面積（㎡）
 * @param {string} buildingFloorsText - 建物階数テキスト（例: "16階建"）
 * @param {string} totalUnitsText - 総戸数テキスト（敷地面積の代替指標）
 * @returns {{ perSqm: number, guideline: number, isAdequate: boolean, label: string }|null}
 */
function calculateRepairFundPerSqm(repairFundText, area, buildingFloorsText, totalUnitsText) {
  if (!repairFundText || !area || area <= 0) return null;

  // 修繕積立金から数値（円）を抽出
  const fundYen = extractYenAmount(repairFundText);
  if (!fundYen || fundYen <= 0) return null;

  const perSqm = Math.round(fundYen / area);

  // 建物階数を取得（地下部分を除去してから地上階数を抽出）
  let buildingFloors = 0;
  if (buildingFloorsText) {
    const cleaned = buildingFloorsText.replace(/地下\d+階/g, '').replace(/地上/g, '');
    const floorsMatch = cleaned.match(/(\d+)階/);
    if (floorsMatch) {
      buildingFloors = parseInt(floorsMatch[1], 10);
    }
  }

  // 国交省ガイドライン目安（円/㎡/月）
  // 20階以上（タワマン）: 338円
  // 15階未満・5,000㎡未満: 335円
  // 15階未満・5,000〜10,000㎡: 252円
  // 15階未満・10,000㎡以上: 271円
  // 不明の場合: 252円（最も一般的）
  let guideline = 252; // デフォルト
  let guidelineLabel = '';

  if (buildingFloors >= 20) {
    guideline = 338;
    guidelineLabel = '20階以上';
  } else if (buildingFloors > 0 && buildingFloors < 15) {
    // 総戸数から敷地面積を推定（粗い推定だが参考値として）
    // 総戸数が不明の場合はデフォルト252円
    guidelineLabel = '15階未満';
    guideline = 252; // デフォルト（5,000〜10,000㎡が最も一般的）
  } else {
    guidelineLabel = '一般';
  }

  // 80%未満なら目安以下
  const isAdequate = perSqm >= guideline * 0.8;
  const label = isAdequate ? '適正水準' : '目安以下（将来値上げリスク）';

  return { perSqm, guideline, isAdequate, label };
}

/**
 * 修繕積立金の平米単価表示用DOM要素を生成
 * @param {{ perSqm: number, guideline: number, isAdequate: boolean, label: string }} result
 * @returns {HTMLDivElement}
 */
function createRepairFundElement(result) {
  const div = document.createElement('div');
  div.className = 'fudosan-unit-price fudosan-repair-fund';
  const statusClass = result.isAdequate ? 'repair-fund-adequate' : 'repair-fund-warning';
  const statusIcon = result.isAdequate ? '\u2713' : '\u26A0';
  div.innerHTML = `
    <span class="unit-price-label">修繕積立金単価:</span>
    <span class="unit-price-value repair-fund-value">${result.perSqm.toLocaleString()}円/㎡/月</span>
    <span class="unit-price-separator">|</span>
    <a href="https://www.mlit.go.jp/jutakukentiku/house/content/001747009.pdf" target="_blank" rel="noopener" class="unit-price-label repair-fund-link">目安:</a>
    <span class="unit-price-value">${result.guideline}円/㎡</span>
    <span class="unit-price-separator">|</span>
    <span class="${statusClass}">${statusIcon} ${result.label}</span>
  `;
  return div;
}

/**
 * 月額コスト表示用DOM要素を生成
 * @param {number} loanMonthly - ローン月額（円）
 * @param {number|null} managementFee - 管理費（円/月）、取得不可の場合null
 * @param {number|null} repairFund - 修繕積立金（円/月）、取得不可の場合null
 * @param {number} annualRate - 年利（例: 0.005）
 * @param {number} years - 返済年数
 * @returns {HTMLDivElement}
 */
function createMonthlyCostElement(loanMonthly, managementFee, repairFund, annualRate, years) {
  const totalMonthly = loanMonthly + (managementFee || 0) + (repairFund || 0);

  const div = document.createElement('div');
  div.className = 'fudosan-unit-price fudosan-monthly-cost';

  // 内訳の構築
  const parts = [`ローン ${loanMonthly.toLocaleString()}円`];
  if (managementFee !== null) {
    parts.push(`管理費 ${managementFee.toLocaleString()}円`);
  }
  if (repairFund !== null) {
    parts.push(`修繕 ${repairFund.toLocaleString()}円`);
  }

  // 注記（取得できなかった項目がある場合）
  const missingParts = [];
  if (managementFee === null) missingParts.push('管理費');
  if (repairFund === null) missingParts.push('修繕積立金');
  const missingNote = missingParts.length > 0
    ? `<span class="monthly-cost-note">※${missingParts.join('・')}は取得できませんでした</span>`
    : '';

  const ratePercent = (annualRate * 100).toFixed(1);
  const downPaymentLabel = currentLoanSettings.downPaymentMan > 0
    ? ` / 頭金${currentLoanSettings.downPaymentMan.toLocaleString()}万円`
    : '';

  div.innerHTML = `
    <div class="monthly-cost-header">
      <span class="monthly-cost-icon">\uD83D\uDCB0</span>
      <span class="monthly-cost-label">月額コスト概算:</span>
      <span class="monthly-cost-total">約${totalMonthly.toLocaleString()}円</span>
    </div>
    <div class="monthly-cost-breakdown">
      （${parts.join(' + ')}）
    </div>
    <div class="monthly-cost-conditions">
      ※金利${ratePercent}% / ${years}年返済${downPaymentLabel}
      ${missingNote}
    </div>
  `;
  return div;
}

function normalizeOptionalYenAmount(value) {
  if (value === null || value === undefined || value === '') return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function calculateMonthlyCostBreakdown(priceMan, fees = {}) {
  const annualRate = currentLoanSettings.annualRatePercent / 100;
  const years = currentLoanSettings.years;
  const principal = Math.max(0, (priceMan - currentLoanSettings.downPaymentMan) * 10000);
  const loanMonthly = calculateMonthlyLoanPayment(principal, annualRate, years);
  const managementFee = normalizeOptionalYenAmount(fees.managementFee);
  const repairFund = normalizeOptionalYenAmount(fees.repairFund);

  return {
    loanMonthly,
    managementFee,
    repairFund,
    totalMonthly: loanMonthly + (managementFee || 0) + (repairFund || 0),
    annualRate,
    years,
    downPaymentMan: currentLoanSettings.downPaymentMan
  };
}

function formatMonthlyCostShort(amount) {
  if (!amount || amount <= 0) return '';
  if (amount >= 10000) {
    const man = Math.round(amount / 1000) / 10;
    return `約${man.toLocaleString()}万円`;
  }
  return `約${amount.toLocaleString()}円`;
}

function createListMonthlyCostElement(monthlyCost, isCompact) {
  if (!monthlyCost || monthlyCost.loanMonthly <= 0) return null;

  const div = document.createElement('div');
  div.className = isCompact
    ? 'fudosan-list-monthly-cost fudosan-list-monthly-cost--compact'
    : 'fudosan-list-monthly-cost';

  const includedParts = [];
  if (monthlyCost.managementFee !== null) includedParts.push('管理費');
  if (monthlyCost.repairFund !== null) includedParts.push('修繕');

  const scopeLabel = includedParts.length > 0
    ? `${includedParts.join('・')}込`
    : 'ローンのみ';
  const ratePercent = (monthlyCost.annualRate * 100).toFixed(1);
  const downPaymentLabel = monthlyCost.downPaymentMan > 0
    ? ` / 頭金${monthlyCost.downPaymentMan.toLocaleString()}万円`
    : '';

  div.innerHTML = `
    <span class="list-monthly-cost-label">月々概算</span>
    <span class="list-monthly-cost-value">${formatMonthlyCostShort(monthlyCost.totalMonthly)}</span>
    <span class="list-monthly-cost-scope">${scopeLabel}</span>
    <span class="list-monthly-cost-condition">${ratePercent}%/${monthlyCost.years}年${downPaymentLabel}</span>
  `;

  return div;
}

function formatPriceMan(price) {
  if (!price) return '';
  if (price >= 10000) {
    const oku = Math.floor(price / 10000);
    const man = price % 10000;
    return man === 0 ? `${oku}億円` : `${oku}億${man.toLocaleString()}万円`;
  }
  return `${price.toLocaleString()}万円`;
}

function formatSignedMan(diff) {
  return `${diff > 0 ? '+' : ''}${diff.toLocaleString()}万円`;
}

function getPriceWatchInfo(favorite, currentPrice) {
  if (!favorite || !currentPrice) return null;

  const storedCurrentPrice = favorite.currentPrice || favorite.price || null;
  if (storedCurrentPrice && currentPrice !== storedCurrentPrice) {
    const diff = currentPrice - storedCurrentPrice;
    return {
      diff,
      previousPrice: storedCurrentPrice,
      currentPrice,
      detectedNow: true
    };
  }

  if (favorite.previousPrice && storedCurrentPrice && favorite.previousPrice !== storedCurrentPrice) {
    const diff = storedCurrentPrice - favorite.previousPrice;
    return {
      diff,
      previousPrice: favorite.previousPrice,
      currentPrice: storedCurrentPrice,
      detectedNow: false
    };
  }

  return null;
}

function createPriceWatchElement(watchInfo) {
  if (!watchInfo) return null;

  const div = document.createElement('div');
  div.className = `fudosan-price-watch ${watchInfo.diff > 0 ? 'fudosan-price-watch--up' : 'fudosan-price-watch--down'}`;

  const movement = watchInfo.diff > 0 ? '値上がり' : '値下がり';
  const prefix = watchInfo.detectedNow ? '価格改定検知' : '価格改定';
  div.textContent = `${prefix}: ${movement} ${formatSignedMan(watchInfo.diff)} (${formatPriceMan(watchInfo.previousPrice)} → ${formatPriceMan(watchInfo.currentPrice)})`;

  return div;
}

function buildNextPriceHistory(favorite, previousPrice, currentPrice, checkedAt) {
  const history = Array.isArray(favorite.priceHistory) ? favorite.priceHistory : [];
  if (!previousPrice || !currentPrice || previousPrice === currentPrice) {
    return history;
  }

  const latest = history[0];
  if (
    latest &&
    latest.previousPrice === previousPrice &&
    latest.currentPrice === currentPrice
  ) {
    return [
      { ...latest, checkedAt },
      ...history.slice(1)
    ];
  }

  return [
    {
      previousPrice,
      currentPrice,
      diff: currentPrice - previousPrice,
      checkedAt
    },
    ...history
  ].slice(0, 20);
}

async function loadLoanSettings() {
  const result = await getStorageData({ loanSettings: DEFAULT_LOAN_SETTINGS });
  currentLoanSettings = normalizeLoanSettings(result.loanSettings);
  return currentLoanSettings;
}

async function saveLoanSettings(settings) {
  currentLoanSettings = normalizeLoanSettings(settings);
  lastLoanSettingsSaveAt = Date.now();
  await setStorageData({ loanSettings: currentLoanSettings });
}

async function loadHighlightSettings() {
  const result = await getStorageData({ highlightSettings: DEFAULT_HIGHLIGHT_SETTINGS });
  currentHighlightSettings = normalizeHighlightSettings(result.highlightSettings);
  return currentHighlightSettings;
}

async function saveHighlightSettings(settings) {
  currentHighlightSettings = normalizeHighlightSettings(settings);
  await setStorageData({ highlightSettings: currentHighlightSettings });
}

/**
 * 詳細ページで管理費・修繕積立金を取得する
 * @returns {{ managementFee: number|null, repairFund: number|null }}
 */
function extractManagementAndRepairFees() {
  let managementFeeText = '';
  let repairFundText = '';

  if (SITE_TYPE === 'SUUMO') {
    // テーブルのth/tdから取得を試みる
    const tables = document.querySelectorAll('table');
    for (const table of tables) {
      const rows = table.querySelectorAll('tr');
      for (const row of rows) {
        const th = row.querySelector('th');
        const td = row.querySelector('td');
        if (!th || !td) continue;
        const thText = th.textContent.trim();
        if (thText.includes('管理費') && !thText.includes('修繕積立金')) {
          managementFeeText = td.textContent.trim();
        }
        if (thText.includes('修繕積立金') && !thText.includes('基金')) {
          repairFundText = td.textContent.trim();
        }
      }
    }
    // フォールバック: テーブルから取得できなかった場合、本文テキストから検索
    if (!managementFeeText || !extractYenAmount(managementFeeText)) {
      const bodyText = document.body.textContent;
      const mgmtMatch = bodyText.match(/管理費[等]*[^\d万]*?([0-9,]+(?:万[0-9,]*)?円)/);
      if (mgmtMatch) managementFeeText = mgmtMatch[1];
    }
    if (!repairFundText || !extractYenAmount(repairFundText)) {
      const bodyText = document.body.textContent;
      const repairMatch = bodyText.match(/修繕積立金[等]*[^\d万]*?([0-9,]+(?:万[0-9,]*)?円)/);
      if (repairMatch) repairFundText = repairMatch[1];
    }
  } else if (SITE_TYPE === 'REHOUSE') {
    const bodyText = document.body.textContent;
    const mgmtMatch = bodyText.match(/管理費[等]*[^\d万]*?([0-9,]+(?:万[0-9,]*)?円)/);
    if (mgmtMatch) managementFeeText = mgmtMatch[1];
    const repairMatch = bodyText.match(/修繕積立金[等]*[^\d万]*?([0-9,]+(?:万[0-9,]*)?円)/);
    if (repairMatch) repairFundText = repairMatch[1];
  } else if (SITE_TYPE === 'ATHOME') {
    const tables = document.querySelectorAll('table');
    for (const table of tables) {
      const rows = table.querySelectorAll('tr');
      for (const row of rows) {
        const th = row.querySelector('th');
        const td = row.querySelector('td');
        if (!th || !td) continue;
        const thText = th.textContent.trim();
        if (thText.includes('管理費')) {
          managementFeeText = td.textContent.trim();
        }
        if (thText.includes('修繕積立金')) {
          repairFundText = td.textContent.trim();
        }
      }
    }
  } else if (SITE_TYPE === 'HOMES') {
    const bodyText = document.body.textContent;
    const mgmtMatch = bodyText.match(/管理費[等]*[^\d万]*?([0-9,]+(?:万[0-9,]*)?円)/);
    if (mgmtMatch) managementFeeText = mgmtMatch[1];
    const repairMatch = bodyText.match(/修繕積立金[等]*[^\d万]*?([0-9,]+(?:万[0-9,]*)?円)/);
    if (repairMatch) repairFundText = repairMatch[1];
  }

  const managementFee = extractYenAmount(managementFeeText);
  const repairFund = extractYenAmount(repairFundText);

  log('管理費テキスト:', managementFeeText, '->', managementFee, '円');
  log('修繕積立金テキスト:', repairFundText, '->', repairFund, '円');

  return { managementFee, repairFund };
}

/**
 * 詳細ページで月額コスト概算を計算・表示する
 * @param {number} priceMan - 物件価格（万円）
 */
function displayMonthlyCost(priceMan) {
  const annualRate = currentLoanSettings.annualRatePercent / 100;
  const years = currentLoanSettings.years;
  const principal = Math.max(0, (priceMan - currentLoanSettings.downPaymentMan) * 10000);

  const loanMonthly = calculateMonthlyLoanPayment(principal, annualRate, years);
  if (loanMonthly <= 0) {
    log('ローン月額計算不可');
    return;
  }

  const { managementFee, repairFund } = extractManagementAndRepairFees();

  log('月額コスト計算 - ローン:', loanMonthly, '円, 管理費:', managementFee, '円, 修繕:', repairFund, '円');

  // 既存の月額コスト表示を削除
  const existingCost = document.querySelectorAll('.fudosan-monthly-cost');
  existingCost.forEach(el => el.remove());

  const costDiv = createMonthlyCostElement(loanMonthly, managementFee, repairFund, annualRate, years);

  // 挿入位置: 修繕積立金表示の下、なければ坪単価表示の下
  if (SITE_TYPE === 'SUUMO') {
    const repairFundEl = document.querySelector('.mt7.b ~ .fudosan-repair-fund');
    const unitPriceEl = document.querySelector('.mt7.b + .fudosan-unit-price:not(.fudosan-repair-fund)');
    const insertAfter = repairFundEl || unitPriceEl;
    if (insertAfter && insertAfter.parentElement) {
      if (insertAfter.nextSibling) {
        insertAfter.parentElement.insertBefore(costDiv, insertAfter.nextSibling);
      } else {
        insertAfter.parentElement.appendChild(costDiv);
      }
      log('月額コストを上部に挿入');
    }
  } else {
    // REHOUSE, ATHOME, HOMES: 修繕積立金表示の下、なければ坪単価表示の下
    const repairFundEl = document.querySelector('.fudosan-repair-fund');
    const unitPriceEl = document.querySelector('.fudosan-unit-price:not(.fudosan-repair-fund):not(.fudosan-monthly-cost)');
    const insertAfter = repairFundEl || unitPriceEl;
    if (insertAfter && insertAfter.parentElement) {
      if (insertAfter.nextSibling) {
        insertAfter.parentElement.insertBefore(costDiv, insertAfter.nextSibling);
      } else {
        insertAfter.parentElement.appendChild(costDiv);
      }
      log('月額コストを坪単価表示の下に挿入');
    }
  }
}

// ============================================================
// 住宅ローンシミュレーション
// ============================================================

/**
 * 住宅ローンシミュレーションUIを作成・表示する
 * @param {number} priceMan - 物件価格（万円）
 */
function displayLoanSimulation(priceMan) {
  // 既存のシミュレーションUIがあれば削除
  const existing = document.querySelector('.fudosan-loan-sim');
  if (existing) existing.remove();

  const priceYen = priceMan * 10000; // 万円 -> 円

  // コンテナ
  const container = document.createElement('div');
  container.className = 'fudosan-unit-price fudosan-loan-sim';

  // ヘッダー（折りたたみトグル）
  const header = document.createElement('div');
  header.className = 'loan-sim-header';
  header.innerHTML = `
    <span class="loan-sim-toggle">\u25B6</span>
    <span class="loan-sim-icon">\uD83C\uDFE0</span>
    <span class="loan-sim-title">住宅ローンシミュレーション</span>
  `;
  container.appendChild(header);

  // 本体（折りたたみ対象）
  const body = document.createElement('div');
  body.className = 'loan-sim-body';

  // --- 入力欄 ---
  const inputsDiv = document.createElement('div');
  inputsDiv.className = 'loan-sim-inputs';

  // 頭金
  const downPaymentRow = createSimInputRow('頭金', 'loan-sim-down', currentLoanSettings.downPaymentMan, 0, priceMan, 100, '万円');
  inputsDiv.appendChild(downPaymentRow.row);

  // 金利
  const rateRow = createSimInputRow('金利', 'loan-sim-rate', currentLoanSettings.annualRatePercent, 0.0, 5.0, 0.1, '%');
  inputsDiv.appendChild(rateRow.row);

  // 返済期間
  const yearsRow = createSimInputRow('返済期間', 'loan-sim-years', currentLoanSettings.years, 10, 50, 5, '年');
  inputsDiv.appendChild(yearsRow.row);

  body.appendChild(inputsDiv);

  // --- 結果表示 ---
  const resultDiv = document.createElement('div');
  resultDiv.className = 'loan-sim-result';
  body.appendChild(resultDiv);

  container.appendChild(body);

  // デフォルトは折りたたみ状態
  let isCollapsed = true;
  body.style.display = 'none';
  header.querySelector('.loan-sim-toggle').textContent = '\u25B6';

  // 折りたたみ動作
  header.addEventListener('click', () => {
    isCollapsed = !isCollapsed;
    body.style.display = isCollapsed ? 'none' : '';
    header.querySelector('.loan-sim-toggle').textContent = isCollapsed ? '\u25B6' : '\u25BC';
  });

  // 計算・表示更新関数
  function updateSimulation() {
    const downPayment = parseFloat(downPaymentRow.input.value) || 0;
    const rate = parseFloat(rateRow.input.value) || 0;
    const years = parseInt(yearsRow.input.value, 10) || 35;

    saveLoanSettings({
      downPaymentMan: downPayment,
      annualRatePercent: rate,
      years
    }).then(() => {
      const propertyCards = getPropertyCards();
      if (propertyCards.length === 0) {
        displayMonthlyCost(priceMan);
      }
    });

    const borrowing = Math.max(0, priceYen - downPayment * 10000);
    const annualRate = rate / 100;
    const monthly = calculateMonthlyLoanPayment(borrowing, annualRate, years);
    const totalPayment = monthly * years * 12;
    const totalInterest = totalPayment - borrowing;

    resultDiv.innerHTML = `
      <div class="loan-sim-result-row">
        <span class="loan-sim-result-label">借入額</span>
        <span class="loan-sim-result-value">${Math.round(borrowing / 10000).toLocaleString()}万円</span>
      </div>
      <div class="loan-sim-result-row loan-sim-result-highlight">
        <span class="loan-sim-result-label">月々返済額</span>
        <span class="loan-sim-result-value loan-sim-monthly">${monthly.toLocaleString()}円</span>
      </div>
      <div class="loan-sim-result-row">
        <span class="loan-sim-result-label">総返済額</span>
        <span class="loan-sim-result-value">${Math.round(totalPayment / 10000).toLocaleString()}万円</span>
      </div>
      <div class="loan-sim-result-row">
        <span class="loan-sim-result-label">利息総額</span>
        <span class="loan-sim-result-value">${Math.round(totalInterest / 10000).toLocaleString()}万円</span>
      </div>
    `;

    // スライダーと数値入力の同期
    downPaymentRow.syncDisplay();
    rateRow.syncDisplay();
    yearsRow.syncDisplay();
  }

  // イベントリスナー設定
  [downPaymentRow, rateRow, yearsRow].forEach(({ input, slider }) => {
    input.addEventListener('input', () => {
      slider.value = input.value;
      updateSimulation();
    });
    slider.addEventListener('input', () => {
      input.value = slider.value;
      updateSimulation();
    });
  });

  // 初回計算
  updateSimulation();

  // 挿入位置: 月額コスト表示の下、なければ修繕積立金表示の下、なければ坪単価表示の下
  if (SITE_TYPE === 'SUUMO') {
    const monthlyCostEl = document.querySelector('.mt7.b ~ .fudosan-monthly-cost');
    const repairFundEl = document.querySelector('.mt7.b ~ .fudosan-repair-fund');
    const unitPriceEl = document.querySelector('.mt7.b + .fudosan-unit-price:not(.fudosan-repair-fund):not(.fudosan-monthly-cost)');
    const insertAfter = monthlyCostEl || repairFundEl || unitPriceEl;
    if (insertAfter && insertAfter.parentElement) {
      if (insertAfter.nextSibling) {
        insertAfter.parentElement.insertBefore(container, insertAfter.nextSibling);
      } else {
        insertAfter.parentElement.appendChild(container);
      }
      log('ローンシミュレーションを上部に挿入');
    }
  } else {
    const monthlyCostEl = document.querySelector('.fudosan-monthly-cost');
    const repairFundEl = document.querySelector('.fudosan-repair-fund');
    const unitPriceEl = document.querySelector('.fudosan-unit-price:not(.fudosan-repair-fund):not(.fudosan-monthly-cost):not(.fudosan-loan-sim)');
    const insertAfter = monthlyCostEl || repairFundEl || unitPriceEl;
    if (insertAfter && insertAfter.parentElement) {
      if (insertAfter.nextSibling) {
        insertAfter.parentElement.insertBefore(container, insertAfter.nextSibling);
      } else {
        insertAfter.parentElement.appendChild(container);
      }
      log('ローンシミュレーションを挿入');
    }
  }
}

/**
 * シミュレーション入力行（ラベル + スライダー + 数値入力）を作成
 * @param {string} label - ラベル
 * @param {string} id - 要素IDプレフィックス
 * @param {number} defaultVal - デフォルト値
 * @param {number} min - 最小値
 * @param {number} max - 最大値
 * @param {number} step - 刻み値
 * @param {string} unit - 単位テキスト
 * @returns {{ row: HTMLDivElement, input: HTMLInputElement, slider: HTMLInputElement, syncDisplay: Function }}
 */
function createSimInputRow(label, id, defaultVal, min, max, step, unit) {
  const row = document.createElement('div');
  row.className = 'loan-sim-input-row';

  const labelEl = document.createElement('label');
  labelEl.className = 'loan-sim-input-label';
  labelEl.textContent = label;
  labelEl.htmlFor = id + '-input';
  row.appendChild(labelEl);

  const controlsDiv = document.createElement('div');
  controlsDiv.className = 'loan-sim-input-controls';

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'loan-sim-slider';
  slider.id = id + '-slider';
  slider.min = min;
  slider.max = max;
  slider.step = step;
  slider.value = defaultVal;
  controlsDiv.appendChild(slider);

  const inputWrap = document.createElement('div');
  inputWrap.className = 'loan-sim-input-wrap';

  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'loan-sim-input';
  input.id = id + '-input';
  input.min = min;
  input.max = max;
  input.step = step;
  input.value = defaultVal;
  inputWrap.appendChild(input);

  const unitEl = document.createElement('span');
  unitEl.className = 'loan-sim-input-unit';
  unitEl.textContent = unit;
  inputWrap.appendChild(unitEl);

  controlsDiv.appendChild(inputWrap);
  row.appendChild(controlsDiv);

  const syncDisplay = () => {
    // クランプ
    let val = parseFloat(input.value);
    if (isNaN(val)) val = defaultVal;
    if (val < min) val = min;
    if (val > max) val = max;
  };

  return { row, input, slider, syncDisplay };
}

// ============================================================
// 共通抽出・生成関数（重複排除）
// ============================================================

/**
 * 一覧ページの物件カードを取得する共通関数
 * processAllProperties, collectPropertyData, init で共通利用
 * @returns {Array} - 物件カード要素の配列
 */
function getPropertyCards() {
  if (SITE_TYPE === 'REHOUSE') {
    return Array.from(document.querySelectorAll('.property-index-card'));
  } else if (SITE_TYPE === 'ATHOME') {
    return Array.from(document.querySelectorAll('.card-box-inner__detail'));
  } else if (SITE_TYPE === 'HOMES') {
    // ホームズ: 通常の一覧ページ - td.priceとtd.spaceの両方を持つtableを物件カードとして扱う
    const allTables = document.querySelectorAll('.bukkenSpec table');
    const standardCards = Array.from(allTables).filter(table =>
      table.querySelector('td.price') && table.querySelector('td.space')
    );

    // ホームズ: グルーピング一覧ページ - .unitSummary内のtr要素を物件カードとして扱う
    const groupedCards = Array.from(document.querySelectorAll('.unitSummary tbody tr'));

    return [...standardCards, ...groupedCards];
  } else {
    return Array.from(document.querySelectorAll('.cassetteitem, .dottable--cassette'));
  }
}

/**
 * キャッシュ付きの単価計算
 * @param {number} price - 物件価格（万円）
 * @param {number} area - 専有面積（㎡）
 * @returns {{ tsuboPrice: number, heiheiPrice: number }}
 */
function getOrCalculateUnitPrice(price, area) {
  const cacheKey = `${price}_${area}`;
  if (calculationCache.has(cacheKey)) {
    return calculationCache.get(cacheKey);
  }
  const result = {
    tsuboPrice: calculateTsuboPrice(price, area),
    heiheiPrice: calculateHeiheiPrice(price, area)
  };
  calculationCache.set(cacheKey, result);
  return result;
}

/**
 * 単価表示用のDOM要素を生成
 * @param {number} tsuboPrice - 坪単価（万円/坪）
 * @param {number} heiheiPrice - 平米単価（万円/㎡）
 * @param {boolean} isCompact - コンパクト表示かどうか
 * @returns {HTMLDivElement}
 */
function createUnitPriceElement(tsuboPrice, heiheiPrice, isCompact) {
  const div = document.createElement('div');
  div.className = isCompact
    ? 'fudosan-unit-price fudosan-unit-price--compact'
    : 'fudosan-unit-price';
  div.innerHTML = `
    <span class="unit-price-label">坪単価:</span>
    <span class="unit-price-value">${tsuboPrice.toLocaleString()}万円</span>
    <span class="unit-price-separator">|</span>
    <span class="unit-price-label">平米単価:</span>
    <span class="unit-price-value">${heiheiPrice.toLocaleString()}万円</span>
  `;
  return div;
}

/**
 * 「計算不可」表示用のDOM要素を生成
 * @param {boolean} isCompact - コンパクト表示かどうか
 * @returns {HTMLDivElement}
 */
function createUnavailableElement(isCompact) {
  const div = document.createElement('div');
  div.className = isCompact
    ? 'fudosan-unit-price fudosan-unit-price--compact'
    : 'fudosan-unit-price';
  div.innerHTML = `
    <span class="unit-price-label">坪単価:</span>
    <span class="unit-price-na">計算不可</span>
    <span class="unit-price-separator">|</span>
    <span class="unit-price-label">平米単価:</span>
    <span class="unit-price-na">計算不可</span>
  `;
  return div;
}

function extractFeesFromText(text) {
  const managementMatch = text.match(/管理費[^\d万]*([0-9,]+(?:万[0-9,]*)?円)/);
  const repairMatch = text.match(/修繕積立金[^\d万]*([0-9,]+(?:万[0-9,]*)?円)/);
  return {
    managementFee: managementMatch ? extractYenAmount(managementMatch[1]) : null,
    repairFund: repairMatch ? extractYenAmount(repairMatch[1]) : null
  };
}

function analyzeListPropertyMetrics(element, price, area, tsuboPrice) {
  const text = element.textContent || '';
  const fees = extractFeesFromText(text);
  const monthlyCost = calculateMonthlyCostBreakdown(price, fees);
  const metrics = {
    tsuboPrice,
    monthlyCost: monthlyCost.totalMonthly || null,
    repairFundResult: null
  };

  if (fees.repairFund && area) {
    metrics.repairFundResult = calculateRepairFundPerSqm(`${fees.repairFund}円`, area, '', '');
  }

  return metrics;
}

function applyHighlightToUnitPrice(element, unitPriceDiv, metrics) {
  if (!currentHighlightSettings.enabled || !unitPriceDiv) return;

  unitPriceDiv.classList.remove(
    'fudosan-unit-price--alert',
    'fudosan-unit-price--warn',
    'fudosan-unit-price--good'
  );
  element.classList.remove(
    'fudosan-property-highlight--alert',
    'fudosan-property-highlight--warn',
    'fudosan-property-highlight--good'
  );

  const highlightReasons = [];

  const tsuboLimit = Number(currentHighlightSettings.tsuboPriceLimit);
  if (tsuboLimit > 0 && metrics.tsuboPrice && metrics.tsuboPrice > tsuboLimit) {
    highlightReasons.push('坪単価が上限超過');
  }

  if (currentHighlightSettings.repairFundMode === 'warn' && metrics.repairFundResult && !metrics.repairFundResult.isAdequate) {
    highlightReasons.push('修繕積立金が目安以下');
  }

  const monthlyLimit = Number(currentHighlightSettings.monthlyCostLimit);
  if (monthlyLimit > 0 && metrics.monthlyCost && metrics.monthlyCost > monthlyLimit) {
    highlightReasons.push('月額総コストが上限超過');
  }

  if (highlightReasons.length === 0) {
    unitPriceDiv.classList.add('fudosan-unit-price--good');
    element.classList.add('fudosan-property-highlight--good');
    unitPriceDiv.title = '条件内';
    return;
  }

  const hasHardLimit = highlightReasons.some(reason => reason.includes('上限超過'));
  unitPriceDiv.classList.add(hasHardLimit ? 'fudosan-unit-price--alert' : 'fudosan-unit-price--warn');
  element.classList.add(hasHardLimit ? 'fudosan-property-highlight--alert' : 'fudosan-property-highlight--warn');
  unitPriceDiv.title = highlightReasons.join(' / ');
}

function createHighlightPanel() {
  let panel = document.getElementById('fudosan-highlight-panel');
  if (panel) panel.remove();

  panel = document.createElement('div');
  panel.id = 'fudosan-highlight-panel';
  panel.className = 'fudosan-highlight-panel';
  panel.innerHTML = `
    <div class="fudosan-highlight-panel__title">検索色分け</div>
    <label class="fudosan-highlight-panel__row">
      <input type="checkbox" id="fudosan-highlight-enabled">
      <span>有効化</span>
    </label>
    <label class="fudosan-highlight-panel__row">
      <span>坪単価上限</span>
      <input type="number" id="fudosan-highlight-tsubo" min="0" step="1" placeholder="万円/坪">
    </label>
    <label class="fudosan-highlight-panel__row">
      <span>修繕積立金</span>
      <select id="fudosan-highlight-repair">
        <option value="none">判定しない</option>
        <option value="warn">目安以下を警告</option>
      </select>
    </label>
    <label class="fudosan-highlight-panel__row">
      <span>月額総コスト上限</span>
      <input type="number" id="fudosan-highlight-monthly" min="0" step="1000" placeholder="円/月">
    </label>
  `;

  document.body.appendChild(panel);

  const enabled = panel.querySelector('#fudosan-highlight-enabled');
  const tsubo = panel.querySelector('#fudosan-highlight-tsubo');
  const repair = panel.querySelector('#fudosan-highlight-repair');
  const monthly = panel.querySelector('#fudosan-highlight-monthly');

  enabled.checked = currentHighlightSettings.enabled;
  tsubo.value = currentHighlightSettings.tsuboPriceLimit;
  repair.value = currentHighlightSettings.repairFundMode;
  monthly.value = currentHighlightSettings.monthlyCostLimit;

  const handleChange = async () => {
    await saveHighlightSettings({
      enabled: enabled.checked,
      tsuboPriceLimit: tsubo.value,
      repairFundMode: repair.value,
      monthlyCostLimit: monthly.value
    });
    processAllProperties();
  };

  [enabled, tsubo, repair, monthly].forEach((input) => {
    input.addEventListener('change', handleChange);
  });
}

/**
 * 対象要素の直後に単価表示を挿入する（既存の表示があれば削除）
 * 詳細ページでの REHOUSE/HOMES/ATHOME/SUUMO 共通の挿入処理
 * @param {Element} targetElement - 挿入基準となる要素
 * @param {HTMLDivElement} unitPriceDiv - 挿入する単価表示要素
 */
function insertUnitPriceAfterElement(targetElement, unitPriceDiv) {
  if (!targetElement || !targetElement.parentElement) {
    log('挿入先の要素または親要素が見つかりません');
    return;
  }

  // 既存の単価表示を削除
  const existing = targetElement.parentElement.querySelector('.fudosan-unit-price');
  if (existing) existing.remove();

  // 対象要素の直後に挿入
  if (targetElement.nextSibling) {
    targetElement.parentElement.insertBefore(unitPriceDiv, targetElement.nextSibling);
  } else {
    targetElement.parentElement.appendChild(unitPriceDiv);
  }
}

// ============================================================
// お気に入り機能
// ============================================================

/**
 * chrome.storageからお気に入りURLセットを読み込んでキャッシュ
 * @returns {Promise<void>}
 */
function loadFavoriteUrls() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ favorites: [] }, (result) => {
      favoriteUrls = new Set(result.favorites.map(f => f.url));
      favoriteDataByUrl = new Map(result.favorites.map(f => [f.url, f]));
      resolve();
    });
  });
}

/**
 * お気に入りを追加
 * @param {Object} data - { url, name, price, tsubotanka, site, area, addedAt }
 * @returns {Promise<void>}
 */
function addFavorite(data) {
  return new Promise((resolve) => {
    chrome.storage.local.get({ favorites: [] }, (result) => {
      const favorites = result.favorites;
      if (!favorites.some(f => f.url === data.url)) {
        const now = new Date().toISOString();
        favorites.push({
          memo: '',
          currentPrice: data.price || null,
          previousPrice: null,
          priceHistory: [],
          priceUpdatedAt: data.price ? now : null,
          lastCheckedAt: now,
          ...data
        });
        chrome.storage.local.set({ favorites }, () => {
          favoriteUrls.add(data.url);
          favoriteDataByUrl = new Map(favorites.map(f => [f.url, f]));
          log('お気に入り追加:', data.url);
          resolve();
        });
      } else {
        resolve();
      }
    });
  });
}

/**
 * お気に入りを削除
 * @param {string} url - 削除対象URL
 * @returns {Promise<void>}
 */
function removeFavorite(url) {
  return new Promise((resolve) => {
    chrome.storage.local.get({ favorites: [] }, (result) => {
      const favorites = result.favorites.filter(f => f.url !== url);
      chrome.storage.local.set({ favorites }, () => {
        favoriteUrls.delete(url);
        favoriteDataByUrl.delete(url);
        syncedFavoriteUrls.delete(url);
        log('お気に入り削除:', url);
        resolve();
      });
    });
  });
}

function syncFavoritePropertyData(propertyInfo) {
  if (!propertyInfo.url || !favoriteUrls.has(propertyInfo.url) || syncedFavoriteUrls.has(propertyInfo.url)) {
    return;
  }

  syncedFavoriteUrls.add(propertyInfo.url);

  chrome.storage.local.get({ favorites: [] }, (result) => {
    let changed = false;
    const now = new Date().toISOString();

    const favorites = result.favorites.map((favorite) => {
      if (favorite.url !== propertyInfo.url) return favorite;
      const storedCurrentPrice = favorite.currentPrice || favorite.price || null;

      const nextFavorite = {
        ...favorite,
        name: propertyInfo.name || favorite.name || '',
        area: propertyInfo.area || favorite.area || null,
        tsubotanka: propertyInfo.tsubotanka || favorite.tsubotanka || null,
        site: favorite.site || SITE_TYPE,
        priceHistory: Array.isArray(favorite.priceHistory) ? favorite.priceHistory : [],
        lastCheckedAt: now
      };

      if (propertyInfo.price && storedCurrentPrice && propertyInfo.price !== storedCurrentPrice) {
        nextFavorite.previousPrice = storedCurrentPrice;
        nextFavorite.currentPrice = propertyInfo.price;
        nextFavorite.price = propertyInfo.price;
        nextFavorite.priceUpdatedAt = now;
        nextFavorite.priceHistory = buildNextPriceHistory(favorite, storedCurrentPrice, propertyInfo.price, now);
        changed = true;
      } else if (propertyInfo.price && !storedCurrentPrice) {
        nextFavorite.currentPrice = propertyInfo.price;
        nextFavorite.price = propertyInfo.price;
        nextFavorite.priceUpdatedAt = now;
        changed = true;
      } else if (
        nextFavorite.name !== favorite.name ||
        nextFavorite.area !== favorite.area ||
        nextFavorite.tsubotanka !== favorite.tsubotanka ||
        nextFavorite.lastCheckedAt !== favorite.lastCheckedAt
      ) {
        changed = true;
      }

      return nextFavorite;
    });

    if (!changed) return;

    chrome.storage.local.set({ favorites }, () => {
      favoriteDataByUrl = new Map(favorites.map(f => [f.url, f]));
      log('お気に入り情報を同期:', propertyInfo.url);
    });
  });
}

/**
 * お気に入りボタンを生成して返す
 * @param {Object} propertyInfo - { url, name, price, tsubotanka, site, area }
 * @returns {HTMLButtonElement}
 */
function createFavoriteButton(propertyInfo) {
  const btn = document.createElement('button');
  btn.className = 'fudosan-favorite-btn';
  const isFav = favoriteUrls.has(propertyInfo.url);
  btn.textContent = isFav ? '\u2605' : '\u2606';
  btn.title = isFav ? 'お気に入りから削除' : 'お気に入りに追加';
  if (isFav) {
    btn.classList.add('fudosan-favorite-btn--active');
  }

  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (favoriteUrls.has(propertyInfo.url)) {
      await removeFavorite(propertyInfo.url);
      btn.textContent = '\u2606';
      btn.title = 'お気に入りに追加';
      btn.classList.remove('fudosan-favorite-btn--active');
    } else {
      await addFavorite({
        url: propertyInfo.url,
        name: propertyInfo.name || '',
        price: propertyInfo.price || null,
        tsubotanka: propertyInfo.tsubotanka || null,
        site: SITE_TYPE,
        area: propertyInfo.area || null,
        addedAt: new Date().toISOString()
      });
      btn.textContent = '\u2605';
      btn.title = 'お気に入りから削除';
      btn.classList.add('fudosan-favorite-btn--active');
    }
  });

  return btn;
}

/**
 * 物件カードからURLを抽出する
 * @param {Element} card - 物件カード要素
 * @returns {string} - 物件URL
 */
function extractPropertyUrl(card) {
  if (SITE_TYPE === 'SUUMO') {
    const parentDiv = card.closest('.property_unit-body, .ui-media');
    if (parentDiv) {
      const links = parentDiv.querySelectorAll('a[href*="/ms/"], a[href*="/chuko/"]');
      if (links.length > 0) {
        const href = links[0].getAttribute('href');
        if (href) return href.startsWith('http') ? href : new URL(href, window.location.origin).href;
      }
    }
    const linkSelectors = ['.cassetteitem_content-title a', 'a[href*="/chuko/"]', 'a[href*="/ms/"]'];
    for (const selector of linkSelectors) {
      const linkEl = card.querySelector(selector);
      if (linkEl) {
        const href = linkEl.getAttribute('href');
        if (href && !href.includes('#') && !href.includes('javascript:')) {
          return href.startsWith('http') ? href : new URL(href, window.location.origin).href;
        }
      }
    }
  } else if (SITE_TYPE === 'ATHOME') {
    const parentCard = card.closest('.card-box-inner');
    const linkEl = (parentCard || card).querySelector('.select-link, a[href*="/mansion/"]');
    if (linkEl) {
      const href = linkEl.getAttribute('href');
      if (href && !href.includes('javascript:')) {
        return href.startsWith('http') ? href : new URL(href, window.location.origin).href;
      }
    }
  } else {
    const linkEl = card.querySelector('a[href]');
    if (linkEl) {
      const href = linkEl.getAttribute('href');
      if (href) return href.startsWith('http') ? href : new URL(href, window.location.origin).href;
    }
  }
  return '';
}

/**
 * 物件カードから物件名を抽出する
 * @param {Element} card - 物件カード要素
 * @returns {string} - 物件名
 */
function extractPropertyName(card) {
  if (SITE_TYPE === 'SUUMO') {
    const dts = card.querySelectorAll('dt');
    for (const dt of dts) {
      if (dt.textContent.trim().includes('物件名')) {
        const dd = dt.nextElementSibling;
        if (dd && dd.tagName === 'DD') return dd.textContent.trim();
      }
    }
    const titleEl = card.querySelector('.cassetteitem_content-title');
    if (titleEl) return titleEl.textContent.trim();
  } else if (SITE_TYPE === 'REHOUSE') {
    const titleEl = card.querySelector('.property-card-title, [class*="title"]');
    if (titleEl) return titleEl.textContent.trim();
  } else if (SITE_TYPE === 'ATHOME') {
    const parentCard = card.closest('.card-box-inner');
    const titleEl = parentCard ? parentCard.querySelector('.title-wrap__title-text') : null;
    if (titleEl) return titleEl.textContent.trim();
    const selectors = ['h3 a', 'h2 a', '.property-title', '[class*="title"] a'];
    for (const sel of selectors) {
      const el = (parentCard || card).querySelector(sel);
      if (el && el.textContent.trim()) return el.textContent.trim();
    }
  } else if (SITE_TYPE === 'HOMES') {
    const titleEl = card.querySelector('.bukkenName, [class*="name"]');
    if (titleEl) return titleEl.textContent.trim();
  }
  return '';
}

// ============================================================
// 物件処理（一覧ページ）
// ============================================================

/**
 * 物件カード/詳細ページから価格と面積を取得して単価を表示
 * @param {Element} element - 物件要素
 */
function processProperty(element) {
  // 既に処理済みの場合はスキップ
  if (processedElements.has(element)) {
    return;
  }

  log('物件を処理中:', element);

  // 価格要素を検索（サイトごとのパターンに対応）
  let priceSelectors = [];
  if (SITE_TYPE === 'REHOUSE') {
    priceSelectors = [
      '.price-text',                             // 三井のリハウス一覧ページ
      '[class*="price"]',                        // 汎用パターン
    ];
  } else if (SITE_TYPE === 'ATHOME') {
    priceSelectors = [
      '.property-price',                         // アットホーム一覧ページ
      '[class*="price"]',                        // 汎用パターン
    ];
  } else if (SITE_TYPE === 'HOMES') {
    priceSelectors = [
      'td.price',                                // ホームズ一覧ページ
      '[class*="price"]',                        // 汎用パターン
    ];
  } else {
    priceSelectors = [
      '.dottable-value',                         // SUUMO一覧ページ（新）
      '.mt7.b',                                   // SUUMO詳細ページ
      '.dkr-cassetteitem_price--num',           // SUUMO一覧ページ
      '.cassette_price--num',                    // SUUMO一覧ページ（旧）
      '.property_view_note-emphasis',            // SUUMO詳細ページ（旧）
      '.detailbox_property_price_txt',           // SUUMO詳細ページ（別パターン）
      '[class*="price"]',                         // 汎用パターン
    ];
  }

  let priceElement = null;
  for (const selector of priceSelectors) {
    priceElement = element.querySelector(selector);
    if (priceElement) {
      log('価格要素発見:', selector, priceElement);
      break;
    }
  }

  // テーブル行の場合：<th>価格</th><td>値</td> のパターン
  if (!priceElement && element.tagName === 'TR') {
    // ホームズのグルーピング一覧ページの場合: verticalTable構造
    const verticalTable = element.querySelector('.verticalTable');
    if (verticalTable && SITE_TYPE === 'HOMES') {
      const ths = verticalTable.querySelectorAll('th');
      for (const th of ths) {
        if (th.textContent.includes('価格')) {
          const td = th.nextElementSibling;
          if (td && td.tagName === 'TD') {
            priceElement = td;
            log('価格要素発見: verticalTable内のtd', priceElement);
            break;
          }
        }
      }
    } else {
      const th = element.querySelector('th');
      const td = element.querySelector('td');
      if (th && th.textContent.includes('価格') && td) {
        priceElement = td;
        log('価格要素発見: テーブル行のtd', priceElement);
      }
    }
  }

  if (!priceElement) {
    log('価格要素が見つかりませんでした');
    return;
  }

  // 面積要素を検索（サイトごとのパターンに対応）
  let areaSelectors = [];
  if (SITE_TYPE === 'REHOUSE') {
    areaSelectors = [
      '.paragraph-body',                         // 三井のリハウス一覧ページ（面積を含む段落）
      '[class*="area"]',                         // 汎用パターン
    ];
  } else if (SITE_TYPE === 'ATHOME') {
    areaSelectors = [
      '.property-detail-table__block',           // アットホーム一覧ページ（専有面積ブロック）
      '[class*="area"]',                         // 汎用パターン
    ];
  } else if (SITE_TYPE === 'HOMES') {
    areaSelectors = [
      'td.space',                                // ホームズ一覧ページ
      '[class*="area"]',                         // 汎用パターン
    ];
  } else {
    areaSelectors = [
      '.dkr-cassetteitem_detail_text--area',   // SUUMO一覧ページ
      '.cassette_detail_text--area',            // SUUMO一覧ページ（旧）
      '[class*="area"]',                         // 汎用パターン
    ];
  }

  let areaElement = null;
  for (const selector of areaSelectors) {
    // 三井のリハウスの場合、複数の.paragraph-bodyがあるため㎡を含むものを探す
    if (SITE_TYPE === 'REHOUSE' && selector === '.paragraph-body') {
      const elements = element.querySelectorAll(selector);
      for (const el of elements) {
        if (el.textContent.includes('㎡') || el.textContent.includes('m2') || el.textContent.includes('m')) {
          areaElement = el;
          log('面積要素発見:', selector, areaElement);
          break;
        }
      }
      if (areaElement) break;
    } else if (SITE_TYPE === 'ATHOME' && selector === '.property-detail-table__block') {
      // アットホームの場合、専有面積を含むブロックを探す
      const elements = element.querySelectorAll(selector);
      for (const el of elements) {
        if (el.textContent.includes('専有面積')) {
          // 専有面積ブロック内のspanから「40.00m²」のような値を取得
          const spans = el.querySelectorAll('span');
          for (const span of spans) {
            if (span.textContent.includes('m') || span.textContent.includes('㎡')) {
              areaElement = span;
              log('面積要素発見:', selector, areaElement);
              break;
            }
          }
          if (areaElement) break;
        }
      }
      if (areaElement) break;
    } else {
      areaElement = element.querySelector(selector);
      if (areaElement) {
        log('面積要素発見:', selector, areaElement);
        break;
      }
    }
  }

  // 新しいHTML構造: <dt>専有面積</dt><dd>値</dd> の形式を検索
  if (!areaElement) {
    const dts = element.querySelectorAll('dt');
    for (const dt of dts) {
      if (dt.textContent.includes('専有面積')) {
        areaElement = dt.nextElementSibling;
        if (areaElement && areaElement.tagName === 'DD') {
          log('面積要素発見: <dt>専有面積</dt>の次のdd', areaElement);
          break;
        }
      }
    }
  }

  // 詳細ページ: span要素内に「専有面積XXXm2」が含まれる場合
  if (!areaElement) {
    const spans = element.querySelectorAll('span');
    for (const span of spans) {
      if (span.textContent.includes('専有面積') && (span.textContent.includes('m') || span.textContent.includes('㎡'))) {
        // 数値が抽出できるか確認
        const testExtract = extractNumber(span.textContent);
        if (testExtract && testExtract > 0) {
          areaElement = span;
          log('面積要素発見: 専有面積を含むspan', areaElement);
          break;
        }
      }
    }
  }

  // テーブル行の場合：同じテーブル内の専有面積行を探す
  if (!areaElement && element.tagName === 'TR') {
    // ホームズのグルーピング一覧ページの場合: verticalTable構造
    const verticalTable = element.querySelector('.verticalTable');
    if (verticalTable && SITE_TYPE === 'HOMES') {
      const ths = verticalTable.querySelectorAll('th');
      for (const th of ths) {
        if (th.textContent.includes('専有面積')) {
          const td = th.nextElementSibling;
          if (td && td.tagName === 'TD') {
            areaElement = td;
            log('面積要素発見: verticalTable内のtd', areaElement);
            break;
          }
        }
      }
    } else {
      const table = element.closest('table');
      if (table) {
        const rows = table.querySelectorAll('tr');
        for (const row of rows) {
          const th = row.querySelector('th');
          const td = row.querySelector('td');
          if (th && th.textContent.includes('専有面積') && td) {
            areaElement = td;
            log('面積要素発見: テーブル行のtd', areaElement);
            break;
          }
        }
      }
    }
  }

  // 価格と面積を抽出
  const priceText = priceElement.textContent;
  const areaText = areaElement ? areaElement.textContent : null;

  log('価格テキスト:', priceText);
  log('面積テキスト:', areaText);

  const price = extractNumber(priceText);
  const area = extractNumber(areaText);

  log('価格:', price, '万円');
  log('面積:', area, '㎡');

  // テーブル内の場合はコンパクトなスタイルを適用
  const isInTable = priceElement.closest('table') !== null;

  // 単価表示要素を作成
  let unitPriceDiv;
  let tsuboPrice = null;
  if (price && area && price > 0 && area > 0) {
    const result = getOrCalculateUnitPrice(price, area);
    tsuboPrice = result.tsuboPrice;
    log('計算結果 - 坪単価:', result.tsuboPrice, '万円/坪, 平米単価:', result.heiheiPrice, '万円/㎡');
    unitPriceDiv = createUnitPriceElement(result.tsuboPrice, result.heiheiPrice, isInTable);
  } else {
    log('計算不可 - 価格または面積が不正');
    unitPriceDiv = createUnavailableElement(isInTable);
  }

  const listFees = extractFeesFromText(element.textContent || '');
  if (price && price > 0) {
    const monthlyCost = calculateMonthlyCostBreakdown(price, listFees);
    const monthlyCostDiv = createListMonthlyCostElement(monthlyCost, isInTable);
    if (monthlyCostDiv) {
      unitPriceDiv.appendChild(monthlyCostDiv);
    }
  }

  // 既存の単価表示があれば削除
  const existingInParent = priceElement.parentElement?.querySelector('.fudosan-unit-price');
  if (existingInParent) {
    existingInParent.remove();
  }
  const existingInElement = priceElement.querySelector('.fudosan-unit-price');
  if (existingInElement) {
    existingInElement.remove();
  }

  // お気に入りボタンを単価表示に追加
  const propertyUrl = extractPropertyUrl(element);
  if (propertyUrl) {
    const watchedFavorite = favoriteDataByUrl.get(propertyUrl);
    const priceWatchDiv = createPriceWatchElement(getPriceWatchInfo(watchedFavorite, price));
    if (priceWatchDiv) {
      unitPriceDiv.appendChild(priceWatchDiv);
    }

    const favoriteInfo = {
      url: propertyUrl,
      name: extractPropertyName(element),
      price: price,
      tsubotanka: tsuboPrice,
      area: area
    };
    const favBtn = createFavoriteButton(favoriteInfo);
    unitPriceDiv.appendChild(favBtn);
    syncFavoritePropertyData(favoriteInfo);
  }

  if (price && area && tsuboPrice) {
    const metrics = analyzeListPropertyMetrics(element, price, area, tsuboPrice);
    applyHighlightToUnitPrice(element, unitPriceDiv, metrics);
  }

  // テーブル内の場合は価格要素（td）の中に追加
  if (isInTable) {
    priceElement.appendChild(unitPriceDiv);
    log('単価表示をテーブル内に挿入しました');
  } else {
    // 通常の場合は価格要素の後に挿入
    const priceParent = priceElement.parentElement;
    if (priceParent) {
      if (priceElement.nextSibling) {
        priceParent.insertBefore(unitPriceDiv, priceElement.nextSibling);
      } else {
        priceParent.appendChild(unitPriceDiv);
      }
      log('単価表示を挿入しました');
    } else {
      log('価格要素の親要素が見つかりません');
      return;
    }
  }

  // 処理済みとしてマーク
  processedElements.add(element);
}

// ============================================================
// 一覧ページ処理 / 詳細ページ処理
// ============================================================

/**
 * 一覧ページの全物件カードを処理
 * @param {Array} cards - 物件カード要素の配列
 */
function processListPage(cards) {
  log('一覧ページとして処理 cards:', cards.length);
  cards.forEach(card => {
    processProperty(card);
  });
}

/**
 * 詳細ページの価格・面積を取得して単価を表示
 */
function processDetailPage() {
  log('詳細ページとして処理');
  log('URL:', window.location.href);

  // 物件概要テーブルから価格と面積を取得
  let detailPrice = null;
  let detailArea = null;
  let priceElement = null;

  if (SITE_TYPE === 'REHOUSE') {
    // 三井のリハウス詳細ページ
    priceElement = document.querySelector('.text-price-regular.price-size') ||
                   document.querySelector('.building-price-info');
    const areaElement = document.querySelector('.building-info');

    if (priceElement && areaElement) {
      detailPrice = extractNumber(priceElement.textContent);
      detailArea = extractNumber(areaElement.textContent);
      log('詳細ページから取得 - 価格:', detailPrice, '万円, 面積:', detailArea, '㎡');
    }
  } else if (SITE_TYPE === 'HOMES') {
    // ホームズ詳細ページ
    priceElement = document.querySelector('[data-component="price"]');
    const areaElement = document.querySelector('[data-component="occupiedArea"]');

    if (priceElement && areaElement) {
      detailPrice = extractNumber(priceElement.textContent);
      detailArea = extractNumber(areaElement.textContent);
      log('詳細ページから取得 - 価格:', detailPrice, '万円, 面積:', detailArea, '㎡');
    }
  } else if (SITE_TYPE === 'ATHOME') {
    // アットホーム詳細ページ
    priceElement = document.querySelector('.price-main');

    // 面積要素を取得（テーブルから）
    let areaElement = null;
    const tables = document.querySelectorAll('table');
    for (const table of tables) {
      const rows = table.querySelectorAll('tr');
      for (const row of rows) {
        const th = row.querySelector('th');
        const td = row.querySelector('td');
        if (th && th.textContent.trim() === '専有面積' && td) {
          areaElement = td;
          break;
        }
      }
      if (areaElement) break;
    }

    if (priceElement && areaElement) {
      detailPrice = extractNumber(priceElement.textContent);
      detailArea = extractNumber(areaElement.textContent);
      log('詳細ページから取得 - 価格:', detailPrice, '万円, 面積:', detailArea, '㎡');
    }
  } else {
    // SUUMO詳細ページ（テーブル形式）
    const tables = document.querySelectorAll('table');
    log('テーブル数:', tables.length);

    for (const table of tables) {
      const rows = table.querySelectorAll('tr');
      let priceRow = null;
      let areaRow = null;

      for (const row of rows) {
        const th = row.querySelector('th');
        if (th && th.textContent.includes('価格')) {
          priceRow = row;
        }
        if (th && th.textContent.includes('専有面積')) {
          areaRow = row;
        }
      }

      if (priceRow && areaRow) {
        const priceTd = priceRow.querySelector('td');
        const areaTd = areaRow.querySelector('td');

        if (priceTd && areaTd) {
          detailPrice = extractNumber(priceTd.textContent);
          detailArea = extractNumber(areaTd.textContent);
          log('物件概要から取得 - 価格:', detailPrice, '万円, 面積:', detailArea, '㎡');
          break;
        }
      }
    }
  }

  // 価格と面積が取得できた場合、各箇所に表示
  if (detailPrice && detailArea && detailPrice > 0 && detailArea > 0) {
    const { tsuboPrice, heiheiPrice } = getOrCalculateUnitPrice(detailPrice, detailArea);
    log('計算完了 - 坪単価:', tsuboPrice, '万円/坪, 平米単価:', heiheiPrice, '万円/㎡');

    // 詳細ページのお気に入りボタン用情報
    const detailUrl = window.location.href;
    const detailName = document.querySelector('h1')?.textContent?.trim() || '';
    const favoriteInfo = {
      url: detailUrl,
      name: detailName,
      price: detailPrice,
      tsubotanka: tsuboPrice,
      area: detailArea
    };
    syncFavoritePropertyData(favoriteInfo);

    // 上部の価格表示の下に追加
    if (SITE_TYPE === 'SUUMO') {
      const topPriceElement = document.querySelector('.mt7.b');
      if (topPriceElement && topPriceElement.parentElement) {
        const unitPriceDiv = createUnitPriceElement(tsuboPrice, heiheiPrice, false);
        const favBtn = createFavoriteButton(favoriteInfo);
        unitPriceDiv.appendChild(favBtn);
        const priceWatchDiv = createPriceWatchElement(getPriceWatchInfo(favoriteDataByUrl.get(favoriteInfo.url), detailPrice));
        if (priceWatchDiv) unitPriceDiv.appendChild(priceWatchDiv);
        insertUnitPriceAfterElement(topPriceElement, unitPriceDiv);
        log('上部に表示を挿入');
      }
    } else if (SITE_TYPE === 'REHOUSE' && priceElement) {
      const unitPriceDiv = createUnitPriceElement(tsuboPrice, heiheiPrice, false);
      const favBtn = createFavoriteButton(favoriteInfo);
      unitPriceDiv.appendChild(favBtn);
      const priceWatchDiv = createPriceWatchElement(getPriceWatchInfo(favoriteDataByUrl.get(favoriteInfo.url), detailPrice));
      if (priceWatchDiv) unitPriceDiv.appendChild(priceWatchDiv);
      // REHOUSE: .property-detail-information内にラッパーを作成し、flexの新しい行に配置
      const infoSection = document.querySelector('.property-detail-information');
      if (infoSection) {
        let wrapper = infoSection.querySelector('.fudosan-rehouse-badges');
        if (!wrapper) {
          wrapper = document.createElement('div');
          wrapper.className = 'fudosan-rehouse-badges';
          infoSection.style.flexWrap = 'wrap';
          infoSection.appendChild(wrapper);
        }
        // 既存の坪単価バッジのみ削除
        const existing = wrapper.querySelector('.fudosan-unit-price:not(.fudosan-repair-fund):not(.fudosan-monthly-cost):not(.fudosan-loan-sim)');
        if (existing) existing.remove();
        wrapper.insertBefore(unitPriceDiv, wrapper.firstChild);
      } else {
        insertUnitPriceAfterElement(priceElement, unitPriceDiv);
      }
      log('価格表示の下に表示を挿入');
    } else if (SITE_TYPE === 'HOMES' && priceElement) {
      const unitPriceDiv = createUnitPriceElement(tsuboPrice, heiheiPrice, false);
      const favBtn = createFavoriteButton(favoriteInfo);
      unitPriceDiv.appendChild(favBtn);
      const priceWatchDiv = createPriceWatchElement(getPriceWatchInfo(favoriteDataByUrl.get(favoriteInfo.url), detailPrice));
      if (priceWatchDiv) unitPriceDiv.appendChild(priceWatchDiv);
      insertUnitPriceAfterElement(priceElement, unitPriceDiv);
      log('価格表示の下に表示を挿入');
    } else if (SITE_TYPE === 'ATHOME' && priceElement) {
      const unitPriceDiv = createUnitPriceElement(tsuboPrice, heiheiPrice, false);
      const favBtn = createFavoriteButton(favoriteInfo);
      unitPriceDiv.appendChild(favBtn);
      const priceWatchDiv = createPriceWatchElement(getPriceWatchInfo(favoriteDataByUrl.get(favoriteInfo.url), detailPrice));
      if (priceWatchDiv) unitPriceDiv.appendChild(priceWatchDiv);
      insertUnitPriceAfterElement(priceElement, unitPriceDiv);
      log('価格表示の下に表示を挿入');
    }

    // テーブル内の価格行に追加（SUUMO専用）
    if (SITE_TYPE === 'SUUMO') {
      const tables = document.querySelectorAll('table');
      tables.forEach((table, tableIdx) => {
        const rows = table.querySelectorAll('tr');
        rows.forEach((row, rowIdx) => {
          const th = row.querySelector('th');
          const td = row.querySelector('td');
          if (th && th.textContent.includes('価格') && td) {
            const existing = td.querySelector('.fudosan-unit-price');
            if (existing) existing.remove();

            const unitPriceDiv = createUnitPriceElement(tsuboPrice, heiheiPrice, true);
            td.appendChild(unitPriceDiv);
            log('テーブル内に表示を挿入 table:', tableIdx, 'row:', rowIdx);
          }
        });
      });
    }
  } else {
    log('詳細ページで価格・面積が取得できませんでした');
  }

  // 修繕積立金の平米単価表示
  if (detailArea && detailArea > 0) {
    displayRepairFundPerSqm(detailArea);
  }

  // 月額コスト概算表示
  if (detailPrice && detailPrice > 0) {
    displayMonthlyCost(detailPrice);
  }

  // 住宅ローンシミュレーション
  if (detailPrice && detailPrice > 0) {
    displayLoanSimulation(detailPrice);
  }

  log('詳細ページ処理完了。単価表示数:', document.querySelectorAll('.fudosan-unit-price').length);
}

/**
 * 詳細ページで修繕積立金の平米単価を計算・表示する
 * @param {number} area - 専有面積（㎡）
 */
function displayRepairFundPerSqm(area) {
  let repairFundText = '';
  let buildingFloorsText = '';
  let totalUnitsText = '';
  let repairFundRow = null; // 修繕積立金の表示行（挿入位置用）

  if (SITE_TYPE === 'SUUMO') {
    const tables = document.querySelectorAll('table');
    for (const table of tables) {
      const rows = table.querySelectorAll('tr');
      for (const row of rows) {
        const th = row.querySelector('th');
        const td = row.querySelector('td');
        if (!th || !td) continue;
        const thText = th.textContent.trim();
        if (thText.includes('修繕積立金') && !thText.includes('基金')) {
          repairFundText = td.textContent.trim();
          repairFundRow = row;
        }
        if (thText.includes('建物階数') || (thText.includes('所在階') && thText.includes('構造'))) {
          buildingFloorsText = td.textContent.trim();
        }
        if (thText.includes('総戸数')) {
          totalUnitsText = td.textContent.trim();
        }
      }
    }
    // フォールバック: テーブルから取得できなかった場合、本文テキストから検索
    if (!repairFundText || !extractYenAmount(repairFundText)) {
      const bodyText = document.body.textContent;
      const repairMatch = bodyText.match(/修繕積立金[等]*[^\d万]*?([0-9,]+(?:万[0-9,]*)?円)/);
      if (repairMatch) repairFundText = repairMatch[1];
    }
    if (!buildingFloorsText) {
      const bodyText = document.body.textContent;
      const floorsMatch = bodyText.match(/(?:地上|RC|SRC|鉄骨鉄筋|鉄筋|鉄骨)?(\d+)階(?:地下\d+階)?建/);
      if (floorsMatch) buildingFloorsText = floorsMatch[1] + '階建';
    }
    if (!totalUnitsText) {
      const bodyText = document.body.textContent;
      const unitsMatch = bodyText.match(/総戸数\s*([0-9,]+戸)/);
      if (unitsMatch) totalUnitsText = unitsMatch[1];
    }
  } else if (SITE_TYPE === 'REHOUSE') {
    const bodyText = document.body.textContent;
    const repairMatch = bodyText.match(/修繕積立金[等]*[^\d万]*?([0-9,]+(?:万[0-9,]*)?円)/);
    if (repairMatch) repairFundText = repairMatch[1];
    const floorsMatch = bodyText.match(/(?:地上|RC|SRC|鉄骨鉄筋|鉄筋|鉄骨)?(\d+)階(?:地下\d+階)?建/);
    if (floorsMatch) buildingFloorsText = floorsMatch[1] + '階建';
    const unitsMatch = bodyText.match(/総戸数\s*([0-9,]+戸)/);
    if (unitsMatch) totalUnitsText = unitsMatch[1];
  } else if (SITE_TYPE === 'ATHOME') {
    const tables = document.querySelectorAll('table');
    for (const table of tables) {
      const rows = table.querySelectorAll('tr');
      for (const row of rows) {
        const th = row.querySelector('th');
        const td = row.querySelector('td');
        if (!th || !td) continue;
        const thText = th.textContent.trim();
        if (thText.includes('修繕積立金')) {
          repairFundText = td.textContent.trim();
          repairFundRow = row;
        }
        if (thText.includes('階建')) {
          buildingFloorsText = td.textContent.trim();
        }
        if (thText.includes('総戸数')) {
          totalUnitsText = td.textContent.trim();
        }
      }
    }
  } else if (SITE_TYPE === 'HOMES') {
    const bodyText = document.body.textContent;
    const repairMatch = bodyText.match(/修繕積立金[等]*[^\d万]*?([0-9,]+(?:万[0-9,]*)?円)/);
    if (repairMatch) repairFundText = repairMatch[1];
    const floorsEl = document.querySelector('[data-component="buildingFloors"]');
    if (floorsEl) buildingFloorsText = floorsEl.textContent.trim();
    const unitsMatch = bodyText.match(/総戸数\s*([0-9,]+戸)/);
    if (unitsMatch) totalUnitsText = unitsMatch[1];
  }

  if (!repairFundText) {
    log('修繕積立金が見つかりません');
    return;
  }

  log('修繕積立金テキスト:', repairFundText, '建物階数:', buildingFloorsText, '総戸数:', totalUnitsText);

  const result = calculateRepairFundPerSqm(repairFundText, area, buildingFloorsText, totalUnitsText);
  if (!result) {
    log('修繕積立金の平米単価計算不可');
    return;
  }

  log('修繕積立金計算結果:', result.perSqm, '円/㎡/月, 目安:', result.guideline, '円/㎡, 判定:', result.label);

  // 既存の修繕積立金平米単価表示を削除
  const existingRepairFund = document.querySelectorAll('.fudosan-repair-fund');
  existingRepairFund.forEach(el => el.remove());

  const repairFundDiv = createRepairFundElement(result);

  // 挿入位置: 坪単価表示の直後に挿入
  // 注意: insertUnitPriceAfterElementは既存の.fudosan-unit-priceを削除するため使わない
  if (SITE_TYPE === 'SUUMO') {
    // 上部の坪単価表示の後に挿入
    const topUnitPrice = document.querySelector('.mt7.b + .fudosan-unit-price:not(.fudosan-repair-fund)');
    if (topUnitPrice && topUnitPrice.parentElement) {
      if (topUnitPrice.nextSibling) {
        topUnitPrice.parentElement.insertBefore(repairFundDiv, topUnitPrice.nextSibling);
      } else {
        topUnitPrice.parentElement.appendChild(repairFundDiv);
      }
      log('修繕積立金平米単価を上部に挿入');
    }

    // テーブル内の修繕積立金行にも挿入
    if (repairFundRow) {
      const td = repairFundRow.querySelector('td');
      if (td) {
        const existing = td.querySelector('.fudosan-repair-fund');
        if (existing) existing.remove();
        const compactDiv = createRepairFundElement(result);
        compactDiv.classList.add('fudosan-unit-price--compact');
        td.appendChild(compactDiv);
        log('修繕積立金平米単価をテーブル内に挿入');
      }
    }
  } else {
    // REHOUSE, ATHOME, HOMES: 坪単価表示の後に挿入
    const unitPriceEl = document.querySelector('.fudosan-unit-price:not(.fudosan-repair-fund)');
    if (unitPriceEl && unitPriceEl.parentElement) {
      if (unitPriceEl.nextSibling) {
        unitPriceEl.parentElement.insertBefore(repairFundDiv, unitPriceEl.nextSibling);
      } else {
        unitPriceEl.parentElement.appendChild(repairFundDiv);
      }
      log('修繕積立金平米単価を坪単価表示の下に挿入');
    }
  }
}

/**
 * ページ内のすべての物件を処理（一覧ページ or 詳細ページに振り分け）
 */
function processAllProperties() {
  log('processAllProperties開始');

  const propertyCards = getPropertyCards();
  log('物件カード数:', propertyCards.length);

  if (propertyCards.length === 0) {
    // 詳細ページ: 物件カードがない場合
    processDetailPage();
  } else {
    // 一覧ページ
    processedElements.clear();
    processListPage(propertyCards);
  }
}

// ============================================================
// DOM変更監視
// ============================================================

/**
 * DOM変更を監視して新しい物件が追加されたら処理
 */
function observeDOMChanges() {
  const observer = new MutationObserver((mutations) => {
    // 新しいノードが追加されたかチェック（ただし自分が追加した要素は除外）
    let shouldProcess = false;

    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        // 追加されたノードをチェック
        for (const node of mutation.addedNodes) {
          // 自分が追加した.fudosan-unit-price要素は無視
          if (node.nodeType === 1 && !node.classList?.contains('fudosan-unit-price')) {
            shouldProcess = true;
            break;
          }
        }
      }
      if (shouldProcess) break;
    }

    if (shouldProcess) {
      processAllProperties();
    }
  });

  // body全体を監視
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

// ============================================================
// 詳細ページ情報取得（サイト別）
// ============================================================

/**
 * 詳細ページから追加情報を取得
 * @param {string} url - 詳細ページURL
 * @param {string} siteType - サイトタイプ ('SUUMO', 'REHOUSE', 'ATHOME', 'HOMES')
 * @returns {Object} - 追加情報
 */
async function fetchDetailPageInfo(url, siteType = SITE_TYPE) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`[${siteType}坪単価] 詳細ページ取得失敗: ${url}`);
      return {};
    }

    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const detailInfo = {
      nameDetail: '',          // 詳細ページの物件名
      floor: '',               // 階数
      direction: '',           // 向き
      buildingFloors: '',      // 建物階数
      managementFee: '',       // 管理費
      repairFund: '',          // 修繕積立金
      totalUnits: '',          // 総戸数
      structure: '',           // 構造
      parking: '',             // 駐車場
      builtDate: '',           // 築年月（詳細）
      company: '',             // 不動産会社名
      // 追加項目
      layout: '',              // 間取り
      salesUnits: '',          // 販売戸数
      balconyArea: '',         // バルコニー面積
      repairFundInitial: '',   // 修繕積立基金
      otherFees: '',           // 諸費用
      deliveryTime: '',        // 引渡可能時期
      landArea: '',            // 敷地面積
      landRights: '',          // 敷地の権利形態
      zoning: '',              // 用途地域
      constructor: '',         // 施工会社
      energyPerformance: '',   // エネルギー消費性能
      insulation: '',          // 断熱性能
      utilityEstimate: '',     // 目安光熱費
      reform: '',              // リフォーム
      majorPriceRange: '',     // 最多価格帯
      restrictions: '',        // その他制限事項
      notes: ''                // その他概要・特記事項
    };

    // サイト別の処理
    if (siteType === 'REHOUSE') {
      // ===== 三井のリハウス =====
      return extractRehouseDetailInfo(doc, detailInfo);
    } else if (siteType === 'ATHOME') {
      // ===== アットホーム =====
      return extractAthomeDetailInfo(doc, detailInfo);
    } else if (siteType === 'HOMES') {
      // ===== ホームズ =====
      return extractHomesDetailInfo(doc, detailInfo);
    }

    // ===== SUUMO（既存ロジック） =====
    // 物件名を取得（h1タグから）
    const h1Elements = doc.querySelectorAll('h1, .section_h1-header-title');
    for (const h1 of h1Elements) {
      const text = h1.textContent.trim();
      // 価格や間取りが含まれている場合は除去
      if (text && !text.includes('SUUMOトップ')) {
        // 「物件名 価格（間取り）」形式から物件名部分のみ抽出
        const match = text.match(/^(.+?)\s*[\d億万円]+/);
        if (match) {
          detailInfo.nameDetail = match[1].trim();
        } else {
          detailInfo.nameDetail = text;
        }
        break;
      }
    }

    // 不動産会社名を取得
    const companyPatterns = [
      { selector: 'th', contains: 'お問い合せ先', getValue: (td) => {
        const text = td.textContent.trim();
        const match = text.match(/^([^\n\t]+)/);
        return match ? match[1].trim() : text.split(/[\n\t]/)[0].trim();
      }},
      { selector: 'th', contains: '不動産会社ガイド', getValue: (td) => {
        return td.textContent.trim().split(/[\n\t]/)[0].trim();
      }}
    ];

    for (const pattern of companyPatterns) {
      const ths = doc.querySelectorAll('th');
      for (const th of ths) {
        if (th.textContent.includes(pattern.contains)) {
          const td = th.nextElementSibling;
          if (td && td.tagName === 'TD') {
            detailInfo.company = pattern.getValue(td);
            if (detailInfo.company) break;
          }
        }
      }
      if (detailInfo.company) break;
    }

    // テーブルから情報を抽出（SUUMO詳細ページの構造）
    const tables = doc.querySelectorAll('table');
    for (const table of tables) {
      const rows = table.querySelectorAll('tr');
      for (const row of rows) {
        const ths = row.querySelectorAll('th');

        // 各thについて、次の兄弟要素がtdかチェック
        for (const th of ths) {
          const td = th.nextElementSibling;
          if (!td || td.tagName !== 'TD') continue;

          const thText = th.textContent.trim().replace(/\s+/g, ' ');
          const tdText = td.textContent.trim().replace(/\s+/g, ' ');

          // 「所在階/構造・階建」から情報を分離
          if (thText.includes('所在階') && thText.includes('構造')) {
            // 例: "12階/RC16階地下1階建"
            const floorMatch = tdText.match(/^(\d+階)/);
            if (floorMatch) {
              detailInfo.floor = floorMatch[1];
            }

            const structureMatch = tdText.match(/\/(RC|SRC|鉄骨鉄筋コンクリート|鉄筋コンクリート|鉄骨造|木造|軽量鉄骨)/);
            if (structureMatch) {
              detailInfo.structure = structureMatch[1];
            }

            const buildingFloorsMatch = tdText.match(/(RC|SRC|鉄骨鉄筋コンクリート|鉄筋コンクリート|鉄骨造|木造|軽量鉄骨)(\d+階)/);
            if (buildingFloorsMatch) {
              detailInfo.buildingFloors = buildingFloorsMatch[2];
            }
          } else if (thText.includes('所在階') && !thText.includes('構造')) {
            detailInfo.floor = tdText;
          } else if (thText.includes('バルコニー') && thText.includes('向き')) {
            const match = tdText.match(/([東西南北]+)向き/);
            if (match) detailInfo.direction = match[1] + '向き';
          } else if (thText === '向き' || thText.includes('向き')) {
            const match = tdText.match(/([東西南北]+)向き/);
            if (match) {
              detailInfo.direction = match[1] + '向き';
            } else {
              detailInfo.direction = tdText.split(/\s/)[0]; // 最初の単語のみ
            }
          } else if (thText.includes('建物階数')) {
            detailInfo.buildingFloors = tdText;
          } else if (thText.includes('管理費') && !thText.includes('修繕積立金')) {
            detailInfo.managementFee = tdText.split(/\[/)[0].trim();
            log('管理費取得:', detailInfo.managementFee);
          } else if (thText.includes('修繕積立金')) {
            detailInfo.repairFund = tdText.split(/\[/)[0].trim();
            log('修繕積立金取得:', detailInfo.repairFund);
          } else if (thText.includes('総戸数')) {
            detailInfo.totalUnits = tdText;
          } else if (thText.includes('構造') && !thText.includes('所在階')) {
            detailInfo.structure = tdText;
          } else if (thText.includes('駐車場')) {
            detailInfo.parking = tdText;
          } else if (thText.includes('築年月')) {
            detailInfo.builtDate = tdText.split(/\(/)[0].trim(); // 括弧以降を除去
          } else if (thText.includes('間取り')) {
            detailInfo.layout = tdText;
          } else if (thText.includes('販売戸数')) {
            detailInfo.salesUnits = tdText;
          } else if (thText.includes('その他面積')) {
            detailInfo.balconyArea = tdText;
          } else if (thText.includes('修繕積立基金')) {
            detailInfo.repairFundInitial = tdText.split(/\[/)[0].trim();
          } else if (thText.includes('諸費用')) {
            detailInfo.otherFees = tdText;
          } else if (thText.includes('引渡可能時期')) {
            detailInfo.deliveryTime = tdText;
          } else if (thText.includes('敷地面積')) {
            detailInfo.landArea = tdText;
          } else if (thText.includes('敷地の権利形態')) {
            detailInfo.landRights = tdText;
          } else if (thText.includes('用途地域')) {
            detailInfo.zoning = tdText;
          } else if (thText.includes('施工')) {
            detailInfo.constructor = tdText;
          } else if (thText.includes('エネルギー消費性能')) {
            detailInfo.energyPerformance = tdText;
          } else if (thText.includes('断熱性能')) {
            detailInfo.insulation = tdText;
          } else if (thText.includes('目安光熱費')) {
            detailInfo.utilityEstimate = tdText;
          } else if (thText.includes('リフォーム')) {
            detailInfo.reform = tdText;
          } else if (thText.includes('最多価格帯')) {
            detailInfo.majorPriceRange = tdText;
          } else if (thText.includes('その他制限事項')) {
            detailInfo.restrictions = tdText;
          } else if (thText.includes('その他概要') || thText.includes('特記事項')) {
            detailInfo.notes = tdText;
          }
        }
      }
    }

    log('詳細情報取得成功:', url, detailInfo);
    return detailInfo;

  } catch (error) {
    logError('詳細ページ取得エラー:', url, error);
    return {};
  }
}

/**
 * 三井のリハウス詳細ページから情報を抽出
 * @param {Document} doc - パースされたHTMLドキュメント
 * @param {Object} detailInfo - 情報格納オブジェクト
 * @returns {Object} - 抽出された情報
 */
function extractRehouseDetailInfo(doc, detailInfo) {
  // 物件名を取得（h1タグから）
  const h1Elements = doc.querySelectorAll('h1');
  for (const h1 of h1Elements) {
    const text = h1.textContent.trim();
    if (text && text.length > 0 && text.length < 100) {
      detailInfo.nameDetail = text;
      break;
    }
  }

  // テキストから情報を抽出（より厳密なパターンマッチング）
  const bodyText = doc.body.textContent;

  // 住所を取得: 「所在地」ラベルの直後から取得
  const addressWithLabelMatch = bodyText.match(/所在地\s*(東京都|神奈川県|千葉県|埼玉県|大阪府|京都府|兵庫県|愛知県|福岡県|北海道)[^(\n)]+?(?=\n|GoogleMaps|スーパー|公園|病院|小学校|中学校|その他|駅|価格|交通|管理費|$)/);
  if (addressWithLabelMatch) {
    let address = addressWithLabelMatch[0].replace(/所在地\s*/, '').trim();
    detailInfo.address = address;
  } else {
    // フォールバック: 「所在地」なしで探す
    const addressMatch = bodyText.match(/(東京都|神奈川県|千葉県|埼玉県|大阪府|京都府|兵庫県|愛知県|福岡県|北海道)[^(\n)]+?(?=\n|GoogleMaps|スーパー|公園|病院|小学校|中学校|その他|駅|価格|交通|管理費|$)/);
    if (addressMatch) {
      let address = addressMatch[0].trim();
      // 買いたい、売りたいなどのメニューが含まれている場合は除外
      if (address.includes('買いたい') || address.includes('売りたい') || address.includes('借りたい') || address.includes('の中古マンション')) {
        detailInfo.address = '';
      } else {
        detailInfo.address = address;
      }
    }
  }

  // 階数/階建: より厳密なパターン "32階 / 地上32階"
  const floorMatch = bodyText.match(/(\d+階)\s*[/／]\s*(地上|地下)?(\d+階)/);
  if (floorMatch) {
    detailInfo.floor = floorMatch[1];
    detailInfo.buildingFloors = (floorMatch[2] || '') + floorMatch[3];
  }

  // 向き: より厳密なパターン
  const directionMatch = bodyText.match(/(?:向き\s+|バルコニー.*?)(南東|南西|北東|北西|南|北|東|西)(?:\s|階|$)/);
  if (directionMatch) {
    detailInfo.direction = directionMatch[1];
  }

  // 管理費: 最初の1つのみ取得
  const managementMatch = bodyText.match(/管理費[等]*[^\d万]*?([0-9,]+(?:万[0-9,]*)?円)(?:\s|\/|月|$)/);
  if (managementMatch) {
    detailInfo.managementFee = managementMatch[1];
  }

  // 修繕積立金: 最初の1つのみ取得
  const repairMatch = bodyText.match(/修繕積立金[等]*[^\d万]*?([0-9,]+(?:万[0-9,]*)?円)(?:\s|\/|月|$)/);
  if (repairMatch) {
    detailInfo.repairFund = repairMatch[1];
  }

  // その他費用: より厳密に取得
  const otherFeesMatch = bodyText.match(/その他費用\s*([^\n]{0,100}?円[^\n]{0,50})/);
  if (otherFeesMatch) {
    let fees = otherFeesMatch[1].trim();
    // お支払い目安以降を除去
    const cutIdx = fees.search(/お支払い|取引態様|更新日|物件番号/);
    if (cutIdx > 0) {
      fees = fees.substring(0, cutIdx).trim();
    }
    detailInfo.otherFees = fees;
  }

  // 間取り: 数値+LDKの形式に限定
  const layoutMatch = bodyText.match(/間取り\s*([0-9]+[SLDK]+)(?:\s|専有面積|築年月|階数|\/|$)/);
  if (layoutMatch) {
    detailInfo.layout = layoutMatch[1];
  }

  // バルコニー: 数値+㎡の形式
  const balconyMatch = bodyText.match(/バルコニー\s*([0-9.]+㎡)(?:\s|現況|駐車場|$)/);
  if (balconyMatch) {
    detailInfo.balconyArea = balconyMatch[1];
  }

  // 総戸数: 数値+戸の形式
  const totalUnitsMatch = bodyText.match(/総戸数\s*([0-9,]+戸)(?:\s|管理会社|管理形態|$)/);
  if (totalUnitsMatch) {
    detailInfo.totalUnits = totalUnitsMatch[1];
  }

  // 建物構造: より短いマッチング（造まで）
  const structureMatch = bodyText.match(/建物構造\s*(鉄骨鉄筋コンクリート造|鉄筋コンクリート造|鉄骨造|木造|軽量鉄骨造)(?:\s|総戸数|管理会社|$)/);
  if (structureMatch) {
    detailInfo.structure = structureMatch[1];
  }

  // 駐車場: ハイフンまたは「利用可」「空き無」などの短い情報のみ
  const parkingMatch = bodyText.match(/駐車場\s*(利用可|空き無|無|－|-|[0-9,]+円)(?:\s|建物構造|総戸数|$)/);
  if (parkingMatch) {
    detailInfo.parking = parkingMatch[1].trim();
  }

  // 築年月: YYYY年MM月築の形式
  const builtDateMatch = bodyText.match(/築年月\s*(\d{4}年\d{1,2}月)築?(?:\s|階数|階建|\/|$)/);
  if (builtDateMatch) {
    detailInfo.builtDate = builtDateMatch[1];
  }

  // 土地権利: 所有権などの短い情報
  const landRightsMatch = bodyText.match(/(?:土地権利|敷地の権利形態)\s*(所有権|借地権|定期借地権)(?:\s|分譲会社|施工会社|$)/);
  if (landRightsMatch) {
    detailInfo.landRights = landRightsMatch[1];
  }

  // 施工会社: 会社名（株）まで
  const constructorMatch = bodyText.match(/施工会社\s*([^\n]{3,50}?(?:株式会社|（株）|\(株\)|[^\s]+))(?:\s*設計会社|備考|引渡|取引態様|$)/);
  if (constructorMatch) {
    detailInfo.constructor = constructorMatch[1].trim();
  }

  // 引渡時期: 即時、相談などの短い情報
  const deliveryMatch = bodyText.match(/引渡時期\s*(即時|相談|[0-9]{4}年[0-9]{1,2}月[^\s]{0,10})(?:\s|取引態様|更新日|物件番号|$)/);
  if (deliveryMatch) {
    detailInfo.deliveryTime = deliveryMatch[1].trim();
  }

  console.log(`[REHOUSE坪単価] 詳細情報取得:`, detailInfo);
  return detailInfo;
}

/**
 * アットホーム詳細ページから情報を抽出
 * @param {Document} doc - パースされたHTMLドキュメント
 * @param {Object} detailInfo - 情報格納オブジェクト
 * @returns {Object} - 抽出された情報
 */
function extractAthomeDetailInfo(doc, detailInfo) {
  // 物件名を取得（h1タグから）
  const h1Elements = doc.querySelectorAll('h1');
  for (const h1 of h1Elements) {
    const text = h1.textContent.trim();
    if (text && !text.includes('アットホーム')) {
      detailInfo.nameDetail = text;
      break;
    }
  }

  const bodyText = doc.body.textContent;

  // 住所を取得
  const addressMatch = bodyText.match(/(東京都|神奈川県|千葉県|埼玉県|大阪府|京都府|兵庫県|愛知県|福岡県|北海道|[^\n]*?[都道府県])[^\n]{5,80}?(区|市|町|村)[^\n]{0,50}/);
  if (addressMatch) {
    // 住所部分を抽出して不要な情報を除去
    let address = addressMatch[0].trim();
    // 「階」「築」「専有面積」などが含まれる場合はそこで切る
    const cutIndex = address.search(/[0-9]+階|築[0-9]+年|専有面積|間取り/);
    if (cutIndex > 0) {
      address = address.substring(0, cutIndex).trim();
    }
    detailInfo.address = address;
  }

  // 階建/階: テーブル構造から取得を試みる
  const tables = doc.querySelectorAll('table');
  for (const table of tables) {
    const rows = table.querySelectorAll('tr');
    for (const row of rows) {
      const th = row.querySelector('th');
      const td = row.querySelector('td');
      if (!th || !td) continue;

      const thText = th.textContent.trim();
      const tdText = td.textContent.trim();

      if (thText.includes('所在階')) {
        detailInfo.floor = tdText;
      } else if (thText.includes('階建')) {
        detailInfo.buildingFloors = tdText;
      } else if (thText.includes('間取り')) {
        detailInfo.layout = tdText;
      } else if (thText.includes('バルコニー')) {
        detailInfo.balconyArea = tdText;
      } else if (thText.includes('管理費')) {
        detailInfo.managementFee = tdText.split(/[/／]/)[0].trim();
      } else if (thText.includes('修繕積立金')) {
        detailInfo.repairFund = tdText.split(/[/／]/)[0].trim();
      } else if (thText.includes('建物構造') || thText === '構造') {
        detailInfo.structure = tdText;
      } else if (thText.includes('総戸数')) {
        detailInfo.totalUnits = tdText;
      } else if (thText.includes('駐車場')) {
        if (tdText !== '－' && tdText !== '-') {
          detailInfo.parking = tdText;
        }
      } else if (thText.includes('築年月')) {
        detailInfo.builtDate = tdText.split(/[（(]/)[0].trim();
      } else if (thText.includes('土地権利')) {
        detailInfo.landRights = tdText;
      } else if (thText.includes('引渡')) {
        detailInfo.deliveryTime = tdText;
      } else if (thText.includes('向き')) {
        detailInfo.direction = tdText;
      }
    }
  }

  // テーブルで取得できなかった場合のフォールバック（正規表現）
  if (!detailInfo.layout) {
    const layoutMatch = bodyText.match(/間取り[:\s]*([0-9]+[SLDK]+)/);
    if (layoutMatch) detailInfo.layout = layoutMatch[1];
  }

  if (!detailInfo.builtDate) {
    const builtDateMatch = bodyText.match(/築年月[:\s]*(\d{4}年\d+月)/);
    if (builtDateMatch) detailInfo.builtDate = builtDateMatch[1];
  }

  // 備考から施工会社を抽出
  const constructorMatch = bodyText.match(/施工[会社社][：:\s]*([^\n]+)/);
  if (constructorMatch) {
    detailInfo.constructor = constructorMatch[1].trim();
  }

  // 用途地域
  const zoningMatch = bodyText.match(/用途地域[：:\s]*([^\n]+)/);
  if (zoningMatch) {
    detailInfo.zoning = zoningMatch[1].trim();
  }

  console.log(`[ATHOME坪単価] 詳細情報取得:`, detailInfo);
  return detailInfo;
}

/**
 * ホームズ詳細ページから情報を抽出
 * @param {Document} doc - パースされたHTMLドキュメント
 * @param {Object} detailInfo - 情報格納オブジェクト
 * @returns {Object} - 抽出された情報
 */
function extractHomesDetailInfo(doc, detailInfo) {
  // 物件名を取得（h1タグから）
  const h1Elements = doc.querySelectorAll('h1');
  for (const h1 of h1Elements) {
    const text = h1.textContent.trim();
    if (text && text.length > 0 && text.length < 100) {
      detailInfo.nameDetail = text;
      break;
    }
  }

  const bodyText = doc.body.textContent;

  // data-component属性から情報を取得
  const floorEl = doc.querySelector('[data-component="floor"]');
  if (floorEl) detailInfo.floor = floorEl.textContent.trim();

  const directionEl = doc.querySelector('[data-component="direction"]');
  if (directionEl) detailInfo.direction = directionEl.textContent.trim();

  const buildingFloorsEl = doc.querySelector('[data-component="buildingFloors"]');
  if (buildingFloorsEl) detailInfo.buildingFloors = buildingFloorsEl.textContent.trim();

  // テキストから情報を抽出
  const managementMatch = bodyText.match(/管理費[等]*[^\d万]*?([0-9,]+(?:万[0-9,]*)?円)/);
  if (managementMatch) {
    detailInfo.managementFee = managementMatch[1];
  }

  const repairMatch = bodyText.match(/修繕積立金[等]*[^\d万]*?([0-9,]+(?:万[0-9,]*)?円)/);
  if (repairMatch) {
    detailInfo.repairFund = repairMatch[1];
  }

  const layoutMatch = bodyText.match(/([0-9]+[SLDK]+)/);
  if (layoutMatch) {
    detailInfo.layout = layoutMatch[1];
  }

  const balconyMatch = bodyText.match(/バルコニー[^\d]*([0-9.]+㎡)/);
  if (balconyMatch) {
    detailInfo.balconyArea = balconyMatch[1];
  }

  const totalUnitsMatch = bodyText.match(/総戸数\s*([0-9,]+戸)/);
  if (totalUnitsMatch) {
    detailInfo.totalUnits = totalUnitsMatch[1];
  }

  const structureMatch = bodyText.match(/(RC|SRC|鉄骨鉄筋コンクリート|鉄筋コンクリート|鉄骨造|木造)/);
  if (structureMatch) {
    detailInfo.structure = structureMatch[1];
  }

  const parkingMatch = bodyText.match(/駐車場\s*([^\n]+)/);
  if (parkingMatch) {
    detailInfo.parking = parkingMatch[1].trim();
  }

  const builtDateMatch = bodyText.match(/(\d{4}年\d+月)/);
  if (builtDateMatch) {
    detailInfo.builtDate = builtDateMatch[1];
  }

  console.log(`[HOMES坪単価] 詳細情報取得:`, detailInfo);
  return detailInfo;
}

// ============================================================
// CSVエクスポート機能
// ============================================================

/**
 * 現在表示されている物件データを収集（非同期版）
 * @param {Function} progressCallback - 進捗通知コールバック (current, total)
 * @returns {Array} - 物件データの配列
 */
async function collectPropertyData(progressCallback = null) {
  log('物件データ収集開始');
  const properties = [];

  const propertyCards = getPropertyCards();

  log('収集対象物件数:', propertyCards.length);

  // 各物件からデータを抽出
  propertyCards.forEach((card, index) => {
    try {
      const propertyData = {
        site: SITE_TYPE,
        name: '',
        address: '',
        price: '',
        area: '',
        tsuboPrice: '',
        heiheiPrice: '',
        age: '',
        station: '',
        url: '',
        // 詳細ページから取得する情報
        nameDetail: '',          // 詳細ページの物件名（これで上書き）
        floor: '',
        direction: '',
        buildingFloors: '',
        managementFee: '',
        repairFund: '',
        totalUnits: '',
        structure: '',
        parking: '',
        builtDate: '',
        company: '',             // 不動産会社名
        // 追加項目
        layout: '',              // 間取り
        salesUnits: '',          // 販売戸数
        balconyArea: '',         // バルコニー面積
        repairFundInitial: '',   // 修繕積立基金
        otherFees: '',           // 諸費用
        deliveryTime: '',        // 引渡可能時期
        landArea: '',            // 敷地面積
        landRights: '',          // 敷地の権利形態
        zoning: '',              // 用途地域
        constructor: '',         // 施工会社
        energyPerformance: '',   // エネルギー消費性能
        insulation: '',          // 断熱性能
        utilityEstimate: '',     // 目安光熱費
        reform: '',              // リフォーム
        majorPriceRange: '',     // 最多価格帯
        restrictions: '',        // その他制限事項
        notes: ''                // その他概要・特記事項
      };

      // 価格を抽出
      let priceSelectors = [];
      if (SITE_TYPE === 'REHOUSE') {
        priceSelectors = ['.price-text'];
      } else if (SITE_TYPE === 'ATHOME') {
        priceSelectors = ['.property-price'];
      } else if (SITE_TYPE === 'HOMES') {
        priceSelectors = ['td.price'];
      } else {
        priceSelectors = ['.dottable-value', '.dkr-cassetteitem_price--num', '.cassette_price--num'];
      }

      let priceElement = null;
      for (const selector of priceSelectors) {
        priceElement = card.querySelector(selector);
        if (priceElement) break;
      }

      // ホームズのグルーピング一覧ページの場合
      if (!priceElement && SITE_TYPE === 'HOMES' && card.tagName === 'TR') {
        const verticalTable = card.querySelector('.verticalTable');
        if (verticalTable) {
          const ths = verticalTable.querySelectorAll('th');
          for (const th of ths) {
            if (th.textContent.includes('価格')) {
              priceElement = th.nextElementSibling;
              break;
            }
          }
        }
      }

      if (priceElement) {
        propertyData.price = extractNumber(priceElement.textContent);
      }

      // 面積を抽出
      let areaElement = null;
      if (SITE_TYPE === 'REHOUSE') {
        const elements = card.querySelectorAll('.paragraph-body');
        for (const el of elements) {
          if (el.textContent.includes('㎡') || el.textContent.includes('m2') || el.textContent.includes('m')) {
            areaElement = el;
            break;
          }
        }
      } else if (SITE_TYPE === 'ATHOME') {
        const blocks = card.querySelectorAll('.property-detail-table__block');
        for (const block of blocks) {
          if (block.textContent.includes('専有面積')) {
            const spans = block.querySelectorAll('span');
            for (const span of spans) {
              if (span.textContent.includes('m') || span.textContent.includes('㎡')) {
                areaElement = span;
                break;
              }
            }
            if (areaElement) break;
          }
        }
      } else if (SITE_TYPE === 'HOMES') {
        areaElement = card.querySelector('td.space');
        // グルーピング一覧ページの場合
        if (!areaElement && card.tagName === 'TR') {
          const verticalTable = card.querySelector('.verticalTable');
          if (verticalTable) {
            const ths = verticalTable.querySelectorAll('th');
            for (const th of ths) {
              if (th.textContent.includes('専有面積')) {
                areaElement = th.nextElementSibling;
                break;
              }
            }
          }
        }
      } else {
        const dts = card.querySelectorAll('dt');
        for (const dt of dts) {
          if (dt.textContent.includes('専有面積')) {
            areaElement = dt.nextElementSibling;
            break;
          }
        }
      }

      if (areaElement) {
        propertyData.area = extractNumber(areaElement.textContent);
      }

      // 坪単価・平米単価を計算
      if (propertyData.price && propertyData.area) {
        propertyData.tsuboPrice = calculateTsuboPrice(propertyData.price, propertyData.area);
        propertyData.heiheiPrice = calculateHeiheiPrice(propertyData.price, propertyData.area);
      }

      // 物件名・住所を抽出（サイトごとに異なる）
      if (SITE_TYPE === 'SUUMO') {
        // 新しいSUUMOレイアウト: dl/dt/dd構造から取得
        const dts = card.querySelectorAll('dt');
        for (const dt of dts) {
          const dtText = dt.textContent.trim();
          const dd = dt.nextElementSibling;

          if (dtText.includes('物件名') && dd && dd.tagName === 'DD') {
            propertyData.name = dd.textContent.trim();
          }

          if (dtText.includes('所在地') && dd && dd.tagName === 'DD') {
            propertyData.address = dd.textContent.trim();
          }
        }

        // 旧レイアウトへのフォールバック
        if (!propertyData.name) {
          const titleElement = card.querySelector('.cassetteitem_content-title');
          if (titleElement) {
            propertyData.name = titleElement.textContent.trim();
          }
        }

        if (!propertyData.address) {
          const addressElement = card.querySelector('.cassetteitem_detail-col1');
          if (addressElement) {
            let addressText = addressElement.textContent.trim().replace(/\s+/g, ' ');
            const addressMatch = addressText.match(/^([^\n]+(?:区|市|町|村|郡)[^\n]*?)(?:\s{2,}|\n|築|階|専有)/);
            if (addressMatch) {
              propertyData.address = addressMatch[1].trim();
            } else {
              propertyData.address = addressText.split(/\n/)[0].trim();
            }
          }
        }
      } else if (SITE_TYPE === 'REHOUSE') {
        const titleElement = card.querySelector('.property-card-title, [class*="title"]');
        if (titleElement) {
          propertyData.name = titleElement.textContent.trim();
        }

        // 住所取得: 一覧ページでは詳細ページから取得する方が確実なので、ここではスキップ
        propertyData.address = '';
      } else if (SITE_TYPE === 'ATHOME') {
        // アットホームの物件名は親要素(.card-box-inner)内にある
        const parentCard = card.closest('.card-box-inner');

        // 物件名: .title-wrap__title-text から取得
        const titleElement = parentCard ? parentCard.querySelector('.title-wrap__title-text') : null;
        if (titleElement) {
          propertyData.name = titleElement.textContent.trim();
        } else {
          // フォールバック: 他のセレクタを試す
          const titleSelectors = [
            'h3 a',
            'h2 a',
            '.property-title',
            '.bukken-name',
            '[class*="title"] a'
          ];
          for (const selector of titleSelectors) {
            const fallbackTitle = (parentCard || card).querySelector(selector);
            if (fallbackTitle && fallbackTitle.textContent.trim()) {
              propertyData.name = fallbackTitle.textContent.trim();
              break;
            }
          }
        }

        // 住所: 親要素のテキストから「所在地」の後を取得
        const allText = (parentCard || card).textContent;
        const addressWithLabel = allText.match(/所在地\s*([^\n]+)/);
        if (addressWithLabel) {
          propertyData.address = addressWithLabel[1].trim();
        } else {
          // フォールバック: 都道府県名から始まる住所パターン
          const addressMatch = allText.match(/(東京都|神奈川県|千葉県|埼玉県|大阪府|京都府|兵庫県|愛知県|福岡県|北海道)[^\n]{5,80}?(区|市|町|村)/);
          if (addressMatch) {
            propertyData.address = addressMatch[0].trim();
          }
        }
      } else if (SITE_TYPE === 'HOMES') {
        const titleElement = card.querySelector('.bukkenName, [class*="name"]');
        if (titleElement) {
          propertyData.name = titleElement.textContent.trim();
        }
        const addressElement = card.querySelector('.bukkenAdress, [class*="address"]');
        if (addressElement) {
          propertyData.address = addressElement.textContent.trim();
        }
      }

      // 詳細ページURLを抽出
      if (SITE_TYPE === 'SUUMO') {
        // 新しいSUUMOレイアウト: 親要素からリンクを取得
        const parentDiv = card.closest('.property_unit-body, .ui-media');
        if (parentDiv) {
          const links = parentDiv.querySelectorAll('a[href*="/ms/"], a[href*="/chuko/"]');
          if (links.length > 0) {
            const href = links[0].getAttribute('href');
            if (href) {
              propertyData.url = href.startsWith('http') ? href : new URL(href, window.location.origin).href;
            }
          }
        }

        // 旧レイアウトへのフォールバック
        if (!propertyData.url) {
          const linkSelectors = [
            '.cassetteitem_content-title a',
            'a[href*="/chuko/"]',
            'a[href*="/ms/"]'
          ];
          for (const selector of linkSelectors) {
            const linkElement = card.querySelector(selector);
            if (linkElement) {
              const href = linkElement.getAttribute('href');
              if (href && !href.includes('#') && !href.includes('javascript:')) {
                propertyData.url = href.startsWith('http') ? href : new URL(href, window.location.origin).href;
                break;
              }
            }
          }
        }
      } else if (SITE_TYPE === 'ATHOME') {
        // アットホーム: 親要素から.select-linkを取得
        const parentCard = card.closest('.card-box-inner');
        const linkElement = (parentCard || card).querySelector('.select-link, a[href*="/mansion/"]');
        if (linkElement) {
          const href = linkElement.getAttribute('href');
          if (href && !href.includes('javascript:')) {
            propertyData.url = href.startsWith('http') ? href : new URL(href, window.location.origin).href;
          }
        }
      } else {
        // 他のサイト
        const linkElement = card.querySelector('a[href]');
        if (linkElement) {
          const href = linkElement.getAttribute('href');
          if (href) {
            // 相対パスの場合は絶対パスに変換
            propertyData.url = href.startsWith('http') ? href : new URL(href, window.location.origin).href;
          }
        }
      }

      // 築年数を抽出（可能な場合）
      const allText = card.textContent;
      const builtMatch = allText.match(/築(\d+)年/);
      if (builtMatch) {
        propertyData.age = builtMatch[1] + '年';
      }

      // 駅距離を抽出（可能な場合）
      const stationMatch = allText.match(/徒歩(\d+)分/);
      if (stationMatch) {
        propertyData.station = '徒歩' + stationMatch[1] + '分';
      }

      // 間取りを抽出（可能な場合）
      const layoutMatch = allText.match(/(\d+[SLDK]+)/);
      if (layoutMatch) {
        propertyData.layout = layoutMatch[1];
      }

      properties.push(propertyData);
      log(`物件${index + 1}データ収集:`, propertyData);
    } catch (error) {
      logError(`物件${index + 1}データ収集エラー:`, error);
    }
  });

  log('基本情報収集完了。物件数:', properties.length);

  // 詳細ページから追加情報を取得（全サイト対応）
  if (properties.length > 0) {
    log('詳細ページから追加情報を取得開始...');

    for (let i = 0; i < properties.length; i++) {
      const property = properties[i];

      // 進捗通知
      if (progressCallback) {
        progressCallback(i + 1, properties.length);
      }

      if (property.url) {
        log(`${i + 1}/${properties.length} 詳細ページ取得: ${property.url}`);

        // 詳細情報を取得（サイトタイプを渡す）
        const detailInfo = await fetchDetailPageInfo(property.url, SITE_TYPE);

        // 一覧ページで既に取得した情報を保持
        const existingAddress = property.address;

        // プロパティにマージ
        Object.assign(property, detailInfo);

        // 詳細ページの物件名で上書き
        if (detailInfo.nameDetail) {
          property.name = detailInfo.nameDetail;
        }

        // 住所: 一覧ページで取得できていて詳細ページで取得できなかった場合は一覧ページの住所を維持
        if (existingAddress && !detailInfo.address) {
          property.address = existingAddress;
        }

        // サーバー負荷軽減: 各リクエスト間に2秒待機
        if (i < properties.length - 1) {
          await sleep(2000);

          // 5件ごとに長めの待機（3秒）
          if ((i + 1) % 5 === 0) {
            log('5件処理完了。追加で1秒待機...');
            await sleep(1000);
          }
        }
      }
    }

    log('詳細情報取得完了');
  }

  log('全データ収集完了。物件数:', properties.length);
  return properties;
}

/**
 * CSV文字列を生成
 * @param {Array} properties - 物件データの配列
 * @returns {string} - CSV文字列
 */
function generateCSV(properties) {
  if (properties.length === 0) {
    return '';
  }

  // 英語キーから日本語ヘッダーへのマッピング
  const headerMap = {
    site: 'サイト',
    name: '物件名',
    address: '住所',
    price: '価格(万円)',
    area: '専有面積(㎡)',
    tsuboPrice: '坪単価(万円/坪)',
    heiheiPrice: '平米単価(万円/㎡)',
    age: '築年数',
    station: '駅距離',
    floor: '階数',
    direction: '向き',
    buildingFloors: '建物階数',
    managementFee: '管理費',
    repairFund: '修繕積立金',
    totalUnits: '総戸数',
    structure: '構造',
    parking: '駐車場',
    builtDate: '築年月',
    company: '不動産会社',
    url: 'URL',
    // 追加項目
    layout: '間取り',
    salesUnits: '販売戸数',
    balconyArea: 'バルコニー面積',
    repairFundInitial: '修繕積立基金',
    otherFees: '諸費用',
    deliveryTime: '引渡可能時期',
    landArea: '敷地面積',
    landRights: '敷地の権利形態',
    zoning: '用途地域',
    constructor: '施工会社',
    energyPerformance: 'エネルギー消費性能',
    insulation: '断熱性能',
    utilityEstimate: '目安光熱費',
    reform: 'リフォーム',
    majorPriceRange: '最多価格帯',
    restrictions: 'その他制限事項',
    notes: 'その他概要・特記事項'
  };

  // nameDetailは内部使用のみなので除外
  const headers = Object.keys(properties[0]).filter(key => key !== 'nameDetail');
  const csvRows = [];

  // 日本語ヘッダー行を追加
  const japaneseHeaders = headers.map(h => headerMap[h] || h);
  csvRows.push(japaneseHeaders.join(','));

  // データ行を追加
  for (const property of properties) {
    const values = headers.map(header => {
      let value = property[header];
      if (value === null || value === undefined) {
        value = '';
      }
      // 文字列に変換
      value = String(value);
      // カンマ、改行、ダブルクォートを含む場合はダブルクォートで囲む
      if (value.includes(',') || value.includes('\n') || value.includes('"')) {
        value = '"' + value.replace(/"/g, '""') + '"';
      }
      return value;
    });
    csvRows.push(values.join(','));
  }

  return csvRows.join('\n');
}

/**
 * CSVファイルをダウンロード
 * @param {string} csvContent - CSV文字列
 */
function downloadCSV(csvContent) {
  // BOM付きUTF-8（Excel対応）
  const bom = '\uFEFF';
  const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });

  // ファイル名生成（日時付き）
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '');
  const filename = `物件一覧_${SITE_TYPE}_${dateStr}_${timeStr}.csv`;

  // ダウンロード実行
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // メモリ解放
  URL.revokeObjectURL(link.href);

  log('CSVダウンロード完了:', filename);
}

/**
 * エクスポートボタンを作成
 */
function createExportButton() {
  // 既存のボタンがあれば削除
  const existing = document.getElementById('fudosan-csv-export-button');
  if (existing) {
    existing.remove();
  }

  // ボタン作成
  const button = document.createElement('button');
  button.id = 'fudosan-csv-export-button';
  button.className = 'fudosan-csv-export-button';
  button.innerHTML = '📊 CSVエクスポート (β版)';
  button.title = '【ベータ版機能】現在のページの物件データをCSV形式でダウンロード\n・無料提供中ですが、将来的に有料化する可能性があります';

  // クリックイベント（非同期対応）
  button.addEventListener('click', async () => {
    // 初回使用時のベータ版確認
    const hasSeenBetaNotice = localStorage.getItem('csvBetaNoticeShown');
    if (!hasSeenBetaNotice) {
      const confirmed = confirm(
        '📊 CSVエクスポート（ベータ版）\n\n' +
        '現在無料で提供中ですが、以下の点にご留意ください：\n\n' +
        '✓ ベータ版のため、仕様が変更される可能性があります\n' +
        '✓ 将来的に有料化する可能性があります\n\n' +
        'ご了承いただける場合は「OK」を押してください。'
      );

      if (!confirmed) {
        return; // キャンセルされた場合は処理を中断
      }

      localStorage.setItem('csvBetaNoticeShown', 'true');
    }

    log('CSVエクスポート開始');
    button.disabled = true;
    button.innerHTML = '⏳ エクスポート中...';

    // プログレスバーを作成・挿入
    const progressContainer = document.createElement('div');
    progressContainer.className = 'fudosan-export-progress';
    progressContainer.innerHTML = `
      <div class="fudosan-export-progress-track">
        <div class="fudosan-export-progress-bar" style="width: 0%"></div>
      </div>
      <div class="fudosan-export-progress-text">準備中...</div>
    `;
    button.parentElement.insertBefore(progressContainer, button.nextSibling);

    try {
      // 進捗表示コールバック
      const progressCallback = (current, total) => {
        const percent = Math.round((current / total) * 100);
        const bar = progressContainer.querySelector('.fudosan-export-progress-bar');
        const text = progressContainer.querySelector('.fudosan-export-progress-text');
        if (bar) bar.style.width = `${percent}%`;
        if (text) text.textContent = `詳細取得中 ${current}/${total}`;
      };

      const properties = await collectPropertyData(progressCallback);
      if (properties.length === 0) {
        alert('エクスポート可能な物件データが見つかりませんでした。');
        button.innerHTML = '📊 CSVエクスポート (β版)';
        button.disabled = false;
        progressContainer.remove();
        return;
      }

      // CSV生成中の表示
      const bar = progressContainer.querySelector('.fudosan-export-progress-bar');
      const text = progressContainer.querySelector('.fudosan-export-progress-text');
      if (bar) bar.style.width = '100%';
      if (text) text.textContent = 'CSV生成中...';

      const csvContent = generateCSV(properties);
      downloadCSV(csvContent);

      // 完了表示
      progressContainer.remove();
      button.innerHTML = '✅ 完了！';
      setTimeout(() => {
        button.innerHTML = '📊 CSVエクスポート (β版)';
        button.disabled = false;
      }, 2000);
    } catch (error) {
      logError('CSVエクスポートエラー:', error);
      alert('CSVエクスポート中にエラーが発生しました。コンソールを確認してください。');
      progressContainer.remove();
      button.innerHTML = '❌ エラー';
      setTimeout(() => {
        button.innerHTML = '📊 CSVエクスポート (β版)';
        button.disabled = false;
      }, 2000);
    }
  });

  // ボタンをページに追加
  document.body.appendChild(button);
  log('エクスポートボタンを追加しました');
}

// ============================================================
// 初期化
// ============================================================

/**
 * 初期化処理
 */
async function init() {
  log('拡張機能が起動しました');
  log('URL:', window.location.href);

  try {
    await loadLoanSettings();
    await loadHighlightSettings();
    await loadFavoriteUrls();
    log('設定・お気に入りデータ読み込み完了:', favoriteUrls.size, '件');
  } catch (error) {
    logError('初期データ読み込みエラー:', error);
  }

  // ページ読み込み時に処理
  processAllProperties();

  // DOM変更を監視（無限スクロール対応）
  observeDOMChanges();

  // エクスポートボタンを追加（一覧ページのみ）
  // エラーが起きても他の機能に影響しないようにtry-catchで囲む
  try {
    const propertyCards = getPropertyCards();

    if (propertyCards.length > 0) {
      log('一覧ページと判定、エクスポートボタンを追加');
      createHighlightPanel();
      createExportButton();
    }
  } catch (error) {
    logError('エクスポートボタン追加エラー:', error);
  }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;

  if (changes.favorites) {
    const favorites = changes.favorites.newValue || [];
    favoriteUrls = new Set(favorites.map(f => f.url));
    favoriteDataByUrl = new Map(favorites.map(f => [f.url, f]));
  }

  if (changes.loanSettings) {
    currentLoanSettings = normalizeLoanSettings(changes.loanSettings.newValue);
    if (Date.now() - lastLoanSettingsSaveAt > 500) {
      processAllProperties();
    }
  }

  if (changes.highlightSettings) {
    currentHighlightSettings = normalizeHighlightSettings(changes.highlightSettings.newValue);
    processAllProperties();
  }
});

// DOMContentLoaded後に初期化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
