/**
 * 坪たん Side Panel
 */

let sideFavorites = [];
let sideLoanSettings = {
  annualRatePercent: 0.8,
  years: 35,
  downPaymentMan: 0
};
let activeSideView = 'compare';
let selectedFavoriteUrl = '';
let sideMemoSaveTimer = null;
let sideChecklistSaveTimer = null;
let sideRecheckInProgress = false;
let sideSimilarAiSummary = null;
let sideSimilarAiInProgress = false;
let sideSimilarAiGenerationToken = 0;
let sideObservedListings = [];
let sideMatchOverrides = { version: 1, buildingPairs: [], unitPairs: [] };
let sideBuildingAliases = { version: 1, entries: [] };
let selectedCrossSiteListingKey = '';

const SIDE_DEFAULT_LOAN_SETTINGS = {
  annualRatePercent: 0.8,
  years: 35,
  downPaymentMan: 0
};

const SIDE_CHECKLIST_ITEMS = [
  { id: 'sunlight', label: '日当たり' },
  { id: 'noise', label: '騒音' },
  { id: 'management', label: '管理状態' },
  { id: 'repair_history', label: '修繕履歴' },
  { id: 'common_area', label: '共用部' },
  { id: 'trash_area', label: 'ゴミ置き場' }
];

function normalizeSideLoanSettings(settings = {}) {
  const annualRatePercent = Number(settings.annualRatePercent);
  const years = parseInt(settings.years, 10);
  const downPaymentMan = Number(settings.downPaymentMan);

  return {
    annualRatePercent: Number.isFinite(annualRatePercent) && annualRatePercent >= 0
      ? annualRatePercent
      : SIDE_DEFAULT_LOAN_SETTINGS.annualRatePercent,
    years: Number.isFinite(years) && years > 0
      ? years
      : SIDE_DEFAULT_LOAN_SETTINGS.years,
    downPaymentMan: Number.isFinite(downPaymentMan) && downPaymentMan >= 0
      ? downPaymentMan
      : SIDE_DEFAULT_LOAN_SETTINGS.downPaymentMan
  };
}

function consumeCrossSitePendingSelection(value) {
  const listingKey = String(value || '');
  if (!listingKey) return false;
  selectedCrossSiteListingKey = listingKey;
  chrome.storage.local.set({ crossSitePendingSelectionV1: '' });
  return true;
}

function invalidateSideSimilarAiSummary() {
  sideSimilarAiGenerationToken += 1;
  sideSimilarAiSummary = null;
}

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
      invalidateSideSimilarAiSummary();
      selectedCrossSiteListingKey = '';
      consumeCrossSitePendingSelection(result.crossSitePendingSelectionV1);
      if (!selectedFavoriteUrl && sideFavorites[0]) {
        selectedFavoriteUrl = sideFavorites[0].url;
      }
      renderSidePanel();
      resolve();
    });
  });
}

function getSideCrossSiteIndex() {
  return FudosanPropertyMatcher.buildListingIndex(
    sideObservedListings,
    sideMatchOverrides,
    sideBuildingAliases
  );
}

function getSearchText() {
  const input = document.getElementById('side-search-input');
  return (input?.value || '').trim().toLowerCase();
}

function getFilteredSideFavorites() {
  const query = getSearchText();
  if (!query) return sideFavorites;

  return sideFavorites.filter((fav) => [
    fav.name,
    fav.site,
    fav.station,
    fav.address,
    fav.area,
    fav.memo,
    fav.viewingNote
  ].some((value) => String(value || '').toLowerCase().includes(query)));
}

function getSortedSideFavorites() {
  return [...getFilteredSideFavorites()].sort((a, b) => {
    const aDrop = getPriceDiffInfo(a).diff < 0 ? 1 : 0;
    const bDrop = getPriceDiffInfo(b).diff < 0 ? 1 : 0;
    if (aDrop !== bDrop) return bDrop - aDrop;
    return new Date(b.priceUpdatedAt || b.addedAt || 0) - new Date(a.priceUpdatedAt || a.addedAt || 0);
  });
}

function getSelectedFavorite() {
  return sideFavorites.find(fav => fav.url === selectedFavoriteUrl) || getSortedSideFavorites()[0] || null;
}

function renderSidePanel() {
  const sorted = getSortedSideFavorites();
  if (!sorted.some(fav => fav.url === selectedFavoriteUrl)) {
    selectedFavoriteUrl = sorted[0]?.url || sideFavorites[0]?.url || '';
  }

  renderSideSummary(sorted);
  renderLastChecked(sorted);
  renderActiveSideView(sorted);
  renderSelectedDetail(getSelectedFavorite());
}

