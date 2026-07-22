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

function loadSidePanelData() {
  chrome.storage.local.get({
    favorites: [],
    loanSettings: SIDE_DEFAULT_LOAN_SETTINGS
  }, (result) => {
    sideFavorites = Array.isArray(result.favorites) ? result.favorites : [];
    sideLoanSettings = normalizeSideLoanSettings(result.loanSettings);
    if (!selectedFavoriteUrl && sideFavorites[0]) {
      selectedFavoriteUrl = sideFavorites[0].url;
    }
    renderSidePanel();
  });
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
  renderSimilarGroups(favorites);
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

function renderSimilarGroups(favorites) {
  const groupsEl = document.getElementById('side-similar-groups');
  const statusEl = document.getElementById('side-similar-status');
  const button = document.getElementById('side-similar-ai');
  if (!groupsEl || !statusEl || !button) return;

  const groups = buildSimilarFavoriteGroups(favorites);
  groupsEl.innerHTML = '';
  button.disabled = groups.length === 0 || sideSimilarAiInProgress || !getSideLanguageModelApi()?.create;
  button.textContent = sideSimilarAiInProgress ? '生成中...' : 'AI短評';

  if (groups.length === 0) {
    statusEl.textContent = favorites.length < 2 ? '候補が2件以上になると類似まとめを表示します。' : '強く似ている候補はまだ見つかりません。';
    statusEl.dataset.tone = '';
    return;
  }

  if (!getSideLanguageModelApi()?.create) {
    statusEl.textContent = '類似グループを表示中。AI短評はこのChromeでは未対応です。';
    statusEl.dataset.tone = 'warn';
  } else if (sideSimilarAiSummary) {
    statusEl.textContent = 'AI短評を表示中です。';
    statusEl.dataset.tone = 'success';
  } else {
    statusEl.textContent = '類似グループを表示中。AI短評も生成できます。';
    statusEl.dataset.tone = '';
  }

  groups.forEach((group, index) => {
    const card = document.createElement('article');
    card.className = 'side-similar-card';

    const title = document.createElement('div');
    title.className = 'side-similar-title';
    title.textContent = group.title;
    card.appendChild(title);

    const reason = document.createElement('div');
    reason.className = 'side-similar-reason';
    reason.textContent = group.reasons.join(' / ');
    card.appendChild(reason);

    const items = document.createElement('div');
    items.className = 'side-similar-items';
    group.favorites.forEach((fav) => {
      const buttonEl = document.createElement('button');
      buttonEl.className = 'side-similar-item';
      buttonEl.type = 'button';
      buttonEl.addEventListener('click', () => {
        selectedFavoriteUrl = fav.url;
        renderSidePanel();
      });

      const name = document.createElement('strong');
      name.textContent = fav.name || '(物件名不明)';
      buttonEl.appendChild(name);

      const meta = document.createElement('span');
      meta.textContent = [
        formatSidePrice(fav.currentPrice || fav.price),
        fav.area ? `${fav.area}m²` : '',
        fav.tsubotanka ? `坪${fav.tsubotanka.toLocaleString()}万` : '',
        fav.station || ''
      ].filter(Boolean).join(' / ');
      buttonEl.appendChild(meta);
      items.appendChild(buttonEl);
    });
    card.appendChild(items);

    const aiComment = sideSimilarAiSummary?.summaries?.[index]?.comment;
    if (aiComment) {
      const comment = document.createElement('div');
      comment.className = 'side-similar-ai-comment';
      comment.textContent = aiComment;
      card.appendChild(comment);
    }

    groupsEl.appendChild(card);
  });
}

function normalizeSimilarText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
    .replace(/中古マンション|マンション|売主|専任|一般|階|号室|室|棟/g, '')
    .replace(/[()\[\]（）【】「」『』,\s　・･\-＿_]/g, '');
}

