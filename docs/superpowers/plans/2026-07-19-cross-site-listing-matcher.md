# Site-Crossing Listing Matcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record properties viewed on the four supported sites, match the same condominium and unit locally, and show cross-site price and listing differences on property pages and in the Side Panel.

**Architecture:** Put all deterministic normalization, scoring, grouping, and diff logic in a DOM-free `property-matcher.js`. Put deterministic retention and merge rules in `observed-listings-store.js`; `background.js` serializes Chrome storage mutations and exposes a small message API. `content.js` only extracts records and renders a compact match badge, while `sidepanel.js` owns the hierarchical comparison and manual decisions.

**Tech Stack:** Chrome Extension Manifest V3, plain JavaScript, `chrome.storage.local`, `chrome.runtime` messaging, Chrome Side Panel, Node.js `assert/strict`, Playwright extension E2E, Bash/PowerShell build scripts.

## Global Constraints

- Before Task 1, use `superpowers:using-git-worktrees` and verify that the execution worktree starts from a commit containing the current Side Panel, AI, notification, and local-build changes.
- The current workspace contains user-owned uncommitted changes. Do not stage, commit, stash, overwrite, or copy those changes into a feature commit without explicit user authorization.
- If the prerequisite changes are still uncommitted when execution begins, stop before implementation and ask the user to commit them or authorize a baseline snapshot.
- Match only listings the user viewed or favorited; never crawl or query unvisited listing sites.
- Store all matching data in `chrome.storage.local`; send no matching data to an external service.
- Add no Chrome permissions and no host permissions.
- Keep matching enabled by default, retain non-favorites for 90 days, keep at most 500 non-favorites, and exempt favorites from both limits.
- Never auto-match a building from its name alone. A high-confidence building match requires matching block-level address data.
- Building confidence thresholds are high at 80 or more, candidate at 60–79, and unmatched below 60.
- Unit confidence thresholds are high at 80 or more, candidate at 55–79, and separate below 55.
- Price must never contribute to identity matching.
- Manual `same` and `different` decisions override automatic matching.
- A learned building-name alias is valid only inside one exact normalized block-address key.
- Clearing a manual building `same` decision also forgets learned aliases for that address block so the pair returns to automatic candidate evaluation.
- Match copy must say that a match was found in viewed history; it must not imply exhaustive internet-wide coverage.
- Matching failures must not break unit price, favorites, price watch, AI memo, CSV, or loan calculations.
- Every implementation task follows red-green-refactor and ends with a focused commit only after its complete verification command passes.
- Design source: `docs/superpowers/specs/2026-07-11-cross-site-listing-matcher-design.md`.

---

## File Structure

### New files

- `property-matcher.js` — normalization, scoring, grouping, match summaries, and unit-field diffs; no DOM or Chrome API access.
- `observed-listings-store.js` — record merge, retention, favorites exemption, manual decisions, and alias updates; no Chrome API access.
- `test_property_matcher.js` — matcher unit tests using `assert/strict`.
- `test_observed_listings_store.js` — storage-policy unit tests using `assert/strict`.

### Existing files to modify

- `manifest.json` — load `property-matcher.js` before `content.js`.
- `background.js` — import shared modules, serialize writes, expose cross-site message handlers, open Side Panel from a listing badge.
- `test_background.js` — verify controller serialization, disabled behavior, selection handoff, and clearing.
- `content.js` — create normalized records for list/detail pages, batch upserts, render badges, react to settings changes.
- `styles.css` — style match and candidate badges without changing existing unit-price layout.
- `sidepanel.html` — load matcher first and relabel the existing similar-candidate section.
- `sidepanel.js` — replace heuristic favorite grouping with stored listing groups and manual match actions.
- `sidepanel.css` — hierarchical building/unit/listing presentation and decision controls.
- `popup.html` — add local cross-site matching settings and delete action.
- `popup.js` — load/save settings, clear data, show status, add release note.
- `popup.css` — settings section and destructive-action styles.
- `tests/e2e_extension.js` — copy shared files and verify list-to-list matching, Side Panel comparison, manual decisions, settings, and deletion.
- `package.json` and `scripts/test.sh` — run new syntax checks and unit tests.
- `build.sh`, `build.ps1`, and `scripts/build-local.sh` — include both shared JavaScript files.
- `.github/workflows/ci.yml` and `.github/workflows/release.yml` — validate and package both shared files.
- `scripts/capture-store-screenshots.js` — seed a cross-site match and show it in the comparison screenshot.
- `README.md`, `PRIVACY_POLICY.md`, `PRIVACY_PRACTICES.txt`, `STORE_LISTING_TEXT.txt`, `AGENTS.md`, and `CLAUDE.md` — document behavior, retention, local storage, and Store copy.

### Task 1: Pure normalization and identity scoring

**Files:**
- Create: `property-matcher.js`
- Create: `test_property_matcher.js`
- Modify: `package.json:5-10`
- Modify: `scripts/test.sh:10-22`

**Interfaces:**
- Consumes: raw listing fields such as `rawName`, `rawAddress`, `layout`, `floor`, `roomNumber`, `areaSqm`, `builtAt`, `totalUnits`, `buildingFloors`, `direction`, and `balconyAreaSqm`.
- Produces: global/CommonJS API `FudosanPropertyMatcher` with `normalizeBuildingName`, `extractBuildingWing`, `normalizeAddress`, `normalizeLayout`, `parseFloor`, `parseArea`, `normalizeBuiltAt`, `diceCoefficient`, `normalizeUrl`, `extractSourceListingId`, `prepareListingRecord`, `scoreBuildingMatch`, and `scoreUnitMatch`.

- [ ] **Step 1: Write failing normalization tests**

Create `test_property_matcher.js` with these concrete assertions:

```javascript
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
```

- [ ] **Step 2: Run the normalization test and verify the missing-module failure**

Run: `node test_property_matcher.js`

Expected: non-zero exit with `Cannot find module './property-matcher.js'`.

- [ ] **Step 3: Add failing building and unit score tests**

Append these cases before implementation:

```javascript
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
```

- [ ] **Step 4: Implement the pure matcher foundation**

Create `property-matcher.js` as a classic script/CommonJS dual export. Use this public shape and constants exactly:

```javascript
(function initPropertyMatcher(globalScope) {
  'use strict';

  const BUILDING_HIGH_SCORE = 80;
  const BUILDING_CANDIDATE_SCORE = 60;
  const UNIT_HIGH_SCORE = 80;
  const UNIT_CANDIDATE_SCORE = 55;
  const DECORATION_PATTERN = /中古マンション|価格改定|新価格|新着|売主|専任|一般/g;
  const KANJI_DIGITS = new Map([
    ['〇', 0], ['零', 0], ['一', 1], ['二', 2], ['三', 3], ['四', 4],
    ['五', 5], ['六', 6], ['七', 7], ['八', 8], ['九', 9],
    ['壱', 1], ['弐', 2], ['参', 3]
  ]);

  function parseKanjiNumberToken(token) {
    if (token.includes('十')) {
      const [tensText, onesText] = token.split('十');
      const tens = tensText ? KANJI_DIGITS.get(tensText) : 1;
      const ones = onesText ? KANJI_DIGITS.get(onesText) : 0;
      return String(tens * 10 + ones);
    }
    return token.split('').map(char => KANJI_DIGITS.get(char)).join('');
  }

  function normalizeNumberBefore(value, suffixPattern) {
    const pattern = new RegExp(`([〇零一二三四五六七八九十壱弐参]+)(?=${suffixPattern})`, 'g');
    return String(value || '').replace(pattern, parseKanjiNumberToken);
  }

  function normalizeRomanBuildingNumber(value) {
    return String(value || '')
      .replace(/Ⅳ|\biv\b/gi, '4')
      .replace(/Ⅲ|\biii\b/gi, '3')
      .replace(/Ⅱ|\bii\b/gi, '2')
      .replace(/Ⅰ|\bi\b/gi, '1');
  }

  function baseText(value) {
    return normalizeRomanBuildingNumber(String(value || '').normalize('NFKC'))
      .toLowerCase()
      .replace(DECORATION_PATTERN, '')
      .replace(/(\d+)階部分/g, '')
      .trim();
  }

  function normalizeBuildingName(value) {
    return normalizeNumberBefore(baseText(value), '番館|号館|棟')
      .replace(/the\s+park\s*house/g, 'ザパークハウス')
      .replace(/\bwest\b/g, 'ウエスト')
      .replace(/\beast\b/g, 'イースト')
      .replace(/[\s　・･,，.。()（）\[\]【】「」『』_＿\-]/g, '');
  }

  function extractBuildingWing(value) {
    const normalized = normalizeNumberBefore(baseText(value), '番館|号館|棟')
      .replace(/\bwest\b/g, 'ウエスト')
      .replace(/\beast\b/g, 'イースト')
      .replace(/[\s　・･]/g, '');
    const match = normalized.match(/(\d+棟|ウエスト棟?|イースト棟?|サウス棟?|ノース棟?)$/);
    return match ? match[1] : '';
  }

  function normalizeAddress(value) {
    let normalized = normalizeNumberBefore(String(value || '').normalize('NFKC'), '丁目|番地?|号')
      .replace(/\d+階(?:部分)?|\d+号室/g, '')
      .replace(/[\s　]/g, '')
      .replace(/丁目/g, '-')
      .replace(/番地?|号/g, '-')
      .replace(/[‐‑‒–—―ー－]/g, '-')
      .replace(/-+/g, '-')
      .replace(/-$/, '');
    const addressPrefix = normalized.match(/^([^\d-]+\d+(?:-\d+){0,2})/);
    if (addressPrefix) normalized = addressPrefix[1];
    const townMatch = normalized.match(/^([^\d-]+)/);
    const addressMatch = townMatch && normalized.match(/^([^\d-]+)(\d+-\d+(?:-\d+)?)$/);
    return {
      normalized,
      municipalityTownKey: townMatch ? townMatch[1] : '',
      addressBlockKey: addressMatch ? `${addressMatch[1]}${addressMatch[2]}` : ''
    };
  }

  function normalizeLayout(value) {
    const match = String(value || '').normalize('NFKC').toUpperCase().match(/\d+[SLDK]+/);
    return match ? match[0] : '';
  }

  function parseFloor(value) {
    const text = String(value || '').normalize('NFKC');
    const match = text.match(/(?:所在階[^\d]*)?(\d+)階/) || text.match(/^\d+$/);
    return match ? Number(match[1] || match[0]) : null;
  }

  function parseArea(value) {
    const number = Number.parseFloat(String(value || '').normalize('NFKC').replace(/,/g, ''));
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  function parseInteger(value) {
    const match = String(value || '').normalize('NFKC').replace(/,/g, '').match(/\d+/);
    return match ? Number(match[0]) : null;
  }

  function normalizeBuiltAt(value) {
    const match = String(value || '').normalize('NFKC').match(/(\d{4})年\s*(\d{1,2})月/);
    return match ? `${match[1]}-${match[2].padStart(2, '0')}` : '';
  }

  function bigrams(value) {
    if (value.length < 2) return [value];
    return Array.from({ length: value.length - 1 }, (_, index) => value.slice(index, index + 2));
  }

  function diceCoefficient(leftValue, rightValue) {
    const left = String(leftValue || '');
    const right = String(rightValue || '');
    if (!left || !right) return 0;
    if (left === right) return 1;
    if (left.length < 4 || right.length < 4) return 0;
    const rightCounts = new Map();
    bigrams(right).forEach(token => rightCounts.set(token, (rightCounts.get(token) || 0) + 1));
    let intersection = 0;
    bigrams(left).forEach((token) => {
      const count = rightCounts.get(token) || 0;
      if (count > 0) {
        intersection += 1;
        rightCounts.set(token, count - 1);
      }
    });
    return (2 * intersection) / (bigrams(left).length + bigrams(right).length);
  }

  function normalizeUrl(value) {
    try {
      const url = new URL(value);
      url.hash = '';
      ['utm_source', 'utm_medium', 'utm_campaign', 'vos', 'fmlg'].forEach(key => url.searchParams.delete(key));
      return url.href;
    } catch (error) {
      return String(value || '');
    }
  }

  function extractSourceListingId(url, site) {
    const patterns = {
      SUUMO: /\/nc_(\d+)/,
      REHOUSE: /\/bkdetail\/([^/?#]+)/,
      ATHOME: /\/mansion\/(\d+)/,
      HOMES: /\/mansion\/b-([^/?#]+)/
    };
    return String(url || '').match(patterns[String(site || '').toUpperCase()])?.[1] || '';
  }

  function prepareListingRecord(input, seenAt) {
    const address = normalizeAddress(input.rawAddress);
    const url = normalizeUrl(input.url);
    const site = String(input.site || '').toUpperCase();
    const sourceId = String(input.sourceListingId || extractSourceListingId(url, site)).trim();
    const fullBuildingName = normalizeBuildingName(input.rawName);
    const buildingWing = input.buildingWing || extractBuildingWing(input.rawName);
    return {
      ...input,
      site,
      url,
      listingKey: `${site}:${sourceId || url}`,
      normalizedBuildingName: buildingWing && fullBuildingName.endsWith(buildingWing)
        ? fullBuildingName.slice(0, -buildingWing.length)
        : fullBuildingName,
      buildingWing,
      normalizedAddress: address.normalized,
      municipalityTownKey: address.municipalityTownKey,
      addressBlockKey: address.addressBlockKey,
      areaSqm: parseArea(input.areaSqm),
      floor: parseFloor(input.floor),
      roomNumber: String(input.roomNumber || '').replace(/\D/g, ''),
      layout: normalizeLayout(input.layout),
      builtAt: normalizeBuiltAt(input.builtAt),
      totalUnits: parseInteger(input.totalUnits),
      buildingFloors: parseInteger(input.buildingFloors),
      direction: String(input.direction || '').trim(),
      balconyAreaSqm: parseArea(input.balconyAreaSqm),
      firstSeenAt: input.firstSeenAt || seenAt,
      lastSeenAt: seenAt
    };
  }

  function matchingAlias(left, right, aliases) {
    if (!left.addressBlockKey || left.addressBlockKey !== right.addressBlockKey) return false;
    return (Array.isArray(aliases) ? aliases : []).some(entry => (
      entry.addressBlockKey === left.addressBlockKey &&
      Array.isArray(entry.normalizedNames) &&
      entry.normalizedNames.includes(left.normalizedBuildingName) &&
      entry.normalizedNames.includes(right.normalizedBuildingName)
    ));
  }

  function scoreBuildingMatch(left, right, aliases = []) {
    const reasons = [];
    let score = 0;
    const blockMatch = left.addressBlockKey && left.addressBlockKey === right.addressBlockKey;
    if (blockMatch) {
      score += 45;
      reasons.push('街区住所が一致');
    } else if (left.municipalityTownKey && left.municipalityTownKey === right.municipalityTownKey) {
      score += Boolean(left.addressBlockKey) !== Boolean(right.addressBlockKey) ? 30 : 15;
      reasons.push('町域が一致');
    }
    const aliasMatch = matchingAlias(left, right, aliases);
    const nameSimilarity = diceCoefficient(left.normalizedBuildingName, right.normalizedBuildingName);
    if (aliasMatch || (left.normalizedBuildingName && left.normalizedBuildingName === right.normalizedBuildingName)) {
      score += 35;
      reasons.push(aliasMatch ? '確認済み名称別名' : '物件名が一致');
    } else if (nameSimilarity >= 0.85) {
      score += 25;
      reasons.push('物件名が強く類似');
    } else if (nameSimilarity >= 0.7) {
      score += 15;
      reasons.push('物件名が類似');
    }
    if (left.builtAt && left.builtAt === right.builtAt) score += 10;
    if (left.totalUnits && left.totalUnits === right.totalUnits) score += 5;
    if (left.buildingFloors && left.buildingFloors === right.buildingFloors) score += 5;
    const confidence = blockMatch && score >= BUILDING_HIGH_SCORE
      ? 'high'
      : score >= BUILDING_CANDIDATE_SCORE
        ? 'candidate'
        : 'none';
    return { score, confidence, reasons };
  }

  function scoreUnitMatch(left, right) {
    if (left.buildingWing && right.buildingWing && left.buildingWing !== right.buildingWing) {
      return { score: 0, confidence: 'none', reasons: ['棟名が異なる'] };
    }
    if (left.roomNumber && right.roomNumber && left.roomNumber !== right.roomNumber) {
      return { score: 0, confidence: 'none', reasons: ['部屋番号が異なる'] };
    }
    const reasons = [];
    const areaDiff = left.areaSqm && right.areaSqm ? Math.abs(left.areaSqm - right.areaSqm) : null;
    let score = 0;
    if (left.roomNumber && left.roomNumber === right.roomNumber) { score += 40; reasons.push('部屋番号が一致'); }
    if (areaDiff !== null && areaDiff <= 0.5) { score += 45; reasons.push('専有面積が一致'); }
    else if (areaDiff !== null && areaDiff <= 1.0) { score += 25; reasons.push('専有面積が近い'); }
    if (left.floor && left.floor === right.floor) { score += 30; reasons.push('階数が一致'); }
    if (left.layout && left.layout === right.layout) { score += 15; reasons.push('間取りが一致'); }
    if (left.direction && left.direction === right.direction) score += 5;
    if (left.balconyAreaSqm && right.balconyAreaSqm && Math.abs(left.balconyAreaSqm - right.balconyAreaSqm) <= 0.5) score += 5;
    const roomMatches = left.roomNumber && left.roomNumber === right.roomNumber;
    const roomCorroborated = roomMatches && (areaDiff !== null && areaDiff <= 1.0 || left.floor && left.floor === right.floor);
    const confidence = roomCorroborated || score >= UNIT_HIGH_SCORE
      ? 'high'
      : roomMatches || score >= UNIT_CANDIDATE_SCORE
        ? 'candidate'
        : 'none';
    return { score, confidence, reasons };
  }

  const api = {
    normalizeBuildingName, extractBuildingWing, normalizeAddress, normalizeLayout,
    parseFloor, parseArea, normalizeBuiltAt, diceCoefficient, normalizeUrl,
    extractSourceListingId, prepareListingRecord, scoreBuildingMatch, scoreUnitMatch
  };
  globalScope.FudosanPropertyMatcher = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
```

