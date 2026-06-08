/**
 * お気に入り物件ポップアップ
 */

let currentFilter = 'all';
let currentSort = 'added_desc';
let currentView = 'favorites';
let currentFavorites = [];
let memoSaveTimer = null;
let loanSaveTimer = null;
let checklistSaveTimer = null;
let favoriteRecheckInProgress = false;

const RELEASE_NOTES_STORAGE_KEY = 'lastSeenReleaseNotesVersion';

const DEFAULT_LOAN_SETTINGS = {
  annualRatePercent: 0.8,
  years: 35,
  downPaymentMan: 0
};

let currentPopupLoanSettings = { ...DEFAULT_LOAN_SETTINGS };

const VIEWING_CHECKLIST_ITEMS = [
  { id: 'common_area', label: '共用部' },
  { id: 'notice_board', label: '掲示板' },
  { id: 'trash_area', label: 'ゴミ置き場' },
  { id: 'noise', label: '騒音' },
  { id: 'sunlight', label: '日当たり' },
  { id: 'signal', label: '電波' },
  { id: 'condensation', label: '結露跡' },
  { id: 'management', label: '管理状態' },
  { id: 'night_route', label: '夜道' },
  { id: 'repair_history', label: '修繕履歴' }
];

const RELEASE_NOTES = [
  {
    version: '1.9.0',
    title: '購入判断を助ける機能を追加',
    items: [
      '修繕積立金をリスク低・中・高で診断し、目安比率と理由を表示するようにしました。',
      'お気に入り物件を価格・坪単価・月額・管理費・修繕積立金で比較できるボードを追加しました。',
      'お気に入り物件ごとに内見チェックリストと内見メモを保存できるようにしました。',
      'お気に入りの価格改定をバックグラウンド再チェックで検知したとき、Chrome通知で知らせるようにしました。'
    ]
  },
  {
    version: '1.8.2',
    title: '詳細ページの費用取得を改善',
    items: [
      '三井のリハウスで管理費・修繕積立金を取得できない場合がある問題を修正しました。',
      'アットホームとホームズでも、ページ構造の違いによる費用・面積・階数の取りこぼしに強くしました。',
      '詳細ページとCSVエクスポートの詳細情報取得をより安定させました。'
    ]
  },
  {
    version: '1.8.1',
    title: '更新に気づきやすく改善',
    items: [
      '更新後、ツールバーの拡張アイコンにNEWバッジを表示するようにしました。',
      'ポップアップで更新内容を確認して閉じると、NEWバッジが消えるようにしました。',
      '物件登録ボタンを「坪たんに登録」と表示し、用途がわかりやすくなりました。'
    ]
  },
  {
    version: '1.8.0',
    title: 'お気に入りの価格ウォッチを強化',
    items: [
      '更新後にポップアップで新機能を確認できるようになりました。',
      'お気に入り物件の掲載中・掲載終了の可能性を表示します。',
      'お気に入り物件をバックグラウンドで定期再チェックします。',
      '価格履歴がある物件にミニグラフと下落率・上昇率を表示します。',
      'ポップアップから手動で価格と掲載状態を再チェックできます。'
    ]
  },
  {
    version: '1.7.1',
    title: 'CSVエクスポートを4サイト正式対応',
    items: [
      'SUUMO、三井のリハウス、アットホーム、ホームズの一覧CSV出力に対応しました。',
      '詳細ページ取得に失敗した物件も一覧情報だけでCSVに含めます。',
      '詳細取得ステータス列を追加しました。'
    ]
  }
];

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

function getCurrentVersion() {
  if (typeof chrome === 'undefined' || !chrome.runtime?.getManifest) return '';
  return chrome.runtime.getManifest().version || '';
}

function renderExtensionVersion() {
  const versionEl = document.getElementById('extension-version');
  if (!versionEl || typeof chrome === 'undefined' || !chrome.runtime?.getManifest) return;

  const manifest = chrome.runtime.getManifest();
  versionEl.textContent = `v${manifest.version}`;
  versionEl.title = `${manifest.name} v${manifest.version} の更新内容`;
}

