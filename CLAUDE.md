# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

不動産サイト向けChrome拡張機能。物件の価格と専有面積から坪単価・平米単価を自動計算して表示する。

**対応サイト:**
- SUUMO（スーモ）
- 三井のリハウス
- アットホーム
- ホームズ

**対応ページ:**
- SUUMO
  - 一覧ページ（例: https://suumo.jp/jj/bukken/ichiran/...）
  - 詳細ページ（例: https://suumo.jp/ms/chuko/tokyo/sc_...）
- 三井のリハウス
  - 一覧ページ（例: https://www.rehouse.co.jp/buy/mansion/prefecture/13/city/13102/）
  - 詳細ページ（例: https://www.rehouse.co.jp/buy/mansion/bkdetail/F1FAGA2C/）
- アットホーム
  - 一覧ページ（例: https://www.athome.co.jp/mansion/chuko/tokyo/chuo-city/list/）
  - 詳細ページ（例: https://www.athome.co.jp/mansion/1012995991/）
- ホームズ
  - 一覧ページ（例: https://www.homes.co.jp/mansion/chuko/list/）
  - 詳細ページ（例: https://www.homes.co.jp/mansion/b-1193620002052/）

**主な機能:**
- **坪単価・平米単価の自動表示**: 億円表記の価格を正しく計算（例: 2億5990万円 = 25990万円）
- **CSVエクスポート**: 一覧ページからワンクリックで全物件データをCSV出力
- **詳細情報取得**: 各物件の詳細ページから階数、向き、管理費、修繕積立金などを自動取得
- 同じ価格・面積の組み合わせはキャッシュして効率化
- テーブル内はコンパクト表示でレイアウト崩れを防止（SUUMO）
- 無限スクロール対応（MutationObserver）
- サイトを自動判定して適切なセレクタを使用

## プロジェクト構造

```
fudosan-tanka-viewer/
├── manifest.json          # Chrome拡張の設定（Manifest V3）
├── content.js             # メインロジック（DOM監視、計算、表示）
├── styles.css             # 坪単価表示のスタイル
├── icons/                 # 拡張機能アイコン（16px, 48px, 128px）
└── CLAUDE.md             # このファイル
```

## 開発・テスト方法

### Chrome拡張のインストール

1. Chromeで `chrome://extensions/` を開く
2. 右上の「デベロッパーモード」をONにする
3. 「パッケージ化されていない拡張機能を読み込む」をクリック
4. このプロジェクトのルートディレクトリを選択

### デバッグ方法

1. 対象サイトの物件ページを開く
   - SUUMO（例：https://suumo.jp/ms/chuko/tokyo/）
   - 三井のリハウス（例：https://www.rehouse.co.jp/buy/mansion/prefecture/13/city/13102/）
   - アットホーム（例：https://www.athome.co.jp/mansion/chuko/tokyo/chuo-city/list/）
   - ホームズ（例：https://www.homes.co.jp/mansion/chuko/list/）
2. Chrome DevToolsを開く（F12）
3. Consoleタブで `[SUUMO坪単価]`、`[REHOUSE坪単価]`、`[ATHOME坪単価]`、または `[HOMES坪単価]` プレフィックスのログを確認
4. Elementsタブで `.suumo-unit-price` クラスの要素を確認

**デバッグログの見方:**
- `拡張機能が起動しました` - content.jsが正常に読み込まれた
- `物件カード数: X` - 見つかった物件要素の数
- `価格要素発見` / `面積要素発見` - 各要素の検出状況
- `価格テキスト` / `面積テキスト` - 抽出されたテキスト
- `計算結果` - 坪単価・平米単価の計算値
- `単価表示を挿入しました` - DOM挿入成功

### コード変更時

1. ファイルを編集
2. `chrome://extensions/` で拡張機能の「更新」ボタンをクリック
3. 対象サイトのページをリロード（Ctrl+R）
4. Consoleでログを確認

## アーキテクチャ

### content.js の処理フロー

1. **初期化** (`init()`)
   - ページ読み込み時に全物件を処理
   - MutationObserverでDOM変更を監視開始

2. **一覧ページ処理** (`processProperty()`)
   - 物件カード（`.dottable--cassette` など）から価格・面積を検索
   - 価格・面積を数値抽出
   - キャッシュをチェック、なければ計算
   - DOM要素を作成・挿入

3. **詳細ページ処理** (`processAllProperties()`)
   - 物件概要テーブルから価格・面積を取得（確実な方法）
   - 1回だけ計算してキャッシュ
   - ページ上部とテーブル内の複数箇所に表示

4. **DOM監視** (`observeDOMChanges()`)
   - 無限スクロールで新規追加される物件を検知
   - 自分が追加した`.suumo-unit-price`要素は無視（無限ループ防止）
   - 新しいノードが追加されたら自動処理

