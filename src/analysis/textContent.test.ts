import { describe, expect, it, vi } from "vitest";
import { readTextContent } from "./textContent";

interface TestTextContent {
  items: unknown[];
  styles: Record<string, unknown>;
  lang: string | null;
}

describe("readTextContent", () => {
  it("merges streamed chunks without requiring ReadableStream async iteration", async () => {
    const getTextContent = vi.fn();
    const stream = new ReadableStream<TestTextContent>({
      start(controller) {
        controller.enqueue({
          items: [{ str: "first" }],
          styles: { fontA: { family: "A" } },
          lang: "ja",
        });
        controller.enqueue({
          items: [{ str: "second" }],
          styles: { fontB: { family: "B" } },
          lang: null,
        });
        controller.close();
      },
    });
    const streamTextContent = vi.fn().mockReturnValue(stream);

    const result = await readTextContent({
      isPureXfa: false,
      getTextContent,
      streamTextContent,
    });

    expect(getTextContent).not.toHaveBeenCalled();
    expect(streamTextContent).toHaveBeenCalledWith({
      disableNormalization: true,
    });
    expect(result).toEqual({
      items: [{ str: "first" }, { str: "second" }],
      styles: {
        fontA: { family: "A" },
        fontB: { family: "B" },
      },
      lang: "ja",
    });
  });

  it("preserves PDF.js text conversion for pure XFA pages", async () => {
    const expected: TestTextContent = {
      items: [{ str: "xfa" }],
      styles: {},
      lang: null,
    };
    const getTextContent = vi.fn().mockResolvedValue(expected);

    const result = await readTextContent({
      isPureXfa: true,
      getTextContent,
      streamTextContent: vi.fn(),
    });

    expect(result).toBe(expected);
    expect(getTextContent).toHaveBeenCalledWith({ disableNormalization: true });
  });
});
