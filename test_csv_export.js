/**
 * CSVエクスポートの一覧抽出ロジックのテストスクリプト
 * Node.jsで実行: node test_csv_export.js
 */

const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');

class TestElement {
  constructor(tagName, options = {}, children = []) {
    this.tagName = tagName.toUpperCase();
    this._text = options.text || '';
    this.classes = new Set(options.classes || []);
    this.attributes = { ...(options.attrs || {}) };
    this.children = [];
    this.parentElement = null;

    if (this.classes.size > 0 && !this.attributes.class) {
      this.attributes.class = Array.from(this.classes).join(' ');
    }

    children.forEach(child => this.appendChild(child));
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  get textContent() {
    return this._text + this.children.map(child => child.textContent).join('');
  }

  get nextElementSibling() {
    if (!this.parentElement) return null;
    const siblings = this.parentElement.children;
    const index = siblings.indexOf(this);
    return index >= 0 ? siblings[index + 1] || null : null;
  }

  getAttribute(name) {
    return this.attributes[name] || null;
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (matchesAnySelector(current, selector)) return current;
      current = current.parentElement;
    }
    return null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const results = [];
    const visit = (node) => {
      node.children.forEach((child) => {
        if (matchesAnySelector(child, selector)) results.push(child);
        visit(child);
      });
    };
    visit(this);
    return results;
  }
}

function el(tagName, options, children) {
  return new TestElement(tagName, options, children);
}

function matchesAnySelector(element, selector) {
  return selector
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
    .some(part => matchesSelector(element, part));
}

function matchesSelector(element, selector) {
  const tagClassMatch = selector.match(/^([a-z0-9]+)\.([a-z0-9_-]+)$/i);
  if (tagClassMatch) {
    return element.tagName === tagClassMatch[1].toUpperCase() && element.classes.has(tagClassMatch[2]);
  }

  if (selector.startsWith('.')) {
    return element.classes.has(selector.slice(1));
  }

  const attrMatch = selector.match(/^([a-z0-9]+)?\[([a-z0-9_-]+)(\*)?(?:=["']?([^"'\]]+)["']?)?\]$/i);
  if (attrMatch) {
    const [, tagName, attrName, containsOperator, expectedValue] = attrMatch;
    if (tagName && element.tagName !== tagName.toUpperCase()) return false;

    const actualValue = attrName === 'class'
      ? Array.from(element.classes).join(' ')
      : element.getAttribute(attrName);

    if (expectedValue === undefined) return actualValue !== null;
    if (actualValue === null) return false;
    return containsOperator ? actualValue.includes(expectedValue) : actualValue === expectedValue;
  }

  return element.tagName === selector.toUpperCase();
}

function loadCsvApi(hostname) {
  const contentSource = fs.readFileSync('content.js', 'utf8');
  const context = {
    console,
    URL,
    setTimeout,
    clearTimeout,
    window: {
      location: {
        hostname,
        href: `https://${hostname}/`,
        origin: `https://${hostname}`
      }
    },
    document: {
      readyState: 'loading',
      addEventListener() {},
      querySelectorAll() { return []; },
      querySelector() { return null; },
      body: new TestElement('body')
    },
    chrome: {
      storage: {
        local: {
          get() {},
          set() {}
        },
        onChanged: {
          addListener() {}
        }
      }
    }
  };

  vm.createContext(context);
  vm.runInContext(
    `${contentSource}\n` +
    `globalThis.__csvTestApi = { extractListCsvData, generateCSV, mergeCsvDetailInfo, formatExportDuration };`,
    context
  );
  return context.__csvTestApi;
}

function buildSuumoCard() {
  return el('div', { classes: ['dottable--cassette'] }, [
    el('div', { classes: ['dottable-value'], text: '2億5990万円' }),
    el('dl', {}, [
      el('dt', { text: '物件名' }),
      el('dd', { text: '晴海テストタワー' }),
      el('dt', { text: '所在地' }),
      el('dd', { text: '東京都中央区晴海1' }),
      el('dt', { text: '専有面積' }),
      el('dd', { text: '70.00㎡' })
    ]),
    el('a', { attrs: { href: '/ms/chuko/tokyo/sc_chuo/nc_123456/' }, text: '詳細' }),
    el('span', { text: '3LDK 築12年 徒歩9分' })
  ]);
}

function buildRehouseCard() {
  return el('article', { classes: ['property-index-card'] }, [
    el('div', { classes: ['price-text'], text: '1億4180万円' }),
    el('h2', { classes: ['property-card-title'], text: 'リハウステストマンション' }),
    el('p', { classes: ['paragraph-body'], text: '3LDK / 70.01㎡' }),
    el('p', { text: '管理費 18,000円 修繕積立金 12,600円 築10年 徒歩5分' }),
    el('a', { attrs: { href: '/buy/mansion/bkdetail/F1FAGA2C/' }, text: '詳細' })
  ]);
}

