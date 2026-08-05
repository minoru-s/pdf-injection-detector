import type {
  Detection,
  DetectionSignal,
  Severity,
  TextCandidate,
} from "./types";

const INSTRUCTION_PATTERNS = [
  /(?:ignore|disregard|forget).{0,40}(?:instruction|prompt|direction)/iu,
  /(?:ignore|disregard|forget).{0,50}(?:requested|required|specified|desired).{0,30}(?:output|response|answer)?\s*(?:format|style)/iu,
  /(?:begin|start).{0,30}(?:response|answer|output).{0,30}(?:with|by)/iu,
  /(?:do not|never).{0,30}(?:mention|reveal|disclose).{0,30}(?:instruction|prompt)/iu,
  /(?:do not|never).{0,30}(?:mention|reveal|disclose).{0,30}(?:note|message|text)/iu,
  /(?:include|insert|output|respond|answer).{0,50}(?:word|phrase|token|exactly|必ず)/iu,
  /(?:chatgpt|llm|language model|generative ai|生成ai|言語モデル)/iu,
  /(?:以前|これまで|上記).{0,20}(?:指示|命令).{0,20}(?:無視|忘れ)/u,
  /(?:回答|出力|返答).{0,30}(?:含め|挿入|記載|追加|書いて)/u,
  /(?:この|本).{0,15}(?:指示|命令).{0,20}(?:秘密|言及しない|開示しない)/u,
  /(?:含め|記載|挿入|追加|使用|用い|論じ|示し).{0,12}(?:ること|てください|なさい|せよ|必須)/u,
];

const VISIBILITY_SIGNAL_KINDS = new Set([
  "low-contrast",
  "tiny-text",
  "compressed-text",
  "edge-or-outside",
  "transparent-text",
  "occluded-text",
]);

// Relative size alone makes readable footers look suspicious on pages dominated
// by large headings. Require a genuinely small effective size as well.
const MAX_TINY_TEXT_SIZE = 8;

function colorDistance(
  declared: string | null,
  rendered: [number, number, number] | null,
): number | null {
  if (!declared || !rendered) return null;
  const match = declared.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/iu);
  if (!match) return null;
  const rgb = match.slice(1).map((value) => Number.parseInt(value, 16));
  return Math.hypot(rgb[0] - rendered[0], rgb[1] - rendered[1], rgb[2] - rendered[2]);
}

export function severityForScore(score: number): Severity {
  if (score >= 60) return "high";
  if (score >= 35) return "caution";
  return "info";
}

export function hasInstructionLanguage(text: string): boolean {
  return INSTRUCTION_PATTERNS.some((pattern) => pattern.test(text));
}

function belongsToSameTextRun(left: TextCandidate, right: TextCandidate): boolean {
  const operationGap = right.operationIndex - left.operationIndex;
  const largerFontSize = Math.max(left.fontSize, right.fontSize);
  const smallerFontSize = Math.min(left.fontSize, right.fontSize);
  return (
    operationGap > 0 &&
    operationGap <= 12 &&
    left.fillColor === right.fillColor &&
    Math.abs(left.fillAlpha - right.fillAlpha) <= 0.1 &&
    left.renderingMode === right.renderingMode &&
    largerFontSize > 0 &&
    smallerFontSize / largerFontSize >= 0.8
  );
}

export function instructionContextForCandidate(
  candidates: TextCandidate[],
  index: number,
): string {
  const run = [candidates[index]];
  for (let cursor = index - 1; cursor >= 0 && run.length < 5; cursor -= 1) {
    if (!belongsToSameTextRun(candidates[cursor], candidates[cursor + 1])) break;
    run.unshift(candidates[cursor]);
  }
  for (let cursor = index + 1; cursor < candidates.length && run.length < 5; cursor += 1) {
    if (!belongsToSameTextRun(candidates[cursor - 1], candidates[cursor])) break;
    run.push(candidates[cursor]);
  }
  return run.map((candidate) => candidate.text.trim()).join(" ").slice(0, 800);
}