function getNameTokens(fav) {
  const text = normalizeSimilarText(fav.name || '');
  if (!text) return [];
  const tokens = [];
  for (let length = Math.min(8, text.length); length >= 3; length--) {
    for (let i = 0; i <= text.length - length; i++) {
      tokens.push(text.slice(i, i + length));
    }
  }
  return Array.from(new Set(tokens)).slice(0, 80);
}

function getFavoriteSimilarity(a, b) {
  const reasons = [];
  let score = 0;
  const aName = normalizeSimilarText(a.name || '');
  const bName = normalizeSimilarText(b.name || '');
  const stationA = normalizeSimilarText(a.station || '');
  const stationB = normalizeSimilarText(b.station || '');

  if (aName && bName && (aName.includes(bName) || bName.includes(aName))) {
    score += 3.2;
    reasons.push('物件名が近い');
  } else {
    const aTokens = getNameTokens(a);
    const bTokenSet = new Set(getNameTokens(b));
    const overlap = aTokens.filter(token => bTokenSet.has(token)).length;
    if (overlap >= 2) {
      score += Math.min(2.4, overlap * 0.55);
      reasons.push('名称の共通部分あり');
    }
  }

  if (stationA && stationB && stationA === stationB) {
    score += 1.1;
    reasons.push('駅距離表記が同じ');
  }

  const areaDiff = Math.abs(Number(a.area || 0) - Number(b.area || 0));
  if (areaDiff > 0 && areaDiff <= 3) {
    score += 1.2;
    reasons.push('面積が近い');
  } else if (areaDiff > 0 && areaDiff <= 8) {
    score += 0.6;
    reasons.push('面積帯が近い');
  }

  const priceDiff = Math.abs(Number(a.currentPrice || a.price || 0) - Number(b.currentPrice || b.price || 0));
  if (priceDiff > 0 && priceDiff <= 500) {
    score += 0.9;
    reasons.push('価格が近い');
  } else if (priceDiff > 0 && priceDiff <= 1500) {
    score += 0.45;
    reasons.push('価格帯が近い');
  }

  const tsuboDiff = Math.abs(Number(a.tsubotanka || 0) - Number(b.tsubotanka || 0));
  if (tsuboDiff > 0 && tsuboDiff <= 20) {
    score += 0.8;
    reasons.push('坪単価が近い');
  }

  return { score, reasons: Array.from(new Set(reasons)) };
}

function buildSimilarFavoriteGroups(favorites) {
  const candidates = favorites.filter(fav => fav.url && (fav.name || fav.station || fav.area || fav.price));
  const parent = new Map(candidates.map(fav => [fav.url, fav.url]));
  const pairReasons = new Map();

  const find = (url) => {
    const current = parent.get(url);
    if (current === url) return url;
    const root = find(current);
    parent.set(url, root);
    return root;
  };
  const unite = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
  };

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const similarity = getFavoriteSimilarity(candidates[i], candidates[j]);
      if (similarity.score >= 3) {
        unite(candidates[i].url, candidates[j].url);
        pairReasons.set(`${candidates[i].url}|${candidates[j].url}`, similarity.reasons);
      }
    }
  }

  const grouped = new Map();
  candidates.forEach((fav) => {
    const root = find(fav.url);
    if (!grouped.has(root)) grouped.set(root, []);
    grouped.get(root).push(fav);
  });

  return Array.from(grouped.values())
    .filter(group => group.length >= 2)
    .map((group) => {
      const reasons = new Set();
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          (pairReasons.get(`${group[i].url}|${group[j].url}`) || pairReasons.get(`${group[j].url}|${group[i].url}`) || [])
            .forEach(reason => reasons.add(reason));
        }
      }
      const titleBase = group[0].name ? compactSideText(group[0].name, 18) : '近い条件';
      return {
        title: `${titleBase} ほか${group.length}件`,
        reasons: Array.from(reasons).slice(0, 4),
        favorites: group.sort((a, b) => Number(a.currentPrice || a.price || 0) - Number(b.currentPrice || b.price || 0))
      };
    })
    .slice(0, 4);
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

