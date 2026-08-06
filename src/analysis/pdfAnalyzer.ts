import {
  GlobalWorkerOptions,
  OPS,
  getDocument,
} from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  boxExtentAlongDirection,
  boxesHaveReliableAgreement,
} from "./geometry";
import { instructionContextForCandidate, scoreCandidate } from "./scoring";
import type {
  BoundingBox,
  DocumentAnalysis,
  PageAnalysis,
  Severity,
  TextCandidate,
} from "./types";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type Matrix = [number, number, number, number, number, number];

interface BBoxReader {
  length: number;
  isEmpty(index: number): boolean;
  minX(index: number): number;
  minY(index: number): number;
  maxX(index: number): number;
  maxY(index: number): number;
}

interface PDFOperatorList {
  fnArray: number[];
  argsArray: unknown[][];
}

interface GraphicsState {
  ctm: Matrix;
  textMatrix: Matrix;
  textX: number;
  textY: number;
  lineX: number;
  lineY: number;
  leading: number;
  fontSize: number;
  horizontalScale: number;
  fillColor: string | null;
  fillColorKind: "solid" | "pattern" | "unknown";
  fillAlpha: number;
  renderingMode: number;
  textRise: number;
  zeroAreaClip: boolean;
}

interface OptionalContentVisibility {
  isVisible(group: unknown): boolean;
}

