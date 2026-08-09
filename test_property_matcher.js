const assert = require('assert/strict');
const matcher = require('./property-matcher.js');

assert.equal(
  matcher.normalizeBuildingName('【価格改定】ザ・パークハウス 新宿 中古マンション'),
  'ザパークハウス新宿'
);
assert.equal(
  matcher.normalizeBuildingName('晴海フラッグ ＳＵＮ ＶＩＬＬＡＧＥ Ⅱ棟'),
  '晴海フラッグsunvillage2棟'
);
assert.equal(matcher.normalizeBuildingName('レジデンス壱番館'), 'レジデンス1番館');
assert.equal(matcher.normalizeBuildingName('三井レジデンス壱番館'), '三井レジデンス1番館');
assert.equal(matcher.extractBuildingWing('晴海フラッグ SUN VILLAGE Ⅱ棟'), '2棟');
const wingRecord = matcher.prepareListingRecord({
  site: 'SUUMO', url: 'https://suumo.jp/wing', rawName: '晴海フラッグ SUN VILLAGE Ⅱ棟'
}, '2026-07-19T00:00:00.000Z');
assert.equal(wingRecord.normalizedBuildingName, '晴海フラッグsunvillage');
assert.equal(wingRecord.buildingWing, '2棟');

assert.deepEqual(
  matcher.normalizeAddress('東京都中央区晴海二丁目3番30号 パークタワー48階'),
  {
    normalized: '東京都中央区晴海2-3-30',
    municipalityTownKey: '東京都中央区晴海',
    addressBlockKey: '東京都中央区晴海2-3-30'
  }
);
assert.equal(
  matcher.normalizeAddress('東京都江東区豊洲十二丁目4番5号').normalized,
  '東京都江東区豊洲12-4-5'
);
assert.equal(
  matcher.normalizeAddress('三重県四日市市諏訪栄町一丁目2番3号').normalized,
  '三重県四日市市諏訪栄町1-2-3'
);

assert.equal(matcher.normalizeLayout(' 3ＬＤＫ + WIC '), '3LDK');
assert.equal(matcher.parseFloor('所在階 48階／地上50階建'), 48);
assert.equal(matcher.parseFloor(48), 48);
assert.equal(matcher.parseArea('72.91m²（壁芯）'), 72.91);
assert.equal(matcher.normalizeBuiltAt('2019年2月築'), '2019-02');
assert.equal(matcher.extractSourceListingId('https://suumo.jp/ms/chuko/tokyo/nc_123456/', 'SUUMO'), '123456');
assert.equal(matcher.extractSourceListingId('https://www.homes.co.jp/mansion/b-987/', 'HOMES'), '987');
assert.equal(matcher.normalizeUrl('https://suumo.jp/nc_1/?utm_source=test#price'), 'https://suumo.jp/nc_1/');
assert.equal(matcher.diceCoefficient('ザパークハウス新宿', 'ザパークハウス新宿レジデンス') > 0.7, true);
assert.equal(matcher.diceCoefficient('森', '森'), 1);
assert.equal(matcher.diceCoefficient('森', '杜'), 0);

const left = matcher.prepareListingRecord({
  site: 'SUUMO',
  url: 'https://suumo.jp/ms/chuko/tokyo/sc_chuo/nc_111/',
  sourceListingId: '111',
  rawName: 'ザ・パークハウス新宿',
  rawAddress: '東京都新宿区西新宿1丁目2番3号',
  areaSqm: 72.91,
  floor: '18階',
  layout: '3LDK',
  builtAt: '2019年2月',
  totalUnits: '120戸',
  buildingFloors: '20階建'
}, '2026-07-19T00:00:00.000Z');

const right = matcher.prepareListingRecord({
  site: 'HOMES',
  url: 'https://www.homes.co.jp/mansion/b-222/',
  sourceListingId: '222',
  rawName: 'ザ パークハウス 新宿',
  rawAddress: '東京都新宿区西新宿1-2-3',
  areaSqm: '72.90㎡',
  floor: '18階 / 20階建',
  layout: '3ＬＤＫ',
  builtAt: '2019年02月築',
  totalUnits: '120戸',
  buildingFloors: '地上20階'
}, '2026-07-19T00:01:00.000Z');