function renderReleaseNotes() {
  const bodyEl = document.getElementById('release-notes-body');
  if (!bodyEl) return;

  bodyEl.innerHTML = '';

  RELEASE_NOTES.forEach((note) => {
    const section = document.createElement('section');
    section.className = 'release-note';

    const title = document.createElement('h3');
    title.className = 'release-note-title';
    title.textContent = `v${note.version} ${note.title}`;
    section.appendChild(title);

    const list = document.createElement('ul');
    list.className = 'release-note-list';
    note.items.forEach((item) => {
      const li = document.createElement('li');
      li.textContent = item;
      list.appendChild(li);
    });
    section.appendChild(list);

    bodyEl.appendChild(section);
  });
}

function markReleaseNotesSeen() {
  const currentVersion = getCurrentVersion();
  if (!currentVersion) return;
  chrome.storage.local.set({ [RELEASE_NOTES_STORAGE_KEY]: currentVersion }, () => {
    chrome.runtime?.sendMessage?.({ type: 'RELEASE_NOTES_SEEN' });
  });
}

function showReleaseNotes() {
  const dialog = document.getElementById('release-notes-dialog');
  if (!dialog) return;

  renderReleaseNotes();
  dialog.hidden = false;
}

function closeReleaseNotes() {
  const dialog = document.getElementById('release-notes-dialog');
  if (!dialog) return;

  dialog.hidden = true;
  markReleaseNotesSeen();
}

function maybeShowReleaseNotesOnUpdate() {
  const currentVersion = getCurrentVersion();
  if (!currentVersion) return;

  chrome.storage.local.get({ [RELEASE_NOTES_STORAGE_KEY]: '' }, (result) => {
    if (result[RELEASE_NOTES_STORAGE_KEY] === currentVersion) return;
    showReleaseNotes();
  });
}

function setupReleaseNotes() {
  document.getElementById('extension-version')?.addEventListener('click', showReleaseNotes);
  document.getElementById('release-notes-close')?.addEventListener('click', closeReleaseNotes);
  document.getElementById('release-notes-dialog')?.addEventListener('click', (event) => {
    if (event.target.id === 'release-notes-dialog') closeReleaseNotes();
  });

  maybeShowReleaseNotesOnUpdate();
}

/**
 * お気に入り一覧を読み込んで表示
 */
function loadFavorites() {
  chrome.storage.local.get({ favorites: [] }, (result) => {
    renderAllViews(result.favorites);
  });
}

function renderAllViews(favorites) {
  currentFavorites = Array.isArray(favorites) ? favorites : [];
  renderFavorites(currentFavorites);
  renderComparisonBoard(currentFavorites);
  renderViewingChecklist(currentFavorites);
}

function getVisibleSortedFavorites(favorites) {
  const filtered = currentFilter === 'all'
    ? favorites
    : favorites.filter(f => f.site === currentFilter);

  return sortFavorites(filtered, currentSort);
}

/**
 * お気に入り一覧を描画
 * @param {Array} favorites - お気に入りデータ配列
 */
