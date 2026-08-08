/**
 * background.js の価格・掲載状態再チェックロジックのテスト
 * Node.jsで実行: node test_background.js
 */

const assert = require('assert/strict');

const {
  parsePriceMan,
  extractPriceFromHtml,
  detectListingStatus,
  mergeFavoriteRecheckResult,
  shouldRecheckFavorite,
  didFavoritePriceChange,
  buildPriceChangeNotificationMessage,
  createCrossSiteController
} = require('./background.js');

assert.equal(parsePriceMan('2億5990万円'), 25990);
assert.equal(parsePriceMan('16,500万円'), 16500);
assert.equal(parsePriceMan('1.2億円'), 12000);

assert.equal(
  extractPriceFromHtml('<html><body><dt>販売価格</dt><dd>1億4,180万円</dd><p>管理費 18,000円</p></body></html>'),
  14180
);

assert.deepEqual(
  detectListingStatus({ ok: false, status: 404 }, ''),
  {
    listingStatus: 'ended',
    listingStatusLabel: '掲載終了の可能性',
    recheckError: null
  }
);

assert.equal(
  detectListingStatus({ ok: true, status: 200 }, '<main>この物件は掲載を終了しました</main>').listingStatus,
  'ended'
);

assert.equal(
  detectListingStatus({ ok: false, status: 403 }, '<main>Forbidden</main>').listingStatus,
  'check_failed'
);

const checkedAt = '2026-06-07T00:00:00.000Z';
const favorite = {
  url: 'https://suumo.jp/ms/chuko/tokyo/sc_chuo/nc_123456/',
  name: 'テスト物件',
  price: 10000,
  currentPrice: 10000,
  previousPrice: null,
  priceHistory: [],
  listingStatus: 'active'
};

const changed = mergeFavoriteRecheckResult(favorite, {
  listingStatus: 'active',
  listingStatusLabel: '掲載中',
  recheckError: null,
  priceMan: 9500,
  finalUrl: favorite.url
}, checkedAt);

assert.equal(changed.currentPrice, 9500);
assert.equal(changed.previousPrice, 10000);
assert.equal(changed.priceHistory.length, 1);
assert.equal(changed.priceHistory[0].diff, -500);
assert.equal(changed.listingStatus, 'active');
assert.equal(didFavoritePriceChange(favorite, changed), true);

assert.deepEqual(
  buildPriceChangeNotificationMessage(changed),
  {
    title: '坪たん: 価格改定',
    message: 'テスト物件が 1億円 → 9,500万円 に値下げされました (-500万円)'
  }
);

const ended = mergeFavoriteRecheckResult(changed, {
  listingStatus: 'ended',
  listingStatusLabel: '掲載終了の可能性',
  recheckError: null,
  priceMan: null,
  finalUrl: favorite.url
}, checkedAt);

assert.equal(ended.listingStatus, 'ended');
assert.equal(ended.listingEndedAt, checkedAt);

assert.equal(shouldRecheckFavorite(favorite, Date.now(), true), true);
assert.equal(shouldRecheckFavorite({ ...favorite, url: 'not-a-url' }, Date.now(), true), false);

console.log('background recheck tests passed');

async function testCrossSiteController() {
  let memory = {
    observedListingsV1: { version: 1, items: [] },
    listingMatchOverridesV1: { version: 1, buildingPairs: [], unitPairs: [] },
    buildingAliasesV1: { version: 1, entries: [] },
    crossSiteMatchingSettingsV1: { enabled: true, retentionDays: 90 },
    crossSiteMigrationsV1: { favoriteBackfillCompleted: false },
    favorites: []
  };
  const openedTabs = [];
  let failObservedWrites = 0;
  const controller = createCrossSiteController({
    get: async defaults => ({ ...defaults, ...memory }),
    set: async (patch) => {
      if (patch.observedListingsV1 && failObservedWrites > 0) {
        failObservedWrites -= 1;
        throw new Error('QUOTA_BYTES quota exceeded');
      }
      memory = { ...memory, ...patch };
    },
    openSidePanel: async tabId => { openedTabs.push(tabId); },
    now: () => '2026-07-19T00:00:00.000Z'
  });

  await Promise.all([
    controller.upsert([{ listingKey: 'SUUMO:1', url: 'https://suumo.jp/1', lastSeenAt: '2026-07-19T00:00:00.000Z' }]),
    controller.upsert([{ listingKey: 'HOMES:2', url: 'https://homes.co.jp/2', lastSeenAt: '2026-07-19T00:00:00.000Z' }])
  ]);
  assert.deepEqual(memory.observedListingsV1.items.map(item => item.listingKey).sort(), ['HOMES:2', 'SUUMO:1']);

  memory.favorites = [{
    site: 'ATHOME',
    url: 'https://www.athome.co.jp/mansion/legacy-favorite/',
    name: '以前からのお気に入り',
    currentPrice: 8800,
    area: 65,
    listingStatus: 'active'
  }];
  await controller.backfillFavorites();
  assert.equal(memory.observedListingsV1.items.some(item => (
    item.site === 'ATHOME' && item.observationSource === 'favorite-backfill' && item.rawName === '以前からのお気に入り'
  )), true);
  assert.equal(memory.crossSiteMigrationsV1.favoriteBackfillCompleted, true);

  await controller.openListingGroup('SUUMO:1', 77);
  assert.equal(memory.crossSitePendingSelectionV1, 'SUUMO:1');
  assert.deepEqual(openedTabs, [77]);

  await controller.saveSettings({ enabled: false, retentionDays: 90 });
  const disabled = await controller.upsert([{ listingKey: 'ATHOME:3', url: 'https://athome.co.jp/3' }]);
  assert.equal(disabled.disabled, true);
  assert.equal(memory.observedListingsV1.items.length, 3);

  memory.crossSiteMatchingSettingsV1 = { enabled: true, retentionDays: 90 };
  memory.observedListingsV1 = {
    version: 1,
    items: Array.from({ length: 300 }, (_, index) => ({
      listingKey: `SUUMO:quota-${index}`,
      url: `https://suumo.jp/quota-${index}`,
      lastSeenAt: new Date(Date.parse('2026-07-19T00:00:00.000Z') - index * 1000).toISOString()
    }))
  };
  failObservedWrites = 1;
  await controller.upsert([{ listingKey: 'HOMES:quota-new', url: 'https://homes.co.jp/quota-new', lastSeenAt: '2026-07-19T00:00:00.000Z' }]);
  assert.equal(memory.observedListingsV1.items.length <= 250, true);
  assert.equal(failObservedWrites, 0);

  const beforeFailedRetry = JSON.stringify(memory.observedListingsV1);
  failObservedWrites = 2;
  await assert.rejects(() => controller.upsert([{
    listingKey: 'ATHOME:quota-discarded',
    url: 'https://www.athome.co.jp/quota-discarded',
    lastSeenAt: '2026-07-19T00:00:00.000Z'
  }]), /quota/i);
  assert.equal(JSON.stringify(memory.observedListingsV1), beforeFailedRetry);

  await controller.clearData();
  assert.equal(memory.observedListingsV1.items.length, 0);
  assert.equal(memory.crossSiteMatchingSettingsV1.enabled, true);
  assert.equal(memory.crossSiteMigrationsV1.favoriteBackfillCompleted, true);
}

testCrossSiteController().then(() => console.log('cross-site controller tests passed'));
