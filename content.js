/**
 * 不動産坪単価・平米単価表示 Chrome拡張
 * SUUMO、三井のリハウスの物件の価格と面積から坪単価・平米単価を自動計算して表示
 */

// 既に処理済みの要素を追跡するためのSet
const processedElements = new Set();

// 計算結果をキャッシュするためのMap（価格_面積 -> {tsuboPrice, heiheiPrice}）
const calculationCache = new Map();

// 現在のサイトを判定
const SITE_TYPE = window.location.hostname.includes('rehouse.co.jp')
  ? 'REHOUSE'
  : window.location.hostname.includes('athome.co.jp')
    ? 'ATHOME'
    : window.location.hostname.includes('homes.co.jp')
      ? 'HOMES'
      : 'SUUMO';

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
      console.log(`[${SITE_TYPE}坪単価] 価格要素発見:`, selector, priceElement);
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
            console.log(`[${SITE_TYPE}坪単価] 価格要素発見: verticalTable内のtd`, priceElement);
            break;
          }
        }
      }
    } else {
      const th = element.querySelector('th');
      const td = element.querySelector('td');
      if (th && th.textContent.includes('価格') && td) {
        priceElement = td;
        console.log(`[${SITE_TYPE}坪単価] 価格要素発見: テーブル行のtd`, priceElement);
      }
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
          console.log(`[${SITE_TYPE}坪単価] 面積要素発見:`, selector, areaElement);
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
              console.log(`[${SITE_TYPE}坪単価] 面積要素発見:`, selector, areaElement);
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
    // ホームズのグルーピング一覧ページの場合: verticalTable構造
    const verticalTable = element.querySelector('.verticalTable');
    if (verticalTable && SITE_TYPE === 'HOMES') {
      const ths = verticalTable.querySelectorAll('th');
      for (const th of ths) {
        if (th.textContent.includes('専有面積')) {
          const td = th.nextElementSibling;
          if (td && td.tagName === 'TD') {
            areaElement = td;
            console.log(`[${SITE_TYPE}坪単価] 面積要素発見: verticalTable内のtd`, areaElement);
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
            console.log(`[${SITE_TYPE}坪単価] 面積要素発見: テーブル行のtd`, areaElement);
            break;
          }
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
  } else if (SITE_TYPE === 'ATHOME') {
    propertyCards = document.querySelectorAll('.card-box-inner__detail');
  } else if (SITE_TYPE === 'HOMES') {
    // ホームズ: 通常の一覧ページ - td.priceとtd.spaceの両方を持つtableを物件カードとして扱う
    const allTables = document.querySelectorAll('.bukkenSpec table');
    const standardCards = Array.from(allTables).filter(table =>
      table.querySelector('td.price') && table.querySelector('td.space')
    );

    // ホームズ: グルーピング一覧ページ - .unitSummary内のtr要素を物件カードとして扱う
    const groupedCards = document.querySelectorAll('.unitSummary tbody tr');

    propertyCards = [...standardCards, ...groupedCards];
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
    } else if (SITE_TYPE === 'HOMES') {
      // ホームズ詳細ページ
      // 価格要素を取得
      priceElement = document.querySelector('[data-component="price"]');

      // 面積要素を取得
      const areaElement = document.querySelector('[data-component="occupiedArea"]');

      if (priceElement && areaElement) {
        detailPrice = extractNumber(priceElement.textContent);
        detailArea = extractNumber(areaElement.textContent);
        console.log(`[${SITE_TYPE}坪単価] 詳細ページから取得 - 価格:`, detailPrice, '万円, 面積:', detailArea, '㎡');
      }
    } else if (SITE_TYPE === 'ATHOME') {
      // アットホーム詳細ページ
      // 価格要素を取得
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
      } else if (SITE_TYPE === 'HOMES' && priceElement) {
        // ホームズ詳細ページ：価格表示の下に追加
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
      } else if (SITE_TYPE === 'ATHOME' && priceElement) {
        // アットホーム詳細ページ：価格表示の下に追加
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
 * 指定ミリ秒待機する
 * @param {number} ms - 待機時間（ミリ秒）
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 詳細ページから追加情報を取得
 * @param {string} url - 詳細ページURL
 * @returns {Object} - 追加情報
 */
async function fetchDetailPageInfo(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`[${SITE_TYPE}坪単価] 詳細ページ取得失敗: ${url}`);
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
        // 「野村の仲介+勝どきセンター野村不動産ソリューションズ(株)」から会社名部分を抽出
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
          } else if (thText.includes('管理費') && !thText.includes('修繕')) {
            // 「2万5000円／月（委託(通勤)）」などから抽出
            detailInfo.managementFee = tdText.split(/\[/)[0].trim();
            console.log(`[${SITE_TYPE}坪単価] 管理費取得: ${detailInfo.managementFee}`);
          } else if (thText.includes('修繕積立金')) {
            detailInfo.repairFund = tdText.split(/\[/)[0].trim();
            console.log(`[${SITE_TYPE}坪単価] 修繕積立金取得: ${detailInfo.repairFund}`);
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

    console.log(`[${SITE_TYPE}坪単価] 詳細情報取得成功: ${url}`, detailInfo);
    return detailInfo;

  } catch (error) {
    console.error(`[${SITE_TYPE}坪単価] 詳細ページ取得エラー: ${url}`, error);
    return {};
  }
}

/**
 * 現在表示されている物件データを収集（非同期版）
 * @param {Function} progressCallback - 進捗通知コールバック
 * @returns {Array} - 物件データの配列
 */
async function collectPropertyData(progressCallback = null) {
  console.log(`[${SITE_TYPE}坪単価] 物件データ収集開始`);
  const properties = [];

  // 物件カード（一覧ページ）をサイトごとに検索
  let propertyCards = [];
  if (SITE_TYPE === 'REHOUSE') {
    propertyCards = document.querySelectorAll('.property-index-card');
  } else if (SITE_TYPE === 'ATHOME') {
    propertyCards = document.querySelectorAll('.card-box-inner__detail');
  } else if (SITE_TYPE === 'HOMES') {
    const allTables = document.querySelectorAll('.bukkenSpec table');
    const standardCards = Array.from(allTables).filter(table =>
      table.querySelector('td.price') && table.querySelector('td.space')
    );
    const groupedCards = document.querySelectorAll('.unitSummary tbody tr');
    propertyCards = [...standardCards, ...groupedCards];
  } else {
    propertyCards = document.querySelectorAll('.cassetteitem, .dottable--cassette, [class*="cassette"]');
  }

  console.log(`[${SITE_TYPE}坪単価] 収集対象物件数:`, propertyCards.length);

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
        const addressElements = card.querySelectorAll('.paragraph-body');
        for (const el of addressElements) {
          if (el.textContent.includes('駅') || el.textContent.includes('徒歩')) {
            continue; // 駅情報はスキップ
          }
          if (!el.textContent.includes('㎡') && !el.textContent.includes('m2')) {
            propertyData.address = el.textContent.trim();
            break;
          }
        }
      } else if (SITE_TYPE === 'ATHOME') {
        const titleElement = card.querySelector('.property-title, [class*="title"]');
        if (titleElement) {
          propertyData.name = titleElement.textContent.trim();
        }
        const addressElement = card.querySelector('.property-address');
        if (addressElement) {
          propertyData.address = addressElement.textContent.trim();
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
      const builtYearPatterns = ['築年月', '築年数', '築'];
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
      console.log(`[${SITE_TYPE}坪単価] 物件${index + 1}データ収集:`, propertyData);
    } catch (error) {
      console.error(`[${SITE_TYPE}坪単価] 物件${index + 1}データ収集エラー:`, error);
    }
  });

  console.log(`[${SITE_TYPE}坪単価] 基本情報収集完了。物件数:`, properties.length);

  // 詳細ページから追加情報を取得（SUUMO専用）
  if (SITE_TYPE === 'SUUMO' && properties.length > 0) {
    console.log(`[${SITE_TYPE}坪単価] 詳細ページから追加情報を取得開始...`);

    for (let i = 0; i < properties.length; i++) {
      const property = properties[i];

      // 進捗通知
      if (progressCallback) {
        progressCallback(i + 1, properties.length);
      }

      if (property.url) {
        console.log(`[${SITE_TYPE}坪単価] ${i + 1}/${properties.length} 詳細ページ取得: ${property.url}`);

        // 詳細情報を取得
        const detailInfo = await fetchDetailPageInfo(property.url);

        // プロパティにマージ
        Object.assign(property, detailInfo);

        // 詳細ページの物件名で上書き
        if (detailInfo.nameDetail) {
          property.name = detailInfo.nameDetail;
        }

        // サーバー負荷軽減: 各リクエスト間に2秒待機
        if (i < properties.length - 1) {
          await sleep(2000);

          // 5件ごとに長めの待機（3秒）
          if ((i + 1) % 5 === 0) {
            console.log(`[${SITE_TYPE}坪単価] 5件処理完了。追加で1秒待機...`);
            await sleep(1000);
          }
        }
      }
    }

    console.log(`[${SITE_TYPE}坪単価] 詳細情報取得完了`);
  }

  console.log(`[${SITE_TYPE}坪単価] 全データ収集完了。物件数:`, properties.length);
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

  console.log(`[${SITE_TYPE}坪単価] CSVダウンロード完了:`, filename);
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
  button.innerHTML = '📊 CSVエクスポート';
  button.title = '現在のページの物件データをCSV形式でダウンロード';

  // クリックイベント（非同期対応）
  button.addEventListener('click', async () => {
    console.log(`[${SITE_TYPE}坪単価] CSVエクスポート開始`);
    button.disabled = true;
    button.innerHTML = '⏳ 収集中...';

    try {
      // 進捗表示コールバック
      const progressCallback = (current, total) => {
        button.innerHTML = `⏳ 詳細取得中 ${current}/${total}`;
      };

      const properties = await collectPropertyData(progressCallback);
      if (properties.length === 0) {
        alert('エクスポート可能な物件データが見つかりませんでした。');
        button.innerHTML = '📊 CSVエクスポート';
        button.disabled = false;
        return;
      }

      button.innerHTML = '📝 CSV生成中...';
      const csvContent = generateCSV(properties);
      downloadCSV(csvContent);

      button.innerHTML = '✅ 完了！';
      setTimeout(() => {
        button.innerHTML = '📊 CSVエクスポート';
        button.disabled = false;
      }, 2000);
    } catch (error) {
      console.error(`[${SITE_TYPE}坪単価] CSVエクスポートエラー:`, error);
      alert('CSVエクスポート中にエラーが発生しました。コンソールを確認してください。');
      button.innerHTML = '❌ エラー';
      setTimeout(() => {
        button.innerHTML = '📊 CSVエクスポート';
        button.disabled = false;
      }, 2000);
    }
  });

  // ボタンをページに追加
  document.body.appendChild(button);
  console.log(`[${SITE_TYPE}坪単価] エクスポートボタンを追加しました`);
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

  // エクスポートボタンを追加（一覧ページのみ）
  // エラーが起きても他の機能に影響しないようにtry-catchで囲む
  try {
    // 詳細ページかどうかを判定
    let propertyCards = [];
    if (SITE_TYPE === 'REHOUSE') {
      propertyCards = document.querySelectorAll('.property-index-card');
    } else if (SITE_TYPE === 'ATHOME') {
      propertyCards = document.querySelectorAll('.card-box-inner__detail');
    } else if (SITE_TYPE === 'HOMES') {
      const allTables = document.querySelectorAll('.bukkenSpec table');
      const standardCards = Array.from(allTables).filter(table =>
        table.querySelector('td.price') && table.querySelector('td.space')
      );
      const groupedCards = document.querySelectorAll('.unitSummary tbody tr');
      propertyCards = [...standardCards, ...groupedCards];
    } else {
      propertyCards = document.querySelectorAll('.cassetteitem, .dottable--cassette, [class*="cassette"]');
    }

    if (propertyCards.length > 0) {
      console.log(`[${SITE_TYPE}坪単価] 一覧ページと判定、エクスポートボタンを追加`);
      createExportButton();
    }
  } catch (error) {
    console.error(`[${SITE_TYPE}坪単価] エクスポートボタン追加エラー:`, error);
  }
}

// DOMContentLoaded後に初期化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
