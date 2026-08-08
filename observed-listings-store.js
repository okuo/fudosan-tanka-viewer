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
    nonFavorites.sort((left, right) => {
      const lastSeenDifference = Date.parse(right.lastSeenAt || 0) - Date.parse(left.lastSeenAt || 0);
      if (lastSeenDifference !== 0) return lastSeenDifference;
      const leftKey = String(left.listingKey || '');
      const rightKey = String(right.listingKey || '');
      if (leftKey < rightKey) return -1;
      if (leftKey > rightKey) return 1;
      return 0;
    });
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