function renderSideSummary(favorites) {
  const totalEl = document.getElementById('side-summary-total');
  const compareEl = document.getElementById('side-summary-compare');
  const dropsEl = document.getElementById('side-summary-drops');
  const riskEl = document.getElementById('side-summary-risk');
  if (!totalEl || !compareEl || !dropsEl || !riskEl) return;

  const drops = favorites.filter(fav => getPriceDiffInfo(fav).diff < 0).length;
  const risks = favorites.filter((fav) => {
    const riskLevel = fav.repairFundRisk?.level;
    return riskLevel === 'high' || fav.listingStatus === 'ended';
  }).length;

  totalEl.textContent = sideFavorites.length.toLocaleString();
  compareEl.textContent = Math.min(favorites.length, 3).toLocaleString();
  dropsEl.textContent = drops.toLocaleString();
  riskEl.textContent = risks.toLocaleString();
}

function renderLastChecked(favorites) {
  const el = document.getElementById('side-last-checked');
  if (!el) return;

  const latest = favorites
    .map(fav => fav.lastCheckedAt || fav.priceUpdatedAt || fav.listingCheckedAt)
    .filter(Boolean)
    .sort((a, b) => new Date(b) - new Date(a))[0];

  el.textContent = latest ? `最終確認 ${formatSideDateTime(latest)}` : '最終確認 -';
}