- [ ] **Step 5: Run matcher tests**

Run: `node test_property_matcher.js`

Expected: exit 0 with no assertion failures.

- [ ] **Step 6: Add the matcher to normal test entry points**

Change `package.json` so `test` begins with:

```json
"test": "node --check property-matcher.js && node --check content.js && node --check popup.js && node --check sidepanel.js && node --check background.js && node --check scripts/make-local-manifest.js && node test_property_matcher.js && node test_csv_export.js && node test_background.js"
```

Add to `scripts/test.sh` before the existing content check:

```bash
"$NODE_BIN" --check property-matcher.js
```

Add after the syntax checks:

```bash
"$NODE_BIN" test_property_matcher.js
```

- [ ] **Step 7: Run the npm-free suite**

Run: `bash scripts/test.sh`

Expected: existing tests pass and the final line is `npm-free test checks passed`.

- [ ] **Step 8: Commit the pure matcher**

```bash
git add property-matcher.js test_property_matcher.js package.json scripts/test.sh
git commit -m "feat: add cross-site property matcher"
```

### Task 2: Grouping, match summaries, aliases, and listing diffs

**Files:**
- Modify: `property-matcher.js`
- Modify: `test_property_matcher.js`

**Interfaces:**
- Consumes: Task 1's normalized records and `{version, buildingPairs, unitPairs}` overrides plus `{version, entries}` aliases.
- Produces: `pairKey`, `buildListingIndex`, `summarizeListingMatches`, and `diffUnitListings` on `FudosanPropertyMatcher`.

- [ ] **Step 1: Add failing grouping and diff tests**

Append fixtures for two sites on one unit, another unit in the same building, and one building candidate:

```javascript
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
```

- [ ] **Step 2: Run the matcher test and verify the missing-function failure**

Run: `node test_property_matcher.js`

Expected: non-zero exit because `buildListingIndex` is not defined.

- [ ] **Step 3: Implement deterministic grouping and summaries**

Add the following exact behaviors to `property-matcher.js`:

```javascript
function pairKey(leftKey, rightKey) {
  return [leftKey, rightKey].sort().join('|');
}

function decisionMap(pairs) {
  return new Map((Array.isArray(pairs) ? pairs : [])
    .filter(item => item?.leftKey && item?.rightKey && ['same', 'different'].includes(item.decision))
    .map(item => [pairKey(item.leftKey, item.rightKey), item.decision]));
}

function createUnionFind(keys, blockedPairs = new Set()) {
  const parent = new Map(keys.map(key => [key, key]));
  const members = new Map(keys.map(key => [key, new Set([key])]));
  const find = (key) => {
    const current = parent.get(key);
    if (current === key) return key;
    const root = find(current);
    parent.set(key, root);
    return root;
  };
  const hasConflict = (leftKey, rightKey) => {
    const leftRoot = find(leftKey);
    const rightRoot = find(rightKey);
    if (leftRoot === rightRoot) return false;
    const leftMembers = members.get(leftRoot) || new Set();
    const rightMembers = members.get(rightRoot) || new Set();
    return Array.from(leftMembers).some(leftMember => (
      Array.from(rightMembers).some(rightMember => blockedPairs.has(pairKey(leftMember, rightMember)))
    ));
  };
  const unite = (leftKey, rightKey) => {
    const leftRoot = find(leftKey);
    const rightRoot = find(rightKey);
    if (leftRoot === rightRoot) return true;
    if (hasConflict(leftRoot, rightRoot)) return false;
    const leftMembers = members.get(leftRoot) || new Set();
    const rightMembers = members.get(rightRoot) || new Set();
    parent.set(rightRoot, leftRoot);
    rightMembers.forEach(key => leftMembers.add(key));
    members.set(leftRoot, leftMembers);
    members.delete(rightRoot);
    return true;
  };
  return { find, unite, hasConflict };
}

function stableId(prefix, keys) {
  let hash = 2166136261;
  [...keys].sort().join('|').split('').forEach((char) => {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  });
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}

function buildListingIndex(records, overrides = {}, aliasState = {}) {
  const items = (Array.isArray(records) ? records : []).filter(record => record && record.listingKey);
  const byKey = new Map(items.map(record => [record.listingKey, record]));
  const buildingDecisions = decisionMap(overrides?.buildingPairs);
  const unitDecisions = decisionMap(overrides?.unitPairs);
  const aliases = Array.isArray(aliasState?.entries) ? aliasState.entries : [];
  const blockedBuildings = new Set(Array.from(buildingDecisions)
    .filter(([, decision]) => decision === 'different')
    .map(([key]) => key));
  const buildingUf = createUnionFind(items.map(item => item.listingKey), blockedBuildings);
  const rawBuildingCandidates = [];
  const unitCandidates = [];

  for (let leftIndex = 0; leftIndex < items.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < items.length; rightIndex += 1) {
      const leftItem = items[leftIndex];
      const rightItem = items[rightIndex];
      const key = pairKey(leftItem.listingKey, rightItem.listingKey);
      const forced = buildingDecisions.get(key);
      if (leftItem.site === rightItem.site && !forced) continue;
      const result = scoreBuildingMatch(leftItem, rightItem, aliases);
      if (forced === 'same' || !forced && result.confidence === 'high') {
        buildingUf.unite(leftItem.listingKey, rightItem.listingKey);
      } else if (forced !== 'different' && result.confidence === 'candidate') {
        rawBuildingCandidates.push({ scope: 'building', leftKey: leftItem.listingKey, rightKey: rightItem.listingKey, ...result });
      }
    }
  }

  const buildingBuckets = new Map();
  items.forEach((item) => {
    const root = buildingUf.find(item.listingKey);
    if (!buildingBuckets.has(root)) buildingBuckets.set(root, []);
    buildingBuckets.get(root).push(item);
  });

  const buildingCandidateMap = new Map();
  rawBuildingCandidates.forEach((candidate) => {
    const leftRoot = buildingUf.find(candidate.leftKey);
    const rightRoot = buildingUf.find(candidate.rightKey);
    if (leftRoot === rightRoot || buildingUf.hasConflict(leftRoot, rightRoot)) return;
    const key = pairKey(leftRoot, rightRoot);
    const current = buildingCandidateMap.get(key);
    if (!current || candidate.score > current.score) {
      buildingCandidateMap.set(key, {
        ...candidate,
        leftKey: leftRoot,
        rightKey: rightRoot,
        leftMemberKeys: (buildingBuckets.get(leftRoot) || []).map(item => item.listingKey),
        rightMemberKeys: (buildingBuckets.get(rightRoot) || []).map(item => item.listingKey)
      });
    }
  });

  const groups = Array.from(buildingBuckets.values()).map((buildingItems) => {
    const blockedUnits = new Set(Array.from(unitDecisions)
      .filter(([, decision]) => decision === 'different')
      .map(([key]) => key));
    const unitUf = createUnionFind(buildingItems.map(item => item.listingKey), blockedUnits);
    const rawUnitCandidates = [];
    for (let leftIndex = 0; leftIndex < buildingItems.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < buildingItems.length; rightIndex += 1) {
        const leftItem = buildingItems[leftIndex];
        const rightItem = buildingItems[rightIndex];
        const key = pairKey(leftItem.listingKey, rightItem.listingKey);
        const forced = unitDecisions.get(key);
        if (leftItem.site === rightItem.site && !forced) continue;
        const result = scoreUnitMatch(leftItem, rightItem);
        if (forced === 'same' || !forced && result.confidence === 'high') {
          unitUf.unite(leftItem.listingKey, rightItem.listingKey);
        } else if (forced !== 'different' && result.confidence === 'candidate') {
          rawUnitCandidates.push({ scope: 'unit', leftKey: leftItem.listingKey, rightKey: rightItem.listingKey, ...result });
        }
      }
    }
    const units = new Map();
    buildingItems.forEach((item) => {
      const root = unitUf.find(item.listingKey);
      if (!units.has(root)) units.set(root, []);
      units.get(root).push(item);
    });
    const unitCandidateMap = new Map();
    rawUnitCandidates.forEach((candidate) => {
      const leftRoot = unitUf.find(candidate.leftKey);
      const rightRoot = unitUf.find(candidate.rightKey);
      if (leftRoot === rightRoot || unitUf.hasConflict(leftRoot, rightRoot)) return;
      const key = pairKey(leftRoot, rightRoot);
      const current = unitCandidateMap.get(key);
      if (!current || candidate.score > current.score) {
        unitCandidateMap.set(key, {
          ...candidate,
          leftKey: leftRoot,
          rightKey: rightRoot,
          leftMemberKeys: (units.get(leftRoot) || []).map(item => item.listingKey),
          rightMemberKeys: (units.get(rightRoot) || []).map(item => item.listingKey)
        });
      }
    });
    unitCandidates.push(...unitCandidateMap.values());
    return {
      groupId: stableId('building', buildingItems.map(item => item.listingKey)),
      displayName: buildingItems.find(item => item.rawName)?.rawName || '物件名不明',
      memberKeys: buildingItems.map(item => item.listingKey),
      unitGroups: Array.from(units.values()).map(unitItems => ({
        unitId: stableId('unit', unitItems.map(item => item.listingKey)),
        listingKeys: unitItems.map(item => item.listingKey),
        listings: [...unitItems].sort((leftItem, rightItem) => Number(leftItem.priceMan || Infinity) - Number(rightItem.priceMan || Infinity)),
        diff: diffUnitListings(unitItems)
      }))
    };
  });

  return { groups, candidates: [...buildingCandidateMap.values(), ...unitCandidates], byKey };
}

function diffUnitListings(listings) {
  const comparableFields = ['priceMan', 'areaSqm', 'layout', 'floor', 'managementFeeYen', 'repairFundYen'];
  const prices = listings.map(item => Number(item.priceMan)).filter(Number.isFinite);
  const minPriceMan = prices.length ? Math.min(...prices) : null;
  const fieldsWithDifferences = comparableFields.filter((field) => {
    const values = listings.map(item => item[field]).filter(value => value !== null && value !== undefined && value !== '');
    if (field === 'areaSqm') {
      const numericValues = values.map(Number).filter(Number.isFinite);
      return numericValues.length > 1 && Math.max(...numericValues) - Math.min(...numericValues) > 0.1;
    }
    return new Set(values).size > 1;
  });
  return {
    minPriceMan,
    fieldsWithDifferences: fieldsWithDifferences.sort(),
    priceDiffByKey: Object.fromEntries(listings.map(item => [
      item.listingKey,
      minPriceMan === null || !Number.isFinite(Number(item.priceMan)) ? null : Number(item.priceMan) - minPriceMan
    ]))
  };
}

function summarizeListingMatches(index) {
  const summaries = {};
  index.groups.forEach((group) => {
    const buildingSiteCount = new Set(group.unitGroups.flatMap(unit => unit.listings.map(item => item.site))).size;
    group.unitGroups.forEach((unitGroup) => {
      const matchedSites = Array.from(new Set(unitGroup.listings.map(item => item.site))).sort();
      unitGroup.listings.forEach((item) => {
        summaries[item.listingKey] = {
          listingKey: item.listingKey,
          sameUnitSiteCount: matchedSites.length,
          candidateCount: index.candidates.filter(candidate => (
            candidate.leftMemberKeys?.includes(item.listingKey) || candidate.rightMemberKeys?.includes(item.listingKey)
          )).length,
          buildingUnitCount: group.unitGroups.length,
          buildingSiteCount,
          matchedSites
        };
      });
    });
  });
  return summaries;
}
```

Export all four functions in the browser and CommonJS API.

- [ ] **Step 4: Run matcher tests**

Run: `node test_property_matcher.js`

Expected: exit 0 with no assertion failures.

- [ ] **Step 5: Run the full lightweight suite**