function renderFavorites(favorites) {
  const listEl = document.getElementById('favorites-list');
  const emptyEl = document.getElementById('empty-message');

  const sorted = getVisibleSortedFavorites(favorites);

  listEl.innerHTML = '';

  if (sorted.length === 0) {
    listEl.style.display = 'none';
    emptyEl.style.display = 'block';
    return;
  }

  listEl.style.display = 'block';
  emptyEl.style.display = 'none';

  sorted.forEach((fav) => {
    const item = document.createElement('div');
    item.className = 'favorite-item';

    const info = document.createElement('div');
    info.className = 'favorite-info';

    const nameLink = document.createElement('a');
    nameLink.className = 'favorite-name';
    nameLink.href = fav.url;
    nameLink.target = '_blank';
    nameLink.rel = 'noopener';
    nameLink.textContent = fav.name || '(物件名不明)';
    nameLink.title = fav.name || '';
    info.appendChild(nameLink);

    const details = document.createElement('div');
    details.className = 'favorite-details';

    const siteBadge = document.createElement('span');
    siteBadge.className = `favorite-site favorite-site--${fav.site}`;
    siteBadge.textContent = getSiteDisplayName(fav.site);
    details.appendChild(siteBadge);

    const currentPrice = fav.currentPrice || fav.price;
    if (currentPrice) {
      const priceEl = document.createElement('span');
      priceEl.className = 'favorite-detail-item';
      priceEl.textContent = formatPrice(currentPrice);
      details.appendChild(priceEl);
    }

    if (fav.area) {
      const areaEl = document.createElement('span');
      areaEl.className = 'favorite-detail-item';
      areaEl.textContent = `${fav.area}m²`;
      details.appendChild(areaEl);
    }

    if (fav.tsubotanka) {
      const tankaEl = document.createElement('span');
      tankaEl.className = 'favorite-detail-item';
      tankaEl.textContent = `@${fav.tsubotanka.toLocaleString()}万/坪`;
      details.appendChild(tankaEl);
    }

    info.appendChild(details);

    const diffEl = createPriceDiffElement(fav);
    if (diffEl) {
      info.appendChild(diffEl);
    }

    const listingStatusEl = createListingStatusElement(fav);
    if (listingStatusEl) {
      info.appendChild(listingStatusEl);
    }

    const repairRiskEl = createFavoriteRepairRiskElement(fav);
    if (repairRiskEl) {
      info.appendChild(repairRiskEl);
    }

    const priceHistoryEl = createPriceHistoryElement(fav);
    if (priceHistoryEl) {
      info.appendChild(priceHistoryEl);
    }

    const memoEl = document.createElement('textarea');
    memoEl.className = 'favorite-memo';
    memoEl.placeholder = '気になった点をメモ';
    memoEl.value = fav.memo || '';
    memoEl.addEventListener('input', () => {
      window.clearTimeout(memoSaveTimer);
      memoSaveTimer = window.setTimeout(() => {
        updateFavoriteMemo(fav.url, memoEl.value);
      }, 250);
    });
    info.appendChild(memoEl);

    const actionRow = document.createElement('div');
    actionRow.className = 'favorite-actions';

    const checklistBtn = document.createElement('button');
    checklistBtn.className = 'favorite-secondary-action';
    checklistBtn.type = 'button';
    checklistBtn.textContent = '内見';
    checklistBtn.addEventListener('click', () => {
      switchPopupView('checklist');
    });
    actionRow.appendChild(checklistBtn);

    info.appendChild(actionRow);

    item.appendChild(info);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'favorite-delete';
    deleteBtn.textContent = '×';
    deleteBtn.title = 'お気に入りから削除';
    deleteBtn.addEventListener('click', () => {
      removeFavorite(fav.url);
    });
    item.appendChild(deleteBtn);

    listEl.appendChild(item);
  });
}

function createPriceDiffElement(fav) {
  const latestHistory = Array.isArray(fav.priceHistory) ? fav.priceHistory[0] : null;
  const previousPrice = latestHistory?.previousPrice || fav.previousPrice;
  const currentPrice = latestHistory?.currentPrice || fav.currentPrice;
  const checkedAt = latestHistory?.checkedAt || fav.priceUpdatedAt;

  if (!previousPrice || !currentPrice || previousPrice === currentPrice) {
    const lastCheckedAt = fav.lastCheckedAt || fav.priceUpdatedAt;
    if (!lastCheckedAt || !(fav.currentPrice || fav.price)) return null;
    const sameEl = document.createElement('div');
    sameEl.className = 'favorite-price-diff favorite-price-diff--same';
    sameEl.textContent = `前回確認価格と同じ (${formatDateTime(lastCheckedAt)}確認)`;
    return sameEl;
  }

  const diff = currentPrice - previousPrice;
  const diffEl = document.createElement('div');
  diffEl.className = `favorite-price-diff ${diff > 0 ? 'favorite-price-diff--up' : 'favorite-price-diff--down'}`;
  diffEl.textContent = `${diff > 0 ? '値上がり' : '値下がり'} ${formatSignedMan(diff)} (${formatDateTime(checkedAt)})`;
  return diffEl;
}

