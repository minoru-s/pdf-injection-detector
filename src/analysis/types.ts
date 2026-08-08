export type Severity = "info" | "caution" | "high";

export type SignalKind =
  | "low-contrast"
  | "tiny-text"
  | "compressed-text"
  | "edge-or-outside"
  | "transparent-text"
  | "clipped-text"
  | "hidden-layer"
  | "occluded-text"
  | "unicode-tags"
  | "zero-width-encoding"
  | "bidi-control"
  | "metadata-instruction"
  | "instruction-language";

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectionSignal {
  kind: SignalKind;
  score: number;
  label: string;
  detail: string;
}

export interface Detection {
  id: string;
  pageNumber: number;
  operationIndex: number;
  text: string;
  box: BoundingBox;
  score: number;
  severity: Severity;
  signals: DetectionSignal[];
}

export interface PageAnalysis {
  pageNumber: number;
  width: number;
  height: number;
  previewUrl: string;
  detections: Detection[];
}

export interface DocumentDetection {
  id: string;
  source: string;
  text: string;
  score: number;
  severity: Severity;
  signals: DetectionSignal[];
}

export interface DocumentAnalysis {
  fileName: string;
  pageCount: number;
  analyzedAt: string;
  pages: PageAnalysis[];
  documentDetections: DocumentDetection[];
  summary: Record<Severity, number>;
}

export interface TextCandidate {
  pageNumber: number;
  operationIndex: number;
  text: string;
  box: BoundingBox;
  hasRecordedBox: boolean;
  recordedBoxEmpty: boolean;
  hiddenByClipping: boolean;
  geometryReliable: boolean;
  fontSize: number;
  horizontalScale: number;
  transformScaleRatio: number;
  glyphWidthRatio: number;
  fillColor: string | null;
  fillColorKind: "solid" | "pattern" | "unknown";
  fillAlpha: number;
  renderingMode: number;
  hiddenByOptionalContent: boolean;
  surroundingColor: [number, number, number] | null;
  surroundingConfidence: number;
  declaredInkRatio: number | null;
  hasExactVisibleTextMatch: boolean;
  laterOcclusionRatio: number;
  occlusionChangeRatio: number;
  laterOccluderIndices: number[];
  hasNearbyReplacementText: boolean;
}