Run: `bash scripts/test.sh`

Expected: final line `npm-free test checks passed`.

- [ ] **Step 6: Commit grouping and diff behavior**

```bash
git add property-matcher.js test_property_matcher.js
git commit -m "feat: group matching listings and compare fields"
```

### Task 3: Deterministic storage policy and background controller

**Files:**
- Create: `observed-listings-store.js`
- Create: `test_observed_listings_store.js`
- Modify: `background.js:1-40, 511-565`
- Modify: `test_background.js:7-90`
- Modify: `manifest.json:13-24`
- Modify: `package.json:5-10`
- Modify: `scripts/test.sh:10-22`

**Interfaces:**
- Consumes: Task 2 matcher API, `favorites`, the four user-data/settings keys, and internal `crossSiteMigrationsV1.favoriteBackfillCompleted`.
- Produces: `FudosanObservedListingsStore`, startup favorite backfill, plus background messages `CROSS_SITE_UPSERT`, `CROSS_SITE_GET_STATE`, `CROSS_SITE_SAVE_DECISION`, `CROSS_SITE_CLEAR`, `CROSS_SITE_OPEN`, and `CROSS_SITE_SAVE_SETTINGS`.

- [ ] **Step 1: Write failing retention and merge tests**

Create `test_observed_listings_store.js` with fixed dates and these cases:

```javascript
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
```

- [ ] **Step 2: Add failing manual-decision and alias tests**

Append:

```javascript
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
```

- [ ] **Step 3: Run the store test and verify the missing-module failure**

Run: `node test_observed_listings_store.js`

Expected: non-zero exit with `Cannot find module './observed-listings-store.js'`.

- [ ] **Step 4: Implement the pure storage module**

Create `observed-listings-store.js` with this API and behavior:

```javascript
(function initObservedListingsStore(globalScope) {
  'use strict';

  const EMPTY_OBSERVED = () => ({ version: 1, items: [] });
  const EMPTY_OVERRIDES = () => ({ version: 1, buildingPairs: [], unitPairs: [] });
  const EMPTY_ALIASES = () => ({ version: 1, entries: [] });
  const DEFAULT_SETTINGS = Object.freeze({ enabled: true, retentionDays: 90 });

  function nonEmpty(value) {
    return value !== '' && value !== null && value !== undefined;
  }

  function mergeRecord(current, incoming) {
    const merged = { ...current };
    Object.entries(incoming).forEach(([key, value]) => {
      if (nonEmpty(value)) merged[key] = value;
    });
    merged.firstSeenAt = current.firstSeenAt || incoming.firstSeenAt;
    merged.lastSeenAt = incoming.lastSeenAt || current.lastSeenAt;
    return merged;
  }

  function upsertObservedListings(currentState, incomingRecords, favorites, nowValue, options) {
    const settings = { ...DEFAULT_SETTINGS, ...options };
    const maxNonFavorites = Number.isFinite(settings.maxNonFavorites) ? settings.maxNonFavorites : 500;
    const nowMs = Date.parse(nowValue);
    const favoriteUrls = new Set((Array.isArray(favorites) ? favorites : []).map(item => item.url).filter(Boolean));
    const currentItems = Array.isArray(currentState?.items) ? currentState.items : [];
    const byKey = new Map(currentItems.filter(item => item?.listingKey).map(item => [item.listingKey, item]));
    (Array.isArray(incomingRecords) ? incomingRecords : []).forEach((record) => {
      if (!record?.listingKey) return;
      byKey.set(record.listingKey, mergeRecord(byKey.get(record.listingKey) || {}, record));
    });
    const cutoffMs = nowMs - settings.retentionDays * 24 * 60 * 60 * 1000;
    const favoritesKept = [];
    const nonFavorites = [];
    Array.from(byKey.values()).forEach((item) => {
      if (favoriteUrls.has(item.url)) favoritesKept.push(item);
      else if (Date.parse(item.lastSeenAt || 0) >= cutoffMs) nonFavorites.push(item);
    });
    nonFavorites.sort((left, right) => Date.parse(right.lastSeenAt || 0) - Date.parse(left.lastSeenAt || 0));
    return { version: 1, items: [...favoritesKept, ...nonFavorites.slice(0, maxNonFavorites)] };
  }

  function sortedPair(leftKey, rightKey) {
    const [left, right] = [leftKey, rightKey].sort();
    return { leftKey: left, rightKey: right };
  }

  function upsertPair(pairs, leftKey, rightKey, decision) {
    const pair = sortedPair(leftKey, rightKey);
    const remaining = (Array.isArray(pairs) ? pairs : [])
      .filter(item => !(item.leftKey === pair.leftKey && item.rightKey === pair.rightKey));
    return decision === 'clear' ? remaining : [...remaining, { ...pair, decision }];
  }

  function mergeAlias(entries, left, right, confirmedAt) {
    if (!left.addressBlockKey || left.addressBlockKey !== right.addressBlockKey) return entries;
    const names = [left.normalizedBuildingName, right.normalizedBuildingName].filter(Boolean);
    if (names.length < 2) return entries;
    const safeEntries = Array.isArray(entries) ? entries : [];
    const current = safeEntries.find(entry => entry.addressBlockKey === left.addressBlockKey);
    const next = {
      addressBlockKey: left.addressBlockKey,
      normalizedNames: Array.from(new Set([...(current?.normalizedNames || []), ...names])).sort(),
      confirmedAt
    };
    return [...safeEntries.filter(entry => entry.addressBlockKey !== left.addressBlockKey), next];
  }

  function applyMatchDecision(state, records, action, confirmedAt) {
    const byKey = new Map((Array.isArray(records) ? records : []).map(item => [item.listingKey, item]));
    const overrides = {
      version: 1,
      buildingPairs: [...(Array.isArray(state?.overrides?.buildingPairs) ? state.overrides.buildingPairs : [])],
      unitPairs: [...(Array.isArray(state?.overrides?.unitPairs) ? state.overrides.unitPairs : [])]
    };
    const aliases = {
      version: 1,
      entries: [...(Array.isArray(state?.aliases?.entries) ? state.aliases.entries : [])]
    };
    const target = action.scope === 'unit' ? 'unitPairs' : 'buildingPairs';
    overrides[target] = upsertPair(overrides[target], action.leftKey, action.rightKey, action.decision);
    if (action.decision === 'same') {
      const left = byKey.get(action.leftKey);
      const right = byKey.get(action.rightKey);
      if (left && right) aliases.entries = mergeAlias(aliases.entries, left, right, confirmedAt);
    }
    if (action.scope === 'building' && action.decision === 'clear') {
      const left = byKey.get(action.leftKey);
      const right = byKey.get(action.rightKey);
      if (left?.addressBlockKey && left.addressBlockKey === right?.addressBlockKey) {
        aliases.entries = aliases.entries.filter(entry => entry.addressBlockKey !== left.addressBlockKey);
      }
    }
    return { overrides, aliases };
  }

  function clearCrossSiteData() {
    return {
      observedListingsV1: EMPTY_OBSERVED(),
      listingMatchOverridesV1: EMPTY_OVERRIDES(),
      buildingAliasesV1: EMPTY_ALIASES(),
      crossSitePendingSelectionV1: ''
    };
  }

  function pruneMatchMetadata(overrides, records) {
    const existingKeys = new Set((Array.isArray(records) ? records : []).map(item => item.listingKey));
    const keepPair = pair => existingKeys.has(pair.leftKey) || existingKeys.has(pair.rightKey);
    return {
      version: 1,
      buildingPairs: (Array.isArray(overrides?.buildingPairs) ? overrides.buildingPairs : []).filter(keepPair),
      unitPairs: (Array.isArray(overrides?.unitPairs) ? overrides.unitPairs : []).filter(keepPair)
    };
  }

  const api = {
    DEFAULT_SETTINGS, EMPTY_OBSERVED, EMPTY_OVERRIDES, EMPTY_ALIASES,
    mergeRecord, upsertObservedListings, applyMatchDecision, pruneMatchMetadata, clearCrossSiteData
  };
  globalScope.FudosanObservedListingsStore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
```

- [ ] **Step 5: Run store tests**

Run: `node test_observed_listings_store.js`

Expected: exit 0 with no assertion failures.

- [ ] **Step 6: Write failing background-controller tests**

Extend `test_background.js` to import `createCrossSiteController`. Add an in-memory storage adapter and verify two concurrent upserts preserve both records, disabled settings skip writes, `openListingGroup` persists the listing key before opening the Side Panel, and `clearData` clears three data collections but keeps settings:

```javascript
const { createCrossSiteController } = require('./background.js');

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
```

- [ ] **Step 7: Run background tests and verify the missing-export failure**

Run: `node test_background.js`

Expected: non-zero exit because `createCrossSiteController` is not exported.

- [ ] **Step 8: Implement the background controller and message contract**

At the top of `background.js`, load both shared scripts in service-worker mode and require them in Node mode:

```javascript
if (typeof importScripts === 'function') {
  importScripts('property-matcher.js', 'observed-listings-store.js');
}

const CrossSiteMatcher = globalThis.FudosanPropertyMatcher || (
  typeof require === 'function' ? require('./property-matcher.js') : null
);
const CrossSiteStore = globalThis.FudosanObservedListingsStore || (
  typeof require === 'function' ? require('./observed-listings-store.js') : null
);
```

Add `createCrossSiteController(deps)` with a promise tail named `writeTail`. Each mutation must execute through `enqueue(work)`, which assigns `writeTail = writeTail.then(work, work)` and returns that promise. Implement these methods:

```javascript
function createCrossSiteController({ get, set, openSidePanel, now }) {
  let writeTail = Promise.resolve();
  const enqueue = (work) => {
    const result = writeTail.then(work, work);
    writeTail = result.catch(() => undefined);
    return result;
  };

  const defaults = {
    observedListingsV1: CrossSiteStore.EMPTY_OBSERVED(),
    listingMatchOverridesV1: CrossSiteStore.EMPTY_OVERRIDES(),
    buildingAliasesV1: CrossSiteStore.EMPTY_ALIASES(),
    crossSiteMatchingSettingsV1: { ...CrossSiteStore.DEFAULT_SETTINGS },
    crossSiteMigrationsV1: { favoriteBackfillCompleted: false },
    favorites: []
  };

  function isQuotaError(error) {
    return /quota|QUOTA_BYTES/i.test(error?.message || '');
  }

  async function persistObserved(observed, overrides, favorites) {
    try {
      await set({ observedListingsV1: observed, listingMatchOverridesV1: overrides });
      return observed;
    } catch (error) {
      if (!isQuotaError(error)) throw error;
      const reduced = CrossSiteStore.upsertObservedListings(
        observed,
        [],
        favorites,
        now(),
        { retentionDays: 90, maxNonFavorites: 250 }
      );
      const reducedOverrides = CrossSiteStore.pruneMatchMetadata(overrides, reduced.items);
      await set({ observedListingsV1: reduced, listingMatchOverridesV1: reducedOverrides });
      return reduced;
    }
  }

  async function getState() {
    const state = await get(defaults);
    return {
      observed: state.observedListingsV1,
      overrides: state.listingMatchOverridesV1,
      aliases: state.buildingAliasesV1,
      settings: state.crossSiteMatchingSettingsV1
    };
  }

  function favoriteToObservedRecord(favorite) {
    return CrossSiteMatcher.prepareListingRecord({
      site: favorite.site,
      url: favorite.url,
      sourceListingId: CrossSiteMatcher.extractSourceListingId(favorite.url, favorite.site),
      pageType: favorite.pageType === 'detail' ? 'detail' : 'list',
      observationSource: 'favorite-backfill',
      rawName: favorite.name,
      rawAddress: favorite.address || '',
      priceMan: favorite.currentPrice || favorite.price,
      areaSqm: favorite.area,
      managementFeeYen: favorite.managementFee,
      repairFundYen: favorite.repairFund,
      listingStatus: favorite.listingStatus || 'active'
    }, favorite.lastCheckedAt || favorite.addedAt || now());
  }

  async function backfillFavorites() {
    return enqueue(async () => {
      const state = await get(defaults);
      if (state.crossSiteMatchingSettingsV1?.enabled === false) return { ok: true, disabled: true };
      if (state.crossSiteMigrationsV1?.favoriteBackfillCompleted) return { ok: true, skipped: true };
      const favoriteItems = (Array.isArray(state.favorites) ? state.favorites : [])
        .map(favorite => ({ ...favorite, url: CrossSiteMatcher.normalizeUrl(favorite.url) }));
      const records = favoriteItems
        .filter(favorite => favorite?.site && favorite?.url)
        .map(favoriteToObservedRecord);
      const observed = CrossSiteStore.upsertObservedListings(
        state.observedListingsV1,
        records,
        favoriteItems,
        now(),
        { retentionDays: 90, maxNonFavorites: 500 }
      );
      const overrides = CrossSiteStore.pruneMatchMetadata(state.listingMatchOverridesV1, observed.items);
      await persistObserved(observed, overrides, favoriteItems);
      await set({ crossSiteMigrationsV1: { favoriteBackfillCompleted: true } });
      return { ok: true, count: records.length };
    });
  }

  async function upsert(records) {
    return enqueue(async () => {
      const state = await get(defaults);
      if (state.crossSiteMatchingSettingsV1?.enabled === false) return { ok: true, disabled: true, summaries: {} };
      const favoriteItems = (Array.isArray(state.favorites) ? state.favorites : [])
        .map(favorite => ({ ...favorite, url: CrossSiteMatcher.normalizeUrl(favorite.url) }));
      const observed = CrossSiteStore.upsertObservedListings(
        state.observedListingsV1,
        records,
        favoriteItems,
        now(),
        { retentionDays: 90, maxNonFavorites: 500 }
      );
      let overrides = CrossSiteStore.pruneMatchMetadata(state.listingMatchOverridesV1, observed.items);
      const persisted = await persistObserved(observed, overrides, favoriteItems);
      overrides = CrossSiteStore.pruneMatchMetadata(overrides, persisted.items);
      const index = CrossSiteMatcher.buildListingIndex(persisted.items, overrides, state.buildingAliasesV1);
      return { ok: true, disabled: false, summaries: CrossSiteMatcher.summarizeListingMatches(index) };
    });
  }

  async function saveDecision(action) {
    return enqueue(async () => {
      const state = await get(defaults);
      const next = CrossSiteStore.applyMatchDecision({
        overrides: state.listingMatchOverridesV1,
        aliases: state.buildingAliasesV1
      }, Array.isArray(state.observedListingsV1?.items) ? state.observedListingsV1.items : [], action, now());
      await set({ listingMatchOverridesV1: next.overrides, buildingAliasesV1: next.aliases });
      return { ok: true };
    });
  }

  async function clearData() {
    return enqueue(async () => {
      await set({
        ...CrossSiteStore.clearCrossSiteData(),
        crossSiteMigrationsV1: { favoriteBackfillCompleted: true }
      });
      return { ok: true };
    });
  }

  async function saveSettings(settings) {
    const result = await enqueue(async () => {
      const next = { enabled: settings.enabled !== false, retentionDays: 90 };
      await set({ crossSiteMatchingSettingsV1: next });
      return { ok: true, settings: next };
    });
    if (result.settings.enabled) await backfillFavorites();
    return result;
  }

  async function openListingGroup(listingKey, tabId) {
    return enqueue(async () => {
      await set({ crossSitePendingSelectionV1: listingKey });
      await openSidePanel(tabId);
      return { ok: true };
    });
  }

  return { getState, backfillFavorites, upsert, saveDecision, clearData, saveSettings, openListingGroup };
}
```