function renderActiveSideView(favorites) {
  document.querySelectorAll('.side-tab').forEach((tab) => {
    const isActive = tab.dataset.view === activeSideView;
    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  document.querySelectorAll('.side-panel-view').forEach((view) => {
    view.hidden = view.id !== `${activeSideView}-panel`;
  });

  renderCandidateList(favorites);
  renderCrossSiteGroupsSafely();
  renderCompareBoard(favorites);
  renderChecklistView(favorites);
  renderWatchView(favorites);
}

function renderCandidateList(favorites) {
  const listEl = document.getElementById('candidate-list');
  const emptyEl = document.getElementById('candidate-empty');
  if (!listEl || !emptyEl) return;

  listEl.innerHTML = '';
  emptyEl.hidden = favorites.length !== 0;
  listEl.hidden = favorites.length === 0;

  favorites.forEach((fav) => {
    const row = document.createElement('article');
    row.className = 'candidate-row';

    const body = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'candidate-title';
    title.textContent = fav.name || '(物件名不明)';
    body.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'candidate-meta';
    [getSiteDisplayName(fav.site), fav.station, fav.area ? `${fav.area}m²` : '']
      .filter(Boolean)
      .forEach((text) => appendSpan(meta, text));
    body.appendChild(meta);

    const metrics = document.createElement('div');
    metrics.className = 'candidate-metrics';
    const monthlyCost = calculateSideMonthlyCost(fav);
    appendSpan(metrics, formatSidePrice(fav.currentPrice || fav.price));
    appendSpan(metrics, fav.tsubotanka ? `坪${fav.tsubotanka.toLocaleString()}万` : '', 'metric-good');
    appendSpan(metrics, monthlyCost ? `月額 ${formatSideMonthlyCost(monthlyCost.totalMonthly)}` : '', 'metric-good');
    appendPriceDiff(metrics, fav);
    body.appendChild(metrics);
    row.appendChild(body);

    const selectButton = document.createElement('button');
    selectButton.className = 'candidate-select';
    selectButton.type = 'button';
    selectButton.textContent = fav.url === selectedFavoriteUrl ? '表示中' : '表示';
    selectButton.addEventListener('click', () => {
      selectedFavoriteUrl = fav.url;
      renderSidePanel();
    });
    row.appendChild(selectButton);

    listEl.appendChild(row);
  });
}

function renderCompareBoard(favorites) {
  const boardEl = document.getElementById('side-compare-board');
  const emptyEl = document.getElementById('compare-empty');
  if (!boardEl || !emptyEl) return;

  boardEl.innerHTML = '';
  const compareFavorites = favorites.slice(0, 3);
  emptyEl.hidden = compareFavorites.length !== 0;
  boardEl.hidden = compareFavorites.length === 0;
  if (compareFavorites.length === 0) return;

  const table = document.createElement('table');
  table.className = 'side-compare-table';

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  const firstHead = document.createElement('th');
  firstHead.className = 'side-compare-row-head';
  firstHead.textContent = '物件';
  headerRow.appendChild(firstHead);

  compareFavorites.forEach((fav, index) => {
    const th = document.createElement('th');
    const button = document.createElement('button');
    button.className = 'side-compare-property';
    button.type = 'button';
    button.textContent = fav.name || `(物件${index + 1})`;
    button.addEventListener('click', () => {
      selectedFavoriteUrl = fav.url;
      renderSelectedDetail(fav);
    });
    th.appendChild(button);

    const site = document.createElement('span');
    site.className = 'side-compare-site';
    site.textContent = getSiteDisplayName(fav.site);
    th.appendChild(site);
    headerRow.appendChild(th);
  });

  thead.appendChild(headerRow);
  table.appendChild(thead);

  const rows = [
    { key: 'price', label: '価格', best: 'min', value: fav => fav.currentPrice || fav.price, text: fav => formatSidePrice(fav.currentPrice || fav.price) },
    { key: 'area', label: '専有面積', best: 'max', value: fav => Number(fav.area), text: fav => fav.area ? `${fav.area}m²` : '-' },
    { key: 'tsubo', label: '坪単価', best: 'min', value: fav => Number(fav.tsubotanka), text: fav => fav.tsubotanka ? `${fav.tsubotanka.toLocaleString()}万円` : '-' },
    { key: 'monthly', label: '月額概算', best: 'min', value: fav => calculateSideMonthlyCost(fav)?.totalMonthly, text: fav => formatSideMonthlyCost(calculateSideMonthlyCost(fav)?.totalMonthly) || '-' },
    { key: 'management', label: '管理費', best: 'min', value: fav => Number(fav.managementFee), text: fav => formatSideYen(Number(fav.managementFee) || 0) || '-' },
    { key: 'repair', label: '修繕積立金', best: 'min', value: fav => Number(fav.repairFund), text: fav => formatSideYen(Number(fav.repairFund) || 0) || '-' },
    { key: 'repairRisk', label: '修繕診断', best: null, value: fav => fav.repairFundRisk?.level, text: fav => fav.repairFundRisk?.label || '-' },
    { key: 'station', label: '駅距離', best: null, value: fav => fav.station, text: fav => fav.station || '-' },
    { key: 'age', label: '築年数', best: null, value: fav => fav.age, text: fav => fav.age || '-' },
    { key: 'diff', label: '価格変動', best: 'min', value: fav => getPriceDiffInfo(fav).diff, text: fav => getPriceDiffInfo(fav).label || '変動なし' }
  ];

  const tbody = document.createElement('tbody');
  rows.forEach((rowDef) => {
    const row = document.createElement('tr');
    const head = document.createElement('th');
    head.className = 'side-compare-row-head';
    head.textContent = rowDef.label;
    row.appendChild(head);

    const bestValue = findBestValue(compareFavorites, rowDef);
    compareFavorites.forEach((fav) => {
      const td = document.createElement('td');
      const value = rowDef.value(fav);
      td.textContent = rowDef.text(fav);
      if (rowDef.best && bestValue !== null && Number(value) === bestValue) {
        td.classList.add('side-compare-cell--best');
      }
      if (rowDef.key === 'repairRisk' && fav.repairFundRisk?.level === 'high') {
        td.classList.add('side-compare-cell--risk');
      }
      if (rowDef.key === 'diff' && getPriceDiffInfo(fav).diff > 0) {
        td.classList.add('side-compare-cell--risk');
      }
      row.appendChild(td);
    });
    tbody.appendChild(row);
  });

  table.appendChild(tbody);
  boardEl.appendChild(table);
}

const CROSS_SITE_FIELD_LABELS = {
  priceMan: '価格',
  areaSqm: '面積',
  layout: '間取り',
  floor: '階数',
  managementFeeYen: '管理費',
  repairFundYen: '修繕積立金'
};

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

function focusSelectedCrossSiteListing() {
  if (!selectedCrossSiteListingKey) return;
  const row = document.querySelector(`[data-listing-key="${CSS.escape(selectedCrossSiteListingKey)}"]`);
  const candidate = row ? null : Array.from(
    document.querySelectorAll('.cross-site-candidate[data-cross-site-member-keys]')
  ).find((card) => {
    try {
      return JSON.parse(card.dataset.crossSiteMemberKeys || '[]').includes(selectedCrossSiteListingKey);
    } catch (error) {
      return false;
    }
  });
  const target = row || candidate;
  if (!target) {
    setSideStatus('指定された閲覧物件は保存期間の終了などで見つかりませんでした');
    return;
  }
  target.classList.add(row ? 'cross-site-listing-row--selected' : 'cross-site-candidate--selected');
  target.scrollIntoView({ block: 'center' });
}

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
    candidateCard.dataset.crossSiteMemberKeys = JSON.stringify(Array.from(new Set([
      candidate.leftKey,
      candidate.rightKey,
      ...(candidate.leftMemberKeys || []),
      ...(candidate.rightMemberKeys || [])
    ])).sort());
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

function getSideLanguageModelApi() {
  if (typeof LanguageModel !== 'undefined') return LanguageModel;
  if (globalThis.ai?.languageModel) return globalThis.ai.languageModel;
  if (globalThis.ai?.createTextSession) {
    return {
      availability: async () => 'available',
      create: () => globalThis.ai.createTextSession()
    };
  }
  return null;
}

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

  const generationToken = ++sideSimilarAiGenerationToken;
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

    if (generationToken === sideSimilarAiGenerationToken) {
      sideSimilarAiSummary = parseSideSimilarSummary(response, groups);
      setSideStatus('横断掲載のAI短評を生成しました');
    }
  } catch (error) {
    console.error('[坪たん Side Panel] 横断掲載AI短評生成エラー:', error);
    if (generationToken === sideSimilarAiGenerationToken) {
      setSideStatus(error.message || 'AI短評を生成できませんでした');
    }
  } finally {
    if (session?.destroy) session.destroy();
    sideSimilarAiInProgress = false;
    renderCrossSiteGroupsSafely();
  }
}

