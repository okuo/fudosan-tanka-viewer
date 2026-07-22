/**
 * お気に入り物件のバックグラウンド再チェック
 */

const FAVORITE_RECHECK_ALARM = 'favorite-price-recheck';
const FAVORITE_RECHECK_INTERVAL_MINUTES = 6 * 60;
const FAVORITE_RECHECK_STALE_MS = 24 * 60 * 60 * 1000;
const FAVORITE_RECHECK_BATCH_SIZE = 5;
const FAVORITE_RECHECK_DELAY_MS = 2000;
const RELEASE_NOTES_STORAGE_KEY = 'lastSeenReleaseNotesVersion';
const RELEASE_NOTES_BADGE_VERSION_KEY = 'pendingReleaseNotesBadgeVersion';
const RELEASE_NOTES_BADGE_TEXT = 'NEW';
const LOCAL_BUILD_BADGE_TEXT = 'DEV';
const PRICE_NOTIFICATION_TARGETS_KEY = 'priceChangeNotificationTargets';

const LISTING_ENDED_PATTERNS = [
  /掲載(?:が)?終了/,
  /公開(?:が)?終了/,
  /販売(?:が)?終了/,
  /売却済/,
  /成約済/,
  /この物件は掲載を終了/,
  /お探しの物件(?:情報)?は(?:見つかりません|ございません)/,
  /物件情報が見つかりません/,
  /ページが見つかりません/
];

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

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getExtensionManifest() {
  return chrome.runtime.getManifest?.() || {};
}

function isLocalBuild() {
  const manifest = getExtensionManifest();
  return /\blocal\b/i.test(manifest.version_name || '') ||
    /\bLOCAL\b/.test(manifest.name || '') ||
    /\bLOCAL\b/.test(manifest.action?.default_title || '');
}

function getCurrentVersion() {
  return getExtensionManifest().version || '';
}

async function setLocalBuildBadge() {
  await chrome.action.setBadgeText({ text: LOCAL_BUILD_BADGE_TEXT });
  await chrome.action.setBadgeBackgroundColor({ color: '#dc2626' });
  await chrome.action.setBadgeTextColor?.({ color: '#ffffff' });
}

async function setReleaseNotesBadge() {
  if (isLocalBuild()) {
    await setLocalBuildBadge();
    return;
  }

  await chrome.action.setBadgeText({ text: RELEASE_NOTES_BADGE_TEXT });
  await chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });
  await chrome.action.setBadgeTextColor?.({ color: '#ffffff' });
}

async function clearReleaseNotesBadge() {
  if (isLocalBuild()) {
    await setLocalBuildBadge();
  } else {
    await chrome.action.setBadgeText({ text: '' });
  }
  await setStorageData({ [RELEASE_NOTES_BADGE_VERSION_KEY]: '' });
}

async function markReleaseNotesBadgePending() {
  const currentVersion = getCurrentVersion();
  if (!currentVersion) return;

  await setStorageData({ [RELEASE_NOTES_BADGE_VERSION_KEY]: currentVersion });
  await setReleaseNotesBadge();
}

async function refreshReleaseNotesBadge() {
  if (isLocalBuild()) {
    await setLocalBuildBadge();
    return;
  }

  const currentVersion = getCurrentVersion();
  if (!currentVersion) return;

  const result = await getStorageData({
    [RELEASE_NOTES_STORAGE_KEY]: '',
    [RELEASE_NOTES_BADGE_VERSION_KEY]: ''
  });
  if (
    result[RELEASE_NOTES_BADGE_VERSION_KEY] === currentVersion &&
    result[RELEASE_NOTES_STORAGE_KEY] !== currentVersion
  ) {
    await setReleaseNotesBadge();
    return;
  }

  if (result[RELEASE_NOTES_BADGE_VERSION_KEY]) {
    await clearReleaseNotesBadge();
  }
}

function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.href;
  } catch (error) {
    return null;
  }
}

function toHalfWidth(text) {
  return String(text || '')
    .replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
    .replace(/[，．]/g, char => ({ '，': ',', '．': '.' }[char] || char));
}