Instantiate it with these promise wrappers and `chrome.sidePanel.open({tabId})`:

```javascript
function getLocalStorage(defaults) {
  return new Promise(resolve => chrome.storage.local.get(defaults, resolve));
}

function setLocalStorage(patch) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(patch, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

const crossSiteController = createCrossSiteController({
  get: getLocalStorage,
  set: setLocalStorage,
  openSidePanel: tabId => chrome.sidePanel.open({ tabId }),
  now: () => new Date().toISOString()
});

crossSiteController.backfillFavorites().catch((error) => {
  console.error('[坪たん 横断照合] 既存のお気に入りを取り込めませんでした:', error);
});
```

Extend `chrome.runtime.onMessage` with an early switch before `RECHECK_FAVORITES_NOW`:

```javascript
const crossSiteHandlers = {
  CROSS_SITE_GET_STATE: () => crossSiteController.getState(),
  CROSS_SITE_UPSERT: message => crossSiteController.upsert(message.records || []),
  CROSS_SITE_SAVE_DECISION: message => crossSiteController.saveDecision(message.action),
  CROSS_SITE_CLEAR: () => crossSiteController.clearData(),
  CROSS_SITE_SAVE_SETTINGS: message => crossSiteController.saveSettings(message.settings || {}),
  CROSS_SITE_OPEN: (message, sender) => {
    if (!Number.isInteger(sender.tab?.id)) throw new Error('Side Panelを開くタブを特定できませんでした');
    return crossSiteController.openListingGroup(message.listingKey, sender.tab.id);
  }
};

if (crossSiteHandlers[message.type]) {
  Promise.resolve()
    .then(() => crossSiteHandlers[message.type](message, sender))
    .then((result) => sendResponse(result?.ok === undefined ? { ok: true, ...result } : result))
    .catch(error => sendResponse({ ok: false, error: error.message || '横断照合の処理に失敗しました' }));
  return true;
}
```

For recognized types, the code above sends `{ok:false,error}` on rejection and returns `true` from the existing listener.

Export `createCrossSiteController` from the existing CommonJS block.

- [ ] **Step 9: Load the matcher before the content script**

Change `manifest.json` content scripts to:

```json
"js": ["property-matcher.js", "content.js"]
```

Do not change permissions.

- [ ] **Step 10: Add store tests to local test commands**

Use this final `package.json` test command:

```json
"test": "node --check property-matcher.js && node --check observed-listings-store.js && node --check content.js && node --check popup.js && node --check sidepanel.js && node --check background.js && node --check scripts/make-local-manifest.js && node test_property_matcher.js && node test_observed_listings_store.js && node test_csv_export.js && node test_background.js"
```

Add these exact commands to `scripts/test.sh` beside the Task 1 checks:

```bash
"$NODE_BIN" --check observed-listings-store.js
"$NODE_BIN" test_observed_listings_store.js
```

- [ ] **Step 11: Run all storage/controller tests**

Run:

```bash
node test_observed_listings_store.js
node test_background.js
bash scripts/test.sh
```

Expected: `cross-site controller tests passed`, `background recheck tests passed`, and final `npm-free test checks passed`.

- [ ] **Step 12: Commit storage and background integration**

```bash
git add observed-listings-store.js test_observed_listings_store.js background.js test_background.js manifest.json package.json scripts/test.sh
git commit -m "feat: persist viewed listings safely"
```

### Task 4: Content extraction, batched recording, and page badges

**Files:**
- Modify: `content.js:7-39, 2466-2860, 2881-3108, 4338-4400`
- Modify: `styles.css:204-280`
- Modify: `tests/e2e_extension.js:17-70, 91-258, 450-470`

**Interfaces:**
- Consumes: `FudosanPropertyMatcher.prepareListingRecord`, `CROSS_SITE_UPSERT`, and `CROSS_SITE_OPEN`.
- Produces: normalized list/detail records and `.fudosan-cross-site-badge` elements with `data-cross-site-listing-key` anchors.

- [ ] **Step 1: Add a failing two-site content E2E**

Add `property-matcher.js` and `observed-listings-store.js` to `EXTENSION_FILES`. Add Side Panel files now because later tasks open them:

```javascript
'property-matcher.js',
'observed-listings-store.js',
'sidepanel.html',
'sidepanel.js',
'sidepanel.css',
'icons/icon32.png',
```

Change the SUUMO fixture and add a HOME'S list fixture so both records describe `晴海クロノレジデンス`, address `東京都中央区晴海2-3-30`, 48th floor, 72.91㎡, and 3LDK, but prices are 12,000 and 12,300万円. Add:

```javascript
function buildHomesListFixture() {
  return `<!doctype html>
<html lang="ja">
<body>
  <section class="bukkenSpec">
    <table>
      <tbody>
        <tr><th class="bukkenName"><a href="/mansion/b-222/">晴海クロノレジデンス</a></th></tr>
        <tr><td class="bukkenAdress">東京都中央区晴海2-3-30</td></tr>
        <tr><td class="price">1億2,300万円</td><td class="space">72.91m²</td></tr>
        <tr><td>48階 3LDK 管理費 23,000円 修繕積立金 16,000円</td></tr>
      </tbody>
    </table>
  </section>
</body>
</html>`;
}

async function testCrossSiteContentBadge(context, extensionId) {
  await context.route('https://www.homes.co.jp/mansion/chuko/list/**', route => route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: buildHomesListFixture()
  }));
  const storageProbe = await context.newPage();
  await storageProbe.goto(`chrome-extension://${extensionId}/popup.html`);
  const suumoPage = await context.newPage();
  await suumoPage.goto('https://suumo.jp/ms/chuko/tokyo/sc_chuo/');
  await storageProbe.waitForFunction(() => new Promise((resolve) => {
    chrome.storage.local.get({ observedListingsV1: { items: [] } }, result => (
      resolve(result.observedListingsV1.items.some(item => item.site === 'SUUMO'))
    ));
  }));

  const homesPage = await context.newPage();
  await homesPage.goto('https://www.homes.co.jp/mansion/chuko/list/');
  await homesPage.waitForSelector('.fudosan-cross-site-badge', { timeout: 10000 });
  assert.match(await homesPage.locator('.fudosan-cross-site-badge').innerText(), /横断一致 2サイト/);
  assert.match(await homesPage.locator('.fudosan-cross-site-caption').innerText(), /閲覧履歴内/);
  await suumoPage.reload();
  await suumoPage.waitForSelector('.fudosan-cross-site-badge', { timeout: 10000 });
  await storageProbe.evaluate(() => new Promise(resolve => chrome.storage.local.set({
    crossSiteMatchingSettingsV1: { enabled: false, retentionDays: 90 }
  }, resolve)));
  await homesPage.waitForFunction(() => !document.querySelector('.fudosan-cross-site-badge'));
  assert.equal(await homesPage.locator('.fudosan-cross-site-badge').count(), 0);
  await storageProbe.evaluate(() => new Promise(resolve => chrome.storage.local.set({
    crossSiteMatchingSettingsV1: { enabled: true, retentionDays: 90 }
  }, resolve)));
  await storageProbe.close();
  await homesPage.close();
  await suumoPage.close();
  await context.unroute('https://www.homes.co.jp/mansion/chuko/list/**');
}
```

In `buildSuumoFixture()`, set the name link to `晴海クロノレジデンス`, price to `1億2,000万円`, address `<dt>所在地</dt><dd>東京都中央区晴海2-3-30</dd>`, area to `72.91㎡`, and body details to `48階 3LDK 管理費 22,000円 修繕積立金 15,000円`.

Call `testCrossSiteContentBadge(context, extensionId)` after `testContentScript(context)`.

- [ ] **Step 2: Run E2E and verify the missing-badge failure**

Run: `npm run test:e2e`

Expected: timeout waiting for `.fudosan-cross-site-badge`.

- [ ] **Step 3: Add content-script state**

Near the existing content globals, add:

```javascript
const crossSitePendingRecords = new Map();
const crossSiteKnownRecords = new Map();
const crossSiteAnchorsByKey = new Map();
let crossSiteFlushTimer = null;
let currentCrossSiteSettings = { enabled: true, retentionDays: 90 };
```

- [ ] **Step 4: Implement list and detail record builders**

Add a site-aware address helper so list records retain the full block address instead of a prefecture/city-only CSV fallback:

```javascript
function extractObservedListAddress(card, csvAddress = '') {
  const selectorsBySite = {
    SUUMO: ['.cassetteitem_detail-col1', '[class*="address"]'],
    REHOUSE: ['.property-card-address', '.property-address', '[class*="address"]'],
    ATHOME: ['.property-address', '.address', '[class*="address"]'],
    HOMES: ['.bukkenAdress', '[class*="address"]']
  };
  for (const selector of selectorsBySite[SITE_TYPE] || []) {
    const value = card.closest('.card-box-inner, .property-index-card')?.querySelector(selector)?.textContent?.trim()
      || card.querySelector(selector)?.textContent?.trim();
    if (value) return value.replace(/^所在地\s*[:：]?\s*/, '');
  }
  const labeled = (card.textContent || '').match(/(?:所在地|住所)\s*[:：]?\s*([^\n]+)/);
  return labeled?.[1]?.trim() || csvAddress;
}
```

Add `buildObservedListRecord(card, values)` using existing `extractListCsvData(card)` for the remaining fields and existing computed values for price and area:

```javascript
function buildObservedListRecord(card, values) {
  const csv = extractListCsvData(card);
  const text = card.textContent || '';
  const floorMatch = text.match(/(?:所在階|階数)?\s*(\d+)階/);
  return FudosanPropertyMatcher.prepareListingRecord({
    site: SITE_TYPE,
    sourceListingId: FudosanPropertyMatcher.extractSourceListingId(values.url, SITE_TYPE),
    url: values.url,
    pageType: 'list',
    rawName: values.name || csv.name,
    rawAddress: extractObservedListAddress(card, csv.address),
    priceMan: values.price,
    areaSqm: values.area,
    layout: csv.layout,
    floor: floorMatch ? floorMatch[1] : '',
    managementFeeYen: values.managementFee,
    repairFundYen: values.repairFund,
    listingStatus: values.listingStatus || 'active'
  }, new Date().toISOString());
}
```

Add a labeled-value helper and detail builder:

```javascript
function observedDetailText(labels) {
  const result = findLabeledValue(document, label => labels.some(item => label.includes(item)));
  return result?.text || '';
}

function buildObservedDetailRecord(favoriteInfo) {
  const heading = document.querySelector('h1')?.textContent?.trim() || favoriteInfo.name;
  const bodyText = document.body.textContent || '';
  const roomMatch = `${heading}\n${bodyText}`.match(/(?:号室|部屋番号)[^\d]*(\d{3,5})|\b(\d{3,5})号室/);
  return FudosanPropertyMatcher.prepareListingRecord({
    site: SITE_TYPE,
    sourceListingId: FudosanPropertyMatcher.extractSourceListingId(favoriteInfo.url, SITE_TYPE),
    url: favoriteInfo.url,
    pageType: 'detail',
    rawName: heading,
    rawAddress: observedDetailText(['所在地', '住所']),
    priceMan: favoriteInfo.price,
    areaSqm: favoriteInfo.area,
    layout: observedDetailText(['間取り']),
    floor: observedDetailText(['所在階', '階数 / 階建', '階数／階建']),
    roomNumber: roomMatch?.[1] || roomMatch?.[2] || '',
    builtAt: observedDetailText(['築年月']),
    totalUnits: observedDetailText(['総戸数']),
    buildingFloors: observedDetailText(['建物階数', '階建']),
    direction: observedDetailText(['向き', '主要採光面']),
    balconyAreaSqm: observedDetailText(['バルコニー面積']),
    managementFeeYen: favoriteInfo.managementFee,
    repairFundYen: favoriteInfo.repairFund,
    brokerageName: observedDetailText(['取扱店舗', '不動産会社', 'お問い合わせ先']),
    listingStatus: favoriteDataByUrl.get(favoriteInfo.url)?.listingStatus || 'active'
  }, new Date().toISOString());
}
```

Missing name or address is allowed in storage. The matcher already prevents a high building match without block-level address.

- [ ] **Step 5: Implement a 250ms batch queue and badge rendering**

Add:

```javascript
function badgeTextForSummary(summary) {
  if (summary.sameUnitSiteCount >= 2) return `横断一致 ${summary.sameUnitSiteCount}サイト`;
  if (summary.candidateCount > 0) return `同一候補 ${summary.candidateCount}件`;
  if (summary.buildingSiteCount >= 2 && summary.buildingUnitCount > 1) return `同じマンションに${summary.buildingUnitCount}住戸`;
  return '';
}

function prepareCrossSiteRecordSafely(factory) {
  try {
    return factory();
  } catch (error) {
    logError('横断照合の物件情報を作成できませんでした:', error);
    return null;
  }
}

function renderCrossSiteBadge(listingKey, summary) {
  const label = badgeTextForSummary(summary || {});
  (crossSiteAnchorsByKey.get(listingKey) || []).forEach((anchor) => {
    anchor.querySelector('.fudosan-cross-site-badge-wrap')?.remove();
    if (!label) return;
    const wrap = document.createElement('div');
    wrap.className = 'fudosan-cross-site-badge-wrap';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'fudosan-cross-site-badge';
    button.textContent = label;
    button.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'CROSS_SITE_OPEN', listingKey });
    });
    const caption = document.createElement('span');
    caption.className = 'fudosan-cross-site-caption';
    caption.textContent = '閲覧履歴内で他サイトの掲載を検出';
    wrap.append(button, caption);
    anchor.appendChild(wrap);
  });
}

function registerCrossSiteRecord(record, anchor) {
  if (!record?.listingKey) return;
  crossSiteKnownRecords.set(record.listingKey, record);
  if (anchor) {
    anchor.dataset.crossSiteListingKey = record.listingKey;
    const anchors = crossSiteAnchorsByKey.get(record.listingKey) || [];
    if (!anchors.includes(anchor)) anchors.push(anchor);
    crossSiteAnchorsByKey.set(record.listingKey, anchors);
  }
  if (currentCrossSiteSettings.enabled === false) return;
  crossSitePendingRecords.set(record.listingKey, record);
  window.clearTimeout(crossSiteFlushTimer);
  crossSiteFlushTimer = window.setTimeout(flushCrossSiteRecords, 250);
}

