export interface TextContentChunk {
  items: unknown[];
  styles: Record<string, unknown>;
  lang: string | null;
}

interface TextContentPage {
  isPureXfa: boolean;
  getTextContent(): Promise<TextContentChunk>;
  streamTextContent(): ReadableStream<TextContentChunk>;
}

/**
 * PDF.js aggregates text chunks with `for await...of`, but WebKit does not
 * currently expose Symbol.asyncIterator on ReadableStream. Consume the stream
 * through its standard reader instead, without modifying browser globals.
 */
export async function readTextContent(
  page: TextContentPage,
): Promise<TextContentChunk> {
  // PDF.js uses a separate XFA-to-text conversion that does not iterate a
  // ReadableStream, so preserve that path for pure XFA documents.
  if (page.isPureXfa) return page.getTextContent();

  const reader = page.streamTextContent().getReader();
  const textContent: TextContentChunk = {
    items: [],
    styles: Object.create(null) as Record<string, unknown>,
    lang: null,
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;

      textContent.lang ??= value.lang;
      Object.assign(textContent.styles, value.styles);
      textContent.items.push(...value.items);
    }
  } finally {
    reader.releaseLock();
  }

  return textContent;
}