function findBestValue(favorites, rowDef) {
  if (!rowDef.best) return null;
  const values = favorites
    .map(fav => Number(rowDef.value(fav)))
    .filter(value => Number.isFinite(value) && value > 0);
  if (!values.length) return null;
  return rowDef.best === 'max' ? Math.max(...values) : Math.min(...values);
}

function renderChecklistView(favorites) {
  const listEl = document.getElementById('side-checklist-list');
  const emptyEl = document.getElementById('checklist-empty');
  if (!listEl || !emptyEl) return;

  listEl.innerHTML = '';
  emptyEl.hidden = favorites.length !== 0;
  listEl.hidden = favorites.length === 0;

  favorites.forEach((fav) => {
    const card = document.createElement('section');
    card.className = 'side-checklist-card';

    const title = document.createElement('div');
    title.className = 'side-checklist-title';
    title.textContent = fav.name || '(物件名不明)';
    card.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'side-checklist-meta';
    const progress = getSideChecklistProgress(fav);
    [formatSidePrice(fav.currentPrice || fav.price), fav.station || '', `${progress.completed}/${progress.total}`]
      .filter(Boolean)
      .forEach((text) => appendSpan(meta, text));
    card.appendChild(meta);

    card.appendChild(createSideChecklistGrid(fav));
    const aiChecklistBlock = createSideAiChecklistBlock(fav);
    if (aiChecklistBlock) card.appendChild(aiChecklistBlock);
    listEl.appendChild(card);
  });
}

function renderWatchView(favorites) {
  const listEl = document.getElementById('side-watch-list');
  const emptyEl = document.getElementById('watch-empty');
  if (!listEl || !emptyEl) return;

  const watchFavorites = favorites.filter(fav => fav.currentPrice || fav.price);
  listEl.innerHTML = '';
  emptyEl.hidden = watchFavorites.length !== 0;
  listEl.hidden = watchFavorites.length === 0;

  watchFavorites.forEach((fav) => {
    const row = document.createElement('article');
    row.className = 'watch-row';

    const title = document.createElement('div');
    title.className = 'watch-title';
    title.textContent = fav.name || '(物件名不明)';
    row.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'watch-meta';
    const diff = getPriceDiffInfo(fav);
    [formatSidePrice(fav.currentPrice || fav.price), diff.label || '変動なし', fav.lastCheckedAt ? `${formatSideDateTime(fav.lastCheckedAt)}確認` : '']
      .filter(Boolean)
      .forEach((text) => appendSpan(meta, text, diff.diff > 0 ? 'metric-risk' : diff.diff < 0 ? 'metric-good' : ''));
    row.appendChild(meta);

    const historyEl = createPriceHistoryElement(fav);
    if (historyEl) row.appendChild(historyEl);
    listEl.appendChild(row);
  });
}