### 計算式

- **坪単価** = 物件価格（万円） ÷ (専有面積㎡ ÷ 3.3058)
- **平米単価** = 物件価格（万円） ÷ 専有面積㎡
- 結果は整数に四捨五入

### CSVエクスポート機能

**概要:**
一覧ページに表示される「📊 CSVエクスポート」ボタンから、表示中の全物件データをCSV形式でダウンロードできます。

**取得データ:**
- 基本情報: サイト名、物件名、住所、価格、専有面積、坪単価、平米単価、築年数、駅距離、URL
- 詳細情報（詳細ページから取得）: 階数、向き、建物階数、管理費、修繕積立金、総戸数、構造、駐車場、築年月、不動産会社名

**処理フロー:**
1. 一覧ページの全物件を収集
2. 各物件の詳細ページにアクセスして追加情報を取得（2秒間隔、5件ごとに3秒待機）
3. CSV生成（BOM付きUTF-8でExcel対応）
4. ファイル名: `物件一覧_SUUMO_20251004_123456.csv`

**サーバー負荷対策:**
- 各詳細ページへのリクエスト間に2秒の待機時間
- 5件処理ごとに追加で1秒待機（合計3秒間隔）
- 進捗表示: ボタンに「⏳ 詳細取得中 5/30」と表示

**処理時間の目安:**
- 10件: 約20秒
- 30件: 約1分
- 50件: 約1分40秒

### CSSセレクタパターン

各サイトのHTML構造変更に対応するため、複数のセレクタパターンを定義：

#### SUUMO

**一覧ページ - 物件カード:**
- `.dottable--cassette` （新一覧ページ）
- `.cassetteitem` （旧一覧ページ）

**一覧ページ - 価格要素:**
- `.dottable-value` （新一覧ページ）
- `.dkr-cassetteitem_price--num` （旧一覧ページ）
- `.cassette_price--num` （さらに旧パターン）

**一覧ページ - 面積要素:**
- `<dt>専有面積</dt>` の次の `<dd>` 要素
- `.dkr-cassetteitem_detail_text--area` （旧パターン）

**詳細ページ:**
- 物件概要テーブルの `<th>価格</th>` / `<th>専有面積</th>` 行から取得
- ページ上部: `.mt7.b` （価格表示の下に坪単価を挿入）
- テーブル内: コンパクトスタイル（`.suumo-unit-price--compact`）で表示

#### 三井のリハウス

**一覧ページ - 物件カード:**
- `.property-index-card` （物件カードコンテナ）

**一覧ページ - 価格要素:**
- `.price-text` （価格表示要素）

**一覧ページ - 面積要素:**
- `.paragraph-body`（㎡を含むもの）
  - 注意: 複数の`.paragraph-body`があるため、`textContent.includes('㎡')`で絞り込み
  - 住所情報と区別するため

**詳細ページ - 価格要素:**
- `.text-price-regular.price-size` （メインの価格表示）
- `.building-price-info` （フォールバック）

**詳細ページ - 面積要素:**
- `.building-info` （間取り・面積情報、例: `3LDK/135.24㎡(約40.91坪)`）

**詳細ページ - 表示位置:**
- 価格要素の直下に坪単価・平米単価を挿入

#### アットホーム

**一覧ページ - 物件カード:**
- `.card-box-inner__detail` （物件カードコンテナ）

**一覧ページ - 価格要素:**
- `.property-price` （価格表示要素）

**一覧ページ - 面積要素:**
- `.property-detail-table__block` （専有面積ブロック）
  - 注意: 専有面積を含むブロック内の `<span>` 要素から「40.00m²」形式の値を取得
  - `textContent.includes('専有面積')` で専有面積ブロックを絞り込み

**詳細ページ - 価格要素:**
- `.price-main` （価格表示要素、例: `7,620万円`）

**詳細ページ - 面積要素:**
- テーブルの `<th>専有面積</th>` の次の `<td>` 要素（例: `43.92m²（壁芯）`）

**詳細ページ - 表示位置:**
- 価格要素の直下に坪単価・平米単価を挿入

#### ホームズ

**一覧ページ - 物件カード:**
- `.bukkenSpec table` （通常の一覧ページ：td.priceとtd.spaceの両方を持つtable要素）
- `.unitSummary tbody tr` （グルーピング一覧ページ：マンションごとにまとめられた物件リスト）

**一覧ページ - 価格要素:**
- `td.price` （通常の一覧ページ：価格表示要素）
- `.verticalTable` 内の `<th>価格</th>` の次の `<td>` 要素 （グルーピング一覧ページ）

