import { hasInstructionLanguage } from "./scoring";
import type { BoundingBox, TextCandidate } from "./types";
import { containsInvisibleUnicode } from "./unicode";

export interface PreviewImage {
  box: BoundingBox;
}

export interface InternalPreviewLink {
  box: BoundingBox;
  destinationPageNumber: number;
  destinationText: string;
}

export interface PreviewDuplicateGroup {
  destinationPageNumber: number;
  operationIndexes: number[];
}

export function destinationRequiresPreviewFallback(
  candidates: TextCandidate[],
  hasDetection: boolean,
): boolean {
  return (
    hasDetection ||
    candidates.some(
      (candidate) =>
        candidate.fillAlpha <= 0.15 ||
        candidate.renderingMode === 3 ||
        candidate.hiddenByClipping ||
        candidate.hiddenByOptionalContent ||
        containsInvisibleUnicode(candidate.text),
    )
  );
}

function area(box: BoundingBox): number {
  return Math.max(0, box.width) * Math.max(0, box.height);
}

function intersectionArea(left: BoundingBox, right: BoundingBox): number {
  const width = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) -
      Math.max(left.x, right.x),
  );
  const height = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) -
      Math.max(left.y, right.y),
  );
  return width * height;
}

function coverage(inner: BoundingBox, outer: BoundingBox): number {
  const innerArea = area(inner);
  return innerArea > 0 ? intersectionArea(inner, outer) / innerArea : 0;
}

function expandedPreviewBox(box: BoundingBox): BoundingBox {
  const tolerance = Math.max(3, Math.min(box.width, box.height) * 0.035);
  return {
    x: box.x - tolerance,
    y: box.y - tolerance,
    width: box.width + tolerance * 2,
    height: box.height + tolerance * 2,
  };
}

function normalizedText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .toLowerCase();
}

function hasMatchingPreviewImage(
  link: InternalPreviewLink,
  images: PreviewImage[],
): boolean {
  return images.some(
    (image) =>
      coverage(link.box, image.box) >= 0.82 &&
      coverage(image.box, link.box) >= 0.82,
  );
}

function isOnlyPowerPointAuxiliaryVisibility(candidate: TextCandidate): boolean {
  return (
    candidate.fillAlpha <= 0.01 &&
    candidate.renderingMode !== 3 &&
    !candidate.hiddenByClipping &&
    !candidate.hiddenByOptionalContent &&
    !containsInvisibleUnicode(candidate.text)
  );
}

/**
 * Identifies transparent text copied from an internally linked slide preview.
 *
 * This deliberately requires a redundant structural proof: a matching raster
 * preview, an internal destination, a multi-operation zero-alpha text group,
 * and an exact normalized substring on the destination page. Any instruction
 * wording or independent hiding primitive disables the suppression.
 */
export function powerPointPreviewDuplicateGroups(
  candidates: TextCandidate[],
  images: PreviewImage[],
  links: InternalPreviewLink[],
): PreviewDuplicateGroup[] {
  const groups: PreviewDuplicateGroup[] = [];

  for (const link of links) {
    if (!hasMatchingPreviewImage(link, images)) continue;
    const candidateRegion = expandedPreviewBox(link.box);

    const group = candidates
      .filter(
        (candidate) =>
          coverage(candidate.box, candidateRegion) >= 0.97 &&
          isOnlyPowerPointAuxiliaryVisibility(candidate),
      )
      .sort((left, right) => left.operationIndex - right.operationIndex);

    // A single short label (or a tiny arbitrary payload) is not enough proof.
    if (group.length < 2) continue;

    const groupText = group.map((candidate) => candidate.text.trim()).join(" ");
    if (hasInstructionLanguage(groupText)) continue;

    const normalizedGroup = normalizedText(groupText);
    const normalizedDestination = normalizedText(link.destinationText);
    if (normalizedGroup.length < 16) continue;
    if (!normalizedDestination.includes(normalizedGroup)) continue;

    groups.push({
      destinationPageNumber: link.destinationPageNumber,
      operationIndexes: group.map((candidate) => candidate.operationIndex),
    });
  }

  return groups;
}

export function powerPointPreviewDuplicateOperations(
  candidates: TextCandidate[],
  images: PreviewImage[],
  links: InternalPreviewLink[],
): Set<number> {
  const duplicates = new Set<number>();
  for (const group of powerPointPreviewDuplicateGroups(candidates, images, links)) {
    for (const operationIndex of group.operationIndexes) {
      duplicates.add(operationIndex);
    }
  }
  return duplicates;
}
