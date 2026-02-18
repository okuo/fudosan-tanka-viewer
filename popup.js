/**
 * お気に入り物件ポップアップ
 */

let currentFilter = 'all';

/**
 * お気に入り一覧を読み込んで表示
 */
function loadFavorites() {
  chrome.storage.local.get({ favorites: [] }, (result) => {
    const favorites = result.favorites;
    renderFavorites(favorites);
  });
}

/**
 * お気に入り一覧を描画
 * @param {Array} favorites - お気に入りデータ配列
 */
function renderFavorites(favorites) {
  const listEl = document.getElementById('favorites-list');
  const emptyEl = document.getElementById('empty-message');

  // フィルタ適用
  const filtered = currentFilter === 'all'
    ? favorites
    : favorites.filter(f => f.site === currentFilter);

  listEl.innerHTML = '';

  if (filtered.length === 0) {
    listEl.style.display = 'none';
    emptyEl.style.display = 'block';
    return;
  }

  listEl.style.display = 'block';
  emptyEl.style.display = 'none';

  // 追加日の新しい順に表示
  const sorted = [...filtered].sort((a, b) => {
    return new Date(b.addedAt) - new Date(a.addedAt);
  });

  sorted.forEach((fav) => {
    const item = document.createElement('div');
    item.className = 'favorite-item';

    const info = document.createElement('div');
    info.className = 'favorite-info';

    // 物件名リンク
    const nameLink = document.createElement('a');
    nameLink.className = 'favorite-name';
    nameLink.href = fav.url;
    nameLink.target = '_blank';
    nameLink.rel = 'noopener';
    nameLink.textContent = fav.name || '(物件名不明)';
    nameLink.title = fav.name || '';
    info.appendChild(nameLink);

    // 詳細行
    const details = document.createElement('div');
    details.className = 'favorite-details';

    // サイトバッジ
    const siteBadge = document.createElement('span');
    siteBadge.className = `favorite-site favorite-site--${fav.site}`;
    siteBadge.textContent = getSiteDisplayName(fav.site);
    details.appendChild(siteBadge);

    // 価格
    if (fav.price) {
      const priceEl = document.createElement('span');
      priceEl.className = 'favorite-detail-item';
      priceEl.textContent = formatPrice(fav.price);
      details.appendChild(priceEl);
    }

    // 面積
    if (fav.area) {
      const areaEl = document.createElement('span');
      areaEl.className = 'favorite-detail-item';
      areaEl.textContent = fav.area + 'm\u00B2';
      details.appendChild(areaEl);
    }

    // 坪単価
    if (fav.tsubotanka) {
      const tankaEl = document.createElement('span');
      tankaEl.className = 'favorite-detail-item';
      tankaEl.textContent = '@' + fav.tsubotanka.toLocaleString() + '\u4E07/\u5761';
      details.appendChild(tankaEl);
    }

    info.appendChild(details);
    item.appendChild(info);

    // 削除ボタン
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'favorite-delete';
    deleteBtn.textContent = '\u00D7';
    deleteBtn.title = '\u304A\u6C17\u306B\u5165\u308A\u304B\u3089\u524A\u9664';
    deleteBtn.addEventListener('click', () => {
      removeFavorite(fav.url);
    });
    item.appendChild(deleteBtn);

    listEl.appendChild(item);
  });
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

/**
 * サイト名表示用の変換
 * @param {string} site - サイトコード
 * @returns {string}
 */
function getSiteDisplayName(site) {
  const names = {
    SUUMO: 'SUUMO',
    REHOUSE: '\u30EA\u30CF\u30A6\u30B9',
    ATHOME: '\u30A2\u30C3\u30C8\u30DB\u30FC\u30E0',
    HOMES: '\u30DB\u30FC\u30E0\u30BA'
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
      return oku + '\u5104\u5186';
    }
    return oku + '\u5104' + man.toLocaleString() + '\u4E07\u5186';
  }
  return price.toLocaleString() + '\u4E07\u5186';
}

// フィルタボタンのイベント
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.site;
    loadFavorites();
  });
});

// 初期表示
loadFavorites();