async function flushCrossSiteRecords() {
  const records = Array.from(crossSitePendingRecords.values());
  crossSitePendingRecords.clear();
  if (!records.length) return;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'CROSS_SITE_UPSERT', records });
    if (!response?.ok || response.disabled || currentCrossSiteSettings.enabled === false) return;
    Object.entries(response.summaries || {}).forEach(([listingKey, summary]) => renderCrossSiteBadge(listingKey, summary));
  } catch (error) {
    logError('横断照合の保存に失敗:', error);
  }
}
```

- [ ] **Step 6: Connect record creation to existing list/detail paths**

In `processProperty`, immediately after `favoriteInfo` is constructed and after `unitPriceDiv` exists, call:

```javascript
const crossSiteRecord = prepareCrossSiteRecordSafely(() => buildObservedListRecord(element, {
  url: propertyUrl,
  name: favoriteInfo.name,
  price,
  area,
  managementFee: listFees.managementFee,
  repairFund: listFees.repairFund,
  listingStatus: watchedFavorite?.listingStatus || 'active'
}));
registerCrossSiteRecord(crossSiteRecord, unitPriceDiv);
```

In `processDetailPage`, construct the record once after `favoriteInfo` and call `registerCrossSiteRecord(detailRecord, unitPriceDiv)` for the primary non-compact unit-price element inserted by the active site branch. If SUUMO also adds a compact table badge, set its `data-cross-site-listing-key` but do not render a second caption inside the table.

Use one anchor variable across the site branches:

```javascript
let primaryCrossSiteAnchor = null;

// Immediately after favoriteInfo is created:
const detailRecord = prepareCrossSiteRecordSafely(() => buildObservedDetailRecord(favoriteInfo));

// Immediately after each site's non-compact unitPriceDiv is inserted:
primaryCrossSiteAnchor = unitPriceDiv;

// After the SUUMO/REHOUSE/HOMES/ATHOME insertion branches:
registerCrossSiteRecord(detailRecord, primaryCrossSiteAnchor);

// Inside SUUMO's compact-table loop, after creating its compact unitPriceDiv:
if (detailRecord) unitPriceDiv.dataset.crossSiteListingKey = detailRecord.listingKey;
```

Declare `primaryCrossSiteAnchor` at the start of the successful `detailPrice/detailArea` block. Do not call `registerCrossSiteRecord` from each branch; the single call above ensures one background upsert even when SUUMO renders several unit-price elements.

Add and await this before the first `processAllProperties()` call in `init`:

```javascript
function loadCrossSiteContentSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get({
      crossSiteMatchingSettingsV1: { enabled: true, retentionDays: 90 }
    }, (result) => {
      currentCrossSiteSettings = result.crossSiteMatchingSettingsV1;
      resolve();
    });
  });
}

await loadCrossSiteContentSettings();
```

Make `init` async if it is not already. Add this branch to `chrome.storage.onChanged`:

```javascript
if (areaName === 'local' && changes.crossSiteMatchingSettingsV1) {
  currentCrossSiteSettings = changes.crossSiteMatchingSettingsV1.newValue || { enabled: true, retentionDays: 90 };
  if (currentCrossSiteSettings.enabled === false) {
    crossSitePendingRecords.clear();
    window.clearTimeout(crossSiteFlushTimer);
    document.querySelectorAll('.fudosan-cross-site-badge-wrap').forEach(element => element.remove());
  } else {
    crossSiteKnownRecords.forEach((record, listingKey) => crossSitePendingRecords.set(listingKey, record));
    flushCrossSiteRecords();
  }
}
```

Add this storage-probe assertion helper to `tests/e2e_extension.js`. The caller passes an extension-origin popup or Side Panel page, never a normal site page:

```javascript
async function assertObservedRecord(storageProbe, expected) {
  await storageProbe.waitForFunction(({ site, pageType, sourceListingId }) => new Promise((resolve) => {
    chrome.storage.local.get({ observedListingsV1: { version: 1, items: [] } }, (result) => {
      const record = result.observedListingsV1.items.find(item => (
        item.site === site && item.pageType === pageType && item.sourceListingId === sourceListingId
      ));
      resolve(Boolean(
        record?.rawName && record?.rawAddress && record?.normalizedBuildingName &&
        record?.addressBlockKey && record?.areaSqm && record?.floor && record?.layout
      ));
    });
  }), expected, { timeout: 10000 });
}
```

Use it for this complete extraction matrix:

```javascript
function buildSuumoDetailObservedFixture() {
  return `<!doctype html><html lang="ja"><body>
    <h1>晴海クロノレジデンス</h1>
    <div class="mt7 b">1億2,000万円</div>
    <table><tbody>
      <tr><th>価格</th><td>1億2,000万円</td></tr>
      <tr><th>専有面積</th><td>72.91㎡（壁芯）</td></tr>
      <tr><th>所在地</th><td>東京都中央区晴海2-3-30</td></tr>
      <tr><th>間取り</th><td>3LDK</td></tr>
      <tr><th>所在階</th><td>48階 / 50階建</td></tr>
      <tr><th>管理費</th><td>22,000円</td></tr>
      <tr><th>修繕積立金</th><td>15,000円</td></tr>
    </tbody></table>
  </body></html>`;
}

function buildRehouseListObservedFixture() {
  return `<!doctype html><html lang="ja"><body>
    <article class="property-index-card">
      <h2 class="property-card-title"><a href="/buy/mansion/bkdetail/RH-LIST-777/">晴海クロノレジデンス</a></h2>
      <p class="property-card-address">東京都中央区晴海2-3-30</p>
      <strong class="price-text">1億2,100万円</strong>
      <p class="paragraph-body">専有面積 72.91㎡</p>
      <p>48階 3LDK 管理費 22,000円 修繕積立金 15,000円</p>
    </article>
  </body></html>`;
}

function buildAthomeListObservedFixture() {
  return `<!doctype html><html lang="ja"><body>
    <article class="card-box-inner">
      <h3 class="title-wrap__title-text"><a class="select-link" href="/mansion/7777777777/">晴海クロノレジデンス</a></h3>
      <p class="property-address">東京都中央区晴海2-3-30</p>
      <div class="card-box-inner__detail">
        <strong class="property-price">1億2,200万円</strong>
        <div class="property-detail-table__block">専有面積 <span>72.91m²</span></div>
        <p>48階 3LDK 管理費 22,000円 修繕積立金 15,000円</p>
      </div>
    </article>
  </body></html>`;
}
```

| Site | List fixture | Detail fixture |
|---|---|---|
| SUUMO | existing `buildSuumoFixture()` | add `buildSuumoDetailObservedFixture()` using `h1` plus `th/td` rows for 価格・専有面積・所在地・間取り・所在階 |
| REHOUSE | add `buildRehouseListObservedFixture()` using `.property-index-card`, `.property-card-title`, `.property-card-address`, `.price-text`, and a `㎡` `.paragraph-body` | existing `buildRehouseDetailFixture()` |
| ATHOME | add `buildAthomeListObservedFixture()` using `.card-box-inner`, `.card-box-inner__detail`, `.title-wrap__title-text`, `.property-address`, `.property-price`, and a 専有面積 `.property-detail-table__block` | existing `buildAthomeDetailFixture()` |
| HOMES | `buildHomesListFixture()` from Step 1 | existing `buildHomesDetailFixture()` |

Use `東京都中央区晴海2-3-30`, `72.91㎡`, `48階`, and `3LDK` in all eight fixtures so every assertion has the same required fields. Give every fixture a distinct source URL/ID so list and detail records do not overwrite one another. This matrix is required before moving to Step 7.

Run the matrix with this function after the existing four content tests and `testCrossSiteContentBadge`:

```javascript
async function testObservedExtractionMatrix(context, extensionId) {
  const storageProbe = await context.newPage();
  await storageProbe.goto(`chrome-extension://${extensionId}/popup.html`);
  const cases = [
    { site: 'SUUMO', pageType: 'list', sourceListingId: '123456', url: 'https://suumo.jp/ms/chuko/tokyo/sc_chuo/', fixture: buildSuumoFixture },
    { site: 'SUUMO', pageType: 'detail', sourceListingId: '888888', url: 'https://suumo.jp/ms/chuko/tokyo/sc_chuo/nc_888888/', fixture: buildSuumoDetailObservedFixture },
    { site: 'REHOUSE', pageType: 'list', sourceListingId: 'RH-LIST-777', url: 'https://www.rehouse.co.jp/buy/mansion/prefecture/13/city/13102/', fixture: buildRehouseListObservedFixture },
    { site: 'REHOUSE', pageType: 'detail', sourceListingId: 'F1FAGA2C', url: 'https://www.rehouse.co.jp/buy/mansion/bkdetail/F1FAGA2C/', fixture: buildRehouseDetailFixture },
    { site: 'ATHOME', pageType: 'list', sourceListingId: '7777777777', url: 'https://www.athome.co.jp/mansion/chuko/tokyo/chuo-city/list/', fixture: buildAthomeListObservedFixture },
    { site: 'ATHOME', pageType: 'detail', sourceListingId: '1234567890', url: 'https://www.athome.co.jp/mansion/1234567890/', fixture: buildAthomeDetailFixture },
    { site: 'HOMES', pageType: 'list', sourceListingId: '222', url: 'https://www.homes.co.jp/mansion/chuko/list/', fixture: buildHomesListFixture },
    { site: 'HOMES', pageType: 'detail', sourceListingId: '1193620002052', url: 'https://www.homes.co.jp/mansion/b-1193620002052/', fixture: buildHomesDetailFixture }
  ];

  for (const fixtureCase of cases) {
    await context.route(fixtureCase.url, route => route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: fixtureCase.fixture()
    }));
    const page = await context.newPage();
    await page.goto(fixtureCase.url);
    await page.waitForSelector('.fudosan-unit-price', { timeout: 10000 });
    await assertObservedRecord(storageProbe, fixtureCase);
    await page.close();
    await context.unroute(fixtureCase.url);
  }
  await storageProbe.close();
}
```

- [ ] **Step 7: Add compact badge styles**

Append to `styles.css`:

```css
.fudosan-cross-site-badge-wrap {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid rgba(37, 99, 235, 0.18);
  white-space: normal;
}

.fudosan-cross-site-badge {
  appearance: none;
  border: 1px solid #2563eb;
  border-radius: 999px;
  padding: 3px 8px;
  background: #eff6ff;
  color: #1d4ed8;
  font: inherit;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}

.fudosan-cross-site-badge:hover,
.fudosan-cross-site-badge:focus-visible {
  background: #dbeafe;
  outline: 2px solid rgba(37, 99, 235, 0.22);
  outline-offset: 1px;
}

.fudosan-cross-site-caption {
  color: #64748b;
  font-size: 10px;
  font-weight: 500;
}

