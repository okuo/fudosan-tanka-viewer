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

  const api = {
    normalizeBuildingName, extractBuildingWing, normalizeAddress, normalizeLayout,
    parseFloor, parseArea, normalizeBuiltAt, diceCoefficient, normalizeUrl,
    extractSourceListingId, prepareListingRecord, scoreBuildingMatch, scoreUnitMatch
  };
  globalScope.FudosanPropertyMatcher = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
