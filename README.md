# Stealth Split Browser

Microsoft Edge 用の拡張機能。**1つのタブを左右に分割して2つのサイトを同時表示**できる、職場や公共空間で目立たずにブラウジングするための補助ツールです。

- 分割画面の片側だけを瞬時に隠す/復元するショートカット
- 全タブをモノクロ化する瞬間切替ショートカット
- ペインごとの **モノクロ表示** / **画像非表示** トグル
- **広告ブロック** (declarativeNetRequest 約95ルール + コスメティック CSS フィルター)
- ブックマークバー（クリックでアクティブなペインに読み込み）
- iframe 制限 (X-Frame-Options / CSP) の自動解除

## インストール手順

1. 本リポジトリを ZIP でダウンロード、または `git clone`
2. Edge で `edge://extensions/` を開く
3. 左下の **「開発者モード」** を ON
4. **「展開して読み込み」** をクリックし、`stealth-split-browser` フォルダを選択
5. 拡張機能アイコンをツールバーにピン留め

## ショートカット

| キー | 動作 |
|---|---|
| `Alt+X` | 分割画面を開く（現タブを置換）|
| `Alt+C` | 左ペインを隠す / 復元 |
| `Alt+V` | 右ペインを隠す / 復元 |
| `Alt+M` | **モノクロ表示トグル（全タブ対象）** |

> いずれも `edge://extensions/shortcuts` から自由に変更可能。入力欄にフォーカスがあっても発動します（ネイティブ `chrome.commands` API）。

## 機能詳細

### 1. 分割画面
- 拡張機能アイコン or `Alt+X` で現タブが分割画面に
- 各ペインは独自の URL バー / 戻る・進む / 再読込 を持つ
- 中央のディバイダをドラッグして比率変更可能
- ペインをクリックするとそちらがアクティブ化（上端に青ライン）

### 2. ブックマーク
- options ページからタイトル + URL を登録
- 分割画面上部のブックマークバーに並ぶ
- クリックするとアクティブなペインに読み込み

### 3. モノクロ表示
- **per-pane（M ボタン）** : 個別ペインの iframe のみを灰色化
- **グローバル（Alt+M）** : 全タブ + 拡張機能ページを灰色化

### 4. 画像非表示
- 各ペインの **I ボタン** で切替
- 効果は分割画面タブ内のみ（他タブには影響しません）

### 5. 広告ブロック
- declarativeNetRequest による URL 遮断（Doubleclick / AdSense / Criteo / Taboola / Outbrain / Yahoo Japan ads / 国内ad-stir, geniee, fluct 等、約95ルール）
- コスメティック CSS フィルターによる要素レベル非表示（`.adsbygoogle` / `[id^="div-gpt-ad"]` / IAB標準サイズ iframe 等）
- options ページで ON/OFF 切替

### 6. iframe 制限解除
- 分割画面で多くのサイトを表示するため、`X-Frame-Options` および `Content-Security-Policy` レスポンスヘッダを除去
- options ページで ON/OFF 切替

## ファイル構成

```
stealth-split-browser/
├── manifest.json
├── background.js          // service worker, commands ハンドラ
├── content.js / .css      // 全ページ向けの最小スクリプト
├── splitter.html/.css/.js // 分割画面本体
├── popup.html/.css/.js    // ツールバーアイコンのポップアップ
├── options.html/.css/.js  // 設定ページ
├── rules/
│   ├── frame_unblock.json // CSP / X-Frame-Options 除去ルール
│   └── adblock.json       // 広告ブロックルール (~95件)
├── LICENSE
└── README.md
```

## 注意事項

- **`Alt+C` / `Alt+M` 等のキーが効かない場合**: 他の拡張機能や IME と競合している可能性があります。`edge://extensions/shortcuts` から別キーへリバインドしてください
- **コスメティック広告フィルターの誤検知**: 攻撃的な CSS セレクタを使っているため、稀に広告以外の要素 (sponsor 表記など) が消えることがあります。気になる場合は options で広告ブロックを OFF にしてください
- **iframe 制限解除を有効にすると、X-Frame-Options を除去するため、一部のクリックジャッキング対策が無効化されます**。プライベートな環境のみで利用してください
- 一部のサイト (Google 検索 / YouTube など) は JavaScript による frame busting を行うため、ヘッダ除去後も iframe 内に表示できない場合があります

## ライセンス

MIT License — 詳細は [LICENSE](./LICENSE) を参照
