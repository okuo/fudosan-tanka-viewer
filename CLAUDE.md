# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

SUUMO向けChrome拡張機能。物件の価格と専有面積から坪単価・平米単価を自動計算して表示する。

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

1. SUUMOの物件ページを開く
2. Chrome DevToolsを開く（F12）
3. Consoleタブでログを確認
4. Elementsタブで `.suumo-unit-price` クラスの要素を確認

### コード変更時

1. ファイルを編集
2. `chrome://extensions/` で拡張機能の「更新」ボタンをクリック
3. SUUMOページをリロード（Ctrl+R）

## アーキテクチャ

### content.js の処理フロー

1. **初期化** (`init()`)
   - ページ読み込み時に全物件を処理
   - MutationObserverでDOM変更を監視開始

2. **物件処理** (`processProperty()`)
   - 価格要素を検索（複数のCSSセレクタパターン）
   - 面積要素を検索
   - 価格・面積を数値抽出
   - 坪単価・平米単価を計算
   - DOM要素を作成・挿入

3. **DOM監視** (`observeDOMChanges()`)
   - 無限スクロールで新規追加される物件を検知
   - 新しいノードが追加されたら自動処理

### 計算式

- **坪単価** = 物件価格（万円） ÷ (専有面積㎡ ÷ 3.3058)
- **平米単価** = 物件価格（万円） ÷ 専有面積㎡
- 結果は整数に四捨五入

### CSSセレクタパターン

SUUMOのHTML構造変更に対応するため、複数のセレクタパターンを定義：

**価格要素:**
- `.dkr-cassetteitem_price--num` （一覧ページ）
- `.cassette_price--num` （旧パターン）
- `.property_view_note-emphasis` （詳細ページ）
- `[class*="price"]` （汎用フォールバック）

**面積要素:**
- `.dkr-cassetteitem_detail_text--area` （一覧ページ）
- `.cassette_detail_text--area` （旧パターン）
- `[class*="area"]` （汎用フォールバック）

## SUUMOのHTML構造が変わった場合

`content.js` の `priceSelectors` と `areaSelectors` 配列を更新：

```javascript
const priceSelectors = [
  '.新しいクラス名',  // 追加
  '.dkr-cassetteitem_price--num',
  // ...既存のセレクタ
];
```

## 今後の展開

- アットホーム対応：新しいcontent scriptを追加
- ホームズ対応：同上
- manifest.jsonの `content_scripts` に新しいマッチパターンを追加

## トラブルシューティング

### 坪単価が表示されない場合

1. DevToolsのConsoleでエラーを確認
2. Elementsタブで価格・面積要素のクラス名を確認
3. セレクタパターンを追加・更新

### 計算不可と表示される場合

- 価格または面積が正しく抽出できていない
- `extractNumber()` 関数のデバッグが必要
