/**
 * お気に入り物件ポップアップ
 */

let currentFilter = 'all';
let currentSort = 'added_desc';
let memoSaveTimer = null;
let loanSaveTimer = null;

const DEFAULT_LOAN_SETTINGS = {
  annualRatePercent: 0.8,
  years: 35,
  downPaymentMan: 0
};

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

function renderExtensionVersion() {
  const versionEl = document.getElementById('extension-version');
  if (!versionEl || typeof chrome === 'undefined' || !chrome.runtime?.getManifest) return;

  const manifest = chrome.runtime.getManifest();
  versionEl.textContent = `v${manifest.version}`;
  versionEl.title = `${manifest.name} v${manifest.version}`;
}

/**
 * お気に入り一覧を読み込んで表示
 */
function loadFavorites() {
  chrome.storage.local.get({ favorites: [] }, (result) => {
    renderFavorites(result.favorites);
  });
}

/**
 * お気に入り一覧を描画
 * @param {Array} favorites - お気に入りデータ配列
 */
function renderFavorites(favorites) {
  const listEl = document.getElementById('favorites-list');
  const emptyEl = document.getElementById('empty-message');

  const filtered = currentFilter === 'all'
    ? favorites
    : favorites.filter(f => f.site === currentFilter);

  const sorted = sortFavorites(filtered, currentSort);

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
      renderFavorites(favorites);
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
  const rateInput = document.getElementById('loan-rate');
  const yearsInput = document.getElementById('loan-years');
  const downPaymentInput = document.getElementById('loan-down-payment');

  if (!rateInput || !yearsInput || !downPaymentInput) return;

  rateInput.value = settings.annualRatePercent;
  yearsInput.value = settings.years;
  downPaymentInput.value = settings.downPaymentMan;
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

document.querySelectorAll('.filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.site;
    loadFavorites();
  });
});

document.getElementById('sort-select').addEventListener('change', (event) => {
  currentSort = event.target.value;
  loadFavorites();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;

  if (changes.favorites) {
    renderFavorites(changes.favorites.newValue || []);
  }

  if (changes.loanSettings) {
    renderLoanSettings(normalizeLoanSettings(changes.loanSettings.newValue));
  }
});

renderExtensionVersion();
setupLoanSettings();
loadFavorites();