function renderSelectedDetail(fav) {
  const detailEl = document.getElementById('selected-detail');
  if (!detailEl) return;
  detailEl.innerHTML = '';
  if (!fav) return;

  selectedFavoriteUrl = fav.url;

  const header = document.createElement('div');
  header.className = 'selected-header';

  const titleRow = document.createElement('div');
  titleRow.className = 'selected-title-row';
  const title = document.createElement('h2');
  title.className = 'selected-title';
  title.textContent = fav.name || '(物件名不明)';
  titleRow.appendChild(title);

  const site = document.createElement('span');
  site.className = 'selected-site';
  site.textContent = getSiteDisplayName(fav.site);
  titleRow.appendChild(site);
  header.appendChild(titleRow);

  const meta = document.createElement('div');
  meta.className = 'selected-meta';
  const monthlyCost = calculateSideMonthlyCost(fav);
  [
    formatSidePrice(fav.currentPrice || fav.price),
    fav.area ? `${fav.area}m²` : '',
    fav.tsubotanka ? `坪${fav.tsubotanka.toLocaleString()}万` : '',
    monthlyCost ? `月額 ${formatSideMonthlyCost(monthlyCost.totalMonthly)}` : ''
  ].filter(Boolean).forEach((text) => appendSpan(meta, text));
  header.appendChild(meta);
  detailEl.appendChild(header);

  const grid = document.createElement('div');
  grid.className = 'selected-grid';

  const historySection = document.createElement('section');
  historySection.className = 'selected-section';
  const historyTitle = document.createElement('h3');
  historyTitle.textContent = '価格変動履歴';
  historySection.appendChild(historyTitle);
  historySection.appendChild(createPriceHistoryElement(fav) || createEmptyText('履歴はまだありません'));
  grid.appendChild(historySection);

  const memoSection = document.createElement('section');
  memoSection.className = 'selected-section';
  const memoTitle = document.createElement('h3');
  memoTitle.textContent = 'メモ';
  memoSection.appendChild(memoTitle);
  const memo = document.createElement('textarea');
  memo.className = 'selected-memo';
  memo.placeholder = '眺望・日当たり・価格の妥当性など';
  memo.value = fav.memo || '';
  memo.addEventListener('input', () => {
    window.clearTimeout(sideMemoSaveTimer);
    sideMemoSaveTimer = window.setTimeout(() => {
      updateSideFavorite(fav.url, { memo: memo.value });
    }, 250);
  });
  memoSection.appendChild(memo);
  grid.appendChild(memoSection);

  const checklistSection = document.createElement('section');
  checklistSection.className = 'selected-section';
  const checklistTitle = document.createElement('h3');
  checklistTitle.textContent = '内見チェックリスト';
  checklistSection.appendChild(checklistTitle);
  checklistSection.appendChild(createSideChecklistGrid(fav));
  const aiChecklistBlock = createSideAiChecklistBlock(fav);
  if (aiChecklistBlock) checklistSection.appendChild(aiChecklistBlock);
  grid.appendChild(checklistSection);

  detailEl.appendChild(grid);
}

function createSideChecklistGrid(fav) {
  const state = getSideChecklistState(fav);
  const grid = document.createElement('div');
  grid.className = 'side-check-grid';

  SIDE_CHECKLIST_ITEMS.forEach((item) => {
    const label = document.createElement('label');
    label.className = 'side-check-item';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = Boolean(state[item.id]);
    input.addEventListener('change', () => {
      window.clearTimeout(sideChecklistSaveTimer);
      sideChecklistSaveTimer = window.setTimeout(() => {
        updateSideFavorite(fav.url, {
          viewingChecklist: {
            ...getSideChecklistState(fav),
            [item.id]: input.checked
          }
        });
      }, 150);
    });
    label.appendChild(input);

    const text = document.createElement('span');
    text.textContent = item.label;
    label.appendChild(text);
    grid.appendChild(label);
  });

  return grid;
}

function getSideAiViewingChecklistItems(fav) {
  return Array.isArray(fav.aiViewingChecklist)
    ? fav.aiViewingChecklist.filter(item => item?.id && item?.label)
    : [];
}