function buildSideSimilarPrompt(groups) {
  const lines = groups.map((group, index) => {
    const items = group.favorites.map((fav) => [
      fav.name || '(物件名不明)',
      formatSidePrice(fav.currentPrice || fav.price),
      fav.area ? `${fav.area}m²` : '',
      fav.tsubotanka ? `坪${fav.tsubotanka}万円` : '',
      fav.station || '',
      fav.repairFundRisk?.label ? `修繕${fav.repairFundRisk.label}` : ''
    ].filter(Boolean).join(' / '));
    return `グループ${index + 1}: ${group.reasons.join('・')}\n${items.map(item => `- ${item}`).join('\n')}`;
  }).join('\n\n');

  return [
    'あなたは中古マンション候補の比較メモを作るアシスタントです。',
    '以下の類似候補グループについて、何が近く、どこを比べるべきかを短くまとめてください。',
    '購入すべき/買わないべき等の結論、価格査定、根拠のない推測は書かないでください。',
    '各グループ1文、45〜80文字程度。返答はJSONだけにしてください。',
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
        summaries[index]?.comment ||
        `${group.reasons.join('・')}が近い候補です。価格、面積、管理費、修繕積立金を横並びで確認してください。`,
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
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return normalizeSideSimilarSummary(JSON.parse(jsonMatch[0]), groups);
    } catch (error) {
      console.error('[坪たん Side Panel] 類似AI短評のJSON解析に失敗:', error);
    }
  }

  const lines = cleaned.split(/\n/).filter(Boolean);
  return {
    summaries: groups.map((group, index) => ({
      comment: compactSideText(lines[index] || `${group.reasons.join('・')}が近い候補です。比較表で差分を確認してください。`, 110)
    }))
  };
}

async function generateSideSimilarAiSummary() {
  const groups = buildSimilarFavoriteGroups(getSortedSideFavorites());
  if (groups.length === 0 || sideSimilarAiInProgress) return;

  const api = getSideLanguageModelApi();
  if (!api?.create) {
    setSideStatus('このChromeではAI短評を生成できません');
    return;
  }

  sideSimilarAiInProgress = true;
  renderSimilarGroups(getSortedSideFavorites());

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
                properties: {
                  comment: { type: 'string' }
                },
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
      response = await session.prompt(`${prompt}\n\nJSON以外の文章は書かず、必ず {"summaries":[{"comment":"..."}]} の形で返してください。`);
    }

    sideSimilarAiSummary = parseSideSimilarSummary(response, groups);
    setSideStatus('類似候補のAI短評を生成しました');
  } catch (error) {
    console.error('[坪たん Side Panel] 類似AI短評生成エラー:', error);
    setSideStatus(error.message || 'AI短評を生成できませんでした');
  } finally {
    if (session?.destroy) session.destroy();
    sideSimilarAiInProgress = false;
    renderSimilarGroups(getSortedSideFavorites());
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
    sideSimilarAiSummary = null;
    renderSidePanel();
  });
  document.getElementById('side-recheck')?.addEventListener('click', requestSideRecheck);
  document.getElementById('side-similar-ai')?.addEventListener('click', generateSideSimilarAiSummary);
  document.getElementById('export-side-csv')?.addEventListener('click', exportSideCsv);
  document.getElementById('open-selected-detail')?.addEventListener('click', openSelectedDetail);
  document.getElementById('open-checklist-view')?.addEventListener('click', () => switchSideView('checklist'));

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes.favorites) sideFavorites = changes.favorites.newValue || [];
    if (changes.loanSettings) sideLoanSettings = normalizeSideLoanSettings(changes.loanSettings.newValue);
    if (changes.favorites || changes.loanSettings) sideSimilarAiSummary = null;
    renderSidePanel();
  });
}

setupSidePanelEvents();
loadSidePanelData();
