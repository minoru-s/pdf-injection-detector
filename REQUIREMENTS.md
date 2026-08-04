# PDFender requirements

## Goal

Detect algorithmically suspicious text placement in PDFs, especially hidden instructions intended to reveal whether a student submitted lecture material to an AI system.

## Privacy and deployment

- All PDF parsing, rendering, and analysis runs in the browser.
- The PDF must not be uploaded to a server.
- The production build must work as a static site on GitHub Pages.
- OCR and external AI APIs are outside the initial scope.

## Detection signals

1. Text whose declared color is very close to the dominant rendered color in its region.
2. Text whose effective font size is abnormally small relative to the page median.
3. Text with extreme horizontal scaling or transformation-based compression.
4. Long text placed outside the page or unusually close to its edge.
5. Transparent text or PDF invisible text-rendering mode.
6. Text substantially covered by a later opaque path or image according to PDF drawing order.
7. AI/prompt-like instruction language, used only as a confidence booster when at least one visibility anomaly exists.

## Result model

- Information: score below 35.
- Caution: score 35–59.
- High risk: score 60 or above.
- Every result must show the exact signals and scores that produced it.
- A result is evidence for human review, not a claim of malicious intent.
- A clean result is not a guarantee that the PDF is safe.

## Deferred until the engine is verified

- Final information architecture and visual design.
- OCR for image-only instructions.
- Detection of text converted to vector outlines.
- Advanced transparency groups and unusual blend-mode simulation.