function createSideAiChecklistBlock(fav) {
  const items = getSideAiViewingChecklistItems(fav);
  if (items.length === 0) return null;

  const state = getSideChecklistState(fav);
  const block = document.createElement('div');
  block.className = 'side-ai-checklist-block';

  const title = document.createElement('div');
  title.className = 'side-ai-checklist-title';
  title.textContent = 'AIチェック';
  block.appendChild(title);

  const list = document.createElement('div');
  list.className = 'side-ai-checklist-list';
  items.forEach((item) => {
    const label = document.createElement('label');
    label.className = 'side-ai-checklist-item';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = Boolean(state[item.id]);
    input.addEventListener('change', () => {
      updateSideFavorite(fav.url, {
        viewingChecklist: {
          ...getSideChecklistState(fav),
          [item.id]: input.checked
        }
      });
    });
    label.appendChild(input);

    const body = document.createElement('span');
    const itemLabel = document.createElement('strong');
    itemLabel.textContent = item.label;
    body.appendChild(itemLabel);
    if (item.reason) {
      const reason = document.createElement('em');
      reason.textContent = item.reason;
      body.appendChild(reason);
    }
    label.appendChild(body);
    list.appendChild(label);
  });

  block.appendChild(list);
  return block;
}

function getSideChecklistState(fav) {
  return fav.viewingChecklist && typeof fav.viewingChecklist === 'object'
    ? fav.viewingChecklist
    : {};
}

function getSideChecklistProgress(fav) {
  const state = getSideChecklistState(fav);
  const completed = SIDE_CHECKLIST_ITEMS.filter(item => state[item.id]).length;
  const aiItems = getSideAiViewingChecklistItems(fav);
  const aiCompleted = aiItems.filter(item => state[item.id]).length;
  return { completed: completed + aiCompleted, total: SIDE_CHECKLIST_ITEMS.length + aiItems.length };
}

function updateSideFavorite(url, patch) {
  chrome.storage.local.get({ favorites: [] }, (result) => {
    const favorites = result.favorites.map((favorite) => {
      if (favorite.url !== url) return favorite;
      return {
        ...favorite,
        ...patch,
        updatedAt: new Date().toISOString()
      };
    });

    chrome.storage.local.set({ favorites });
  });
}

function calculateSideMonthlyLoanPayment(principal, annualRate, years) {
  if (principal <= 0 || years <= 0) return 0;
  if (annualRate <= 0) return Math.round(principal / (years * 12));

  const monthlyRate = annualRate / 12;
  const totalMonths = years * 12;
  const factor = Math.pow(1 + monthlyRate, totalMonths);
  return Math.round(principal * monthlyRate * factor / (factor - 1));
}

function calculateSideMonthlyCost(fav) {
  const priceMan = fav.currentPrice || fav.price || 0;
  if (!priceMan) return null;

  const borrowingMan = Math.max(0, priceMan - sideLoanSettings.downPaymentMan);
  const loanMonthly = calculateSideMonthlyLoanPayment(
    borrowingMan * 10000,
    sideLoanSettings.annualRatePercent / 100,
    sideLoanSettings.years
  );

  const managementFee = Number(fav.managementFee) || 0;
  const repairFund = Number(fav.repairFund) || 0;

  return {
    loanMonthly,
    managementFee,
    repairFund,
    totalMonthly: loanMonthly + managementFee + repairFund
  };
}

function getPriceDiffInfo(fav) {
  const latestHistory = Array.isArray(fav.priceHistory) ? fav.priceHistory[0] : null;
  const previousPrice = latestHistory?.previousPrice || fav.previousPrice;
  const currentPrice = latestHistory?.currentPrice || fav.currentPrice;

  if (!previousPrice || !currentPrice || previousPrice === currentPrice) {
    return { diff: 0, label: '' };
  }

  const diff = currentPrice - previousPrice;
  return {
    diff,
    label: `${diff > 0 ? '+' : ''}${diff.toLocaleString()}万円`
  };
}

function buildPriceHistoryPoints(fav) {
  const history = Array.isArray(fav.priceHistory) ? [...fav.priceHistory].reverse() : [];
  const points = [];

  history.forEach((entry) => {
    if (entry.previousPrice) points.push({ price: entry.previousPrice, checkedAt: entry.checkedAt });
    if (entry.currentPrice) points.push({ price: entry.currentPrice, checkedAt: entry.checkedAt });
  });

  const currentPrice = fav.currentPrice || fav.price;
  if (currentPrice) {
    points.push({
      price: currentPrice,
      checkedAt: fav.lastCheckedAt || fav.priceUpdatedAt || fav.listingCheckedAt
    });
  }

  return points.filter((point, index) => {
    const previous = points[index - 1];
    return !previous || previous.price !== point.price;
  });
}

