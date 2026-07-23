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
    if (left.roomNumber && left.roomNumber === right.roomNumber) { score += 55; reasons.push('部屋番号が一致'); }
    if (areaDiff !== null && areaDiff <= 0.5) { score += 45; reasons.push('専有面積が一致'); }
    else if (areaDiff !== null && areaDiff <= 1.0) { score += 25; reasons.push('専有面積が近い'); }
    if (left.floor && left.floor === right.floor) { score += 30; reasons.push('階数が一致'); }
    if (left.layout && left.layout === right.layout) { score += 15; reasons.push('間取りが一致'); }
    if (left.direction && left.direction === right.direction) score += 5;
    if (left.balconyAreaSqm && right.balconyAreaSqm && Math.abs(left.balconyAreaSqm - right.balconyAreaSqm) <= 0.5) score += 5;
    const confidence = score >= UNIT_HIGH_SCORE
      ? 'high'
      : score >= UNIT_CANDIDATE_SCORE
        ? 'candidate'
        : 'none';
    return { score, confidence, reasons };
  }

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
        if (forced === 'same' || (!forced && result.confidence === 'high')) {
          buildingUf.unite(leftItem.listingKey, rightItem.listingKey);
        } else if (forced !== 'different' && result.confidence === 'candidate') {
          rawBuildingCandidates.push({
            scope: 'building',
            leftKey: leftItem.listingKey,
            rightKey: rightItem.listingKey,
            ...result
          });
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
          if (forced === 'same' || (!forced && result.confidence === 'high')) {
            unitUf.unite(leftItem.listingKey, rightItem.listingKey);
          } else if (forced !== 'different' && result.confidence === 'candidate') {
            rawUnitCandidates.push({
              scope: 'unit',
              leftKey: leftItem.listingKey,
              rightKey: rightItem.listingKey,
              ...result
            });
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
          listings: [...unitItems].sort(
            (leftItem, rightItem) => Number(leftItem.priceMan || Infinity) - Number(rightItem.priceMan || Infinity)
          ),
          diff: diffUnitListings(unitItems)
        }))
      };
    });

    return { groups, candidates: [...buildingCandidateMap.values(), ...unitCandidates], byKey };
  }

  function summarizeListingMatches(index) {
    const summaries = {};
    index.groups.forEach((group) => {
      const buildingSiteCount = new Set(
        group.unitGroups.flatMap(unit => unit.listings.map(item => item.site))
      ).size;
      group.unitGroups.forEach((unitGroup) => {
        const matchedSites = Array.from(new Set(unitGroup.listings.map(item => item.site))).sort();
        unitGroup.listings.forEach((item) => {
          summaries[item.listingKey] = {
            listingKey: item.listingKey,
            sameUnitSiteCount: matchedSites.length,
            candidateCount: index.candidates.filter(candidate => (
              candidate.leftMemberKeys?.includes(item.listingKey) ||
              candidate.rightMemberKeys?.includes(item.listingKey)
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

  const api = {
    normalizeBuildingName, extractBuildingWing, normalizeAddress, normalizeLayout,
    parseFloor, parseArea, normalizeBuiltAt, diceCoefficient, normalizeUrl,
    extractSourceListingId, prepareListingRecord, scoreBuildingMatch, scoreUnitMatch,
    pairKey, buildListingIndex, summarizeListingMatches, diffUnitListings
  };
  globalScope.FudosanPropertyMatcher = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
