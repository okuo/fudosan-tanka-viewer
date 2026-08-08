const assert = require('assert/strict');
const store = require('./observed-listings-store.js');

const NOW = '2026-07-19T00:00:00.000Z';
const current = {
  version: 1,
  items: [{
    listingKey: 'SUUMO:1',
    url: 'https://suumo.jp/1',
    rawName: '既存名',
    rawAddress: '東京都中央区晴海1-1-1',
    priceMan: 12000,
    areaSqm: 70,
    firstSeenAt: '2026-07-01T00:00:00.000Z',
    lastSeenAt: '2026-07-01T00:00:00.000Z'
  }]
};
const merged = store.upsertObservedListings(current, [{
  listingKey: 'SUUMO:1',
  url: 'https://suumo.jp/1',
  rawName: '',
  priceMan: 11800,
  areaSqm: null,
  lastSeenAt: NOW
}], [], NOW, { retentionDays: 90, maxNonFavorites: 500 });

assert.equal(merged.items.length, 1);
assert.equal(merged.items[0].rawName, '既存名');
assert.equal(merged.items[0].priceMan, 11800);
assert.equal(merged.items[0].areaSqm, 70);
assert.equal(merged.items[0].firstSeenAt, '2026-07-01T00:00:00.000Z');
assert.equal(merged.items[0].lastSeenAt, NOW);

const oldFavorite = {
  listingKey: 'HOMES:favorite',
  url: 'https://www.homes.co.jp/favorite',
  lastSeenAt: '2025-01-01T00:00:00.000Z'
};
const oldNonFavorite = {
  listingKey: 'HOMES:old',
  url: 'https://www.homes.co.jp/old',
  lastSeenAt: '2025-01-01T00:00:00.000Z'
};
const pruned = store.upsertObservedListings(
  { version: 1, items: [oldFavorite, oldNonFavorite] },
  [],
  [{ url: oldFavorite.url }],
  NOW,
  { retentionDays: 90, maxNonFavorites: 500 }
);
assert.deepEqual(pruned.items.map(item => item.listingKey), ['HOMES:favorite']);

const cappedItems = Array.from({ length: 505 }, (_, index) => ({
  listingKey: `SUUMO:${index}`,
  url: `https://suumo.jp/${index}`,
  lastSeenAt: new Date(Date.parse(NOW) - index * 1000).toISOString()
}));
assert.equal(store.upsertObservedListings(
  { version: 1, items: cappedItems }, [], [], NOW,
  { retentionDays: 90, maxNonFavorites: 500 }
).items.length, 500);

const equalTimestampItems = Array.from({ length: 501 }, (_, index) => ({
  listingKey: `SUUMO:${String(index).padStart(3, '0')}`,
  url: `https://suumo.jp/equal-${index}`,
  lastSeenAt: NOW
}));
const retainedForward = store.upsertObservedListings(
  { version: 1, items: equalTimestampItems }, [], [], NOW,
  { retentionDays: 90, maxNonFavorites: 500 }
).items.map(item => item.listingKey).sort();
const retainedReversed = store.upsertObservedListings(
  { version: 1, items: [...equalTimestampItems].reverse() }, [], [], NOW,
  { retentionDays: 90, maxNonFavorites: 500 }
).items.map(item => item.listingKey).sort();
assert.deepEqual(retainedReversed, retainedForward);

const decisionState = store.applyMatchDecision({
  overrides: { version: 1, buildingPairs: [], unitPairs: [] },
  aliases: { version: 1, entries: [] }
}, [
  { listingKey: 'SUUMO:1', addressBlockKey: '東京都中央区晴海2-3-30', normalizedBuildingName: 'クロノレジデンス' },
  { listingKey: 'HOMES:2', addressBlockKey: '東京都中央区晴海2-3-30', normalizedBuildingName: 'クロノ棟' }
], {
  scope: 'building', decision: 'same', leftKey: 'SUUMO:1', rightKey: 'HOMES:2'
}, NOW);

assert.equal(decisionState.overrides.buildingPairs[0].decision, 'same');
assert.deepEqual(decisionState.aliases.entries[0].normalizedNames, ['クロノレジデンス', 'クロノ棟']);

const clearedDecisionState = store.applyMatchDecision(decisionState, [
  { listingKey: 'SUUMO:1', addressBlockKey: '東京都中央区晴海2-3-30', normalizedBuildingName: 'クロノレジデンス' },
  { listingKey: 'HOMES:2', addressBlockKey: '東京都中央区晴海2-3-30', normalizedBuildingName: 'クロノ棟' }
], {
  scope: 'building', decision: 'clear', leftKey: 'SUUMO:1', rightKey: 'HOMES:2'
}, NOW);
assert.deepEqual(clearedDecisionState.overrides.buildingPairs, []);
assert.deepEqual(clearedDecisionState.aliases.entries, []);

const missingAddressState = store.applyMatchDecision({
  overrides: { version: 1, buildingPairs: [], unitPairs: [] },
  aliases: { version: 1, entries: [] }
}, [
  { listingKey: 'SUUMO:3', addressBlockKey: '', normalizedBuildingName: '同名' },
  { listingKey: 'HOMES:4', addressBlockKey: '', normalizedBuildingName: '同名別表記' }
], {
  scope: 'building', decision: 'same', leftKey: 'SUUMO:3', rightKey: 'HOMES:4'
}, NOW);
assert.deepEqual(missingAddressState.aliases.entries, []);

const prunedMetadata = store.pruneMatchMetadata({
  version: 1,
  buildingPairs: [
    { leftKey: 'SUUMO:kept', rightKey: 'HOMES:missing', decision: 'same' },
    { leftKey: 'SUUMO:gone', rightKey: 'HOMES:gone', decision: 'different' }
  ],
  unitPairs: []
}, [{ listingKey: 'SUUMO:kept' }]);
assert.deepEqual(prunedMetadata.buildingPairs, [
  { leftKey: 'SUUMO:kept', rightKey: 'HOMES:missing', decision: 'same' }
]);

const cleared = store.clearCrossSiteData({
  observedListingsV1: { version: 1, items: [{}] },
  listingMatchOverridesV1: decisionState.overrides,
  buildingAliasesV1: decisionState.aliases,
  crossSitePendingSelectionV1: 'SUUMO:1'
});
assert.deepEqual(cleared, {
  observedListingsV1: { version: 1, items: [] },
  listingMatchOverridesV1: { version: 1, buildingPairs: [], unitPairs: [] },
  buildingAliasesV1: { version: 1, entries: [] },
  crossSitePendingSelectionV1: ''
});
