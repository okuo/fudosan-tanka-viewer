/**
 * 不動産坪単価・平米単価表示 Chrome拡張
 * SUUMO、三井のリハウスの物件の価格と面積から坪単価・平米単価を自動計算して表示
 */

// 既に処理済みの要素を追跡するためのSet
const processedElements = new Set();

// 計算結果をキャッシュするためのMap（価格_面積 -> {tsuboPrice, heiheiPrice}）
const calculationCache = new Map();

// 現在のサイトを判定
const SITE_TYPE = window.location.hostname.includes('rehouse.co.jp') ? 'REHOUSE' : 'SUUMO';

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
 * 物件カード/詳細ページから価格と面積を取得して単価を表示
 * @param {Element} element - 物件要素
 */
function processProperty(element) {
  // 既に処理済みの場合はスキップ
  if (processedElements.has(element)) {
    return;
  }

  console.log(`[${SITE_TYPE}坪単価] 物件を処理中:`, element);

  // 価格要素を検索（サイトごとのパターンに対応）
  let priceSelectors = [];
  if (SITE_TYPE === 'REHOUSE') {
    priceSelectors = [
      '.price-text',                             // 三井のリハウス一覧ページ
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
      console.log(`[${SITE_TYPE}坪単価] 価格要素発見:`, selector, priceElement);
      break;
    }
  }

  // テーブル行の場合：<th>価格</th><td>値</td> のパターン
  if (!priceElement && element.tagName === 'TR') {
    const th = element.querySelector('th');
    const td = element.querySelector('td');
    if (th && th.textContent.includes('価格') && td) {
      priceElement = td;
      console.log(`[${SITE_TYPE}坪単価] 価格要素発見: テーブル行のtd`, priceElement);
    }
  }

  if (!priceElement) {
    console.log(`[${SITE_TYPE}坪単価] 価格要素が見つかりませんでした`);
    return;
  }

  // 面積要素を検索（サイトごとのパターンに対応）
  let areaSelectors = [];
  if (SITE_TYPE === 'REHOUSE') {
    areaSelectors = [
      '.paragraph-body',                         // 三井のリハウス一覧ページ（面積を含む段落）
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
          console.log(`[${SITE_TYPE}坪単価] 面積要素発見:`, selector, areaElement);
          break;
        }
      }
      if (areaElement) break;
    } else {
      areaElement = element.querySelector(selector);
      if (areaElement) {
        console.log(`[${SITE_TYPE}坪単価] 面積要素発見:`, selector, areaElement);
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
          console.log(`[${SITE_TYPE}坪単価] 面積要素発見: <dt>専有面積</dt>の次のdd`, areaElement);
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
          console.log(`[${SITE_TYPE}坪単価] 面積要素発見: 専有面積を含むspan`, areaElement);
          break;
        }
      }
    }
  }

  // テーブル行の場合：同じテーブル内の専有面積行を探す
  if (!areaElement && element.tagName === 'TR') {
    const table = element.closest('table');
    if (table) {
      const rows = table.querySelectorAll('tr');
      for (const row of rows) {
        const th = row.querySelector('th');
        const td = row.querySelector('td');
        if (th && th.textContent.includes('専有面積') && td) {
          areaElement = td;
          console.log(`[${SITE_TYPE}坪単価] 面積要素発見: テーブル行のtd`, areaElement);
          break;
        }
      }
    }
  }

  // 価格と面積を抽出
  const priceText = priceElement.textContent;
  const areaText = areaElement ? areaElement.textContent : null;

  console.log(`[${SITE_TYPE}坪単価] 価格テキスト:`, priceText);
  console.log(`[${SITE_TYPE}坪単価] 面積テキスト:`, areaText);

  const price = extractNumber(priceText);
  const area = extractNumber(areaText);

  console.log(`[${SITE_TYPE}坪単価] 価格:`, price, '万円');
  console.log(`[${SITE_TYPE}坪単価] 面積:`, area, '㎡');

  // 単価表示要素を作成
  const unitPriceDiv = document.createElement('div');

  // テーブル内の場合はコンパクトなスタイルを適用
  const isInTable = priceElement.closest('table') !== null;
  if (isInTable) {
    unitPriceDiv.className = 'suumo-unit-price suumo-unit-price--compact';
  } else {
    unitPriceDiv.className = 'suumo-unit-price';
  }

  if (price && area && price > 0 && area > 0) {
    // キャッシュキーを生成
    const cacheKey = `${price}_${area}`;

    // キャッシュから取得、なければ計算
    let tsuboPrice, heiheiPrice;
    if (calculationCache.has(cacheKey)) {
      const cached = calculationCache.get(cacheKey);
      tsuboPrice = cached.tsuboPrice;
      heiheiPrice = cached.heiheiPrice;
      console.log(`[${SITE_TYPE}坪単価] キャッシュから取得 - 坪単価:`, tsuboPrice, '万円/坪, 平米単価:', heiheiPrice, '万円/㎡');
    } else {
      tsuboPrice = calculateTsuboPrice(price, area);
      heiheiPrice = calculateHeiheiPrice(price, area);
      calculationCache.set(cacheKey, { tsuboPrice, heiheiPrice });
      console.log(`[${SITE_TYPE}坪単価] 計算結果 - 坪単価:`, tsuboPrice, '万円/坪, 平米単価:', heiheiPrice, '万円/㎡');
    }

    unitPriceDiv.innerHTML = `
      <span class="unit-price-label">坪単価:</span>
      <span class="unit-price-value">${tsuboPrice.toLocaleString()}万円</span>
      <span class="unit-price-separator">|</span>
      <span class="unit-price-label">平米単価:</span>
      <span class="unit-price-value">${heiheiPrice.toLocaleString()}万円</span>
    `;
  } else {
    console.log(`[${SITE_TYPE}坪単価] 計算不可 - 価格または面積が不正`);
    unitPriceDiv.innerHTML = `
      <span class="unit-price-label">坪単価:</span>
      <span class="unit-price-na">計算不可</span>
      <span class="unit-price-separator">|</span>
      <span class="unit-price-label">平米単価:</span>
      <span class="unit-price-na">計算不可</span>
    `;
  }

  // 既存の単価表示があれば削除
  const existingInParent = priceElement.parentElement?.querySelector('.suumo-unit-price');
  if (existingInParent) {
    existingInParent.remove();
  }
  const existingInElement = priceElement.querySelector('.suumo-unit-price');
  if (existingInElement) {
    existingInElement.remove();
  }

  // テーブル内の場合は価格要素（td）の中に追加
  if (isInTable) {
    priceElement.appendChild(unitPriceDiv);
    console.log(`[${SITE_TYPE}坪単価] 単価表示をテーブル内に挿入しました`);
  } else {
    // 通常の場合は価格要素の後に挿入
    const priceParent = priceElement.parentElement;
    if (priceParent) {
      if (priceElement.nextSibling) {
        priceParent.insertBefore(unitPriceDiv, priceElement.nextSibling);
      } else {
        priceParent.appendChild(unitPriceDiv);
      }
      console.log(`[${SITE_TYPE}坪単価] 単価表示を挿入しました`);
    } else {
      console.log(`[${SITE_TYPE}坪単価] 価格要素の親要素が見つかりません`);
      return;
    }
  }

  // 処理済みとしてマーク
  processedElements.add(element);
}