.fudosan-unit-price--compact .fudosan-cross-site-caption {
  display: none;
}
```

- [ ] **Step 8: Run content E2E and the lightweight suite**

Run:

```bash
npm run test:e2e
bash scripts/test.sh
```

Expected: `extension E2E tests passed` and `npm-free test checks passed`.

- [ ] **Step 9: Commit content recording and badges**

```bash
git add content.js styles.css tests/e2e_extension.js
git commit -m "feat: record viewed listings and show matches"
```

### Task 5: Side Panel hierarchical cross-site comparison

**Files:**
- Modify: `sidepanel.html:55-66, 111`
- Modify: `sidepanel.js:5-63, 142-157, 297-535, 1215-1240`
- Modify: `sidepanel.css:318-455`
- Modify: `tests/e2e_extension.js:330-470`

**Interfaces:**
- Consumes: the three cross-site storage keys plus `crossSitePendingSelectionV1` directly, `CROSS_SITE_SAVE_DECISION` for mutations, and Task 2's `buildListingIndex`.
- Produces: building cards, unit groups, site listing rows, price/field differences, and manual decision controls.

- [ ] **Step 1: Add a failing Side Panel E2E**

Seed three normalized records directly in extension storage: SUUMO and HOME'S on the same unit, plus ATHOME on another unit in the same building. Open `sidepanel.html` and assert:

```javascript
async function testCrossSiteSidePanel(context, extensionId) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await page.evaluate(() => new Promise((resolve) => chrome.storage.local.set({
    observedListingsV1: {
      version: 1,
      items: [
        {
          listingKey: 'SUUMO:side-a', site: 'SUUMO', url: 'https://suumo.jp/side-a',
          rawName: 'ザ・パークハウス新宿', normalizedBuildingName: 'ザパークハウス新宿',
          rawAddress: '東京都新宿区西新宿1丁目2番3号', normalizedAddress: '東京都新宿区西新宿1-2-3',
          municipalityTownKey: '東京都新宿区西新宿', addressBlockKey: '東京都新宿区西新宿1-2-3',
          priceMan: 12000, areaSqm: 72.91, floor: 18, layout: '3LDK',
          managementFeeYen: 22000, repairFundYen: 16000, listingStatus: 'active',
          lastSeenAt: '2026-07-19T00:00:00.000Z'
        },
        {
          listingKey: 'HOMES:side-b', site: 'HOMES', url: 'https://www.homes.co.jp/side-b',
          rawName: 'ザ パークハウス 新宿', normalizedBuildingName: 'ザパークハウス新宿',
          rawAddress: '東京都新宿区西新宿1-2-3', normalizedAddress: '東京都新宿区西新宿1-2-3',
          municipalityTownKey: '東京都新宿区西新宿', addressBlockKey: '東京都新宿区西新宿1-2-3',
          priceMan: 12300, areaSqm: 72.9, floor: 18, layout: '3LDK',
          managementFeeYen: 23000, repairFundYen: 16000, listingStatus: 'active',
          lastSeenAt: '2026-07-19T00:01:00.000Z'
        },
        {
          listingKey: 'ATHOME:side-c', site: 'ATHOME', url: 'https://www.athome.co.jp/side-c',
          rawName: 'ザパークハウス新宿', normalizedBuildingName: 'ザパークハウス新宿',
          rawAddress: '東京都新宿区西新宿1-2-3', normalizedAddress: '東京都新宿区西新宿1-2-3',
          municipalityTownKey: '東京都新宿区西新宿', addressBlockKey: '東京都新宿区西新宿1-2-3',
          priceMan: 11800, areaSqm: 65.2, floor: 10, layout: '2LDK',
          listingStatus: 'active', lastSeenAt: '2026-07-19T00:02:00.000Z'
        }
      ]
    },
    listingMatchOverridesV1: { version: 1, buildingPairs: [], unitPairs: [] },
    buildingAliasesV1: { version: 1, entries: [] }
  }, resolve)));
  await page.reload();
  await page.waitForSelector('.cross-site-building-card', { timeout: 10000 });
  assert.equal(await page.locator('.cross-site-building-card').count(), 1);
  assert.equal(await page.locator('.cross-site-unit-card').count(), 2);
  assert.equal(await page.locator('.cross-site-listing-row').count(), 3);
  assert.match(await page.locator('.cross-site-price-diff').first().innerText(), /300万円差/);
  assert.equal(await page.locator('.cross-site-best').count(), 1);

  await page.evaluate(() => new Promise((resolve) => {
    chrome.storage.local.get({ observedListingsV1: { version: 1, items: [] } }, (result) => {
      chrome.storage.local.set({
        observedListingsV1: {
          version: 1,
          items: [...result.observedListingsV1.items, {
            listingKey: 'REHOUSE:candidate',
            site: 'REHOUSE',
            url: 'https://www.rehouse.co.jp/buy/mansion/bkdetail/candidate/',
            rawName: 'ザ パークハウス 新宿',
            normalizedBuildingName: 'ザパークハウス新宿',
            rawAddress: '東京都新宿区西新宿1丁目',
            normalizedAddress: '東京都新宿区西新宿1',
            municipalityTownKey: '東京都新宿区西新宿',
            addressBlockKey: '',
            areaSqm: 72.9,
            floor: 48,
            layout: '3LDK',
            lastSeenAt: '2026-07-19T00:00:00.000Z'
          }]
        }
      }, resolve);
    });
  }));
  await page.waitForSelector('.cross-site-candidate', { timeout: 10000 });
  assert.match(await page.locator('.cross-site-candidate').innerText(), /同一候補/);
  await page.locator('.cross-site-candidate button', { hasText: '同じマンション' }).click();
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.cross-site-building-card').length === 1);
  await page.locator('.cross-site-decision-clear').first().click();
  await page.reload();
  await page.waitForSelector('.cross-site-candidate', { timeout: 10000 });
  await page.locator('.cross-site-candidate button', { hasText: '別の物件' }).click();
  await page.reload();
  await page.waitForSelector('.cross-site-manual-decision', { timeout: 10000 });
  assert.match(await page.locator('.cross-site-manual-decision').innerText(), /別のマンションとして確認済み/);
  await page.locator('.cross-site-decision-clear').first().click();
  await page.reload();
  await page.waitForSelector('.cross-site-candidate', { timeout: 10000 });
  await page.close();
}
```

Call it after cross-site content E2E.

- [ ] **Step 2: Run E2E and verify the missing-building-card failure**

Run: `npm run test:e2e`

Expected: timeout waiting for `.cross-site-building-card`.

- [ ] **Step 3: Load matcher and cross-site state in the Side Panel**

In `sidepanel.html`, add before the current script:

```html
<script src="property-matcher.js"></script>
<script src="sidepanel.js"></script>
```

Replace the old heading copy with:

```html
<h2>横断掲載まとめ</h2>
<p>閲覧履歴内の同じマンション・住戸をサイト横断でまとめます。</p>
```

In `sidepanel.js`, add state:

```javascript
let sideObservedListings = [];
let sideMatchOverrides = { version: 1, buildingPairs: [], unitPairs: [] };
let sideBuildingAliases = { version: 1, entries: [] };
let selectedCrossSiteListingKey = '';
```

Extend `loadSidePanelData()` defaults with the three storage keys and `crossSitePendingSelectionV1`. Build the index with:

```javascript
function getSideCrossSiteIndex() {
  return FudosanPropertyMatcher.buildListingIndex(
    sideObservedListings,
    sideMatchOverrides,
    sideBuildingAliases
  );
}
```

Clear the pending selection after reading it, without deleting the observed records.

- [ ] **Step 4: Replace the price-based heuristic grouper**

Remove `normalizeSimilarText`, `getNameTokens`, `getFavoriteSimilarity`, and `buildSimilarFavoriteGroups`. They use price and坪単価 as identity signals and conflict with the approved design.

Replace the `renderSimilarGroups(favorites)` call inside `renderSidePanel()` with `renderCrossSiteGroupsSafely()`, delete the old renderer, and add:

```javascript
function renderCrossSiteListingRow(listing, unitDiff, listingCount) {
  const row = document.createElement('article');
  row.className = 'cross-site-listing-row';
  row.dataset.listingKey = listing.listingKey;

  const heading = document.createElement('div');
  heading.className = 'cross-site-listing-heading';
  const site = document.createElement('span');
  site.className = `cross-site-site cross-site-site--${listing.site}`;
  site.textContent = getSiteDisplayName(listing.site);
  const price = document.createElement('strong');
  price.textContent = formatSidePrice(listing.priceMan);
  heading.append(site, price);

  if (listingCount > 1 && unitDiff.minPriceMan !== null && listing.priceMan === unitDiff.minPriceMan) {
    const best = document.createElement('em');
    best.className = 'cross-site-best';
    best.textContent = '最安';
    heading.appendChild(best);
  }

  const priceDifference = unitDiff.priceDiffByKey[listing.listingKey];
  if (Number(priceDifference) > 0) {
    const diff = document.createElement('span');
    diff.className = 'cross-site-price-diff';
    diff.textContent = `最安より${Number(priceDifference).toLocaleString()}万円差`;
    heading.appendChild(diff);
  }

  const meta = document.createElement('p');
  meta.className = 'cross-site-listing-meta';
  const statusLabels = {
    active: '掲載中',
    ended: '掲載終了の可能性',
    possibly_ended: '掲載終了の可能性',
    check_failed: '確認失敗'
  };
  meta.textContent = [
    listing.managementFeeYen ? `管理費 ${formatSideYen(listing.managementFeeYen)}` : '',
    listing.repairFundYen ? `修繕 ${formatSideYen(listing.repairFundYen)}` : '',
    listing.brokerageName || '',
    statusLabels[listing.listingStatus] || '',
    formatSideDateTime(listing.lastSeenAt)
  ].filter(Boolean).join(' / ');

  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'cross-site-open-listing';
  open.textContent = '掲載ページを開く';
  open.addEventListener('click', () => chrome.tabs.create({ url: listing.url }));
  row.append(heading, meta, open);
  return row;
}
```

Add `記載差あり` chips for every field in `unitDiff.fieldsWithDifferences`. Use Japanese labels from this fixed map:

```javascript
const CROSS_SITE_FIELD_LABELS = {
  priceMan: '価格',
  areaSqm: '面積',
  layout: '間取り',
  floor: '階数',
  managementFeeYen: '管理費',
  repairFundYen: '修繕積立金'
};

function renderCrossSiteGroups(index) {
  const groupsEl = document.getElementById('side-similar-groups');
  const statusEl = document.getElementById('side-similar-status');
  const aiButton = document.getElementById('side-similar-ai');
  if (!groupsEl || !statusEl || !aiButton) return;

  const visibleGroups = index.groups.filter(group => (
    group.unitGroups.reduce((count, unit) => count + unit.listings.length, 0) >= 2
  ));
  groupsEl.replaceChildren();
  aiButton.disabled = visibleGroups.length === 0 || sideSimilarAiInProgress || !getSideLanguageModelApi()?.create;
  aiButton.textContent = sideSimilarAiInProgress ? '生成中...' : 'AI短評';

  visibleGroups.forEach((group, groupIndex) => {
    const card = document.createElement('article');
    card.className = 'cross-site-building-card';
    card.dataset.groupId = group.groupId;

    const title = document.createElement('div');
    title.className = 'cross-site-building-title';
    title.textContent = group.displayName;
    card.appendChild(title);

    group.unitGroups.forEach((unit) => {
      const unitCard = document.createElement('section');
      unitCard.className = 'cross-site-unit-card';
      const representative = unit.listings[0];
      const unitTitle = document.createElement('div');
      unitTitle.className = 'cross-site-unit-title';
      unitTitle.textContent = [
        representative.floor ? `${representative.floor}階` : '',
        representative.areaSqm ? `${representative.areaSqm}㎡` : '',
        representative.layout || ''
      ].filter(Boolean).join(' / ') || '住戸情報未取得';
      unitCard.appendChild(unitTitle);

      unit.diff.fieldsWithDifferences.forEach((field) => {
        const chip = document.createElement('span');
        chip.className = 'cross-site-difference-chip';
        chip.textContent = `${CROSS_SITE_FIELD_LABELS[field]}に記載差あり`;
        unitCard.appendChild(chip);
      });
      unit.listings.forEach(listing => (
        unitCard.appendChild(renderCrossSiteListingRow(listing, unit.diff, unit.listings.length))
      ));
      card.appendChild(unitCard);
    });

    const aiComment = sideSimilarAiSummary?.summaries?.[groupIndex]?.comment;
    if (aiComment) {
      const comment = document.createElement('div');
      comment.className = 'side-similar-ai-comment';
      comment.textContent = aiComment;
      card.appendChild(comment);
    }
    groupsEl.appendChild(card);
  });

  index.candidates.forEach((candidate) => {
    const left = index.byKey.get(candidate.leftKey);
    const right = index.byKey.get(candidate.rightKey);
    if (!left || !right) return;
    const candidateCard = document.createElement('article');
    candidateCard.className = 'cross-site-candidate';
    const summary = document.createElement('strong');
    summary.textContent = `同一候補: ${left.rawName || left.site} / ${right.rawName || right.site}`;
    const reasons = document.createElement('p');
    reasons.textContent = candidate.reasons.join(' / ');
    const actions = document.createElement('div');
    actions.className = 'cross-site-decision-actions';
    const choices = candidate.scope === 'unit'
      ? [['同じ住戸', 'same'], ['別の物件', 'different']]
      : [['同じマンション', 'same'], ['別の物件', 'different']];
    choices.forEach(([label, decision]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', () => {
        saveCrossSiteDecision(candidate, candidate.scope, decision)
          .catch(error => setSideStatus(error.message));
      });
      actions.appendChild(button);
    });
    candidateCard.append(summary, reasons, actions);
    groupsEl.appendChild(candidateCard);
  });

  const manualPairs = [
    ...(Array.isArray(sideMatchOverrides?.buildingPairs) ? sideMatchOverrides.buildingPairs : [])
      .map(pair => ({ ...pair, scope: 'building' })),
    ...(Array.isArray(sideMatchOverrides?.unitPairs) ? sideMatchOverrides.unitPairs : [])
      .map(pair => ({ ...pair, scope: 'unit' }))
  ].filter(pair => ['same', 'different'].includes(pair.decision));
  manualPairs.forEach((pair) => {
    const left = index.byKey.get(pair.leftKey);
    const right = index.byKey.get(pair.rightKey);
    if (!left || !right) return;
    const decisionCard = document.createElement('article');
    decisionCard.className = 'cross-site-candidate cross-site-manual-decision';
    const label = document.createElement('strong');
    const subject = pair.scope === 'unit' ? '住戸' : 'マンション';
    label.textContent = `${left.rawName || left.site} / ${right.rawName || right.site}: ${pair.decision === 'same' ? `同じ${subject}` : `別の${subject}`}として確認済み`;
    decisionCard.append(label, createDecisionClearButton(pair, pair.scope));
    groupsEl.appendChild(decisionCard);
  });

  statusEl.textContent = visibleGroups.length || index.candidates.length || manualPairs.length
    ? '閲覧履歴内の横断照合結果です。'
    : '別サイトで同じ可能性がある閲覧物件はまだありません。';
  window.requestAnimationFrame(focusSelectedCrossSiteListing);
}

function renderCrossSiteGroupsSafely() {
  try {
    renderCrossSiteGroups(getSideCrossSiteIndex());
  } catch (error) {
    console.error('[坪たん Side Panel] 横断照合の描画に失敗:', error);
    const statusEl = document.getElementById('side-similar-status');
    if (statusEl) statusEl.textContent = '横断照合を表示できませんでした。ほかの比較機能は引き続き利用できます。';
  }
}
```

- [ ] **Step 5: Render candidates and save manual decisions**

For each `index.candidates` pair, show the two records, reasons, and the two actions appropriate to its scope. Wire them through:

```javascript
async function saveCrossSiteDecision(candidate, scope, decision) {
  const response = await chrome.runtime.sendMessage({
    type: 'CROSS_SITE_SAVE_DECISION',
    action: {
      scope,
      decision,
      leftKey: candidate.leftKey,
      rightKey: candidate.rightKey
    }
  });
  if (!response?.ok) throw new Error(response?.error || '判定を保存できませんでした');
  await loadSidePanelData();
  setSideStatus('横断照合の判定を保存しました');
}
```

Buttons use these exact scope-aware actions:

- `同じマンション`: `{scope:'building', decision:'same'}`
- `同じ住戸`: `{scope:'unit', decision:'same'}`
- `別の物件`: building candidateなら `{scope:'building', decision:'different'}`、unit candidateなら `{scope:'unit', decision:'different'}`
- `判定を解除`: same scope with `decision:'clear'`

Because any manual decision removes the pair from `index.candidates`, render both active `same` and `different` pairs in `.cross-site-manual-decision` cards as shown in Step 4. Add one clear button per active pair:

```javascript
function createDecisionClearButton(pair, scope) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'cross-site-decision-clear';
  button.textContent = '判定を解除';
  button.addEventListener('click', () => {
    saveCrossSiteDecision({ leftKey: pair.leftKey, rightKey: pair.rightKey }, scope, 'clear')
      .catch(error => setSideStatus(error.message));
  });
  return button;
}
```

For `sideMatchOverrides.buildingPairs` and `unitPairs`, append this control whenever both referenced records still exist. The controller's metadata pruning removes the card after both records expire.

Catch errors and pass the message to `setSideStatus` without breaking the rest of the panel.

- [ ] **Step 6: Preserve the AI short-summary feature**

Replace the old group prompt input and generator entry/exit calls with:

```javascript
function getCrossSiteAiGroups() {
  return getSideCrossSiteIndex().groups.filter(group => (
    group.unitGroups.reduce((count, unit) => count + unit.listings.length, 0) >= 2
  ));
}

function buildSideSimilarPrompt(groups) {
  const lines = groups.map((group, index) => {
    const listings = group.unitGroups.flatMap(unit => unit.listings).map(listing => [
      getSiteDisplayName(listing.site),
      formatSidePrice(listing.priceMan),
      listing.areaSqm ? `${listing.areaSqm}㎡` : '',
      listing.floor ? `${listing.floor}階` : '',
      listing.layout || ''
    ].filter(Boolean).join(' / '));
    return `マンション${index + 1}: ${group.displayName}\n${listings.map(item => `- ${item}`).join('\n')}`;
  }).join('\n\n');
  return [
    'あなたは中古マンションのサイト別掲載差を整理するアシスタントです。',
    '閲覧履歴内の事実だけを使い、各マンションで確認すべき掲載差を1文でまとめてください。',
    '購入結論、価格査定、投資判断、与えられていない事実の推測は禁止です。',
    '各文45〜80文字。JSONだけを返してください。',
    '形式: {"summaries":[{"comment":"..."}]}',
    '',
    lines
  ].join('\n');
}

function normalizeSideSimilarSummary(rawSummary, groups) {
  const summaries = Array.isArray(rawSummary?.summaries) ? rawSummary.summaries : [];
  return {
    summaries: groups.map((group, index) => ({
      comment: compactSideText(
        summaries[index]?.comment || `${group.displayName}の価格、面積、管理費、修繕積立金の記載差を確認してください。`,
        110
      )
    }))
  };
}