assert.equal(left.listingKey, 'SUUMO:111');
assert.equal(left.normalizedBuildingName, 'ザパークハウス新宿');
assert.equal(left.addressBlockKey, '東京都新宿区西新宿1-2-3');

const buildingMatch = matcher.scoreBuildingMatch(left, right, []);
assert.equal(buildingMatch.confidence, 'high');
assert.equal(buildingMatch.score >= 80, true);

const missingAddress = matcher.prepareListingRecord({
  site: 'ATHOME',
  url: 'https://www.athome.co.jp/mansion/333/',
  rawName: 'ザ・パークハウス新宿',
  areaSqm: 72.9,
  floor: '18階',
  layout: '3LDK'
}, '2026-07-19T00:02:00.000Z');
assert.notEqual(matcher.scoreBuildingMatch(left, missingAddress, []).confidence, 'high');

const differentAddress = matcher.prepareListingRecord({
  site: 'REHOUSE',
  url: 'https://www.rehouse.co.jp/buy/mansion/bkdetail/444/',
  rawName: 'ザ・パークハウス新宿',
  rawAddress: '東京都渋谷区恵比寿4-5-6'
}, '2026-07-19T00:03:00.000Z');
assert.equal(matcher.scoreBuildingMatch(left, differentAddress, []).confidence, 'none');

const unitMatch = matcher.scoreUnitMatch(left, right);
assert.equal(unitMatch.confidence, 'high');
assert.equal(unitMatch.score >= 80, true);

const otherFloor = { ...right, listingKey: 'HOMES:223', floor: 10 };
assert.notEqual(matcher.scoreUnitMatch(left, otherFloor).confidence, 'high');

const sameRoomNoCorroboration = {
  ...right,
  listingKey: 'HOMES:224',
  roomNumber: '1801',
  areaSqm: 90,
  floor: 22
};
const roomOnlyLeft = { ...left, roomNumber: '1801' };
assert.equal(matcher.scoreUnitMatch(roomOnlyLeft, sameRoomNoCorroboration).confidence, 'candidate');

const roomOnlyUnit = matcher.scoreUnitMatch(
  { roomNumber: '1801' },
  { roomNumber: '1801' }
);
assert.equal(roomOnlyUnit.score, 55);
assert.equal(roomOnlyUnit.confidence, 'candidate');

const roomAndFloorUnit = matcher.scoreUnitMatch(
  { roomNumber: '1801', floor: 18 },
  { roomNumber: '1801', floor: 18 }
);
assert.equal(roomAndFloorUnit.score >= 80, true);
assert.equal(roomAndFloorUnit.confidence, 'high');

const roomAndNearbyAreaUnit = matcher.scoreUnitMatch(
  { roomNumber: '1801', areaSqm: 72 },
  { roomNumber: '1801', areaSqm: 72.75 }
);
assert.equal(roomAndNearbyAreaUnit.score >= 80, true);
assert.equal(roomAndNearbyAreaUnit.confidence, 'high');

const belowHighThresholdUnit = matcher.scoreUnitMatch(
  { floor: 18, layout: '3LDK' },
  { floor: 18, layout: '3LDK' }
);
assert.equal(belowHighThresholdUnit.score < 80, true);
assert.notEqual(belowHighThresholdUnit.confidence, 'high');

const aliases = [{
  addressBlockKey: left.addressBlockKey,
  normalizedNames: [left.normalizedBuildingName, '新宿パークハウス']
}];
const aliasAtSameBlock = matcher.prepareListingRecord({
  site: 'ATHOME',
  url: 'https://www.athome.co.jp/mansion/555/',
  rawName: '新宿パークハウス',
  rawAddress: '東京都新宿区西新宿1丁目2番3号'
}, '2026-07-19T00:04:00.000Z');
assert.equal(matcher.scoreBuildingMatch(left, aliasAtSameBlock, aliases).confidence, 'high');
assert.equal(matcher.scoreBuildingMatch(left, aliasAtSameBlock, aliases).reasons.includes('確認済み名称別名'), true);

