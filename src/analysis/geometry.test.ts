import { describe, expect, it } from "vitest";
import { boxExtentAlongDirection, boxesHaveReliableAgreement } from "./geometry";

describe("boxesHaveReliableAgreement", () => {
  it("accepts slightly different boxes around the same text", () => {
    expect(
      boxesHaveReliableAgreement(
        { x: 73, y: 242, width: 590, height: 25 },
        { x: 72, y: 237, width: 586, height: 18 },
      ),
    ).toBe(true);
  });

  it("rejects boxes associated with different page regions", () => {
    expect(
      boxesHaveReliableAgreement(
        { x: 290, y: 80, width: 4, height: 29 },
        { x: 3, y: 366, width: 156, height: 14 },
      ),
    ).toBe(false);
  });

  it("rejects a missing recorded box", () => {
    expect(
      boxesHaveReliableAgreement(null, {
        x: 0,
        y: 393,
        width: 52,
        height: 15,
      }),
    ).toBe(false);
  });
});

describe("boxExtentAlongDirection", () => {
  const box = { x: 10, y: 20, width: 100, height: 40 };

  it("uses width for horizontal text", () => {
    expect(boxExtentAlongDirection(box, 1, 0)).toBe(100);
  });

  it("uses height for vertical text", () => {
    expect(boxExtentAlongDirection(box, 0, 1)).toBe(40);
  });

  it("projects a rotated bounding box onto the text direction", () => {
    expect(boxExtentAlongDirection(box, 1, 1)).toBeCloseTo(98.995, 3);
  });

  it("uses a strongly portrait glyph box when PDF rotation metadata is missing", () => {
    expect(
      boxExtentAlongDirection({ x: 0, y: 0, width: 40, height: 100 }, 1, 0),
    ).toBe(100);
  });

  it("does not reinterpret an ordinary short horizontal box as vertical", () => {
    expect(
      boxExtentAlongDirection({ x: 0, y: 0, width: 40, height: 20 }, 1, 0),
    ).toBe(40);
  });
});