interface PaintOperation {
  operationIndex: number;
  box: BoundingBox;
  alpha: number;
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function cloneState(state: GraphicsState): GraphicsState {
  return {
    ...state,
    ctm: [...state.ctm],
    textMatrix: [...state.textMatrix],
  } as GraphicsState;
}

function multiplyMatrices(left: Matrix, right: Matrix): Matrix {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}

function matrixFromArgs(args: unknown[]): Matrix | null {
  const values =
    args.length === 1 && Array.isArray(args[0]) ? (args[0] as unknown[]) : args;
  if (values.length < 6 || values.slice(0, 6).some((value) => typeof value !== "number")) {
    return null;
  }
  return values.slice(0, 6) as Matrix;
}

function transformPoint(matrix: Matrix, x: number, y: number): [number, number] {
  return [
    matrix[0] * x + matrix[2] * y + matrix[4],
    matrix[1] * x + matrix[3] * y + matrix[5],
  ];
}

function transformBox(matrix: Matrix, x: number, y: number, width: number, height: number): BoundingBox {
  const points = [
    transformPoint(matrix, x, y),
    transformPoint(matrix, x + width, y),
    transformPoint(matrix, x, y + height),
    transformPoint(matrix, x + width, y + height),
  ];
  const xs = points.map(([pointX]) => pointX);
  const ys = points.map(([, pointY]) => pointY);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function bboxForOperation(
  reader: BBoxReader | null,
  index: number,
  width: number,
  height: number,
): BoundingBox | null {
  if (!reader || index >= reader.length || reader.isEmpty(index)) return null;
  const x = reader.minX(index) * width;
  const y = reader.minY(index) * height;
  const maxX = reader.maxX(index) * width;
  const maxY = reader.maxY(index) * height;
  if (![x, y, maxX, maxY].every(Number.isFinite)) return null;
  return { x, y, width: Math.max(0, maxX - x), height: Math.max(0, maxY - y) };
}

function normalizeColor(args: unknown[]): string | null {
  const value = args.length === 1 ? args[0] : args;
  if (typeof value === "string") {
    if (/^#[\da-f]{6}$/iu.test(value)) return value.toLowerCase();
    if (/^#[\da-f]{3}$/iu.test(value)) {
      return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`.toLowerCase();
    }
    if (value === "transparent") return "#ffffff";
  }
  const numbers = Array.from(value as ArrayLike<number> | number[]).filter(
    (entry) => typeof entry === "number",
  );
  if (numbers.length >= 3) {
    const scale = numbers.some((entry) => entry > 1) ? 1 : 255;
    const hex = numbers
      .slice(0, 3)
      .map((entry) => Math.max(0, Math.min(255, Math.round(entry * scale))))
      .map((entry) => entry.toString(16).padStart(2, "0"))
      .join("");
    return `#${hex}`;
  }
  if (numbers.length === 1) {
    const scale = numbers[0] > 1 ? 1 : 255;
    const gray = Math.max(0, Math.min(255, Math.round(numbers[0] * scale)))
      .toString(16)
      .padStart(2, "0");
    return `#${gray}${gray}${gray}`;
  }
  return null;
}

function inferSolidPatternColor(args: unknown[]): string | null {
  const pattern = args.find(
    (value) =>
      value !== null &&
      typeof value === "object" &&
      Array.isArray((value as PDFOperatorList).fnArray) &&
      Array.isArray((value as PDFOperatorList).argsArray),
  ) as PDFOperatorList | undefined;
  if (!pattern) return null;

  const colors: string[] = [];
  for (let index = 0; index < pattern.fnArray.length; index += 1) {
    const operator = pattern.fnArray[index];
    if (operator !== OPS.setFillRGBColor && operator !== OPS.setFillGray) continue;
    const color = normalizeColor(pattern.argsArray[index] ?? []);
    if (color) colors.push(color);
  }
  if (colors.length === 0 || colors.some((color) => color !== colors[0])) {
    return null;
  }
  return colors[0];
}

function pathHasZeroArea(args: unknown[]): boolean {
  const bounds = args[2];
  if (!bounds || typeof bounds !== "object") return false;
  const values = Array.from(bounds as ArrayLike<number>);
  if (values.length < 4 || values.slice(0, 4).some((value) => !Number.isFinite(value))) {
    return false;
  }
  return (
    Math.abs(values[2] - values[0]) <= 1e-6 ||
    Math.abs(values[3] - values[1]) <= 1e-6
  );
}

function extractGlyphData(args: unknown[]): { text: string; advance: number } {
  const glyphs = (Array.isArray(args[0]) ? args[0] : args) as unknown[];
  let text = "";
  let advance = 0;
  for (const glyph of glyphs) {
    if (typeof glyph === "number") {
      advance -= glyph / 1000;
      continue;
    }
    if (!glyph || typeof glyph !== "object") continue;
    const data = glyph as { unicode?: string; width?: number; isSpace?: boolean };
    text += data.unicode ?? (data.isSpace ? " " : "");
    advance += (data.width ?? 0) / 1000;
  }
  return { text, advance };
}

function parseHexColor(color: string | null): [number, number, number] | null {
  const match = color?.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/iu);
  if (!match) return null;
  return match.slice(1).map((value) => Number.parseInt(value, 16)) as [
    number,
    number,
    number,
  ];
}

function rgbDistance(
  left: [number, number, number],
  right: [number, number, number],
): number {
  return Math.hypot(
    left[0] - right[0],
    left[1] - right[1],
    left[2] - right[2],
  );
}

function dominantColorFromBuckets(
  buckets: Map<number, number>,
): [number, number, number] | null {
  let dominantKey = -1;
  let dominantCount = -1;
  for (const [key, count] of buckets) {
    if (count > dominantCount) {
      dominantKey = key;
      dominantCount = count;
    }
  }
  if (dominantKey < 0) return null;
  return [
    Math.min(255, Math.round(Math.floor(dominantKey / 256) * 16 + 7.5)),
    Math.min(255, Math.round((Math.floor(dominantKey / 16) % 16) * 16 + 7.5)),
    Math.min(255, Math.round((dominantKey % 16) * 16 + 7.5)),
  ];
}

function samplePixelEvidence(
  context: CanvasRenderingContext2D,
  box: BoundingBox,
  declaredColor: string | null,
): {
  surroundingColor: [number, number, number] | null;
  surroundingConfidence: number;
  declaredInkRatio: number | null;
} {
  const canvas = context.canvas;
  const padding = Math.max(4, Math.min(14, Math.ceil(box.height * 0.75)));
  const sampleX = Math.max(0, Math.floor(box.x) - padding);
  const sampleY = Math.max(0, Math.floor(box.y) - padding);
  const sampleMaxX = Math.min(canvas.width, Math.ceil(box.x + box.width) + padding);
  const sampleMaxY = Math.min(canvas.height, Math.ceil(box.y + box.height) + padding);
  const sampleWidth = sampleMaxX - sampleX;
  const sampleHeight = sampleMaxY - sampleY;
  if (sampleWidth <= 0 || sampleHeight <= 0) {
    return {
      surroundingColor: null,
      surroundingConfidence: 0,
      declaredInkRatio: null,
    };
  }

  try {
    const pixels = context.getImageData(
      sampleX,
      sampleY,
      sampleWidth,
      sampleHeight,
    ).data;
    const buckets = new Map<number, number>();
    const stride = Math.max(
      1,
      Math.floor(Math.sqrt((sampleWidth * sampleHeight) / 3500)),
    );
    const innerLeft = box.x - sampleX;
    const innerTop = box.y - sampleY;
    const innerRight = innerLeft + box.width;
    const innerBottom = innerTop + box.height;
    const declaredRgb = parseHexColor(declaredColor);
    let innerOpaquePixels = 0;
    let declaredInkPixels = 0;

    for (let py = 0; py < sampleHeight; py += stride) {
      for (let px = 0; px < sampleWidth; px += stride) {
        const offset = (py * sampleWidth + px) * 4;
        if (pixels[offset + 3] < 220) continue;
        const rgb: [number, number, number] = [
          pixels[offset],
          pixels[offset + 1],
          pixels[offset + 2],
        ];
        const insideTextBox =
          px >= innerLeft &&
          px <= innerRight &&
          py >= innerTop &&
          py <= innerBottom;
        if (insideTextBox) {
          innerOpaquePixels += 1;
          if (declaredRgb && rgbDistance(rgb, declaredRgb) < 55) {
            declaredInkPixels += 1;
          }
          continue;
        }
        const red = Math.floor(rgb[0] / 16);
        const green = Math.floor(rgb[1] / 16);
        const blue = Math.floor(rgb[2] / 16);
        const key = red * 256 + green * 16 + blue;
        buckets.set(key, (buckets.get(key) ?? 0) + 1);
      }
    }
    const surroundingSamples = [...buckets.values()].reduce(
      (sum, count) => sum + count,
      0,
    );
    const dominantSamples = Math.max(0, ...buckets.values());
    return {
      surroundingColor: dominantColorFromBuckets(buckets),
      surroundingConfidence:
        surroundingSamples > 0 ? dominantSamples / surroundingSamples : 0,
      declaredInkRatio:
        declaredRgb && innerOpaquePixels > 0
          ? declaredInkPixels / innerOpaquePixels
          : null,
    };
  } catch {
    return {
      surroundingColor: null,
      surroundingConfidence: 0,
      declaredInkRatio: null,
    };
  }
}

function overlapEvidence(
  box: BoundingBox,
  laterPaints: PaintOperation[],
): { ratio: number; operationIndices: number[] } {
  if (box.width <= 0 || box.height <= 0) {
    return { ratio: 0, operationIndices: [] };
  }
  const columns = 16;
  const rows = 8;
  let covered = 0;
  const operationIndices = new Set<number>();
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = box.x + ((column + 0.5) / columns) * box.width;
      const y = box.y + ((row + 0.5) / rows) * box.height;
      const coveringPaints = laterPaints.filter(
        (paint) =>
          paint.alpha >= 0.85 &&
          x >= paint.box.x &&
          x <= paint.box.x + paint.box.width &&
          y >= paint.box.y &&
          y <= paint.box.y + paint.box.height,
      );
      if (coveringPaints.length > 0) {
        covered += 1;
        coveringPaints.forEach((paint) => operationIndices.add(paint.operationIndex));
      }
    }
  }
  return {
    ratio: covered / (columns * rows),
    operationIndices: [...operationIndices].sort((left, right) => left - right),
  };
}

function pixelDifferenceRatio(
  original: CanvasRenderingContext2D,
  alternative: CanvasRenderingContext2D,
  box: BoundingBox,
): number {
  const x = Math.max(0, Math.floor(box.x));
  const y = Math.max(0, Math.floor(box.y));
  const width = Math.min(
    original.canvas.width - x,
    Math.max(1, Math.ceil(box.width)),
  );
  const height = Math.min(
    original.canvas.height - y,
    Math.max(1, Math.ceil(box.height)),
  );
  if (width <= 0 || height <= 0) return 0;
  try {
    const originalPixels = original.getImageData(x, y, width, height).data;
    const alternativePixels = alternative.getImageData(x, y, width, height).data;
    const stride = Math.max(1, Math.floor(Math.sqrt((width * height) / 3000)));
    let compared = 0;
    let changed = 0;
    for (let py = 0; py < height; py += stride) {
      for (let px = 0; px < width; px += stride) {
        const offset = (py * width + px) * 4;
        const difference = Math.hypot(
          originalPixels[offset] - alternativePixels[offset],
          originalPixels[offset + 1] - alternativePixels[offset + 1],
          originalPixels[offset + 2] - alternativePixels[offset + 2],
        );
        compared += 1;
        if (difference >= 28) changed += 1;
      }
    }
    return compared > 0 ? changed / compared : 0;
  } catch {
    return 0;
  }
}

function isPathPaintOperation(args: unknown[]): boolean {
  const paintOperator = args[0];
  return [
    OPS.fill,
    OPS.eoFill,
    OPS.fillStroke,
    OPS.eoFillStroke,
    OPS.closeFillStroke,
    OPS.closeEOFillStroke,
  ].includes(paintOperator as number);
}

function isImagePaintOperation(operator: number): boolean {
  return [
    OPS.paintImageXObject,
    OPS.paintInlineImageXObject,
    OPS.paintImageMaskXObject,
    OPS.paintSolidColorImageMask,
    OPS.paintImageXObjectRepeat,
    OPS.paintImageMaskXObjectRepeat,
    OPS.shadingFill,
  ].includes(operator);
}

function applyGState(state: GraphicsState, args: unknown[]) {
  const entries = (Array.isArray(args[0]) ? args[0] : args) as unknown[];
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const [key, value] = entry;
    if (key === "ca" && typeof value === "number") state.fillAlpha = value;
  }
}