function parseSideSimilarSummary(responseText, groups) {
  if (typeof responseText === 'object' && responseText !== null) {
    return normalizeSideSimilarSummary(responseText, groups);
  }
  const cleaned = String(responseText || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    return normalizeSideSimilarSummary(JSON.parse(cleaned), groups);
  } catch (error) {
    const summaries = cleaned.split(/\n/).filter(Boolean).map(comment => ({ comment }));
    return normalizeSideSimilarSummary({ summaries }, groups);
  }
}

async function generateSideSimilarAiSummary() {
  const groups = getCrossSiteAiGroups();
  if (groups.length === 0 || sideSimilarAiInProgress) return;

  const api = getSideLanguageModelApi();
  if (!api?.create) {
    setSideStatus('このChromeではAI短評を生成できません');
    return;
  }
  sideSimilarAiInProgress = true;
  renderCrossSiteGroupsSafely();

  let session = null;
  try {
    if (api.availability) {
      const availability = await api.availability();
      if (availability === 'unavailable') throw new Error('この端末ではGemini Nanoを利用できません');
    }
    session = await api.create();
    const prompt = buildSideSimilarPrompt(groups);
    let response;
    try {
      response = await session.prompt(prompt, {
        responseConstraint: {
          type: 'object',
          properties: {
            summaries: {
              type: 'array',
              items: {
                type: 'object',
                properties: { comment: { type: 'string' } },
                required: ['comment'],
                additionalProperties: false
              }
            }
          },
          required: ['summaries'],
          additionalProperties: false
        },
        omitResponseConstraintInput: true
      });
    } catch (error) {
      console.error('[坪たん Side Panel] 構造化AI短評に失敗。通常プロンプトで再試行:', error);
      response = await session.prompt(`${prompt}\n\nJSON以外を書かず、必ず {"summaries":[{"comment":"..."}]} の形で返してください。`);
    }
    sideSimilarAiSummary = parseSideSimilarSummary(response, groups);
    setSideStatus('横断掲載のAI短評を生成しました');
  } catch (error) {
    console.error('[坪たん Side Panel] 横断掲載AI短評生成エラー:', error);
    setSideStatus(error.message || 'AI短評を生成できませんでした');
  } finally {
    if (session?.destroy) session.destroy();
    sideSimilarAiInProgress = false;
    renderCrossSiteGroupsSafely();
  }
}
```

Disable the AI button when `getCrossSiteAiGroups().length === 0`.

- [ ] **Step 7: Handle pending selection and storage changes**

Extend the `loadSidePanelData()` storage defaults and assignment block exactly as follows:

```javascript
function loadSidePanelData() {
  return new Promise((resolve) => {
    chrome.storage.local.get({
      favorites: [],
      loanSettings: SIDE_DEFAULT_LOAN_SETTINGS,
      observedListingsV1: { version: 1, items: [] },
      listingMatchOverridesV1: { version: 1, buildingPairs: [], unitPairs: [] },
      buildingAliasesV1: { version: 1, entries: [] },
      crossSitePendingSelectionV1: ''
    }, (result) => {
      sideFavorites = Array.isArray(result.favorites) ? result.favorites : [];
      sideLoanSettings = normalizeSideLoanSettings(result.loanSettings);
      sideObservedListings = Array.isArray(result.observedListingsV1?.items) ? result.observedListingsV1.items : [];
      sideMatchOverrides = result.listingMatchOverridesV1 || { version: 1, buildingPairs: [], unitPairs: [] };
      sideBuildingAliases = result.buildingAliasesV1 || { version: 1, entries: [] };
      selectedCrossSiteListingKey = result.crossSitePendingSelectionV1 || '';
      if (selectedCrossSiteListingKey) chrome.storage.local.set({ crossSitePendingSelectionV1: '' });
      renderSidePanel();
      resolve();
    });
  });
}
```

Call this after `renderCrossSiteGroups` finishes:

```javascript
function focusSelectedCrossSiteListing() {
  if (!selectedCrossSiteListingKey) return;
  const row = document.querySelector(`[data-listing-key="${CSS.escape(selectedCrossSiteListingKey)}"]`);
  if (!row) {
    setSideStatus('指定された閲覧物件は保存期間の終了などで見つかりませんでした');
    return;
  }
  row.classList.add('cross-site-listing-row--selected');
  row.scrollIntoView({ block: 'center' });
}
```

Add these branches to the existing `chrome.storage.onChanged` listener before `renderSidePanel()`:

```javascript
if (changes.observedListingsV1) sideObservedListings = changes.observedListingsV1.newValue?.items || [];
if (changes.listingMatchOverridesV1) {
  sideMatchOverrides = changes.listingMatchOverridesV1.newValue || { version: 1, buildingPairs: [], unitPairs: [] };
}
if (changes.buildingAliasesV1) {
  sideBuildingAliases = changes.buildingAliasesV1.newValue || { version: 1, entries: [] };
}
if (changes.observedListingsV1 || changes.listingMatchOverridesV1 || changes.buildingAliasesV1) {
  sideSimilarAiSummary = null;
}
```

- [ ] **Step 8: Add hierarchical Side Panel styles**

Append these rules to `sidepanel.css`:

```css
.cross-site-building-card {
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid #dbeafe;
  border-radius: 8px;
  background: #fff;
}