const aliasAtDifferentBlock = matcher.prepareListingRecord({
  site: 'ATHOME',
  url: 'https://www.athome.co.jp/mansion/556/',
  rawName: '新宿パークハウス',
  rawAddress: '東京都新宿区西新宿1丁目2番4号'
}, '2026-07-19T00:05:00.000Z');
assert.notEqual(matcher.scoreBuildingMatch(left, aliasAtDifferentBlock, aliases).confidence, 'high');
assert.equal(matcher.scoreBuildingMatch(left, aliasAtDifferentBlock, aliases).reasons.includes('確認済み名称別名'), false);

const sameUnitA = left;
const sameUnitB = right;
const otherUnit = matcher.prepareListingRecord({
  site: 'ATHOME',
  url: 'https://www.athome.co.jp/mansion/555/',
  sourceListingId: '555',
  rawName: 'ザパークハウス新宿',
  rawAddress: '東京都新宿区西新宿1-2-3',
  priceMan: 11800,
  areaSqm: 65.2,
  floor: '10階',
  layout: '2LDK'
}, '2026-07-19T00:04:00.000Z');
const candidateBuilding = matcher.prepareListingRecord({
  site: 'REHOUSE',
  url: 'https://www.rehouse.co.jp/buy/mansion/bkdetail/666/',
  sourceListingId: '666',
  rawName: 'ザパークハウス新宿',
  rawAddress: '東京都新宿区西新宿1丁目',
  areaSqm: 72.9,
  floor: '18階',
  layout: '3LDK'
}, '2026-07-19T00:05:00.000Z');

sameUnitA.priceMan = 12000;
sameUnitA.managementFeeYen = 22000;
sameUnitB.priceMan = 12300;
sameUnitB.managementFeeYen = 23000;

const emptyOverrides = { version: 1, buildingPairs: [], unitPairs: [] };
const emptyAliases = { version: 1, entries: [] };
const index = matcher.buildListingIndex(
  [sameUnitA, sameUnitB, otherUnit, candidateBuilding],
  emptyOverrides,
  emptyAliases
);

assert.equal(index.groups.length, 2);
const matchedGroup = index.groups.find(group => group.memberKeys.includes(sameUnitA.listingKey));
assert.equal(matchedGroup.unitGroups.length, 2);
assert.equal(matchedGroup.unitGroups[0].listings.length, 2);
assert.equal(index.candidates.length, 1);

const summaries = matcher.summarizeListingMatches(index);
assert.deepEqual(summaries[sameUnitA.listingKey], {
  listingKey: sameUnitA.listingKey,
  sameUnitSiteCount: 2,
  candidateCount: 1,
  buildingUnitCount: 2,
  buildingSiteCount: 3,
  matchedSites: ['HOMES', 'SUUMO']
});
assert.equal(summaries[sameUnitB.listingKey].candidateCount, 1);

assert.deepEqual(matcher.diffUnitListings([sameUnitA, sameUnitB]), {
  minPriceMan: 12000,
  fieldsWithDifferences: ['managementFeeYen', 'priceMan'],
  priceDiffByKey: {
    [sameUnitA.listingKey]: 0,
    [sameUnitB.listingKey]: 300
  }
});

const forcedDifferent = {
  version: 1,
  buildingPairs: [{
    leftKey: matcher.pairKey(sameUnitA.listingKey, sameUnitB.listingKey).split('|')[0],
    rightKey: matcher.pairKey(sameUnitA.listingKey, sameUnitB.listingKey).split('|')[1],
    decision: 'different'
  }],
  unitPairs: []
};
const separated = matcher.buildListingIndex([sameUnitA, sameUnitB], forcedDifferent, emptyAliases);
assert.equal(separated.groups.length, 2);

