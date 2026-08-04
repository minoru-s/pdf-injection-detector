# PDFender

PDFender is a local-first static web application that inspects PDF drawing operations for visually hidden or obscured text. It is aimed at detecting hidden instructions embedded in lecture PDFs without sending the document to a server.

## Current checks

- Text color close to the rendered background
- Abnormally small text relative to the page median
- Extreme horizontal or transformation-based compression
- Long text outside or at the edge of a page
- Transparent or invisible-rendering-mode text
- Text covered by a later opaque path or image
- AI/prompt-like language as a confidence booster only

OCR is intentionally not part of the first version.

## Local development

```sh
npm install
npm run fixtures
npm run dev
```

The PDF is parsed and rendered inside the browser. No application server receives the file.

## Verification

```sh
npm test
npm run build
npm run preview
```

The generated fixture is `fixtures/visibility-cases.pdf`. It contains a control case plus white-on-white, tiny, compressed, edge-positioned, covered, and low-opacity text cases.

`fixtures/real/optics-final-report-injection.pdf` is an optional, local-only 44-page regression sample. The PDF itself is ignored by Git. Its user-confirmed ground truth is stored beside it in `optics-final-report-injection.ground-truth.json`: only four text injections on page 44 are positive; every other item is negative.

`fixtures/real/reverse-data-silo-occluded-injection.pdf` is a second optional, local-only 44-page regression sample and is also ignored by Git. The same hidden Japanese instruction appears behind later-drawn objects on pages 8 and 40; every other item is negative. Its labels are stored in the adjacent ground-truth JSON.

## GitHub Pages

The Vite base path is relative and the production build includes PDF.js CMaps, standard fonts, WASM, and ICC assets. Pushes to `main` run the test and build steps before deploying the generated static site to GitHub Pages.

## PWA

The production build includes a web app manifest, install icons, an Apple touch icon, and a service worker. The service worker is registered only in production builds and caches same-origin application assets for offline startup. PDF analysis itself remains local to the browser.

## Limits

This is a heuristic inspection tool, not a proof that a PDF is safe or malicious. Image-only text, outlined glyphs, complex blend groups, and unusual interactive PDF features may not be detected.
