# Third-party licenses / 第三者ライセンス

PDFender includes or redistributes the following third-party software and
assets. These components remain subject to their respective licenses and are
not relicensed under PDFender's MIT License.

PDFenderは、以下の第三者ソフトウェアおよびアセットを同梱または再配布しています。
これらにはPDFender本体のMIT Licenseではなく、それぞれのライセンスが適用されます。

## PDF.js

- Component: `pdfjs-dist`
- Copyright: Mozilla Foundation and PDF.js contributors
- License: Apache License 2.0
- Full text in the deployed application: `pdfjs/licenses/pdfjs-dist-Apache-2.0.txt`

## React

- Components: `react`, `react-dom`, `scheduler`
- Copyright: Meta Platforms, Inc. and affiliates
- License: MIT License
- Full text in the deployed application: `pdfjs/licenses/react-MIT.txt`

## PDF.js auxiliary assets

PDF.js redistributes additional data, fonts, and WebAssembly components under
their own licenses. The corresponding license texts are shipped alongside the
assets at the following paths:

- Adobe CMaps: BSD 3-Clause-style license — `pdfjs/cmaps/LICENSE`
- ICC profiles: CC0 1.0 — `pdfjs/iccs/LICENSE`
- Foxit standard fonts: BSD 3-Clause-style license — `pdfjs/standard_fonts/LICENSE_FOXIT`
- Liberation fonts: SIL Open Font License 1.1 — `pdfjs/standard_fonts/LICENSE_LIBERATION`
- JBIG2 WebAssembly components — `pdfjs/wasm/LICENSE_JBIG2` and `pdfjs/wasm/LICENSE_PDFJS_JBIG2`
- OpenJPEG WebAssembly components — `pdfjs/wasm/LICENSE_OPENJPEG` and `pdfjs/wasm/LICENSE_PDFJS_OPENJPEG`
- qcms WebAssembly components — `pdfjs/wasm/LICENSE_QCMS` and `pdfjs/wasm/LICENSE_PDFJS_QCMS`

The source repository also uses development and testing tools. Their license
information is recorded in each package and in the package lockfile; those
tools are not part of the browser application distributed to users.
