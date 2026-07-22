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
