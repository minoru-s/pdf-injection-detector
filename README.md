# PDFender

[日本語](#日本語) | [English](#english)

## 日本語

PDFenderは、PDFの描画情報を解析し、見えにくく配置された文字や他のオブジェクトに隠された文字などの所謂「間接プロンプトインジェクション」を検出する、ローカルファーストの静的Webアプリです。秘密裏に講義資料などに埋め込まれた、生成AI向けの隠し指示を人が確認するための手掛かりを提示することを目的としています。

**Webアプリ:** [https://minoru-s.github.io/pdf-injection-detector/](https://minoru-s.github.io/pdf-injection-detector/)

### 主な機能

- 背景とほぼ同色の文字を検出
- ページ内の中央値と比べて極端に小さい文字を検出
- 横方向または変換行列によって強く圧縮された文字を検出
- ページ外や端に不自然に配置された文字を検出
- 透明または非表示の描画モードで配置された文字を検出
- 後から描画された図形・画像に覆われた文字を検出
- Unicode Tagsの連続、異常に高密度なゼロ幅文字列、不自然なBidi制御を検出
- Unicode Tagsと一般的なゼロ幅ビット列を復号し、難読化解除後の指示表現で確信度を補強
- PDFのDocumentInfo・XMPにある不可視Unicodeや指示表現を、ページ上の検出とは分けて表示
- AIへの指示に似た表現を、視認性異常がある場合の確信度補強として利用
- 検出ページ間の巡回、疑義箇所への自動スクロール、判定根拠とスコアの表示

通常のページ本文では、AI向け表現だけで単独判定は行いません。Unicode Tagsの連続や異常なゼロ幅文字列は、それ自体が人間には見えない文字データであるため、内容に依存せず確認候補になります。metadata内の指示表現は、AIサービスが読み込む保証がないため低確信度の文書情報として分離します。

PDFenderが主に検査するのは、PDF内部にテキストデータとして存在し、一般的なPDFのテキスト抽出ではAIの入力に含まれ得る一方、描画上は人間に見えにくく配置された文字です。この「抽出される内容と人間の見え方の差」をPDFの文字情報・描画命令・描画順序から直接調べるため、画像から文字を推定するOCRは採用していません。画像化された文字やアウトライン化された文字は、通常の表示では人間にも見える可能性が高いうえ、一般的なPDFテキスト抽出には含まれません。そのため、PDFenderが対象とする「人間には見えにくいのに、テキスト抽出を通じてAIには渡り得る」隠しプロンプトインジェクションとしては機能しにくく、検査対象外としています。

### プライバシー

PDFの読み込み、描画、文字情報の解析、検出結果の生成はブラウザ内で完結します。PDF本文、抽出文字、検出結果はお使いの端末から外部へ一切送信されません。

利用状況の把握のためGoogle Analyticsを使用しており、ページの閲覧情報やブラウザ・端末に関する情報などは匿名化された形でGoogleへ送信されることがあります。

### ローカルでの実行

```sh
npm install
npm run fixtures
npm run dev
```

### テストとビルド

```sh
npm test
npm run build
npm run preview
```

`fixtures/visibility-cases.pdf`は、正常例と、白文字、微小文字、圧縮文字、ページ端、被覆、低透明度の検出例を含む生成テストPDFです。`fixtures/unicode-cases.pdf`は、Unicode Tags、文字間ゼロ幅、ゼロ幅ビット列、Bidi override、metadataの検出例と、孤立したゼロ幅スペース・正規の絵文字タグ列の非検出対照を含みます。

`fixtures/real/`には、任意のローカル回帰テスト用PDFを配置できます。ユーザー提供のPDF本体はGitの追跡対象外です。現在使用している6件の回帰サンプルについては、正解ラベルのみをJSONで管理しています。

### GitHub PagesとPWA

`main`へのpush時に、GitHub Actionsがテストとビルドを実行し、GitHub Pagesへ公開します。本番ビルドには、日本語CIDフォントの表示に必要なPDF.jsのCMap、標準フォント、WASM、ICCアセットが含まれます。

Web App Manifest、各種アイコン、Service Workerを備えており、PWAとしてインストールできます。Service Workerは本番ビルドでのみ登録され、同一オリジンのアプリ資産をキャッシュします。

### ライセンス

PDFender独自のソースコードは[MIT License](LICENSE)で公開しています。PDF.js、React、同梱フォント、CMap、WASMなどの第三者ソフトウェアおよびアセットには、それぞれのライセンスが適用されます。詳細は[第三者ライセンス一覧](THIRD_PARTY_NOTICES.md)を参照してください。

### 制約と免責

検出結果は機械的な手掛かりであり、PDFの安全性やプロンプトインジェクションの有無を保証するものではありません。誤検知や見逃しが発生する可能性があります。

画像化された文字、アウトライン化された文字、複雑な透明グループ、特殊な描画モードやインタラクティブ機能などは検出できない場合があります。重要な用途では元のPDFと検出箇所を必ず確認してください。

---

## English

PDFender is a local-first static web application that inspects PDF drawing operations for visually hidden or obscured text. It provides human-review clues for detecting hidden AI-directed instructions embedded in lecture materials and other PDFs.

**Web app:** [https://minoru-s.github.io/pdf-injection-detector/](https://minoru-s.github.io/pdf-injection-detector/)

### Features

- Detects text whose color is very close to its background
- Detects abnormally small text relative to the page median
- Detects extreme horizontal or transformation-based compression
- Detects text placed outside or unusually close to a page edge
- Detects transparent text and invisible text-rendering modes
- Detects text covered by later-drawn paths or images
- Detects Unicode Tags runs, abnormally dense zero-width sequences, and suspicious bidirectional controls
- Decodes Unicode Tags and common zero-width binary encodings, then uses deobfuscated instruction language as supporting evidence
- Reports invisible Unicode and instruction-like text in DocumentInfo or XMP separately from page findings
- Uses AI/prompt-like language only as a confidence booster when a visibility anomaly is present
- Provides detection-page navigation, automatic scrolling to findings, and signal-by-signal scores

Prompt-like wording in ordinary page text never produces a finding by itself. Unicode Tags runs and abnormal zero-width sequences are findings because the character data itself is invisible. Instruction-like metadata is reported separately at low confidence because an AI service may not ingest it.

PDFender primarily examines text stored as PDF text data that ordinary extraction may pass into an AI context even though the document's drawing operations make it difficult for a person to notice. It directly compares extracted text with PDF text objects, drawing operations, and paint order, so it does not use OCR to infer text from images. Rasterized text and outlined glyphs are likely to remain visible to a person in a normal view, while ordinary PDF text extraction does not expose them. They are therefore unlikely to function as the kind of hidden prompt injection PDFender targets—content that a person may miss but text extraction may pass to an AI—and are outside the inspection scope.

### Privacy

PDF loading, rendering, text analysis, and result generation are performed entirely in the browser. PDF contents, extracted text, and detection results never leave your device.

Google Analytics is used to understand site usage. Page-view information and browser or device information may be sent to Google in anonymized form.

### Local development

```sh
npm install
npm run fixtures
npm run dev
```

### Verification and build

```sh
npm test
npm run build
npm run preview
```

`fixtures/visibility-cases.pdf` is a generated test PDF containing a control case and examples of white-on-white, tiny, compressed, edge-positioned, covered, and low-opacity text. `fixtures/unicode-cases.pdf` covers Unicode Tags, interspersed zero-width characters, zero-width binary encoding, a bidi override, metadata, and negative controls for an isolated zero-width space and a valid emoji tag sequence.

Optional local regression PDFs can be placed in `fixtures/real/`. User-provided PDFs are ignored by Git. Only ground-truth JSON labels for the six current regression samples are tracked.

### GitHub Pages and PWA

Pushes to `main` run the tests and production build through GitHub Actions before deploying to GitHub Pages. The production build includes the PDF.js CMaps, standard fonts, WASM, and ICC assets required for Japanese CID-font rendering.

The app includes a Web App Manifest, install icons, and a Service Worker, so it can be installed as a PWA. The Service Worker is registered only in production and caches same-origin application assets.

### License

PDFender's original source code is released under the [MIT License](LICENSE). Third-party software and assets—including PDF.js, React, bundled fonts, CMaps, and WebAssembly components—remain subject to their respective licenses. See [Third-party licenses](THIRD_PARTY_NOTICES.md) for details.

### Limitations and disclaimer

Findings are heuristic clues, not proof that a PDF is safe or contains prompt injection. False positives and false negatives are possible.

Image-only text, outlined glyphs, complex transparency groups, unusual rendering modes, and interactive PDF features may not be detected. Always review the original PDF and highlighted locations for important use cases.
