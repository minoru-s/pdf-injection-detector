import type { BoundingBox } from "./types";

export function boxesHaveReliableAgreement(
  recorded: BoundingBox | null,
  calculated: BoundingBox,
): boolean {
  if (!recorded) return false;
  const recordedArea = recorded.width * recorded.height;
  const calculatedArea = calculated.width * calculated.height;
  if (recordedArea <= 0 || calculatedArea <= 0) return false;

  const intersectionWidth = Math.max(
    0,
    Math.min(recorded.x + recorded.width, calculated.x + calculated.width) -
      Math.max(recorded.x, calculated.x),
  );
  const intersectionHeight = Math.max(
    0,
    Math.min(recorded.y + recorded.height, calculated.y + calculated.height) -
      Math.max(recorded.y, calculated.y),
  );
  const intersectionArea = intersectionWidth * intersectionHeight;
  const smallerCoverage =
    intersectionArea / Math.min(recordedArea, calculatedArea);
  const widthAgreement =
    Math.min(recorded.width, calculated.width) /
    Math.max(recorded.width, calculated.width);
  const heightAgreement =
    Math.min(recorded.height, calculated.height) /
    Math.max(recorded.height, calculated.height);

  return (
    smallerCoverage >= 0.5 &&
    widthAgreement >= 0.5 &&
    heightAgreement >= 0.5
  );
}

export function boxExtentAlongDirection(
  box: BoundingBox,
  directionX: number,
  directionY: number,
): number {
  const length = Math.hypot(directionX, directionY);
  if (!Number.isFinite(length) || length <= 0) return box.width;
  const unitX = directionX / length;
  const unitY = directionY / length;
  const projected =
    Math.abs(unitX) * box.width + Math.abs(unitY) * box.height;

  // Some PowerPoint PDFs expose a horizontal text matrix even though the
  // recorded glyph box is rotated. A strongly portrait box is a safer signal
  // of the actual advance axis in that case.
  if (box.height >= box.width * 2.5 && projected < box.height * 0.5) {
    return box.height;
  }
  return projected;
}