.cross-site-building-title,
.cross-site-unit-title,
.cross-site-listing-heading {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.cross-site-building-title { color: #172554; font-size: 13px; font-weight: 800; }
.cross-site-unit-card { padding: 8px; border: 1px solid #e2e8f0; border-radius: 6px; background: #f8fafc; }
.cross-site-unit-title { margin-bottom: 6px; color: #334155; font-size: 11px; font-weight: 700; }
.cross-site-listing-row { padding: 8px 0; border-top: 1px solid #e2e8f0; }
.cross-site-listing-row--selected { margin: 0 -6px; padding: 8px 6px; background: #eff6ff; }
.cross-site-site { padding: 2px 6px; border-radius: 999px; color: #fff; font-size: 9px; font-weight: 800; }
.cross-site-site--SUUMO { background: #0ea5e9; }
.cross-site-site--REHOUSE { background: #10b981; }
.cross-site-site--ATHOME { background: #f59e0b; }
.cross-site-site--HOMES { background: #8b5cf6; }
.cross-site-best { padding: 2px 6px; border-radius: 999px; background: #dcfce7; color: #15803d; font-size: 9px; font-style: normal; font-weight: 800; }
.cross-site-price-diff { color: #b45309; font-size: 10px; font-weight: 700; }
.cross-site-listing-meta { margin: 5px 0; color: #64748b; font-size: 10px; line-height: 1.45; }
.cross-site-difference-chip { display: inline-flex; margin: 2px 4px 2px 0; padding: 2px 6px; border-radius: 999px; background: #fef3c7; color: #92400e; font-size: 9px; font-weight: 700; }
.cross-site-candidate { padding: 9px; border: 1px solid #fcd34d; border-radius: 6px; background: #fffbeb; }
.cross-site-manual-decision { display: flex; align-items: center; justify-content: space-between; gap: 8px; border-color: #cbd5e1; background: #f8fafc; }
.cross-site-decision-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 7px; }
.cross-site-decision-actions button,
.cross-site-decision-clear,
.cross-site-open-listing {
  min-height: 32px;
  border: 1px solid #cbd5e1;
  border-radius: 5px;
  padding: 5px 8px;
  background: #fff;
  color: #334155;
  font: inherit;
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;
}
.cross-site-decision-actions button:focus-visible,
.cross-site-decision-clear:focus-visible,
.cross-site-open-listing:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
```

- [ ] **Step 9: Run Side Panel E2E and full lightweight tests**

Run:

```bash
npm run test:e2e
bash scripts/test.sh
```

Expected: Side Panel assertions pass, then `extension E2E tests passed` and `npm-free test checks passed`.

- [ ] **Step 10: Commit Side Panel comparison**

```bash
git add sidepanel.html sidepanel.js sidepanel.css tests/e2e_extension.js
git commit -m "feat: compare cross-site listings in side panel"
```

### Task 6: Popup controls, deletion, and privacy disclosure in-product

**Files:**
- Modify: `popup.html:55-130`
- Modify: `popup.js:37-106, 991-1053, 1208-1269`
- Modify: `popup.css:213-289`
- Modify: `tests/e2e_extension.js:390-455`

**Interfaces:**
- Consumes: `CROSS_SITE_SAVE_SETTINGS`, `CROSS_SITE_CLEAR`, and `crossSiteMatchingSettingsV1`.
- Produces: toggle `#cross-site-enabled`, delete button `#clear-cross-site-data`, and status `#cross-site-settings-status`.

- [ ] **Step 1: Add failing popup E2E assertions**

After popup reload in `testPopup`, assert the toggle starts checked, toggling it persists `{enabled:false,retentionDays:90}`, and clearing deletes observed records, overrides, and aliases while leaving the setting intact:

```javascript
const toggle = page.locator('#cross-site-enabled');
assert.equal(await toggle.isChecked(), true);
await toggle.uncheck();
await page.waitForFunction(() => new Promise((resolve) => {
  chrome.storage.local.get({ crossSiteMatchingSettingsV1: {} }, result => (
    resolve(result.crossSiteMatchingSettingsV1.enabled === false)
  ));
}));

page.once('dialog', dialog => dialog.accept());
await page.locator('#clear-cross-site-data').click();
await page.waitForFunction(() => new Promise((resolve) => {
  chrome.storage.local.get({
    observedListingsV1: { items: [{}] },
    listingMatchOverridesV1: { buildingPairs: [{}], unitPairs: [{}] },
    buildingAliasesV1: { entries: [{}] },
    crossSiteMatchingSettingsV1: { enabled: true }
  }, result => resolve(
    result.observedListingsV1.items.length === 0 &&
    result.listingMatchOverridesV1.buildingPairs.length === 0 &&
    result.buildingAliasesV1.entries.length === 0 &&
    result.crossSiteMatchingSettingsV1.enabled === false
  ));
}));
```

- [ ] **Step 2: Run popup E2E and verify the missing-control failure**

Run: `npm run test:e2e`

Expected: locator failure for `#cross-site-enabled`.

- [ ] **Step 3: Add the settings markup**

Place after the existing loan settings section:

```html
<section class="cross-site-settings" aria-labelledby="cross-site-settings-title">
  <div class="cross-site-settings-header">
    <div>
      <h2 id="cross-site-settings-title">サイト横断照合</h2>
      <p>対応サイトで閲覧した物件情報をブラウザ内だけに保存し、同じマンション・住戸を比較します。</p>
    </div>
    <label class="cross-site-toggle">
      <input id="cross-site-enabled" type="checkbox" checked>
      <span>有効</span>
    </label>
  </div>
  <p class="cross-site-retention">非お気に入りは90日・直近500件まで。未閲覧サイトは検索しません。</p>
  <div class="cross-site-settings-actions">
    <button id="clear-cross-site-data" type="button">閲覧物件データを削除</button>
    <span id="cross-site-settings-status" aria-live="polite"></span>
  </div>
</section>
```

- [ ] **Step 4: Implement settings and clear behavior**

Add:

```javascript
function showCrossSiteSettingsStatus(text, tone = '') {
  const status = document.getElementById('cross-site-settings-status');
  if (!status) return;
  status.textContent = text;
  status.dataset.tone = tone;
}

function loadCrossSiteSettings() {
  chrome.storage.local.get({
    crossSiteMatchingSettingsV1: { enabled: true, retentionDays: 90 }
  }, (result) => {
    const toggle = document.getElementById('cross-site-enabled');
    if (toggle) toggle.checked = result.crossSiteMatchingSettingsV1.enabled !== false;
  });
}

async function saveCrossSiteSettings() {
  const enabled = document.getElementById('cross-site-enabled')?.checked !== false;
  const response = await chrome.runtime.sendMessage({
    type: 'CROSS_SITE_SAVE_SETTINGS',
    settings: { enabled, retentionDays: 90 }
  });
  if (!response?.ok) throw new Error(response?.error || '設定を保存できませんでした');
  showCrossSiteSettingsStatus(enabled ? '横断照合を有効にしました' : '横断照合を停止しました');
}

async function clearCrossSiteData() {
  if (!window.confirm('閲覧物件、手動判定、確認済みの名称別名を削除しますか？お気に入りは削除されません。')) return;
  const response = await chrome.runtime.sendMessage({ type: 'CROSS_SITE_CLEAR' });
  if (!response?.ok) throw new Error(response?.error || '閲覧物件データを削除できませんでした');
  showCrossSiteSettingsStatus('閲覧物件データを削除しました');
}

function setupCrossSiteSettings() {
  document.getElementById('cross-site-enabled')?.addEventListener('change', () => {
    saveCrossSiteSettings().catch(error => showCrossSiteSettingsStatus(error.message, 'error'));
  });
  document.getElementById('clear-cross-site-data')?.addEventListener('click', () => {
    clearCrossSiteData().catch(error => showCrossSiteSettingsStatus(error.message, 'error'));
  });
  loadCrossSiteSettings();
}
```

Call `setupCrossSiteSettings()` during popup initialization and respond to `crossSiteMatchingSettingsV1` in `chrome.storage.onChanged`.

- [ ] **Step 5: Add release-note disclosure**

Add a new first release note entry for version `1.12.0` titled `サイト横断・同一物件チェッカーを追加` with these exact items:

```javascript
{
  version: '1.12.0',
  title: 'サイト横断・同一物件チェッカーを追加',
  items: [
    '対応4サイトで閲覧した同じマンション・住戸を、Side Panelでまとめて比較できるようにしました。',
    '同一住戸の価格差、管理費・修繕積立金の記載差、掲載サイトを確認できます。',
    '閲覧物件情報はブラウザ内だけに保存され、未閲覧サイトへの自動アクセスや外部送信は行いません。',
    '横断照合の停止と閲覧物件データの削除は、ポップアップからいつでも行えます。'
  ]
}
```

- [ ] **Step 6: Add settings styles**

Append to `popup.css`:

```css
.cross-site-settings { padding: 10px 16px 12px; border-bottom: 1px solid #e2e8f0; background: #fff; }
.cross-site-settings-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.cross-site-settings-header h2 { margin: 0 0 3px; color: #334155; font-size: 12px; font-weight: 700; }
.cross-site-settings-header p,
.cross-site-retention { margin: 0; color: #64748b; font-size: 10px; line-height: 1.45; }
.cross-site-retention { margin-top: 6px; }
.cross-site-toggle { display: flex; align-items: center; gap: 5px; flex-shrink: 0; color: #334155; font-size: 10px; font-weight: 700; }
.cross-site-toggle input { width: 16px; height: 16px; accent-color: #2563eb; }
.cross-site-settings-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; }
#clear-cross-site-data { min-height: 30px; border: 1px solid #b91c1c; border-radius: 5px; padding: 5px 8px; background: #fff; color: #b91c1c; font: inherit; font-size: 10px; font-weight: 700; cursor: pointer; }
#clear-cross-site-data:hover { background: #fef2f2; }
#clear-cross-site-data:focus-visible { outline: 2px solid rgba(185, 28, 28, 0.3); outline-offset: 2px; }
#cross-site-settings-status { color: #047857; font-size: 10px; font-weight: 600; text-align: right; }
#cross-site-settings-status[data-tone="error"] { color: #b91c1c; }
```

- [ ] **Step 7: Run popup E2E and full lightweight tests**

Run:

```bash
npm run test:e2e
bash scripts/test.sh
```

Expected: popup setting and deletion assertions pass; both suites report success.

- [ ] **Step 8: Commit popup controls**

```bash
git add popup.html popup.js popup.css tests/e2e_extension.js
git commit -m "feat: add cross-site matching controls"
```

### Task 7: Packaging, CI, version, product documentation, and Store copy

**Files:**
- Modify: `manifest.json:3-27`
- Modify: `package.json:2-10`
- Modify: `build.sh:7-12`
- Modify: `build.ps1:13-25`
- Modify: `scripts/build-local.sh:16-29`
- Modify: `.github/workflows/ci.yml:24-50`
- Modify: `.github/workflows/release.yml:20-38`
- Modify: `scripts/capture-store-screenshots.js:760-795, 900-945`
- Modify: `README.md:5-23, 95-120, 140-155, 253-278`
- Modify: `PRIVACY_POLICY.md:8-55`
- Modify: `PRIVACY_PRACTICES.txt:7-82`
- Modify: `STORE_LISTING_TEXT.txt:25-86, 119-145, 217-232`
- Modify: `AGENTS.md:29-70, 119-240`
- Modify: `CLAUDE.md:29-70, 119-240`

**Interfaces:**
- Consumes: completed feature files and storage behavior.
- Produces: version `1.12.0`, distributable archives containing both shared scripts, accurate privacy disclosures, and Store copy/screenshots describing viewed-history matching.

- [ ] **Step 1: Write a failing packaging assertion**

Extend `scripts/test.sh` with checks after syntax validation:

```bash
for file in property-matcher.js observed-listings-store.js; do
  grep -q "$file" build.sh
  grep -q "$file" scripts/build-local.sh
  grep -q "$file" .github/workflows/ci.yml
  grep -q "$file" .github/workflows/release.yml
done
```

- [ ] **Step 2: Run the npm-free suite and verify packaging checks fail**

Run: `bash scripts/test.sh`

Expected: non-zero exit on the first build/workflow that does not mention a shared file.

- [ ] **Step 3: Add shared files to every package and CI path**

Add `property-matcher.js` and `observed-listings-store.js` to:

- the `cp` list in `build.sh`;
- individual `Copy-Item` calls in `build.ps1`;
- the `files=(...)` list in `scripts/build-local.sh`;
- the required-file loop, Node syntax checks, and new unit-test commands in `.github/workflows/ci.yml`;
- Node syntax checks and new unit-test commands in `.github/workflows/release.yml`.

Both workflows must run `node test_property_matcher.js` and `node test_observed_listings_store.js`. `build.sh` remains the single source that decides which runtime files enter the zip.

Keep the manifest permission arrays unchanged.

Use these exact insertions:

```bash
# build.sh cp line
cp manifest.json property-matcher.js observed-listings-store.js background.js content.js styles.css popup.html popup.js popup.css sidepanel.html sidepanel.js sidepanel.css dist/

# scripts/build-local.sh files=(...) entries, immediately after manifest.json
  property-matcher.js
  observed-listings-store.js
```

```powershell
# build.ps1, immediately after manifest.json
Copy-Item "property-matcher.js" "dist/"
Copy-Item "observed-listings-store.js" "dist/"
```

Use this complete required-file and smoke-test body in `.github/workflows/ci.yml`:

```yaml
for f in property-matcher.js observed-listings-store.js background.js content.js styles.css manifest.json popup.html popup.js popup.css sidepanel.html sidepanel.js sidepanel.css icons/icon16.png icons/icon48.png icons/icon128.png; do
  if [ ! -f "$f" ]; then
    echo "::error::Required file missing: $f"
    missing=1
  fi
done
if [ "$missing" -eq 1 ]; then exit 1; fi

node --check property-matcher.js
node --check observed-listings-store.js
node --check content.js
node --check popup.js
node --check sidepanel.js
node --check background.js
node --check tests/e2e_extension.js
node test_property_matcher.js
node test_observed_listings_store.js
node test_csv_export.js
node test_background.js
```

Use this release workflow smoke-test body:

```yaml
node --check property-matcher.js
node --check observed-listings-store.js
node --check content.js
node --check popup.js
node --check sidepanel.js
node --check background.js
node --check tests/e2e_extension.js
node test_property_matcher.js
node test_observed_listings_store.js
node test_csv_export.js
node test_background.js
```

- [ ] **Step 4: Bump the feature release version**

Change `manifest.json` and `package.json` from `1.11.0` to `1.12.0`. Confirm the first `RELEASE_NOTES` entry is also `1.12.0`.

- [ ] **Step 5: Update user and developer documentation**

Add these facts consistently to `README.md`, `AGENTS.md`, and `CLAUDE.md`:

- viewed listings from four sites are normalized and locally indexed;
- favorites saved before version 1.12.0 are imported once into that local index; clearing cross-site data does not delete favorites and the migration marker prevents silent re-creation afterward;
- matching is building first, unit second;
- high-confidence matches require block-address agreement;
- manual decisions override automatic results;
- non-favorites expire after 90 days and are capped at 500;
- favorites are exempt;
- no unvisited-site crawling or external transmission occurs;
- `property-matcher.js`, `observed-listings-store.js`, the four user-data/settings keys, transient `crossSitePendingSelectionV1`, and internal `crossSiteMigrationsV1` are part of the architecture.

Do not claim complete coverage of all listings.

- [ ] **Step 6: Update privacy disclosures**

In `PRIVACY_POLICY.md` and `PRIVACY_PRACTICES.txt`, explicitly list:

- viewed property URL, site, property/building name, address, price, area, layout, floor, fees, brokerage, listing state, and confirmation timestamps;
- manual same/different decisions and address-scoped building-name aliases;
- local-only storage, 90-day/500-record non-favorite retention, favorites exemption;
- popup controls to disable matching and clear cross-site data;
- no external server, analytics service, or unvisited-site requests.

Explain that `storage` is used for this local index. Do not add a new permission justification.

- [ ] **Step 7: Update Store listing copy and screenshot seed**

Add a feature bullet to `STORE_LISTING_TEXT.txt`:

```text
• 4サイト横断・同一物件比較
  対応サイトで閲覧した同じマンション・住戸をSide Panelにまとめ、価格差や管理費・修繕積立金の記載差を比較できます。照合は閲覧履歴内だけで行います。
```

Update the privacy and storage explanations to match Step 6. In `seedExtensionStorage`, include this exact cross-site seed in the existing `chrome.storage.local.set` payload:

```javascript
observedListingsV1: {
  version: 1,
  items: [
    {
      listingKey: 'SUUMO:store-cross-1', site: 'SUUMO', url: 'https://suumo.jp/store-cross-1',
      rawName: 'パークタワー晴海', normalizedBuildingName: 'パークタワー晴海',
      rawAddress: '東京都中央区晴海2-3-30', normalizedAddress: '東京都中央区晴海2-3-30',
      municipalityTownKey: '東京都中央区晴海', addressBlockKey: '東京都中央区晴海2-3-30',
      priceMan: 12800, areaSqm: 72.91, floor: 48, layout: '3LDK',
      managementFeeYen: 22000, repairFundYen: 15000, brokerageName: '晴海不動産',
      listingStatus: 'active', lastSeenAt: '2026-07-19T09:00:00.000Z'
    },
    {
      listingKey: 'HOMES:store-cross-2', site: 'HOMES', url: 'https://www.homes.co.jp/store-cross-2',
      rawName: 'パークタワー晴海', normalizedBuildingName: 'パークタワー晴海',
      rawAddress: '東京都中央区晴海2-3-30', normalizedAddress: '東京都中央区晴海2-3-30',
      municipalityTownKey: '東京都中央区晴海', addressBlockKey: '東京都中央区晴海2-3-30',
      priceMan: 13000, areaSqm: 72.9, floor: 48, layout: '3LDK',
      managementFeeYen: 23000, repairFundYen: 15000, brokerageName: '湾岸住宅',
      listingStatus: 'active', lastSeenAt: '2026-07-19T09:05:00.000Z'
    },
    {
      listingKey: 'ATHOME:store-cross-3', site: 'ATHOME', url: 'https://www.athome.co.jp/store-cross-3',
      rawName: 'パークタワー晴海', normalizedBuildingName: 'パークタワー晴海',
      rawAddress: '東京都中央区晴海2-3-30', normalizedAddress: '東京都中央区晴海2-3-30',
      municipalityTownKey: '東京都中央区晴海', addressBlockKey: '東京都中央区晴海2-3-30',
      priceMan: 11500, areaSqm: 68.42, floor: 31, layout: '2LDK',
      listingStatus: 'active', lastSeenAt: '2026-07-19T09:10:00.000Z'
    }
  ]
},
listingMatchOverridesV1: { version: 1, buildingPairs: [], unitPairs: [] },
buildingAliasesV1: { version: 1, entries: [] },
crossSiteMatchingSettingsV1: { enabled: true, retentionDays: 90 },
crossSitePendingSelectionV1: 'SUUMO:store-cross-1'
```

Change `captureSidePanelRaw` to wait for `.cross-site-building-card` instead of `.side-compare-table`. Use these exact composition strings for `04-sidepanel-compare.png`:

```javascript
title: '4サイト横断で同じ物件を比較',
subtitle: '閲覧履歴内で見つけた同じマンション・住戸をまとめ、サイト別の価格差や記載差を確認できます。',
cards: [
  { label: '照合範囲', value: '閲覧履歴内' },
  { label: '比較', value: '価格・管理費・修繕積立金' },
  { label: '階層', value: 'マンション / 住戸 / 掲載' },
  { label: '保存先', value: 'ブラウザ内のみ' }
]
```

- [ ] **Step 8: Run package and documentation checks**

Run:

```bash
bash scripts/test.sh
bash scripts/build-local.sh /tmp/fudosan-cross-site-local
test -f /tmp/fudosan-cross-site-local/property-matcher.js
test -f /tmp/fudosan-cross-site-local/observed-listings-store.js
git diff --check
```

Expected: all commands exit 0; local build prints `Local extension build is ready` and both `test -f` commands succeed.

- [ ] **Step 9: Commit release and documentation wiring**

```bash
git add manifest.json package.json build.sh build.ps1 scripts/build-local.sh scripts/test.sh .github/workflows/ci.yml .github/workflows/release.yml scripts/capture-store-screenshots.js README.md PRIVACY_POLICY.md PRIVACY_PRACTICES.txt STORE_LISTING_TEXT.txt AGENTS.md CLAUDE.md
git commit -m "docs: prepare cross-site matcher release"
```

### Task 8: Regression edge cases, full verification, and implementation handoff

**Files:**
- Modify: `tests/e2e_extension.js`
- Modify: `test_property_matcher.js`
- Modify: `test_observed_listings_store.js`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: explicit regression coverage for dangerous false positives plus final verification evidence for match, candidate, manual merge/undo, disabled mode, deletion, retention, and regression safety.

- [ ] **Step 1: Add regression assertions for dangerous false positives**

Extend `test_property_matcher.js` with these complete records and assertions:

```javascript
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
```

Extend `test_observed_listings_store.js` with the same 100-day-old timestamp on a favorite and a non-favorite:

```javascript
const oneHundredDaysAgo = new Date(Date.parse(NOW) - 100 * 24 * 60 * 60 * 1000).toISOString();
const favoriteAtCutoff = {
  listingKey: 'SUUMO:old-favorite', url: 'https://suumo.jp/old-favorite', lastSeenAt: oneHundredDaysAgo
};
const ordinaryAtCutoff = {
  listingKey: 'SUUMO:old-ordinary', url: 'https://suumo.jp/old-ordinary', lastSeenAt: oneHundredDaysAgo
};
const favoriteRetentionRegression = store.upsertObservedListings(
  { version: 1, items: [favoriteAtCutoff, ordinaryAtCutoff] },
  [],
  [{ url: favoriteAtCutoff.url }],
  NOW,
  { retentionDays: 90, maxNonFavorites: 500 }
);
assert.deepEqual(favoriteRetentionRegression.items.map(item => item.listingKey), ['SUUMO:old-favorite']);
assert.doesNotThrow(() => store.applyMatchDecision({
  overrides: { version: 1, buildingPairs: {}, unitPairs: null },
  aliases: { version: 1, entries: {} }
}, [], {
  scope: 'building', decision: 'clear', leftKey: 'SUUMO:missing', rightKey: 'HOMES:missing'
}, NOW));
```

- [ ] **Step 2: Run the focused regression tests**

Run:

```bash
node test_property_matcher.js
node test_observed_listings_store.js
```

Expected: both commands exit 0. If either fails, invoke `superpowers:systematic-debugging`, correct the existing Task 1–3 implementation without introducing a second matcher or storage path, and rerun both commands.

- [ ] **Step 3: Re-run the complete Side Panel decision loop**

Run: `npm run test:e2e`

Expected: the Task 5 E2E confirms candidate display, `同じマンション`, `別の物件`, persistence after reload, `判定を解除`, and return to candidate state after each decision; final line is `extension E2E tests passed`.

- [ ] **Step 4: Run the full verification matrix**

Run fresh commands in this order:

```bash
bash scripts/test.sh
npm test
npm run test:e2e
bash scripts/build-local.sh /tmp/fudosan-cross-site-final
node -e "const m=require('/tmp/fudosan-cross-site-final/manifest.json'); if(m.version!=='1.12.0') process.exit(1)"
git diff --check
```

Expected:

- `npm-free test checks passed`;
- matcher, store, background, and CSV tests report no assertion failures;
- `extension E2E tests passed`;
- local extension build completes;
- manifest version check exits 0;
- `git diff --check` prints nothing.

- [ ] **Step 5: Inspect the final diff against the approved spec**

Run:

```bash
git diff --stat HEAD~7
git diff HEAD~7 -- manifest.json property-matcher.js observed-listings-store.js background.js content.js sidepanel.js popup.js tests/e2e_extension.js
```

Confirm every section of `docs/superpowers/specs/2026-07-11-cross-site-listing-matcher-design.md` maps to implemented code or tests, no new permission exists, and no external request was added.

- [ ] **Step 6: Commit final regression coverage**

```bash
git add tests/e2e_extension.js test_property_matcher.js test_observed_listings_store.js
git commit -m "test: verify cross-site matching workflow"
```

- [ ] **Step 7: Request code review before integration**

Invoke `superpowers:requesting-code-review` with the approved design, this implementation plan, the commit range, and the full verification output. Address only verified actionable findings, rerun the complete verification matrix, then use `superpowers:finishing-a-development-branch` to choose merge, PR, or cleanup.