function decodeBasicEntities(text) {
  return String(text || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

function stripHtmlForText(html) {
  return decodeBasicEntities(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parsePriceMan(text) {
  if (!text) return null;

  const normalized = toHalfWidth(text).replace(/\s+/g, '');
  const okuMatch = normalized.match(/(\d+(?:\.\d+)?)億/);
  const manMatch = normalized.match(/(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)万/);

  let totalMan = 0;
  if (okuMatch) totalMan += parseFloat(okuMatch[1]) * 10000;
  if (manMatch) totalMan += parseFloat(manMatch[1].replace(/,/g, ''));

  return totalMan > 0 ? totalMan : null;
}

function parseFirstPriceMan(text) {
  const normalized = toHalfWidth(text);
  const okuPrice = normalized.match(/(\d+(?:\.\d+)?\s*億\s*(?:\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)?\s*万円?)/);
  if (okuPrice) return parsePriceMan(okuPrice[1]);

  const manPrice = normalized.match(/((?:\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*万円)/);
  return manPrice ? parsePriceMan(manPrice[1]) : null;
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

function didFavoritePriceChange(previousFavorite, nextFavorite) {
  const previousPrice = previousFavorite?.currentPrice || previousFavorite?.price || null;
  const currentPrice = nextFavorite?.currentPrice || nextFavorite?.price || null;
  return Boolean(previousPrice && currentPrice && previousPrice !== currentPrice);
}

function buildPriceChangeNotificationMessage(favorite) {
  const previousPrice = favorite.previousPrice;
  const currentPrice = favorite.currentPrice || favorite.price;
  const diff = currentPrice - previousPrice;
  const movement = diff > 0 ? '値上げ' : '値下げ';
  const name = favorite.name || 'お気に入り物件';

  return {
    title: '坪たん: 価格改定',
    message: `${name}が ${formatPriceMan(previousPrice)} → ${formatPriceMan(currentPrice)} に${movement}されました (${formatSignedMan(diff)})`
  };
}

async function rememberPriceChangeNotificationTarget(notificationId, url) {
  if (!notificationId || !url) return;

  const result = await getStorageData({ [PRICE_NOTIFICATION_TARGETS_KEY]: {} });
  const currentTargets = result[PRICE_NOTIFICATION_TARGETS_KEY] || {};
  const entries = Object.entries(currentTargets)
    .filter(([id]) => id !== notificationId)
    .slice(-19);
  const nextTargets = Object.fromEntries([...entries, [notificationId, url]]);
  await setStorageData({ [PRICE_NOTIFICATION_TARGETS_KEY]: nextTargets });
}

function createChromeNotification(notificationId, options) {
  return new Promise((resolve) => {
    chrome.notifications.create(notificationId, options, () => {
      if (chrome.runtime.lastError) {
        console.warn('価格改定通知の表示に失敗しました', chrome.runtime.lastError.message);
      }
      resolve();
    });
  });
}

async function notifyFavoritePriceChange(favorite) {
  if (!chrome.notifications?.create || !favorite?.previousPrice || !(favorite.currentPrice || favorite.price)) {
    return;
  }

  const notificationId = `price-change-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { title, message } = buildPriceChangeNotificationMessage(favorite);
  await rememberPriceChangeNotificationTarget(notificationId, favorite.url);
  await createChromeNotification(notificationId, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message,
    priority: 1
  });
}

function extractPriceFromHtml(html) {
  const text = stripHtmlForText(html);
  const labels = ['販売価格', '物件価格', '価格'];

  for (const label of labels) {
    const index = text.indexOf(label);
    if (index === -1) continue;
    const price = parseFirstPriceMan(text.slice(index, index + 120));
    if (price) return price;
  }

  return parseFirstPriceMan(text);
}

function detectListingStatus(responseMeta, html) {
  if (responseMeta.status === 404 || responseMeta.status === 410) {
    return {
      listingStatus: 'ended',
      listingStatusLabel: '掲載終了の可能性',
      recheckError: null
    };
  }

  if (!responseMeta.ok) {
    return {
      listingStatus: 'check_failed',
      listingStatusLabel: '確認失敗',
      recheckError: `HTTP ${responseMeta.status}`
    };
  }

  const text = stripHtmlForText(html);
  if (LISTING_ENDED_PATTERNS.some(pattern => pattern.test(text))) {
    return {
      listingStatus: 'ended',
      listingStatusLabel: '掲載終了の可能性',
      recheckError: null
    };
  }

  return {
    listingStatus: 'active',
    listingStatusLabel: '掲載中',
    recheckError: null
  };
}

function buildNextPriceHistory(favorite, previousPrice, currentPrice, checkedAt) {
  const history = Array.isArray(favorite.priceHistory) ? favorite.priceHistory : [];
  if (!previousPrice || !currentPrice || previousPrice === currentPrice) return history;

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

function mergeFavoriteRecheckResult(favorite, result, checkedAt) {
  const storedCurrentPrice = favorite.currentPrice || favorite.price || null;
  const nextFavorite = {
    ...favorite,
    listingStatus: result.listingStatus,
    listingStatusLabel: result.listingStatusLabel,
    listingCheckedAt: checkedAt,
    lastAutoCheckedAt: checkedAt,
    recheckError: result.recheckError || null,
    finalUrl: result.finalUrl || favorite.finalUrl || null
  };

  if (result.listingStatus === 'ended') {
    nextFavorite.listingEndedAt = favorite.listingEndedAt || checkedAt;
  } else if (result.listingStatus === 'active') {
    nextFavorite.listingEndedAt = null;
  }

  if (result.priceMan && storedCurrentPrice && result.priceMan !== storedCurrentPrice) {
    nextFavorite.previousPrice = storedCurrentPrice;
    nextFavorite.currentPrice = result.priceMan;
    nextFavorite.price = result.priceMan;
    nextFavorite.priceUpdatedAt = checkedAt;
    nextFavorite.lastCheckedAt = checkedAt;
    nextFavorite.priceHistory = buildNextPriceHistory(favorite, storedCurrentPrice, result.priceMan, checkedAt);
  } else if (result.priceMan && !storedCurrentPrice) {
    nextFavorite.currentPrice = result.priceMan;
    nextFavorite.price = result.priceMan;
    nextFavorite.priceUpdatedAt = checkedAt;
    nextFavorite.lastCheckedAt = checkedAt;
    nextFavorite.priceHistory = Array.isArray(favorite.priceHistory) ? favorite.priceHistory : [];
  } else {
    nextFavorite.priceHistory = Array.isArray(favorite.priceHistory) ? favorite.priceHistory : [];
  }

  return nextFavorite;
}

function shouldRecheckFavorite(favorite, nowMs, force = false) {
  if (!normalizeUrl(favorite.url)) return false;
  if (force) return true;

  const lastChecked = getFavoriteRecheckTime(favorite);

  return !lastChecked || nowMs - lastChecked >= FAVORITE_RECHECK_STALE_MS;
}

function getFavoriteRecheckTime(favorite) {
  const lastChecked = Date.parse(
    favorite.lastAutoCheckedAt ||
    favorite.listingCheckedAt ||
    favorite.lastCheckedAt ||
    0
  );

  return Number.isNaN(lastChecked) ? 0 : lastChecked;
}

async function fetchFavoriteRecheckResult(favorite) {
  const url = normalizeUrl(favorite.url);
  if (!url) {
    return {
      listingStatus: 'check_failed',
      listingStatusLabel: '確認失敗',
      recheckError: 'URLが不正です',
      priceMan: null,
      finalUrl: null
    };
  }

  try {
    const response = await fetch(url, {
      credentials: 'include',
      cache: 'no-store',
      redirect: 'follow'
    });
    const html = await response.text();
    const statusInfo = detectListingStatus({
      ok: response.ok,
      status: response.status,
      url: response.url,
      originalUrl: url
    }, html);

    return {
      ...statusInfo,
      priceMan: statusInfo.listingStatus === 'active' ? extractPriceFromHtml(html) : null,
      finalUrl: response.url || url
    };
  } catch (error) {
    return {
      listingStatus: 'check_failed',
      listingStatusLabel: '確認失敗',
      recheckError: error.message || '取得に失敗しました',
      priceMan: null,
      finalUrl: url
    };
  }
}

async function recheckFavorites(options = {}) {
  const force = Boolean(options.force);
  const result = await getStorageData({ favorites: [] });
  const favorites = Array.isArray(result.favorites) ? result.favorites : [];
  const nowMs = Date.now();
  const candidates = favorites
    .filter(favorite => shouldRecheckFavorite(favorite, nowMs, force))
    .sort((a, b) => getFavoriteRecheckTime(a) - getFavoriteRecheckTime(b));
  const selected = candidates.slice(0, FAVORITE_RECHECK_BATCH_SIZE);

  if (selected.length === 0) {
    return {
      checked: 0,
      changed: 0,
      ended: 0,
      failed: 0,
      remaining: candidates.length
    };
  }

  let changed = 0;
  let ended = 0;
  let failed = 0;
  const nextByUrl = new Map(favorites.map(favorite => [favorite.url, favorite]));

  for (const favorite of selected) {
    const checkedAt = new Date().toISOString();
    const recheckResult = await fetchFavoriteRecheckResult(favorite);
    const nextFavorite = mergeFavoriteRecheckResult(favorite, recheckResult, checkedAt);
    const priceChanged = didFavoritePriceChange(favorite, nextFavorite);

    if (JSON.stringify(nextFavorite) !== JSON.stringify(favorite)) changed += 1;
    if (nextFavorite.listingStatus === 'ended') ended += 1;
    if (nextFavorite.listingStatus === 'check_failed') failed += 1;
    if (priceChanged) {
      await notifyFavoritePriceChange(nextFavorite);
    }

    nextByUrl.set(favorite.url, nextFavorite);

    if (selected.indexOf(favorite) < selected.length - 1) {
      await delay(FAVORITE_RECHECK_DELAY_MS);
    }
  }

  await setStorageData({ favorites: favorites.map(favorite => nextByUrl.get(favorite.url) || favorite) });

  return {
    checked: selected.length,
    changed,
    ended,
    failed,
    remaining: Math.max(candidates.length - selected.length, 0)
  };
}

function ensureFavoriteRecheckAlarm() {
  chrome.alarms.create(FAVORITE_RECHECK_ALARM, {
    periodInMinutes: FAVORITE_RECHECK_INTERVAL_MINUTES
  });
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onInstalled) {
  chrome.runtime.onInstalled.addListener((details) => {
    ensureFavoriteRecheckAlarm();

    if (isLocalBuild()) {
      setLocalBuildBadge().catch(error => console.warn('ローカル版バッジの設定に失敗しました', error));
      return;
    }

    if (details.reason === 'update') {
      markReleaseNotesBadgePending().catch(error => console.warn('更新バッジの設定に失敗しました', error));
    }
  });

  chrome.runtime.onStartup?.addListener(() => {
    ensureFavoriteRecheckAlarm();
    refreshReleaseNotesBadge().catch(error => console.warn('更新バッジの復元に失敗しました', error));
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== FAVORITE_RECHECK_ALARM) return;
    recheckFavorites().catch(error => console.warn('お気に入り再チェックに失敗しました', error));
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'RELEASE_NOTES_SEEN') {
      clearReleaseNotesBadge()
        .then(() => sendResponse({ ok: true }))
        .catch((error) => {
          sendResponse({ ok: false, error: error.message || '更新バッジのクリアに失敗しました' });
        });

      return true;
    }

    if (message?.type !== 'RECHECK_FAVORITES_NOW') return false;

    recheckFavorites({ force: true })
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          checked: 0,
          changed: 0,
          ended: 0,
          failed: 1,
          remaining: 0,
          error: error.message || '再チェックに失敗しました'
        });
      });

    return true;
  });

  chrome.notifications?.onClicked?.addListener((notificationId) => {
    getStorageData({ [PRICE_NOTIFICATION_TARGETS_KEY]: {} })
      .then((result) => {
        const url = result[PRICE_NOTIFICATION_TARGETS_KEY]?.[notificationId];
        if (url) chrome.tabs?.create?.({ url });
        chrome.notifications?.clear?.(notificationId);
      })
      .catch(error => console.warn('価格改定通知の遷移に失敗しました', error));
  });
}

if (typeof module !== 'undefined') {
  module.exports = {
    parsePriceMan,
    formatPriceMan,
    formatSignedMan,
    extractPriceFromHtml,
    stripHtmlForText,
    detectListingStatus,
    buildNextPriceHistory,
    mergeFavoriteRecheckResult,
    shouldRecheckFavorite,
    getFavoriteRecheckTime,
    didFavoritePriceChange,
    buildPriceChangeNotificationMessage
  };
}
