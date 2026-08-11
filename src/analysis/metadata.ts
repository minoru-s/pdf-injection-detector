import {
  hasInstructionLanguage,
  severityForScore,
} from "./scoring";
import type {
  DocumentDetection,
  DetectionSignal,
} from "./types";
import { inspectInvisibleUnicode } from "./unicode";

interface PdfMetadataResult {
  info?: Record<string, unknown> | null;
  metadata?: Iterable<[string, unknown]> | null;
}

const POWERPOINT_SIGNATURE = /(?:microsoft.{0,12}powerpoint|powerpoint.{0,12}microsoft)/iu;

export function metadataIdentifiesMicrosoftPowerPoint(
  metadata: PdfMetadataResult,
): boolean {
  for (const [source, value] of Object.entries(metadata.info ?? {})) {
    if (!/(?:creator|producer)/iu.test(source) || typeof value !== "string") {
      continue;
    }
    if (POWERPOINT_SIGNATURE.test(value)) return true;
  }
  if (metadata.metadata) {
    for (const [source, value] of metadata.metadata) {
      if (
        !/(?:creator.?tool|producer)/iu.test(source) ||
        typeof value !== "string"
      ) {
        continue;
      }
      if (POWERPOINT_SIGNATURE.test(value)) return true;
    }
  }
  return false;
}

function readableSource(source: string): string {
  const names: Record<string, string> = {
    Title: "タイトル",
    Author: "作成者",
    Subject: "件名",
    Keywords: "キーワード",
    Creator: "作成アプリ",
    Producer: "PDF生成ソフト",
  };
  return names[source] ?? source;
}

function metadataValues(metadata: PdfMetadataResult): Array<{
  source: string;
  value: string;
}> {
  const values: Array<{ source: string; value: string }> = [];
  const seen = new Set<string>();
  const add = (source: string, raw: unknown) => {
    if (typeof raw !== "string" && typeof raw !== "number") return;
    const value = String(raw).slice(0, 20_000);
    if (!value || seen.has(`${source}\u0000${value}`)) return;
    seen.add(`${source}\u0000${value}`);
    values.push({ source: readableSource(source), value });
  };

  for (const [source, value] of Object.entries(metadata.info ?? {})) {
    add(source, value);
  }
  if (metadata.metadata) {
    for (const [source, value] of metadata.metadata) {
      add(`XMP: ${source}`, value);
    }
  }
  return values;
}

export function analyzeDocumentMetadata(
  metadata: PdfMetadataResult,
): DocumentDetection[] {
  const detections: DocumentDetection[] = [];

  for (const [index, entry] of metadataValues(metadata).entries()) {
    const inspection = inspectInvisibleUnicode(entry.value);
    const signals: DetectionSignal[] = [...inspection.signals];
    if (hasInstructionLanguage(inspection.semanticText)) {
      signals.push({
        kind: "metadata-instruction",
        score: 25,
        label: "文書情報内の指示表現",
        detail:
          "通常のページには表示されないPDFの文書情報に、AIへの指示に似た表現があります。AIサービスがこの情報を利用するかは実装によって異なります。",
      });
    }
    if (signals.length === 0) continue;

    const score = Math.min(
      100,
      signals.reduce((sum, signal) => sum + signal.score, 0),
    );
    detections.push({
      id: `metadata-${index}`,
      source: entry.source,
      text: inspection.displayText.slice(0, 800),
      score,
      severity: severityForScore(score),
      signals,
    });
  }

  return detections;
}