function createPriceHistoryElement(fav) {
  const points = buildPriceHistoryPoints(fav);
  if (points.length < 2) return null;

  const prices = points.map(point => point.price);
  const firstPrice = prices[0];
  const latestPrice = prices[prices.length - 1];
  const diff = latestPrice - firstPrice;
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const range = maxPrice - minPrice || 1;

  const wrapper = document.createElement('div');
  const summary = document.createElement('div');
  summary.className = 'price-history-summary';

  const label = document.createElement('span');
  label.textContent = `${formatSidePrice(firstPrice)} → ${formatSidePrice(latestPrice)}`;
  summary.appendChild(label);

  const diffLabel = document.createElement('span');
  diffLabel.className = diff > 0 ? 'metric-risk' : 'metric-good';
  diffLabel.textContent = `${diff > 0 ? '+' : ''}${diff.toLocaleString()}万円`;
  summary.appendChild(diffLabel);
  wrapper.appendChild(summary);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 160 74');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'price-history-chart');
  svg.setAttribute('aria-hidden', 'true');

  const baseLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  baseLine.setAttribute('class', 'price-history-base');
  baseLine.setAttribute('x1', '0');
  baseLine.setAttribute('x2', '160');
  baseLine.setAttribute('y1', '62');
  baseLine.setAttribute('y2', '62');
  svg.appendChild(baseLine);

  const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  polyline.setAttribute('class', 'price-history-line');
  polyline.setAttribute('points', prices.map((price, index) => {
    const x = points.length === 1 ? 0 : (index / (points.length - 1)) * 160;
    const y = 62 - ((price - minPrice) / range) * 46;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' '));
  svg.appendChild(polyline);

  const lastPoint = prices[prices.length - 1];
  const lastCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  lastCircle.setAttribute('class', 'price-history-point');
  lastCircle.setAttribute('cx', '160');
  lastCircle.setAttribute('cy', (62 - ((lastPoint - minPrice) / range) * 46).toFixed(2));
  lastCircle.setAttribute('r', '3.3');
  svg.appendChild(lastCircle);

  wrapper.appendChild(svg);
  return wrapper;
}

function createEmptyText(text) {
  const el = document.createElement('p');
  el.className = 'side-empty-text';
  el.textContent = text;
  return el;
}

function appendSpan(parent, text, className = '') {
  if (!text) return null;
  const span = document.createElement('span');
  if (className) span.className = className;
  span.textContent = text;
  parent.appendChild(span);
  return span;
}

function appendPriceDiff(parent, fav) {
  const diffInfo = getPriceDiffInfo(fav);
  if (!diffInfo.label) return null;
  return appendSpan(parent, diffInfo.label, diffInfo.diff > 0 ? 'metric-risk' : 'metric-good');
}

function getSiteDisplayName(site) {
  const names = {
    SUUMO: 'SUUMO',
    REHOUSE: 'リハウス',
    ATHOME: 'アットホーム',
    HOMES: 'ホームズ'
  };
  return names[site] || site || '';
}

function formatSidePrice(price) {
  if (!price) return '';
  if (price >= 10000) {
    const oku = Math.floor(price / 10000);
    const man = price % 10000;
    return man === 0 ? `${oku}億円` : `${oku}億${man.toLocaleString()}万円`;
  }
  return `${price.toLocaleString()}万円`;
}

function formatSideYen(amount) {
  if (!amount) return '';
  return `${amount.toLocaleString()}円`;
}

function formatSideMonthlyCost(amount) {
  if (!amount) return '';
  if (amount >= 10000) {
    return `${(Math.round(amount / 1000) / 10).toLocaleString()}万円`;
  }
  return `${amount.toLocaleString()}円`;
}

function formatSideDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function compactSideText(text, maxLength = 80) {
  const compact = String(text || '').replace(/\s+/g, ' ').trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}...` : compact;
}

function setSideStatus(text) {
  const statusEl = document.getElementById('side-status');
  if (!statusEl) return;
  statusEl.textContent = text;
  window.clearTimeout(statusEl._clearTimer);
  if (text) {
    statusEl._clearTimer = window.setTimeout(() => {
      statusEl.textContent = '';
    }, 5000);
  }
}

function formatSideRecheckSummary(response) {
  if (!response || response.error) return response?.error || '再チェックに失敗しました';
  if (response.checked === 0) return '確認対象はありません';

  const parts = [`${response.checked}件確認`];
  if (response.ended) parts.push(`掲載終了候補${response.ended}件`);
  if (response.failed) parts.push(`失敗${response.failed}件`);
  if (response.remaining) parts.push(`残り${response.remaining}件`);
  return parts.join(' / ');
}

function requestSideRecheck() {
  if (sideRecheckInProgress) return;
  const button = document.getElementById('side-recheck');
  sideRecheckInProgress = true;
  if (button) button.disabled = true;
  setSideStatus('価格を確認中...');

  chrome.runtime.sendMessage({ type: 'RECHECK_FAVORITES_NOW' }, (response) => {
    sideRecheckInProgress = false;
    if (button) button.disabled = false;

    if (chrome.runtime.lastError) {
      setSideStatus(chrome.runtime.lastError.message || '再チェックに失敗しました');
      return;
    }

    setSideStatus(formatSideRecheckSummary(response));
    loadSidePanelData();
  });
}

function escapeCsvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function exportSideCsv() {
  const favorites = getSortedSideFavorites();
  if (!favorites.length) {
    setSideStatus('出力できる候補がありません');
    return;
  }

  const headers = ['物件名', 'サイト', '価格', '専有面積', '坪単価', '月額概算', '管理費', '修繕積立金', '価格変動', 'URL'];
  const rows = favorites.map((fav) => {
    const monthlyCost = calculateSideMonthlyCost(fav);
    return [
      fav.name || '',
      getSiteDisplayName(fav.site),
      formatSidePrice(fav.currentPrice || fav.price),
      fav.area ? `${fav.area}m²` : '',
      fav.tsubotanka ? `${fav.tsubotanka.toLocaleString()}万円/坪` : '',
      monthlyCost ? formatSideMonthlyCost(monthlyCost.totalMonthly) : '',
      formatSideYen(Number(fav.managementFee) || 0),
      formatSideYen(Number(fav.repairFund) || 0),
      getPriceDiffInfo(fav).label,
      fav.url || ''
    ];
  });

  const csv = '\uFEFF' + [headers, ...rows]
    .map(row => row.map(escapeCsvCell).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
  link.href = url;
  link.download = `坪たん_比較_${timestamp}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  setSideStatus(`${favorites.length}件をCSV出力しました`);
}