function buildAthomeCard() {
  const detail = el('div', { classes: ['card-box-inner__detail'] }, [
    el('div', { classes: ['property-price'], text: '7,620万円' }),
    el('div', { classes: ['property-detail-table__block'], text: '専有面積', }, [
      el('span', { text: '43.92m²' })
    ]),
    el('span', { text: '2LDK 築8年 徒歩4分' })
  ]);

  el('div', { classes: ['card-box-inner'], text: '所在地 東京都中央区月島1\n' }, [
    el('a', { classes: ['select-link'], attrs: { href: '/mansion/1012995991/' }, text: '詳細' }),
    el('div', { classes: ['title-wrap__title-text'], text: 'アットホームテストレジデンス' }),
    detail
  ]);

  return detail;
}

function buildHomesCard() {
  return el('table', {}, [
    el('tr', {}, [
      el('td', { classes: ['price'], text: '16,500万円' }),
      el('td', { classes: ['space'], text: '75.8㎡(壁心)' })
    ]),
    el('tr', {}, [
      el('td', {}, [
        el('div', { classes: ['bukkenName'], text: 'ホームズテストコート' }),
        el('div', { classes: ['bukkenAdress'], text: '東京都港区芝浦1' }),
        el('a', { attrs: { href: '/mansion/b-1193620002052/' }, text: '詳細' })
      ])
    ]),
    el('tr', {}, [
      el('td', { text: '3LDK 築15年 徒歩7分' })
    ])
  ]);
}

const cases = [
  {
    name: 'SUUMO',
    hostname: 'suumo.jp',
    card: buildSuumoCard(),
    expected: {
      site: 'SUUMO',
      name: '晴海テストタワー',
      address: '東京都中央区晴海1',
      price: 25990,
      area: 70,
      url: 'https://suumo.jp/ms/chuko/tokyo/sc_chuo/nc_123456/',
      station: '徒歩9分',
      layout: '3LDK'
    }
  },
  {
    name: 'REHOUSE',
    hostname: 'www.rehouse.co.jp',
    card: buildRehouseCard(),
    expected: {
      site: 'REHOUSE',
      name: 'リハウステストマンション',
      price: 14180,
      area: 70.01,
      managementFee: '18000円',
      repairFund: '12600円',
      url: 'https://www.rehouse.co.jp/buy/mansion/bkdetail/F1FAGA2C/'
    }
  },
  {
    name: 'ATHOME',
    hostname: 'www.athome.co.jp',
    card: buildAthomeCard(),
    expected: {
      site: 'ATHOME',
      name: 'アットホームテストレジデンス',
      address: '東京都中央区月島1',
      price: 7620,
      area: 43.92,
      url: 'https://www.athome.co.jp/mansion/1012995991/'
    }
  },
  {
    name: 'HOMES',
    hostname: 'www.homes.co.jp',
    card: buildHomesCard(),
    expected: {
      site: 'HOMES',
      name: 'ホームズテストコート',
      address: '東京都港区芝浦1',
      price: 16500,
      area: 75.8,
      url: 'https://www.homes.co.jp/mansion/b-1193620002052/'
    }
  }
];

let passCount = 0;

console.log('=== CSVエクスポート一覧抽出テスト ===\n');

for (const testCase of cases) {
  const api = loadCsvApi(testCase.hostname);
  const result = api.extractListCsvData(testCase.card);

  for (const [key, expectedValue] of Object.entries(testCase.expected)) {
    assert.equal(result[key], expectedValue, `${testCase.name}: ${key}`);
  }

  assert.equal(result.detailFetchStatus, '未取得', `${testCase.name}: initial detailFetchStatus`);
  assert.ok(result.tsuboPrice > 0, `${testCase.name}: tsuboPrice`);
  assert.ok(result.heiheiPrice > 0, `${testCase.name}: heiheiPrice`);

  api.mergeCsvDetailInfo(result, {
    detailFetchStatus: '詳細取得失敗',
    nameDetail: '',
    address: ''
  });
  assert.equal(result.detailFetchStatus, '詳細取得失敗', `${testCase.name}: failed status merge`);
  assert.equal(result.name, testCase.expected.name, `${testCase.name}: empty detail should not overwrite name`);

  const csv = api.generateCSV([result]);
  assert.ok(csv.includes('詳細取得ステータス'), `${testCase.name}: status header`);
  assert.ok(csv.includes('詳細取得失敗'), `${testCase.name}: status value`);

  passCount++;
  console.log(`OK: ${testCase.name}`);
}

const api = loadCsvApi('suumo.jp');
assert.equal(api.formatExportDuration(20), '約20秒');
assert.equal(api.formatExportDuration(61), '約1分1秒');

console.log(`\n合格: ${passCount}/${cases.length}`);