const sameUnitC = { ...sameUnitA, site: 'REHOUSE', listingKey: 'REHOUSE:777', url: 'https://www.rehouse.co.jp/777' };
const transitiveDifferent = {
  version: 1,
  buildingPairs: [{
    leftKey: matcher.pairKey(sameUnitB.listingKey, sameUnitC.listingKey).split('|')[0],
    rightKey: matcher.pairKey(sameUnitB.listingKey, sameUnitC.listingKey).split('|')[1],
    decision: 'different'
  }],
  unitPairs: []
};
const transitivelySeparated = matcher.buildListingIndex(
  [sameUnitA, sameUnitB, sameUnitC], transitiveDifferent, emptyAliases
);
assert.equal(transitivelySeparated.groups.length, 2);
assert.equal(transitivelySeparated.groups.some(group => (
  group.memberKeys.includes(sameUnitB.listingKey) && group.memberKeys.includes(sameUnitC.listingKey)
)), false);

const sameBeatsAutomaticOverrides = {
  version: 1,
  buildingPairs: [
    {
      leftKey: matcher.pairKey(sameUnitA.listingKey, sameUnitC.listingKey).split('|')[0],
      rightKey: matcher.pairKey(sameUnitA.listingKey, sameUnitC.listingKey).split('|')[1],
      decision: 'same'
    },
    {
      leftKey: matcher.pairKey(sameUnitB.listingKey, sameUnitC.listingKey).split('|')[0],
      rightKey: matcher.pairKey(sameUnitB.listingKey, sameUnitC.listingKey).split('|')[1],
      decision: 'different'
    }
  ],
  unitPairs: []
};
const sameBeatsAutomatic = matcher.buildListingIndex(
  [sameUnitA, sameUnitB, sameUnitC],
  sameBeatsAutomaticOverrides,
  emptyAliases
);
assert.equal(sameBeatsAutomatic.groups.length, 2);
assert.equal(sameBeatsAutomatic.groups.some(group => (
  group.memberKeys.includes(sameUnitA.listingKey) &&
  group.memberKeys.includes(sameUnitC.listingKey) &&
  !group.memberKeys.includes(sameUnitB.listingKey)
)), true);

function canonicalIndexShape(listingIndex) {
  return {
    groups: listingIndex.groups.map(group => ({
      groupId: group.groupId,
      displayName: group.displayName,
      memberKeys: group.memberKeys,
      unitGroups: group.unitGroups.map(unit => ({
        unitId: unit.unitId,
        listingKeys: unit.listingKeys,
        listings: unit.listings.map(listing => listing.listingKey)
      }))
    })),
    candidates: listingIndex.candidates.map(candidate => ({
      scope: candidate.scope,
      leftKey: candidate.leftKey,
      rightKey: candidate.rightKey,
      leftMemberKeys: candidate.leftMemberKeys,
      rightMemberKeys: candidate.rightMemberKeys,
      score: candidate.score,
      confidence: candidate.confidence
    }))
  };
}

const canonicalInput = [sameUnitA, sameUnitB, otherUnit, candidateBuilding];
assert.deepEqual(
  canonicalIndexShape(matcher.buildListingIndex(canonicalInput, emptyOverrides, emptyAliases)),
  canonicalIndexShape(matcher.buildListingIndex([...canonicalInput].reverse(), emptyOverrides, emptyAliases))
);

const unitSameDifferentOverrides = {
  version: 1,
  buildingPairs: [],
  unitPairs: [
    {
      leftKey: matcher.pairKey(sameUnitA.listingKey, sameUnitC.listingKey).split('|')[0],
      rightKey: matcher.pairKey(sameUnitA.listingKey, sameUnitC.listingKey).split('|')[1],
      decision: 'same'
    },
    {
      leftKey: matcher.pairKey(sameUnitB.listingKey, sameUnitC.listingKey).split('|')[0],
      rightKey: matcher.pairKey(sameUnitB.listingKey, sameUnitC.listingKey).split('|')[1],
      decision: 'different'
    }
  ]
};
const unitSameBeatsAutomatic = matcher.buildListingIndex(
  [sameUnitA, sameUnitB, sameUnitC],
  unitSameDifferentOverrides,
  emptyAliases
);
assert.equal(unitSameBeatsAutomatic.groups.length, 1);
assert.equal(unitSameBeatsAutomatic.groups[0].unitGroups.length, 2);
assert.equal(unitSameBeatsAutomatic.groups[0].unitGroups.some(unit => (
  unit.listingKeys.includes(sameUnitA.listingKey) &&
  unit.listingKeys.includes(sameUnitC.listingKey) &&
  !unit.listingKeys.includes(sameUnitB.listingKey)
)), true);

