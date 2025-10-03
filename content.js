/**
 * SUUMO 坪単価・平米単価表示 Chrome拡張
 * 物件の価格と面積から坪単価・平米単価を自動計算して表示
 */

// 既に処理済みの要素を追跡するためのSet
const processedElements = new Set();

/**
 * 文字列から数値を抽出（カンマ区切りに対応）
 * @param {string} text - 抽出元の文字列
 * @returns {number|null} - 抽出された数値、失敗時はnull
 */
function extractNumber(text) {
  if (!text) return null;
  // カンマを削除して数値のみ抽出
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
 * 物件カード/詳細ページから価格と面積を取得して単価を表示
 * @param {Element} element - 物件要素
 */
function processProperty(element) {
  // 既に処理済みの場合はスキップ
  if (processedElements.has(element)) {
    return;
  }

  // 価格要素を検索（複数のパターンに対応）
  const priceSelectors = [
    '.dkr-cassetteitem_price--num',           // 一覧ページ
    '.cassette_price--num',                    // 一覧ページ（旧）
    '.property_view_note-emphasis',            // 詳細ページ
    '.detailbox_property_price_txt',           // 詳細ページ（別パターン）
    '[class*="price"]',                         // 汎用パターン
  ];

  let priceElement = null;
  for (const selector of priceSelectors) {
    priceElement = element.querySelector(selector);
    if (priceElement) break;
  }

  if (!priceElement) {
    return;
  }

  // 面積要素を検索
  const areaSelectors = [
    '.dkr-cassetteitem_detail_text--area',    // 一覧ページ
    '.cassette_detail_text--area',             // 一覧ページ（旧）
    '[class*="area"]',                          // 汎用パターン
  ];

  let areaElement = null;
  for (const selector of areaSelectors) {
    areaElement = element.querySelector(selector);
    if (areaElement) break;
  }

  // 価格と面積を抽出
  const priceText = priceElement.textContent;
  const areaText = areaElement ? areaElement.textContent : null;

  const price = extractNumber(priceText);
  const area = extractNumber(areaText);

  // 単価表示要素を作成
  const unitPriceDiv = document.createElement('div');
  unitPriceDiv.className = 'suumo-unit-price';

  if (price && area && price > 0 && area > 0) {
    const tsuboPrice = calculateTsuboPrice(price, area);
    const heiheiPrice = calculateHeiheiPrice(price, area);

    unitPriceDiv.innerHTML = `
      <span class="unit-price-label">坪単価:</span>
      <span class="unit-price-value">${tsuboPrice.toLocaleString()}万円/坪</span>
      <span class="unit-price-separator">|</span>
      <span class="unit-price-label">平米単価:</span>
      <span class="unit-price-value">${heiheiPrice.toLocaleString()}万円/㎡</span>
    `;
  } else {
    unitPriceDiv.innerHTML = `
      <span class="unit-price-label">坪単価:</span>
      <span class="unit-price-na">計算不可</span>
      <span class="unit-price-separator">|</span>
      <span class="unit-price-label">平米単価:</span>
      <span class="unit-price-na">計算不可</span>
    `;
  }

  // 価格要素の直下に挿入
  const priceParent = priceElement.parentElement;
  if (priceParent) {
    // 既存の単価表示があれば削除
    const existing = priceParent.querySelector('.suumo-unit-price');
    if (existing) {
      existing.remove();
    }

    // 価格要素の後に挿入
    if (priceElement.nextSibling) {
      priceParent.insertBefore(unitPriceDiv, priceElement.nextSibling);
    } else {
      priceParent.appendChild(unitPriceDiv);
    }

    // 処理済みとしてマーク
    processedElements.add(element);
  }
}

/**
 * ページ内のすべての物件を処理
 */
function processAllProperties() {
  // 物件カード（一覧ページ）
  const propertyCards = document.querySelectorAll('.cassetteitem, [class*="cassette"]');
  propertyCards.forEach(card => {
    processProperty(card);
  });

  // 物件詳細（詳細ページ）
  const propertyDetails = document.querySelectorAll('.detailbox, [class*="detail"]');
  propertyDetails.forEach(detail => {
    processProperty(detail);
  });
}

/**
 * DOM変更を監視して新しい物件が追加されたら処理
 */
function observeDOMChanges() {
  const observer = new MutationObserver((mutations) => {
    // 新しいノードが追加されたかチェック
    let shouldProcess = false;

    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        shouldProcess = true;
        break;
      }
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

/**
 * 初期化処理
 */
function init() {
  // ページ読み込み時に処理
  processAllProperties();

  // DOM変更を監視（無限スクロール対応）
  observeDOMChanges();
}

// DOMContentLoaded後に初期化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