function createListingStatusElement(fav) {
  if (!fav.listingStatus) return null;

  const statusText = {
    active: '掲載中',
    ended: '掲載終了の可能性',
    check_failed: '再確認失敗'
  }[fav.listingStatus] || fav.listingStatusLabel || fav.listingStatus;

  const checkedAt = fav.listingCheckedAt || fav.lastAutoCheckedAt;
  const el = document.createElement('div');
  el.className = `favorite-listing-status favorite-listing-status--${fav.listingStatus}`;
  el.textContent = checkedAt ? `${statusText} (${formatDateTime(checkedAt)})` : statusText;
  if (fav.recheckError) {
    el.title = fav.recheckError;
  }
  return el;
}

function createFavoriteRepairRiskElement(fav) {
  const risk = fav.repairFundRisk;
  if (!risk || !risk.label) return null;

  const el = document.createElement('div');
  el.className = `favorite-repair-risk favorite-repair-risk--${risk.level || 'unknown'}`;
  const perSqm = risk.perSqm ? `${risk.perSqm.toLocaleString()}円/㎡` : '';
  const ratio = risk.ratioPercent ? `目安比${risk.ratioPercent}%` : '';
  el.textContent = ['修繕積立金', risk.label, perSqm, ratio].filter(Boolean).join(' / ');
  if (risk.reason) el.title = risk.reason;
  return el;
}

function calculateMonthlyLoanPaymentForPopup(principal, annualRate, years) {
  if (principal <= 0 || years <= 0) return 0;
  if (annualRate <= 0) {
    return Math.round(principal / (years * 12));
  }
  const monthlyRate = annualRate / 12;
  const totalMonths = years * 12;
  const factor = Math.pow(1 + monthlyRate, totalMonths);
  return Math.round(principal * monthlyRate * factor / (factor - 1));
}

function calculateFavoriteMonthlyCost(fav) {
  const priceMan = fav.currentPrice || fav.price || 0;
  if (!priceMan) return null;

  const borrowingMan = Math.max(0, priceMan - currentPopupLoanSettings.downPaymentMan);
  const loanMonthly = calculateMonthlyLoanPaymentForPopup(
    borrowingMan * 10000,
    currentPopupLoanSettings.annualRatePercent / 100,
    currentPopupLoanSettings.years
  );

  const managementFee = Number(fav.managementFee) || 0;
  const repairFund = Number(fav.repairFund) || 0;

  return {
    loanMonthly,
    managementFee,
    repairFund,
    totalMonthly: loanMonthly + managementFee + repairFund
  };
}

function formatYen(amount) {
  if (!amount) return '';
  return `${amount.toLocaleString()}円`;
}

function formatMonthlyCost(amount) {
  if (!amount) return '';
  if (amount >= 10000) {
    return `約${(Math.round(amount / 1000) / 10).toLocaleString()}万円`;
  }
  return `約${amount.toLocaleString()}円`;
}

function appendTextCell(row, text, className = '') {
  const cell = document.createElement('td');
  if (className) cell.className = className;
  cell.textContent = text || '-';
  row.appendChild(cell);
  return cell;
}