/**
 * ページ内のすべての物件を処理
 */
function processAllProperties() {
  console.log(`[${SITE_TYPE}坪単価] processAllProperties開始`);

  // 物件カード（一覧ページ）をサイトごとに検索
  let propertyCards = [];
  if (SITE_TYPE === 'REHOUSE') {
    propertyCards = document.querySelectorAll('.property-index-card');
  } else {
    propertyCards = document.querySelectorAll('.cassetteitem, .dottable--cassette, [class*="cassette"]');
  }

  console.log(`[${SITE_TYPE}坪単価] 物件カード数:`, propertyCards.length);
  propertyCards.forEach(card => {
    processProperty(card);
  });

  // 詳細ページ: 物件カードがない場合
  if (propertyCards.length === 0) {
    console.log(`[${SITE_TYPE}坪単価] 詳細ページとして処理`);
    console.log(`[${SITE_TYPE}坪単価] URL:`, window.location.href);

    // 物件概要テーブルから価格と面積を取得
    let detailPrice = null;
    let detailArea = null;
    let priceElement = null;

    if (SITE_TYPE === 'REHOUSE') {
      // 三井のリハウス詳細ページ
      // 価格要素を取得
      priceElement = document.querySelector('.text-price-regular.price-size') ||
                     document.querySelector('.building-price-info');

      // 面積要素を取得
      const areaElement = document.querySelector('.building-info');

      if (priceElement && areaElement) {
        detailPrice = extractNumber(priceElement.textContent);
        detailArea = extractNumber(areaElement.textContent);
        console.log(`[${SITE_TYPE}坪単価] 詳細ページから取得 - 価格:`, detailPrice, '万円, 面積:', detailArea, '㎡');
      }
    } else {
      // SUUMO詳細ページ（テーブル形式）
      const tables = document.querySelectorAll('table');
      console.log(`[${SITE_TYPE}坪単価] テーブル数:`, tables.length);

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
            console.log(`[${SITE_TYPE}坪単価] 物件概要から取得 - 価格:`, detailPrice, '万円, 面積:', detailArea, '㎡');
            break;
          }
        }
      }
    }

    // 価格と面積が取得できた場合、各箇所に表示
    if (detailPrice && detailArea && detailPrice > 0 && detailArea > 0) {
      const cacheKey = `${detailPrice}_${detailArea}`;

      let tsuboPrice, heiheiPrice;
      if (calculationCache.has(cacheKey)) {
        const cached = calculationCache.get(cacheKey);
        tsuboPrice = cached.tsuboPrice;
        heiheiPrice = cached.heiheiPrice;
        console.log(`[${SITE_TYPE}坪単価] キャッシュから取得`);
      } else {
        tsuboPrice = calculateTsuboPrice(detailPrice, detailArea);
        heiheiPrice = calculateHeiheiPrice(detailPrice, detailArea);
        calculationCache.set(cacheKey, { tsuboPrice, heiheiPrice });
        console.log(`[${SITE_TYPE}坪単価] 計算完了 - 坪単価:`, tsuboPrice, '万円/坪, 平米単価:', heiheiPrice, '万円/㎡');
      }

      // 上部の価格表示の下に追加
      if (SITE_TYPE === 'SUUMO') {
        const topPriceElement = document.querySelector('.mt7.b');
        if (topPriceElement && topPriceElement.parentElement) {
          const existing = topPriceElement.parentElement.querySelector('.suumo-unit-price');
          if (existing) existing.remove();

          const unitPriceDiv = document.createElement('div');
          unitPriceDiv.className = 'suumo-unit-price';
          unitPriceDiv.innerHTML = `
            <span class="unit-price-label">坪単価:</span>
            <span class="unit-price-value">${tsuboPrice.toLocaleString()}万円</span>
            <span class="unit-price-separator">|</span>
            <span class="unit-price-label">平米単価:</span>
            <span class="unit-price-value">${heiheiPrice.toLocaleString()}万円</span>
          `;

          if (topPriceElement.nextSibling) {
            topPriceElement.parentElement.insertBefore(unitPriceDiv, topPriceElement.nextSibling);
          } else {
            topPriceElement.parentElement.appendChild(unitPriceDiv);
          }
          console.log(`[${SITE_TYPE}坪単価] 上部に表示を挿入`);
        }
      } else if (SITE_TYPE === 'REHOUSE' && priceElement) {
        // 三井のリハウス詳細ページ：価格表示の下に追加
        const existing = priceElement.parentElement?.querySelector('.suumo-unit-price');
        if (existing) existing.remove();

        const unitPriceDiv = document.createElement('div');
        unitPriceDiv.className = 'suumo-unit-price';
        unitPriceDiv.innerHTML = `
          <span class="unit-price-label">坪単価:</span>
          <span class="unit-price-value">${tsuboPrice.toLocaleString()}万円</span>
          <span class="unit-price-separator">|</span>
          <span class="unit-price-label">平米単価:</span>
          <span class="unit-price-value">${heiheiPrice.toLocaleString()}万円</span>
        `;

        if (priceElement.nextSibling) {
          priceElement.parentElement.insertBefore(unitPriceDiv, priceElement.nextSibling);
        } else {
          priceElement.parentElement.appendChild(unitPriceDiv);
        }
        console.log(`[${SITE_TYPE}坪単価] 価格表示の下に表示を挿入`);
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
              const existing = td.querySelector('.suumo-unit-price');
              if (existing) existing.remove();

              const unitPriceDiv = document.createElement('div');
              unitPriceDiv.className = 'suumo-unit-price suumo-unit-price--compact';
              unitPriceDiv.innerHTML = `
                <span class="unit-price-label">坪単価:</span>
                <span class="unit-price-value">${tsuboPrice.toLocaleString()}万円</span>
                <span class="unit-price-separator">|</span>
                <span class="unit-price-label">平米単価:</span>
                <span class="unit-price-value">${heiheiPrice.toLocaleString()}万円</span>
              `;
              td.appendChild(unitPriceDiv);
              console.log(`[${SITE_TYPE}坪単価] テーブル内に表示を挿入 table:`, tableIdx, 'row:', rowIdx);
            }
          });
        });
      }
    } else {
      console.log(`[${SITE_TYPE}坪単価] 詳細ページで価格・面積が取得できませんでした`);
    }

    console.log(`[${SITE_TYPE}坪単価] 詳細ページ処理完了。単価表示数:`, document.querySelectorAll('.suumo-unit-price').length);
  } else {
    console.log(`[${SITE_TYPE}坪単価] 一覧ページとして処理 cards:`, propertyCards.length);
  }
}

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
          // 自分が追加した.suumo-unit-price要素は無視
          if (node.nodeType === 1 && !node.classList?.contains('suumo-unit-price')) {
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

/**
 * 初期化処理
 */
function init() {
  console.log(`[${SITE_TYPE}坪単価] 拡張機能が起動しました`);
  console.log(`[${SITE_TYPE}坪単価] URL:`, window.location.href);

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
