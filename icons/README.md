# アイコン画像について

この拡張機能には以下のサイズのアイコンが必要です：

- `icon16.png` (16x16ピクセル)
- `icon48.png` (48x48ピクセル)
- `icon128.png` (128x128ピクセル)

## アイコン作成方法

### オプション1: オンラインツールを使用
- [Favicon Generator](https://favicon.io/) などのツールで作成

### オプション2: 画像編集ソフトを使用
- Photoshop、GIMP、Canvaなどで作成
- デザイン案：
  - 背景：グラデーション（紫系）
  - 要素：「坪」の文字、または家のアイコン
  - シンプルで認識しやすいデザイン

### オプション3: SVGから変換
以下のSVGコードを使用してPNGに変換できます：

```svg
<svg width="128" height="128" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#667eea;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#764ba2;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="20" fill="url(#grad)"/>
  <text x="64" y="85" font-family="Arial, sans-serif" font-size="60" font-weight="bold" fill="white" text-anchor="middle">坪</text>
</svg>
```

## 一時的な対処法

テスト用に、任意の128x128ピクセルの画像を3つのサイズにリサイズして配置してください。