function fallbackTextBox(
  state: GraphicsState,
  viewportTransform: Matrix,
  advance: number,
): BoundingBox {
  const textScale: Matrix = [
    state.horizontalScale / 100,
    0,
    0,
    1,
    0,
    0,
  ];
  const matrix = multiplyMatrices(
    viewportTransform,
    multiplyMatrices(state.ctm, multiplyMatrices(state.textMatrix, textScale)),
  );
  return transformBox(
    matrix,
    state.textX,
    state.textY + state.textRise,
    Math.abs(advance * state.fontSize),
    Math.abs(state.fontSize),
  );
}

function parseOperations(
  operatorList: PDFOperatorList,
  bboxes: BBoxReader | null,
  context: CanvasRenderingContext2D,
  viewportTransform: Matrix,
  pageNumber: number,
  optionalContentConfig: OptionalContentVisibility | null,
): TextCandidate[] {
  const width = context.canvas.width;
  const height = context.canvas.height;
  let state: GraphicsState = {
    ctm: [...IDENTITY],
    textMatrix: [...IDENTITY],
    textX: 0,
    textY: 0,
    lineX: 0,
    lineY: 0,
    leading: 0,
    fontSize: 0,
    horizontalScale: 100,
    fillColor: "#000000",
    fillColorKind: "solid",
    fillAlpha: 1,
    renderingMode: 0,
    textRise: 0,
    zeroAreaClip: false,
  };
  const stack: GraphicsState[] = [];
  const markedContentVisibility = [true];
  let pendingClip = false;
  const textDrafts: Array<
    Omit<
      TextCandidate,
      | "surroundingColor"
      | "surroundingConfidence"
      | "declaredInkRatio"
      | "laterOcclusionRatio"
      | "occlusionChangeRatio"
      | "laterOccluderIndices"
      | "hasNearbyReplacementText"
    >
  > = [];
  const paints: PaintOperation[] = [];

  for (let index = 0; index < operatorList.fnArray.length; index += 1) {
    const operator = operatorList.fnArray[index];
    const args = (operatorList.argsArray[index] ?? []) as unknown[];

    if (operator === OPS.save || operator === OPS.paintFormXObjectBegin) {
      stack.push(cloneState(state));
      if (operator === OPS.paintFormXObjectBegin) {
        const matrix = matrixFromArgs(Array.isArray(args[0]) ? (args[0] as unknown[]) : []);
        if (matrix) state.ctm = multiplyMatrices(state.ctm, matrix);
      }
      continue;
    }
    if (operator === OPS.restore || operator === OPS.paintFormXObjectEnd) {
      state = stack.pop() ?? state;
      continue;
    }
    if (operator === OPS.transform) {
      const matrix = matrixFromArgs(args);
      if (matrix) state.ctm = multiplyMatrices(state.ctm, matrix);
      continue;
    }
    if (operator === OPS.beginText) {
      state.textMatrix = [...IDENTITY];
      state.textX = state.textY = state.lineX = state.lineY = 0;
      continue;
    }
    if (operator === OPS.setTextMatrix) {
      const matrix = matrixFromArgs(args);
      if (matrix) state.textMatrix = matrix;
      state.textX = state.textY = state.lineX = state.lineY = 0;
      continue;
    }
    if (operator === OPS.moveText || operator === OPS.setLeadingMoveText) {
      const x = Number(args[0]) || 0;
      const y = Number(args[1]) || 0;
      if (operator === OPS.setLeadingMoveText) state.leading = -y;
      state.lineX += x;
      state.lineY += y;
      state.textX = state.lineX;
      state.textY = state.lineY;
      continue;
    }
    if (operator === OPS.nextLine) {
      state.lineY += state.leading;
      state.textX = state.lineX;
      state.textY = state.lineY;
      continue;
    }
    if (operator === OPS.setLeading) {
      state.leading = Number(args[0]) || 0;
      continue;
    }
    if (operator === OPS.setFont) {
      state.fontSize = Math.abs(Number(args[1]) || 0);
      continue;
    }
    if (operator === OPS.setHScale) {
      state.horizontalScale = Math.abs(Number(args[0]) || 100);
      continue;
    }
    if (operator === OPS.setTextRise) {
      state.textRise = Number(args[0]) || 0;
      continue;
    }
    if (operator === OPS.setTextRenderingMode) {
      state.renderingMode = Number(args[0]) || 0;
      continue;
    }
    if (operator === OPS.setFillRGBColor || operator === OPS.setFillGray) {
      state.fillColor = normalizeColor(args);
      state.fillColorKind = "solid";
      continue;
    }
    if (operator === OPS.setFillColorN) {
      state.fillColor = inferSolidPatternColor(args);
      state.fillColorKind = "pattern";
      continue;
    }
    if (operator === OPS.setFillTransparent) {
      state.fillColor = "#ffffff";
      state.fillColorKind = "solid";
      state.fillAlpha = 0;
      continue;
    }
    if (operator === OPS.setGState) {
      applyGState(state, args);
      continue;
    }

    if (operator === OPS.clip || operator === OPS.eoClip) {
      pendingClip = true;
      continue;
    }
    if (operator === OPS.constructPath && pendingClip) {
      state.zeroAreaClip = state.zeroAreaClip || pathHasZeroArea(args);
      pendingClip = false;
    }

    if (operator === OPS.beginMarkedContent) {
      markedContentVisibility.push(
        markedContentVisibility[markedContentVisibility.length - 1],
      );
      continue;
    }
    if (operator === OPS.beginMarkedContentProps) {
      const parentVisible =
        markedContentVisibility[markedContentVisibility.length - 1];
      const tag = args[0];
      const properties = args[1];
      let ownVisible = true;
      if (tag === "OC" && optionalContentConfig && properties) {
        try {
          ownVisible = optionalContentConfig.isVisible(properties);
        } catch {
          ownVisible = true;
        }
      }
      markedContentVisibility.push(parentVisible && ownVisible);
      continue;
    }
    if (operator === OPS.endMarkedContent) {
      if (markedContentVisibility.length > 1) markedContentVisibility.pop();
      continue;
    }

    if (operator === OPS.showText) {
      const { text, advance } = extractGlyphData(args);
      const effective = multiplyMatrices(state.ctm, state.textMatrix);
      const scaleX = Math.hypot(effective[0], effective[1]) * (state.horizontalScale / 100);
      const scaleY = Math.hypot(effective[2], effective[3]);
      const deviceEffective = multiplyMatrices(viewportTransform, effective);
      const textDirectionX =
        deviceEffective[0] * (state.horizontalScale / 100);
      const textDirectionY =
        deviceEffective[1] * (state.horizontalScale / 100);
      const recordedBox = bboxForOperation(bboxes, index, width, height);
      const calculatedFallbackBox = fallbackTextBox(
        state,
        viewportTransform,
        advance,
      );
      const recordedBoxEmpty =
        recordedBox !== null &&
        (recordedBox.width * recordedBox.height <= 0.5 ||
          recordedBox.width <= 0 ||
          recordedBox.height <= 0);
      const box = recordedBox && !recordedBoxEmpty
        ? recordedBox
        : calculatedFallbackBox;
      const deviceScaleX = Math.hypot(textDirectionX, textDirectionY);
      const naturalWidth = Math.abs(
        advance * state.fontSize * Math.max(0.0001, deviceScaleX),
      );
      const measuredAdvanceExtent = boxExtentAlongDirection(
        box,
        textDirectionX,
        textDirectionY,
      );
      if (text.trim()) {
        textDrafts.push({
          pageNumber,
          operationIndex: index,
          text,
          box,
          hasRecordedBox: recordedBox !== null,
          recordedBoxEmpty,
          hiddenByClipping: state.zeroAreaClip,
          geometryReliable: boxesHaveReliableAgreement(
            recordedBox,
            calculatedFallbackBox,
          ),
          fontSize: state.fontSize * Math.max(0.0001, scaleY),
          horizontalScale: state.horizontalScale,
          transformScaleRatio: scaleY > 0 ? scaleX / scaleY : 0,
          glyphWidthRatio:
            naturalWidth > 0
              ? Math.min(2, measuredAdvanceExtent / naturalWidth)
              : 1,
          fillColor: state.fillColor,
          fillColorKind: state.fillColorKind,
          fillAlpha: state.fillAlpha,
          renderingMode: state.renderingMode,
          hiddenByOptionalContent:
            !markedContentVisibility[markedContentVisibility.length - 1],
        });
      }
      state.textX += advance * state.fontSize * (state.horizontalScale / 100);
      continue;
    }

    const paintBox = bboxForOperation(bboxes, index, width, height);
    if (
      paintBox &&
      ((operator === OPS.constructPath && isPathPaintOperation(args)) ||
        isImagePaintOperation(operator))
    ) {
      paints.push({
        operationIndex: index,
        box: paintBox,
        alpha: state.fillAlpha,
      });
    }
  }

  return textDrafts.map((draft) => {
    const laterPaints = paints.filter(
      (paint) => paint.operationIndex > draft.operationIndex,
    );
    const pixelEvidence = samplePixelEvidence(
      context,
      draft.box,
      draft.fillColor,
    );
    const overlap = overlapEvidence(draft.box, laterPaints);
    return {
      ...draft,
      ...pixelEvidence,
      laterOcclusionRatio: overlap.ratio,
      occlusionChangeRatio: 0,
      laterOccluderIndices: overlap.operationIndices,
      hasNearbyReplacementText: false,
    };
  });
}