**一覧ページ - 面積要素:**
- `td.space` （通常の一覧ページ：専有面積表示要素）
- `.verticalTable` 内の `<th>専有面積</th>` の次の `<td>` 要素 （グルーピング一覧ページ）

**詳細ページ - 価格要素:**
- `[data-component="price"]` （価格表示要素、例: `16,500万円`）

**詳細ページ - 面積要素:**
- `[data-component="occupiedArea"]` （専有面積表示要素、例: `75.8㎡(壁心)`）

**詳細ページ - 表示位置:**
- 価格要素の直下に坪単価・平米単価を挿入

## HTML構造が変わった場合

### SUUMOのセレクタ更新

`content.js` の `priceSelectors` と `areaSelectors` 配列を更新：

```javascript
const priceSelectors = [
  '.新しいクラス名',  // 追加
  '.dkr-cassetteitem_price--num',
  // ...既存のセレクタ
];
```

### 三井のリハウスのセレクタ更新

同様に、`SITE_TYPE === 'REHOUSE'` の分岐内でセレクタを更新：

```javascript
if (SITE_TYPE === 'REHOUSE') {
  priceSelectors = [
    '.新しいクラス名',  // 追加
    '.price-text',
    // ...既存のセレクタ
  ];
}
```

### アットホームのセレクタ更新

同様に、`SITE_TYPE === 'ATHOME'` の分岐内でセレクタを更新：

```javascript
if (SITE_TYPE === 'ATHOME') {
  priceSelectors = [
    '.新しいクラス名',  // 追加
    '.property-price',
    // ...既存のセレクタ
  ];
}
```

### ホームズのセレクタ更新

同様に、`SITE_TYPE === 'HOMES'` の分岐内でセレクタを更新：

```javascript
if (SITE_TYPE === 'HOMES') {
  priceSelectors = [
    '.新しいクラス名',  // 追加
    'td.price',
    // ...既存のセレクタ
  ];
}
```

## 今後の展開

- 他の不動産サイト対応を追加可能

## トラブルシューティング

### 坪単価が表示されない場合

**ステップ1: ログ確認**
- Consoleで `[SUUMO坪単価]`、`[REHOUSE坪単価]`、`[ATHOME坪単価]`、または `[HOMES坪単価]` ログを確認
- `物件カード数: 0` の場合 → 物件要素のセレクタが間違っている
- `価格要素が見つかりませんでした` の場合 → 価格セレクタを更新

**ステップ2: HTML構造調査**
1. DevTools Elementsタブで物件要素を検査
2. 価格が表示されている要素のクラス名をコピー
3. 面積が表示されている要素のクラス名をコピー
4. `content.js` の `priceSelectors` / `areaSelectors` に追加

**ステップ3: セレクタ更新**
```javascript
const priceSelectors = [
  '.新しく見つけたクラス名',  // 最優先で追加
  '.dkr-cassetteitem_price--num',
  // ...
];
```

### 計算不可と表示される場合

- Consoleで抽出された価格・面積の値を確認
- 価格または面積が正しく抽出できていない場合、`extractNumber()` 関数を修正
- テキスト形式が変わった可能性あり（例: 「3,000万円」→「3000万円」）

### 詳細ページで表示されない場合

- `propertyCards.length === 0` で詳細ページと判定
- SUUMO: 物件概要テーブルから価格・面積を取得しているか確認
- 三井のリハウス: `.text-price-regular.price-size` と `.building-info` から取得しているか確認
- アットホーム: `.price-main` とテーブルの `<th>専有面積</th>` の次の `<td>` から取得しているか確認
- ホームズ: `[data-component="price"]` と `[data-component="occupiedArea"]` から取得しているか確認
- Consoleで `詳細ページとして処理` が出ているか確認
- 価格・面積が正しく取得できているか確認

### 三井のリハウスで面積が正しく取得できない場合

- 複数の`.paragraph-body`要素が存在し、住所情報を取得している可能性
- content.js:172-182 で、㎡を含む要素のみを選択するロジックが動作しているか確認
- Consoleで「面積テキスト」のログを確認し、住所（「徒歩X分」など）ではなく面積情報が取得されているか確認

### アットホームで面積が正しく取得できない場合

- `.property-detail-table__block` ブロック内の専有面積を含む要素を探している
- content.js:183-200 で、専有面積ブロック内の `<span>` 要素から値を取得するロジックが動作しているか確認
- Consoleで「面積テキスト」のログを確認し、「40.00m²」のような値が取得されているか確認
- 価格が「6,280」のような数値のみで「万円」が別要素の場合、正しく処理されているか確認

### ページ読み込みが終わらない場合

- MutationObserverの無限ループの可能性
- `.suumo-unit-price` 要素の追加を検知して再処理していないか確認
- `observeDOMChanges()` で自分が追加した要素を無視しているか確認