export function scoreCandidate(
  candidate: TextCandidate,
  medianFontSize: number,
  pageWidth: number,
  pageHeight: number,
  instructionContext = candidate.text,
): Detection | null {
  const signals: DetectionSignal[] = [];
  const { box } = candidate;
  const textLength = [...candidate.text.trim()].length;
  const instructionLanguage = hasInstructionLanguage(instructionContext);
  const allowUnreliableGeometryEvidence =
    instructionLanguage ||
    (candidate.fontSize <= 3 && candidate.hasRecordedBox);
  const declaredVsRendered = colorDistance(
    candidate.fillColor,
    candidate.surroundingColor,
  );
  const replacedByLaterPaint = candidate.laterOcclusionRatio >= 0.98;

  if (
    declaredVsRendered !== null &&
    declaredVsRendered < 20 &&
    textLength >= 2 &&
    candidate.surroundingConfidence >= 0.55 &&
    candidate.declaredInkRatio !== null &&
    candidate.declaredInkRatio > 0.72 &&
    (candidate.geometryReliable || allowUnreliableGeometryEvidence) &&
    !replacedByLaterPaint
  ) {
    signals.push({
      kind: "low-contrast",
      score: 35,
      label: "背景とほぼ同色",
      detail: `文字色と文字領域の外側で推定した背景色の色差が ${declaredVsRendered.toFixed(1)} です。`,
    });
  }

  if (
    textLength >= 4 &&
    medianFontSize > 0 &&
    candidate.fontSize > 0 &&
    candidate.fontSize < MAX_TINY_TEXT_SIZE &&
    candidate.fontSize < medianFontSize * 0.35
  ) {
    signals.push({
      kind: "tiny-text",
      score: 20,
      label: "極端に小さい文字",
      detail: `本文基準の ${Math.round((candidate.fontSize / medianFontSize) * 100)}% の文字サイズです。`,
    });
  }

  const geometryCompressionRatio =
    candidate.geometryReliable || instructionLanguage
      ? candidate.glyphWidthRatio
      : 1;
  const compressionRatio = Math.min(
    candidate.horizontalScale / 100,
    candidate.transformScaleRatio,
    geometryCompressionRatio,
  );
  if (textLength >= 2 && compressionRatio < 0.35) {
    signals.push({
      kind: "compressed-text",
      score: 25,
      label: "極端な文字圧縮",
      detail: `横方向の倍率が約 ${Math.round(compressionRatio * 100)}% です。`,
    });
  }

  const outside =
    box.x + box.width <= 0 ||
    box.y + box.height <= 0 ||
    box.x >= pageWidth ||
    box.y >= pageHeight;
  const visibleWidth = Math.max(
    0,
    Math.min(pageWidth, box.x + box.width) - Math.max(0, box.x),
  );
  const visibleHeight = Math.max(
    0,
    Math.min(pageHeight, box.y + box.height) - Math.max(0, box.y),
  );
  const boxArea = Math.max(1, box.width * box.height);
  const visibleRatio = (visibleWidth * visibleHeight) / boxArea;
  const mostlyOutside = visibleRatio < 0.5;
  if (textLength >= 8 && (outside || mostlyOutside)) {
    signals.push({
      kind: "edge-or-outside",
      score: outside ? 30 : 25,
      label: outside ? "ページ外の文字" : "大半がページ外の文字",
      detail: outside
        ? "文字領域が表示ページの外側にあります。"
        : `文字領域のうちページ内に見える部分が約 ${Math.round(visibleRatio * 100)}% です。`,
    });
  }

  if (
    (candidate.fillAlpha <= 0.15 || candidate.renderingMode === 3) &&
    instructionLanguage
  ) {
    signals.push({
      kind: "transparent-text",
      score: 35,
      label: "透明または非表示の文字",
      detail:
        candidate.renderingMode === 3
          ? "PDFの文字描画モードが非表示です。"
          : `文字の不透明度が ${Math.round(candidate.fillAlpha * 100)}% です。`,
    });
  }

  const extremeInkCoverage =
    candidate.declaredInkRatio !== null &&
    (candidate.declaredInkRatio <= 0.01 || candidate.declaredInkRatio >= 0.9);
  const extremeVisualOcclusion =
    textLength >= 4 &&
    candidate.laterOcclusionRatio >= 0.98 &&
    candidate.occlusionChangeRatio >= 0.985 &&
    extremeInkCoverage;
  const directiveOcclusion =
    candidate.laterOcclusionRatio >= 0.9 &&
    candidate.occlusionChangeRatio >= 0.2 &&
    instructionLanguage;
  if (extremeVisualOcclusion || directiveOcclusion) {
    signals.push({
      kind: "occluded-text",
      score: candidate.laterOcclusionRatio >= 0.9 ? 40 : 30,
      label: "後続オブジェクトによる被覆",
      detail: `文字領域の約 ${Math.round(candidate.laterOcclusionRatio * 100)}% が後続オブジェクトと重なり、そのオブジェクトを除く再描画との差が約 ${Math.round(candidate.occlusionChangeRatio * 100)}% あります。`,
    });
  }

  const hasVisibilitySignal = signals.some((signal) =>
    VISIBILITY_SIGNAL_KINDS.has(signal.kind),
  );
  if (hasVisibilitySignal && instructionLanguage) {
    signals.push({
      kind: "instruction-language",
      score: 20,
      label: "AIへの指示に似た表現",
      detail: "この項目は単独判定には使わず、視認性異常の確信度だけを補強します。",
    });
  }

  const hasStandaloneVisibilitySignal = signals.some(
    (signal) =>
      VISIBILITY_SIGNAL_KINDS.has(signal.kind) &&
      signal.kind !== "edge-or-outside",
  );
  if (
    !hasStandaloneVisibilitySignal &&
    !(signals.some((signal) => signal.kind === "edge-or-outside") &&
      instructionLanguage)
  ) {
    return null;
  }
  const score = Math.min(100, signals.reduce((sum, signal) => sum + signal.score, 0));
  return {
    id: `p${candidate.pageNumber}-op${candidate.operationIndex}`,
    pageNumber: candidate.pageNumber,
    operationIndex: candidate.operationIndex,
    text: candidate.text.trim(),
    box,
    score,
    severity: severityForScore(score),
    signals,
  };
}
