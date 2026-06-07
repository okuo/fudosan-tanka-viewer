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
  shouldRecheckFavorite
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