const contradictoryManualOverrides = {
  version: 1,
  buildingPairs: [
    {
      leftKey: matcher.pairKey(sameUnitA.listingKey, sameUnitB.listingKey).split('|')[0],
      rightKey: matcher.pairKey(sameUnitA.listingKey, sameUnitB.listingKey).split('|')[1],
      decision: 'same'
    },
    {
      leftKey: matcher.pairKey(sameUnitA.listingKey, sameUnitC.listingKey).split('|')[0],
      rightKey: matcher.pairKey(sameUnitA.listingKey, sameUnitC.listingKey).split('|')[1],
      decision: 'same'
    },
    {
      leftKey: matcher.pairKey(sameUnitB.listingKey, sameUnitC.listingKey).split('|')[0],
      rightKey: matcher.pairKey(sameUnitB.listingKey, sameUnitC.listingKey).split('|')[1],
      decision: 'different'
    }
  ],
  unitPairs: []
};
const contradictoryManual = matcher.buildListingIndex(
  [sameUnitA, sameUnitB, sameUnitC],
  contradictoryManualOverrides,
  emptyAliases
);
const reversedContradictoryManual = matcher.buildListingIndex(
  [sameUnitC, sameUnitB, sameUnitA],
  {
    ...contradictoryManualOverrides,
    buildingPairs: [...contradictoryManualOverrides.buildingPairs].reverse()
  },
  emptyAliases
);
assert.deepEqual(
  canonicalIndexShape(contradictoryManual),
  canonicalIndexShape(reversedContradictoryManual)
);
assert.equal(contradictoryManual.groups.some(group => (
  group.memberKeys.includes(sameUnitB.listingKey) &&
  group.memberKeys.includes(sameUnitC.listingKey)
)), false);

const deduplicatedBuildingCandidates = matcher.buildListingIndex(
  [sameUnitA, sameUnitB, candidateBuilding],
  emptyOverrides,
  emptyAliases
).candidates.filter(candidate => candidate.scope === 'building');
assert.equal(deduplicatedBuildingCandidates.length, 1);
assert.equal([
  deduplicatedBuildingCandidates[0].leftMemberKeys,
  deduplicatedBuildingCandidates[0].rightMemberKeys
].some(memberKeys => (
  memberKeys.includes(sameUnitA.listingKey) && memberKeys.includes(sameUnitB.listingKey)
)), true);

assert.deepEqual(matcher.diffUnitListings([
  { listingKey: 'SUUMO:missing-null', priceMan: null },
  { listingKey: 'HOMES:missing-empty', priceMan: '' },
  { listingKey: 'ATHOME:priced', priceMan: 12000 }
]), {
  minPriceMan: 12000,
  fieldsWithDifferences: [],
  priceDiffByKey: {
    'SUUMO:missing-null': null,
    'HOMES:missing-empty': null,
    'ATHOME:priced': 0
  }
});

const sameNameTokyo = matcher.prepareListingRecord({
  site: 'SUUMO', url: 'https://suumo.jp/regression-tokyo',
  rawName: 'グランドレジデンス', rawAddress: '東京都港区芝1-2-3'
}, '2026-07-19T00:10:00.000Z');
const sameNameOsaka = matcher.prepareListingRecord({
  site: 'HOMES', url: 'https://www.homes.co.jp/regression-osaka',
  rawName: 'グランドレジデンス', rawAddress: '大阪府大阪市北区梅田1-2-3'
}, '2026-07-19T00:10:01.000Z');
assert.equal(matcher.scoreBuildingMatch(sameNameTokyo, sameNameOsaka, []).confidence, 'none');