function openSelectedDetail() {
  const fav = getSelectedFavorite();
  if (!fav?.url) {
    setSideStatus('開ける物件がありません');
    return;
  }
  chrome.tabs.create({ url: fav.url });
}

function switchSideView(viewName) {
  activeSideView = viewName;
  renderSidePanel();
}

function setupSidePanelEvents() {
  document.querySelectorAll('.side-tab').forEach((tab) => {
    tab.addEventListener('click', () => switchSideView(tab.dataset.view));
  });

  document.getElementById('side-search-input')?.addEventListener('input', () => {
    invalidateSideSimilarAiSummary();
    renderSidePanel();
  });
  document.getElementById('side-recheck')?.addEventListener('click', requestSideRecheck);
  document.getElementById('side-similar-ai')?.addEventListener('click', generateSideSimilarAiSummary);
  document.getElementById('export-side-csv')?.addEventListener('click', exportSideCsv);
  document.getElementById('open-selected-detail')?.addEventListener('click', openSelectedDetail);
  document.getElementById('open-checklist-view')?.addEventListener('click', () => switchSideView('checklist'));

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes.crossSitePendingSelectionV1?.newValue) {
      consumeCrossSitePendingSelection(changes.crossSitePendingSelectionV1.newValue);
    }
    if (changes.favorites) sideFavorites = changes.favorites.newValue || [];
    if (changes.loanSettings) sideLoanSettings = normalizeSideLoanSettings(changes.loanSettings.newValue);
    if (changes.observedListingsV1) sideObservedListings = changes.observedListingsV1.newValue?.items || [];
    if (changes.listingMatchOverridesV1) {
      sideMatchOverrides = changes.listingMatchOverridesV1.newValue || { version: 1, buildingPairs: [], unitPairs: [] };
    }
    if (changes.buildingAliasesV1) {
      sideBuildingAliases = changes.buildingAliasesV1.newValue || { version: 1, entries: [] };
    }
    if (
      changes.favorites ||
      changes.loanSettings ||
      changes.observedListingsV1 ||
      changes.listingMatchOverridesV1 ||
      changes.buildingAliasesV1
    ) {
      invalidateSideSimilarAiSummary();
    }
    renderSidePanel();
  });
}

setupSidePanelEvents();
loadSidePanelData();