function markNearbyReplacementText(candidates: TextCandidate[]) {
  for (const candidate of candidates) {
    if (
      candidate.laterOcclusionRatio < 0.98 ||
      candidate.laterOccluderIndices.length === 0 ||
      candidate.box.height <= 0
    ) {
      continue;
    }
    const lastOccluder = Math.max(...candidate.laterOccluderIndices);
    candidate.hasNearbyReplacementText = candidates.some((other) => {
      const operationGap = other.operationIndex - lastOccluder;
      if (operationGap <= 0 || operationGap > 20) return false;
      if (
        other.hiddenByClipping ||
        other.hiddenByOptionalContent ||
        other.renderingMode === 3 ||
        other.fillAlpha <= 0.5 ||
        other.laterOcclusionRatio >= 0.5
      ) {
        return false;
      }
      const largerFontSize = Math.max(candidate.fontSize, other.fontSize);
      const smallerFontSize = Math.min(candidate.fontSize, other.fontSize);
      if (largerFontSize <= 0 || smallerFontSize / largerFontSize < 0.85) {
        return false;
      }
      const leftAligned =
        Math.abs(candidate.box.x - other.box.x) <=
        Math.max(12, candidate.box.height * 0.75);
      const verticalGap = other.box.y - (candidate.box.y + candidate.box.height);
      const followsSameLineArea =
        verticalGap >= -candidate.box.height * 0.25 &&
        verticalGap <= candidate.box.height * 1.5;
      return leftAligned && followsSameLineArea;
    });
  }
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function pdfAssetUrl(path: string): string {
  const appBaseUrl = new URL(import.meta.env.BASE_URL, document.baseURI);
  return new URL(`pdfjs/${path}/`, appBaseUrl).href;
}

async function analyzePage(
  pdf: Awaited<ReturnType<typeof getDocument>["promise"]>,
  pageNumber: number,
  optionalContentConfig: OptionalContentVisibility | null,
): Promise<PageAnalysis> {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1.5 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvasを初期化できませんでした。");

  const operatorListPromise = page.getOperatorList();
  await page.render({
    canvas,
    canvasContext: context,
    viewport,
    recordOperations: true,
    background: "#ffffff",
  }).promise;
  const operatorList = await operatorListPromise;
  const bboxes = page.recordedBBoxes as BBoxReader | null;
  const candidates = parseOperations(
    operatorList,
    bboxes,
    context,
    viewport.transform as Matrix,
    pageNumber,
    optionalContentConfig,
  );
  markNearbyReplacementText(candidates);
  const occlusionGroups = new Map<string, TextCandidate[]>();
  for (const candidate of candidates) {
    if (
      candidate.laterOcclusionRatio < 0.85 ||
      candidate.laterOccluderIndices.length === 0 ||
      candidate.text.trim().length < 2
    ) {
      continue;
    }
    const key = candidate.laterOccluderIndices.join(",");
    const group = occlusionGroups.get(key) ?? [];
    group.push(candidate);
    occlusionGroups.set(key, group);
  }

  for (const [key, group] of occlusionGroups) {
    const skippedOperations = new Set(
      key.split(",").map((value) => Number.parseInt(value, 10)),
    );
    const alternativeCanvas = document.createElement("canvas");
    alternativeCanvas.width = canvas.width;
    alternativeCanvas.height = canvas.height;
    const alternativeContext = alternativeCanvas.getContext("2d", {
      willReadFrequently: true,
    });
    if (!alternativeContext) continue;
    await page.render({
      canvas: alternativeCanvas,
      canvasContext: alternativeContext,
      viewport,
      background: "#ffffff",
      operationsFilter: (index) => !skippedOperations.has(index),
    }).promise;
    for (const candidate of group) {
      candidate.occlusionChangeRatio = pixelDifferenceRatio(
        context,
        alternativeContext,
        candidate.box,
      );
    }
  }
  if (new URLSearchParams(globalThis.location.search).has("benchmark")) {
    const benchmarkGlobal = globalThis as typeof globalThis & {
      __PDFENDER_BENCHMARK__?: Array<{
        pageNumber: number;
        candidates: TextCandidate[];
      }>;
    };
    benchmarkGlobal.__PDFENDER_BENCHMARK__ ??= [];
    benchmarkGlobal.__PDFENDER_BENCHMARK__.push({ pageNumber, candidates });
  }
  const medianFontSize = median(
    candidates
      .filter((candidate) => candidate.fillAlpha > 0.5 && candidate.renderingMode !== 3)
      .map((candidate) => candidate.fontSize)
      .filter((fontSize) => fontSize > 0),
  );
  const detections = candidates
    .map((candidate, index) =>
      scoreCandidate(
        candidate,
        medianFontSize,
        canvas.width,
        canvas.height,
        instructionContextForCandidate(candidates, index),
      ),
    )
    .filter((detection) => detection !== null)
    .sort((left, right) => right.score - left.score);

  const previewUrl = canvas.toDataURL("image/jpeg", 0.82);
  page.cleanup();
  return {
    pageNumber,
    width: canvas.width,
    height: canvas.height,
    previewUrl,
    detections,
  };
}

export async function analyzePdf(
  file: File,
  onProgress?: (completed: number, total: number) => void,
): Promise<DocumentAnalysis> {
  if (new URLSearchParams(globalThis.location.search).has("benchmark")) {
    const benchmarkGlobal = globalThis as typeof globalThis & {
      __PDFENDER_BENCHMARK__?: unknown[];
    };
    benchmarkGlobal.__PDFENDER_BENCHMARK__ = [];
    document.getElementById("pdfender-benchmark-data")?.remove();
  }
  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = getDocument({
    data,
    cMapUrl: pdfAssetUrl("cmaps"),
    cMapPacked: true,
    standardFontDataUrl: pdfAssetUrl("standard_fonts"),
    wasmUrl: pdfAssetUrl("wasm"),
    iccUrl: pdfAssetUrl("iccs"),
    useSystemFonts: true,
  });
  const pdf = await loadingTask.promise;
  const optionalContentConfig = await pdf.getOptionalContentConfig({
    intent: "display",
  });
  const pages: PageAnalysis[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      pages.push(await analyzePage(pdf, pageNumber, optionalContentConfig));
      onProgress?.(pageNumber, pdf.numPages);
    }
  } finally {
    await loadingTask.destroy();
  }

  const summary: Record<Severity, number> = { info: 0, caution: 0, high: 0 };
  for (const page of pages) {
    for (const detection of page.detections) summary[detection.severity] += 1;
  }
  if (new URLSearchParams(globalThis.location.search).has("benchmark")) {
    const benchmarkGlobal = globalThis as typeof globalThis & {
      __PDFENDER_BENCHMARK__?: unknown[];
    };
    const benchmarkData = document.createElement("script");
    benchmarkData.id = "pdfender-benchmark-data";
    benchmarkData.type = "application/json";
    benchmarkData.textContent = JSON.stringify({
      candidates: benchmarkGlobal.__PDFENDER_BENCHMARK__ ?? [],
      detections: pages.map((page) => ({
        pageNumber: page.pageNumber,
        detections: page.detections,
      })),
    });
    document.body.append(benchmarkData);
  }
  return {
    fileName: file.name,
    pageCount: pages.length,
    analyzedAt: new Date().toISOString(),
    pages,
    summary,
  };
}