const firstWing = { ...left, listingKey: 'SUUMO:wing-1', buildingWing: '1棟', roomNumber: '1801' };
const secondWing = { ...right, listingKey: 'HOMES:wing-2', buildingWing: '2棟', roomNumber: '1801' };
assert.equal(matcher.scoreUnitMatch(firstWing, secondWing).confidence, 'none');
const forcedSameWingIndex = matcher.buildListingIndex([firstWing, secondWing], {
  version: 1,
  buildingPairs: [],
  unitPairs: [{
    leftKey: matcher.pairKey(firstWing.listingKey, secondWing.listingKey).split('|')[0],
    rightKey: matcher.pairKey(firstWing.listingKey, secondWing.listingKey).split('|')[1],
    decision: 'same'
  }]
}, { version: 1, entries: [] });
assert.equal(forcedSameWingIndex.groups[0].unitGroups.length, 1);

const noAddressOne = matcher.prepareListingRecord({
  site: 'SUUMO', url: 'https://suumo.jp/no-address-1', rawName: '同名レジデンス',
  priceMan: 9000, areaSqm: 70
}, '2026-07-19T00:11:00.000Z');
const noAddressTwo = matcher.prepareListingRecord({
  site: 'ATHOME', url: 'https://www.athome.co.jp/no-address-2', rawName: '同名レジデンス',
  priceMan: 9000, areaSqm: 70
}, '2026-07-19T00:11:01.000Z');
assert.notEqual(matcher.scoreBuildingMatch(noAddressOne, noAddressTwo, []).confidence, 'high');

const scopedAliases = {
  version: 1,
  entries: [{
    addressBlockKey: '東京都中央区晴海2-3-30',
    normalizedNames: ['アルファ棟', 'ベータ棟'],
    confirmedAt: '2026-07-19T00:00:00.000Z'
  }]
};
const toyosuAlpha = matcher.prepareListingRecord({
  site: 'SUUMO', url: 'https://suumo.jp/toyosu-alpha',
  rawName: 'アルファ棟', rawAddress: '東京都江東区豊洲2-3-30'
}, '2026-07-19T00:12:00.000Z');
const toyosuBeta = matcher.prepareListingRecord({
  site: 'HOMES', url: 'https://www.homes.co.jp/toyosu-beta',
  rawName: 'ベータ棟', rawAddress: '東京都江東区豊洲2-3-30'
}, '2026-07-19T00:12:01.000Z');
assert.equal(
  matcher.scoreBuildingMatch(toyosuAlpha, toyosuBeta, scopedAliases.entries).reasons.includes('確認済み名称別名'),
  false
);

const harumiAlpha = matcher.prepareListingRecord({
  site: 'SUUMO', url: 'https://suumo.jp/harumi-alpha',
  rawName: 'アルファ棟', rawAddress: '東京都中央区晴海2-3-30'
}, '2026-07-19T00:13:00.000Z');
const harumiBeta = matcher.prepareListingRecord({
  site: 'HOMES', url: 'https://www.homes.co.jp/harumi-beta',
  rawName: 'ベータ棟', rawAddress: '東京都中央区晴海2-3-30'
}, '2026-07-19T00:13:01.000Z');
assert.equal(matcher.scoreBuildingMatch(harumiAlpha, harumiBeta, scopedAliases.entries).confidence, 'high');
const aliasForcedDifferent = matcher.buildListingIndex([harumiAlpha, harumiBeta], {
  version: 1,
  buildingPairs: [{
    leftKey: matcher.pairKey(harumiAlpha.listingKey, harumiBeta.listingKey).split('|')[0],
    rightKey: matcher.pairKey(harumiAlpha.listingKey, harumiBeta.listingKey).split('|')[1],
    decision: 'different'
  }],
  unitPairs: []
}, scopedAliases);
assert.equal(aliasForcedDifferent.groups.length, 2);
assert.doesNotThrow(() => matcher.buildListingIndex(
  [sameNameTokyo, sameNameOsaka],
  { version: 1, buildingPairs: {}, unitPairs: null },
  { version: 1, entries: {} }
));
