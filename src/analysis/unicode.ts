import type { DetectionSignal } from "./types";

const TAG_START = 0xe0000;
const TAG_END = 0xe007f;
const TAG_ASCII_START = 0xe0020;
const TAG_ASCII_END = 0xe007e;
const CANCEL_TAG = 0xe007f;
const BLACK_FLAG = 0x1f3f4;

const ZERO_WIDTH_STEGO = new Set([0x200b, 0x200c, 0x200d]);
const ZERO_WIDTH_OBFUSCATORS = new Set([
  0x00ad,
  0x180e,
  ...ZERO_WIDTH_STEGO,
  0x2060,
  0xfeff,
]);
const STRIPPED_FORMAT_CONTROLS = new Set([
  0x00ad,
  0x061c,
  0x180e,
  0x200b,
  0x200c,
  0x200d,
  0x200e,
  0x200f,
  0x202a,
  0x202b,
  0x202c,
  0x202d,
  0x202e,
  0x2060,
  0x2061,
  0x2062,
  0x2063,
  0x2064,
  0x2066,
  0x2067,
  0x2068,
  0x2069,
  0xfeff,
]);

const BIDI_OPENERS = new Set([0x202a, 0x202b, 0x202d, 0x202e]);
const BIDI_OVERRIDES = new Set([0x202d, 0x202e]);
const BIDI_ISOLATES = new Set([0x2066, 0x2067, 0x2068]);
const BIDI_CONTROLS = new Set([
  ...BIDI_OPENERS,
  0x202c,
  ...BIDI_ISOLATES,
  0x2069,
  0x200e,
  0x200f,
  0x061c,
]);

interface TagRun {
  start: number;
  end: number;
  count: number;
  decoded: string;
  legitimateEmojiSequence: boolean;
}

export interface InvisibleUnicodeInspection {
  signals: DetectionSignal[];
  semanticText: string;
  displayText: string;
  tagDecodedText: string | null;
  zeroWidthDecodedText: string | null;
}

function codePoint(character: string): number {
  return character.codePointAt(0) ?? 0;
}

export function containsInvisibleUnicode(value: string): boolean {
  return [...value].some((character) => {
    const point = codePoint(character);
    return (
      (point >= TAG_START && point <= TAG_END) ||
      ZERO_WIDTH_OBFUSCATORS.has(point) ||
      BIDI_CONTROLS.has(point)
    );
  });
}

function findTagRuns(value: string): TagRun[] {
  const characters = [...value];
  const runs: TagRun[] = [];
  let index = 0;

  while (index < characters.length) {
    const point = codePoint(characters[index]);
    if (point < TAG_START || point > TAG_END) {
      index += 1;
      continue;
    }

    const start = index;
    let decoded = "";
    let count = 0;
    while (index < characters.length) {
      const current = codePoint(characters[index]);
      if (current < TAG_START || current > TAG_END) break;
      if (current >= TAG_ASCII_START && current <= TAG_ASCII_END) {
        decoded += String.fromCodePoint(current - TAG_START);
        count += 1;
      }
      index += 1;
    }

    const previous = start > 0 ? codePoint(characters[start - 1]) : null;
    const last = index > start ? codePoint(characters[index - 1]) : null;
    runs.push({
      start,
      end: index,
      count,
      decoded,
      legitimateEmojiSequence: previous === BLACK_FLAG && last === CANCEL_TAG,
    });
  }

  return runs;
}

function replaceSuspiciousTagRuns(value: string, runs: TagRun[]): string {
  if (runs.length === 0) return value;
  const characters = [...value];
  let result = "";
  let cursor = 0;
  for (const run of runs) {
    result += characters.slice(cursor, run.start).join("");
    if (run.legitimateEmojiSequence) {
      result += characters.slice(run.start, run.end).join("");
    } else {
      result += run.decoded;
    }
    cursor = run.end;
  }
  return result + characters.slice(cursor).join("");
}

function printableRatio(value: string): number {
  if (!value) return 0;
  const printable = [...value].filter(
    (character) => /[\x20-\x7e\n\r\t]/u.test(character),
  ).length;
  return printable / [...value].length;
}

function decodeBits(bits: string): string | null {
  if (bits.length < 16 || bits.length % 8 !== 0) return null;
  const bytes = bits.match(/.{8}/gu)?.map((byte) => Number.parseInt(byte, 2));
  if (!bytes) return null;
  const decoded = String.fromCharCode(...bytes);
  return printableRatio(decoded) >= 0.85 ? decoded : null;
}

function decodeZeroWidthBinary(value: string): string | null {
  const points = [...value]
    .map(codePoint)
    .filter((point) => ZERO_WIDTH_STEGO.has(point));
  const symbols = [...new Set(points)];
  if (points.length < 16 || symbols.length < 2 || symbols.length > 3) return null;

  const candidates: string[] = [];
  const separators: Array<number | null> =
    symbols.length === 3 ? [...symbols, null] : [null];
  for (const separator of separators) {
    const bitSymbols = symbols.filter((symbol) => symbol !== separator);
    if (bitSymbols.length !== 2) continue;
    const filtered = points.filter((point) => point !== separator);
    for (const reversed of [false, true]) {
      const zero = bitSymbols[reversed ? 1 : 0];
      const bits = filtered.map((point) => (point === zero ? "0" : "1")).join("");
      const decoded = decodeBits(bits);
      if (decoded) candidates.push(decoded);
    }
  }

  return candidates.sort((left, right) => {
    const leftLetters = (left.match(/[A-Za-z\u3040-\u30ff\u3400-\u9fff]/gu) ?? []).length;
    const rightLetters = (right.match(/[A-Za-z\u3040-\u30ff\u3400-\u9fff]/gu) ?? []).length;
    return rightLetters - leftLetters;
  })[0] ?? null;
}

