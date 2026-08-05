import type { BoundingBox } from "./types";

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
