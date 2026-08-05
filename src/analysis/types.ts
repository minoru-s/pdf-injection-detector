export type Severity = "info" | "caution" | "high";

export type SignalKind =
  | "low-contrast"
  | "tiny-text"
  | "compressed-text"
  | "edge-or-outside"
  | "transparent-text"
  | "occluded-text"
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

export interface DocumentAnalysis {
  fileName: string;
  pageCount: number;
  analyzedAt: string;
  pages: PageAnalysis[];
  summary: Record<Severity, number>;
}

export interface TextCandidate {
  pageNumber: number;
  operationIndex: number;
  text: string;
  box: BoundingBox;
  hasRecordedBox: boolean;
  geometryReliable: boolean;
  fontSize: number;
  horizontalScale: number;
  transformScaleRatio: number;
  glyphWidthRatio: number;
  fillColor: string | null;
  fillAlpha: number;
  renderingMode: number;
  surroundingColor: [number, number, number] | null;
  surroundingConfidence: number;
  declaredInkRatio: number | null;
  laterOcclusionRatio: number;
  occlusionChangeRatio: number;
  laterOccluderIndices: number[];
}