function stripFormatControls(value: string): string {
  return [...value]
    .filter((character) => {
      const point = codePoint(character);
      return !STRIPPED_FORMAT_CONTROLS.has(point) &&
        !(point >= TAG_START && point <= TAG_END);
    })
    .join("");
}

function bidiIsSuspicious(value: string): {
  suspicious: boolean;
  count: number;
  unbalanced: boolean;
  overrides: number;
} {
  let embeddingDepth = 0;
  let isolateDepth = 0;
  let count = 0;
  let overrides = 0;
  let unbalanced = false;

  for (const character of value) {
    const point = codePoint(character);
    if (!BIDI_CONTROLS.has(point)) continue;
    count += 1;
    if (BIDI_OVERRIDES.has(point)) overrides += 1;
    if (BIDI_OPENERS.has(point)) embeddingDepth += 1;
    if (point === 0x202c) {
      if (embeddingDepth === 0) unbalanced = true;
      else embeddingDepth -= 1;
    }
    if (BIDI_ISOLATES.has(point)) isolateDepth += 1;
    if (point === 0x2069) {
      if (isolateDepth === 0) unbalanced = true;
      else isolateDepth -= 1;
    }
  }

  unbalanced ||= embeddingDepth !== 0 || isolateDepth !== 0;
  return {
    suspicious: overrides > 0 || unbalanced || count >= 6,
    count,
    unbalanced,
    overrides,
  };
}

export function inspectInvisibleUnicode(
  value: string,
): InvisibleUnicodeInspection {
  const signals: DetectionSignal[] = [];
  const tagRuns = findTagRuns(value);
  const suspiciousTagRuns = tagRuns.filter(
    (run) => !run.legitimateEmojiSequence && run.count >= 2,
  );
  const tagDecodedText = suspiciousTagRuns
    .map((run) => run.decoded)
    .filter(Boolean)
    .join(" ") || null;

  if (suspiciousTagRuns.length > 0) {
    const count = suspiciousTagRuns.reduce((sum, run) => sum + run.count, 0);
    const preview = tagDecodedText?.slice(0, 80);
    signals.push({
      kind: "unicode-tags",
      score: 50,
      label: "不可視のUnicode Tags",
      detail: `通常は表示されないUnicode Tagsが${count}文字連続しています${preview ? `。復号結果:「${preview}」` : ""}。`,
    });
  }

  const characters = [...value];
  const zeroWidthCount = characters.filter((character) =>
    ZERO_WIDTH_OBFUSCATORS.has(codePoint(character)),
  ).length;
  let longestZeroWidthRun = 0;
  let currentZeroWidthRun = 0;
  for (const character of characters) {
    if (ZERO_WIDTH_OBFUSCATORS.has(codePoint(character))) {
      currentZeroWidthRun += 1;
      longestZeroWidthRun = Math.max(longestZeroWidthRun, currentZeroWidthRun);
    } else {
      currentZeroWidthRun = 0;
    }
  }
  const zeroWidthDensity = zeroWidthCount / Math.max(1, characters.length);
  const zeroWidthDecodedText = decodeZeroWidthBinary(value);
  if (
    zeroWidthDecodedText ||
    longestZeroWidthRun >= 8 ||
    (zeroWidthCount >= 4 && zeroWidthDensity >= 0.2)
  ) {
    signals.push({
      kind: "zero-width-encoding",
      score: 40,
      label: "異常なゼロ幅文字列",
      detail: zeroWidthDecodedText
        ? `ゼロ幅文字${zeroWidthCount}文字から「${zeroWidthDecodedText.slice(0, 80)}」を復号しました。`
        : `表示幅を持たない文字が${zeroWidthCount}文字含まれ、文字列の${Math.round(zeroWidthDensity * 100)}%を占めています。`,
    });
  }

  const bidi = bidiIsSuspicious(value);
  if (bidi.suspicious) {
    const reasons = [
      bidi.overrides > 0 ? `表示順を強制する制御${bidi.overrides}個` : "",
      bidi.unbalanced ? "対応していない開始・終了制御" : "",
      bidi.count >= 6 ? `方向制御${bidi.count}個` : "",
    ].filter(Boolean);
    signals.push({
      kind: "bidi-control",
      score: 35,
      label: "不自然な文字方向制御",
      detail: `${reasons.join("、")}が含まれ、表示順と抽出順が異なる可能性があります。`,
    });
  }

  const tagsReplaced = replaceSuspiciousTagRuns(value, tagRuns);
  let semanticText = stripFormatControls(tagsReplaced).normalize("NFKC");
  if (
    zeroWidthDecodedText &&
    !semanticText.toLowerCase().includes(zeroWidthDecodedText.toLowerCase())
  ) {
    semanticText = `${semanticText} ${zeroWidthDecodedText}`.trim();
  }
  const displayText = semanticText.trim() ||
    tagDecodedText ||
    zeroWidthDecodedText ||
    `（不可視Unicode ${characters.length}文字）`;

  return {
    signals,
    semanticText,
    displayText,
    tagDecodedText,
    zeroWidthDecodedText,
  };
}