function renderComparisonBoard(favorites) {
  const boardEl = document.getElementById('compare-board');
  const emptyEl = document.getElementById('compare-empty-message');
  if (!boardEl || !emptyEl) return;

  const sorted = getVisibleSortedFavorites(favorites);
  boardEl.innerHTML = '';

  if (sorted.length === 0) {
    boardEl.style.display = 'none';
    emptyEl.style.display = 'block';
    return;
  }

  boardEl.style.display = 'block';
  emptyEl.style.display = 'none';

  const tableWrap = document.createElement('div');
  tableWrap.className = 'compare-table-wrap';

  const table = document.createElement('table');
  table.className = 'compare-table';

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  ['物件', '価格', '坪単価', '月額', '管理費', '修繕積立金', '診断', '築年数', '駅距離'].forEach((label) => {
    const th = document.createElement('th');
    th.textContent = label;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  sorted.forEach((fav) => {
    const row = document.createElement('tr');
    const nameCell = document.createElement('td');
    nameCell.className = 'compare-property-cell';

    const nameLink = document.createElement('a');
    nameLink.href = fav.url;
    nameLink.target = '_blank';
    nameLink.rel = 'noopener';
    nameLink.textContent = fav.name || '(物件名不明)';
    nameCell.appendChild(nameLink);
    row.appendChild(nameCell);

    const monthlyCost = calculateFavoriteMonthlyCost(fav);
    const risk = fav.repairFundRisk;

    appendTextCell(row, formatPrice(fav.currentPrice || fav.price));
    appendTextCell(row, fav.tsubotanka ? `${fav.tsubotanka.toLocaleString()}万/坪` : '');
    appendTextCell(row, monthlyCost ? formatMonthlyCost(monthlyCost.totalMonthly) : '');
    appendTextCell(row, formatYen(Number(fav.managementFee) || 0));
    appendTextCell(row, formatYen(Number(fav.repairFund) || 0));

    const riskCell = appendTextCell(row, risk?.label || '', risk ? `compare-risk compare-risk--${risk.level}` : '');
    if (risk?.reason) riskCell.title = risk.reason;

    appendTextCell(row, fav.age || '');
    appendTextCell(row, fav.station || '');
    tbody.appendChild(row);
  });

  table.appendChild(tbody);
  tableWrap.appendChild(table);
  boardEl.appendChild(tableWrap);
}

function getViewingChecklistState(fav) {
  return fav.viewingChecklist && typeof fav.viewingChecklist === 'object'
    ? fav.viewingChecklist
    : {};
}

function getViewingChecklistProgress(fav) {
  const state = getViewingChecklistState(fav);
  const completed = VIEWING_CHECKLIST_ITEMS.filter(item => state[item.id]).length;
  return { completed, total: VIEWING_CHECKLIST_ITEMS.length };
}

function renderViewingChecklist(favorites) {
  const listEl = document.getElementById('checklist-list');
  const emptyEl = document.getElementById('checklist-empty-message');
  if (!listEl || !emptyEl) return;

  const sorted = getVisibleSortedFavorites(favorites);
  listEl.innerHTML = '';

  if (sorted.length === 0) {
    listEl.style.display = 'none';
    emptyEl.style.display = 'block';
    return;
  }

  listEl.style.display = 'block';
  emptyEl.style.display = 'none';

  sorted.forEach((fav, favIndex) => {
    const section = document.createElement('section');
    section.className = 'checklist-card';

    const header = document.createElement('div');
    header.className = 'checklist-card-header';

    const nameLink = document.createElement('a');
    nameLink.className = 'checklist-property-name';
    nameLink.href = fav.url;
    nameLink.target = '_blank';
    nameLink.rel = 'noopener';
    nameLink.textContent = fav.name || '(物件名不明)';
    header.appendChild(nameLink);

    const progress = getViewingChecklistProgress(fav);
    const progressEl = document.createElement('span');
    progressEl.className = 'checklist-progress';
    progressEl.textContent = `${progress.completed}/${progress.total}`;
    header.appendChild(progressEl);
    section.appendChild(header);

    const detailRow = document.createElement('div');
    detailRow.className = 'checklist-card-details';
    [formatPrice(fav.currentPrice || fav.price), fav.tsubotanka ? `${fav.tsubotanka.toLocaleString()}万/坪` : '', fav.station || '']
      .filter(Boolean)
      .forEach((text) => {
        const span = document.createElement('span');
        span.textContent = text;
        detailRow.appendChild(span);
      });
    section.appendChild(detailRow);

    const state = getViewingChecklistState(fav);
    const grid = document.createElement('div');
    grid.className = 'checklist-grid';

    VIEWING_CHECKLIST_ITEMS.forEach((item) => {
      const label = document.createElement('label');
      label.className = 'checklist-item';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = Boolean(state[item.id]);
      checkbox.id = `checklist-${favIndex}-${item.id}`;
      checkbox.addEventListener('change', () => {
        updateFavoriteChecklistItem(fav.url, item.id, checkbox.checked);
      });
      label.appendChild(checkbox);

      const span = document.createElement('span');
      span.textContent = item.label;
      label.appendChild(span);
      grid.appendChild(label);
    });
    section.appendChild(grid);

    const note = document.createElement('textarea');
    note.className = 'checklist-note';
    note.placeholder = '内見メモ';
    note.value = fav.viewingNote || '';
    note.addEventListener('input', () => {
      window.clearTimeout(checklistSaveTimer);
      checklistSaveTimer = window.setTimeout(() => {
        updateFavoriteViewingNote(fav.url, note.value);
      }, 250);
    });
    section.appendChild(note);

    listEl.appendChild(section);
  });
}

function buildPriceHistoryPoints(fav) {
  const history = Array.isArray(fav.priceHistory) ? [...fav.priceHistory].reverse() : [];
  const points = [];

  history.forEach((entry) => {
    if (entry.previousPrice) {
      points.push({
        price: entry.previousPrice,
        checkedAt: entry.checkedAt
      });
    }
    if (entry.currentPrice) {
      points.push({
        price: entry.currentPrice,
        checkedAt: entry.checkedAt
      });
    }
  });

  const currentPrice = fav.currentPrice || fav.price;
  if (currentPrice) {
    points.push({
      price: currentPrice,
      checkedAt: fav.lastCheckedAt || fav.priceUpdatedAt || fav.listingCheckedAt
    });
  }

  return points.filter((point, index) => {
    const previous = points[index - 1];
    return !previous || previous.price !== point.price;
  });
}

function createPriceHistoryElement(fav) {
  const points = buildPriceHistoryPoints(fav);
  if (points.length < 2) return null;

  const prices = points.map(point => point.price);
  const firstPrice = prices[0];
  const latestPrice = prices[prices.length - 1];
  const diff = latestPrice - firstPrice;
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const range = maxPrice - minPrice || 1;

  const wrapper = document.createElement('div');
  wrapper.className = 'favorite-price-history';

  const summary = document.createElement('div');
  summary.className = 'favorite-price-history-summary';

  const label = document.createElement('span');
  label.textContent = `${formatPrice(firstPrice)} → ${formatPrice(latestPrice)}`;
  summary.appendChild(label);

  const diffLabel = document.createElement('span');
  diffLabel.className = diff > 0
    ? 'favorite-price-history-diff--up'
    : 'favorite-price-history-diff--down';
  diffLabel.textContent = `${formatSignedMan(diff)} ${formatPercent(diff / firstPrice)}`;
  summary.appendChild(diffLabel);

  wrapper.appendChild(summary);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 100 34');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');

  const baseLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  baseLine.setAttribute('class', 'favorite-price-history-base');
  baseLine.setAttribute('x1', '0');
  baseLine.setAttribute('x2', '100');
  baseLine.setAttribute('y1', '28');
  baseLine.setAttribute('y2', '28');
  svg.appendChild(baseLine);

  const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  polyline.setAttribute('class', 'favorite-price-history-line');
  polyline.setAttribute('points', prices.map((price, index) => {
    const x = points.length === 1 ? 0 : (index / (points.length - 1)) * 100;
    const y = 28 - ((price - minPrice) / range) * 22;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' '));
  svg.appendChild(polyline);

  const lastPoint = prices[prices.length - 1];
  const lastCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  lastCircle.setAttribute('class', 'favorite-price-history-point');
  lastCircle.setAttribute('cx', '100');
  lastCircle.setAttribute('cy', (28 - ((lastPoint - minPrice) / range) * 22).toFixed(2));
  lastCircle.setAttribute('r', '2.2');
  svg.appendChild(lastCircle);

  wrapper.appendChild(svg);
  return wrapper;
}

function sortFavorites(favorites, sortKey) {
  const sorted = [...favorites];

  sorted.sort((a, b) => {
    if (sortKey === 'price_desc') {
      return (b.currentPrice || b.price || 0) - (a.currentPrice || a.price || 0);
    }
    if (sortKey === 'price_asc') {
      return (a.currentPrice || a.price || 0) - (b.currentPrice || b.price || 0);
    }
    if (sortKey === 'tsubo_asc') {
      const aVal = a.tsubotanka || Number.MAX_SAFE_INTEGER;
      const bVal = b.tsubotanka || Number.MAX_SAFE_INTEGER;
      return aVal - bVal;
    }
    if (sortKey === 'updated_desc') {
      return new Date(b.priceUpdatedAt || b.addedAt || 0) - new Date(a.priceUpdatedAt || a.addedAt || 0);
    }
    return new Date(b.addedAt || 0) - new Date(a.addedAt || 0);
  });

  return sorted;
}

/**
 * お気に入りを削除
 * @param {string} url - 削除対象のURL
 */
function removeFavorite(url) {
  chrome.storage.local.get({ favorites: [] }, (result) => {
    const favorites = result.favorites.filter(f => f.url !== url);
    chrome.storage.local.set({ favorites }, () => {
      renderAllViews(favorites);
    });
  });
}

function updateFavoriteMemo(url, memo) {
  chrome.storage.local.get({ favorites: [] }, (result) => {
    const favorites = result.favorites.map((favorite) => {
      if (favorite.url !== url) return favorite;
      return {
        ...favorite,
        memo,
        updatedAt: new Date().toISOString()
      };
    });

    chrome.storage.local.set({ favorites });
  });
}

function updateFavoriteChecklistItem(url, itemId, checked) {
  chrome.storage.local.get({ favorites: [] }, (result) => {
    const favorites = result.favorites.map((favorite) => {
      if (favorite.url !== url) return favorite;
      return {
        ...favorite,
        viewingChecklist: {
          ...(favorite.viewingChecklist || {}),
          [itemId]: checked
        },
        updatedAt: new Date().toISOString()
      };
    });

    chrome.storage.local.set({ favorites });
  });
}

function updateFavoriteViewingNote(url, viewingNote) {
  chrome.storage.local.get({ favorites: [] }, (result) => {
    const favorites = result.favorites.map((favorite) => {
      if (favorite.url !== url) return favorite;
      return {
        ...favorite,
        viewingNote,
        updatedAt: new Date().toISOString()
      };
    });

    chrome.storage.local.set({ favorites });
  });
}

/**
 * サイト名表示用の変換
 * @param {string} site - サイトコード
 * @returns {string}
 */
function getSiteDisplayName(site) {
  const names = {
    SUUMO: 'SUUMO',
    REHOUSE: 'リハウス',
    ATHOME: 'アットホーム',
    HOMES: 'ホームズ'
  };
  return names[site] || site;
}

/**
 * 価格フォーマット
 * @param {number} price - 万円単位の価格
 * @returns {string}
 */
function formatPrice(price) {
  if (!price) return '';
  if (price >= 10000) {
    const oku = Math.floor(price / 10000);
    const man = price % 10000;
    if (man === 0) {
      return `${oku}億円`;
    }
    return `${oku}億${man.toLocaleString()}万円`;
  }
  return `${price.toLocaleString()}万円`;
}

function formatSignedMan(priceDiff) {
  const sign = priceDiff > 0 ? '+' : '';
  return `${sign}${priceDiff.toLocaleString()}万円`;
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return '';
  const sign = value > 0 ? '+' : '';
  return `(${sign}${(value * 100).toFixed(1)}%)`;
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function loadLoanSettings() {
  chrome.storage.local.get({ loanSettings: DEFAULT_LOAN_SETTINGS }, (result) => {
    renderLoanSettings(normalizeLoanSettings(result.loanSettings));
  });
}

function renderLoanSettings(settings) {
  currentPopupLoanSettings = normalizeLoanSettings(settings);
  const rateInput = document.getElementById('loan-rate');
  const yearsInput = document.getElementById('loan-years');
  const downPaymentInput = document.getElementById('loan-down-payment');

  if (!rateInput || !yearsInput || !downPaymentInput) return;

  rateInput.value = currentPopupLoanSettings.annualRatePercent;
  yearsInput.value = currentPopupLoanSettings.years;
  downPaymentInput.value = currentPopupLoanSettings.downPaymentMan;
  renderComparisonBoard(currentFavorites);
}

function saveLoanSettingsFromInputs() {
  const rateInput = document.getElementById('loan-rate');
  const yearsInput = document.getElementById('loan-years');
  const downPaymentInput = document.getElementById('loan-down-payment');

  const settings = normalizeLoanSettings({
    annualRatePercent: rateInput.value,
    years: yearsInput.value,
    downPaymentMan: downPaymentInput.value
  });

  chrome.storage.local.set({ loanSettings: settings }, () => {
    showLoanSettingsStatus('保存しました');
  });
}

function showLoanSettingsStatus(text) {
  const statusEl = document.getElementById('loan-settings-status');
  if (!statusEl) return;
  statusEl.textContent = text;
  window.clearTimeout(statusEl._clearTimer);
  statusEl._clearTimer = window.setTimeout(() => {
    statusEl.textContent = '';
  }, 1600);
}

function setupLoanSettings() {
  const inputs = [
    document.getElementById('loan-rate'),
    document.getElementById('loan-years'),
    document.getElementById('loan-down-payment')
  ].filter(Boolean);

  inputs.forEach((input) => {
    input.addEventListener('input', () => {
      window.clearTimeout(loanSaveTimer);
      loanSaveTimer = window.setTimeout(saveLoanSettingsFromInputs, 300);
    });
    input.addEventListener('change', saveLoanSettingsFromInputs);
  });

  loadLoanSettings();
}

function formatRecheckSummary(response) {
  if (!response || response.error) {
    return response?.error || '再チェックに失敗しました';
  }

  if (response.checked === 0) {
    return '確認対象はありません';
  }

  const parts = [`${response.checked}件確認`];
  if (response.ended) parts.push(`掲載終了候補${response.ended}件`);
  if (response.failed) parts.push(`失敗${response.failed}件`);
  if (response.remaining) parts.push(`残り${response.remaining}件`);
  return parts.join(' / ');
}

function setRecheckStatus(text) {
  const statusEl = document.getElementById('recheck-status');
  if (!statusEl) return;

  statusEl.textContent = text;
  window.clearTimeout(statusEl._clearTimer);
  if (text) {
    statusEl._clearTimer = window.setTimeout(() => {
      statusEl.textContent = '';
    }, 5000);
  }
}

function requestFavoriteRecheck() {
  if (favoriteRecheckInProgress) return;

  const button = document.getElementById('recheck-favorites');
  favoriteRecheckInProgress = true;
  if (button) button.disabled = true;
  setRecheckStatus('確認中...');

  chrome.runtime.sendMessage({ type: 'RECHECK_FAVORITES_NOW' }, (response) => {
    favoriteRecheckInProgress = false;
    if (button) button.disabled = false;

    if (chrome.runtime.lastError) {
      setRecheckStatus(chrome.runtime.lastError.message || '再チェックに失敗しました');
      return;
    }

    setRecheckStatus(formatRecheckSummary(response));
    loadFavorites();
  });
}

function setupFavoriteRecheck() {
  const button = document.getElementById('recheck-favorites');
  if (!button) return;

  if (!chrome.runtime?.sendMessage) {
    button.disabled = true;
    setRecheckStatus('再チェックを利用できません');
    return;
  }

  button.addEventListener('click', requestFavoriteRecheck);
}

function switchPopupView(viewName) {
  currentView = viewName;

  document.querySelectorAll('.view-tab').forEach((tab) => {
    const isActive = tab.dataset.view === viewName;
    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  document.querySelectorAll('.popup-view').forEach((view) => {
    view.hidden = view.id !== `${viewName}-view`;
  });

  renderAllViews(currentFavorites);
}

function setupViewTabs() {
  document.querySelectorAll('.view-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      switchPopupView(tab.dataset.view);
    });
  });
}

document.querySelectorAll('.filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.site;
    renderAllViews(currentFavorites);
  });
});

document.getElementById('sort-select').addEventListener('change', (event) => {
  currentSort = event.target.value;
  renderAllViews(currentFavorites);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;

  if (changes.favorites) {
    renderAllViews(changes.favorites.newValue || []);
  }

  if (changes.loanSettings) {
    renderLoanSettings(normalizeLoanSettings(changes.loanSettings.newValue));
  }
});

renderExtensionVersion();
setupReleaseNotes();
setupViewTabs();
setupFavoriteRecheck();
setupLoanSettings();
loadFavorites();
