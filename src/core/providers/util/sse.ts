/**
 * Async iterator over Server-Sent Events from a `fetch` response. Yields raw
 * `data:` payload strings (one per event); the `[DONE]` sentinel used by
 * OpenAI-style streams stops the iterator.
 */
export async function* readSseEvents(response: Response): AsyncGenerator<string> {
  if (!response.body) {
    throw new Error("response has no body to stream");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      // Events are separated by a blank line.
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const data = parseEventBlock(block);
        if (data === "[DONE]") return;
        if (data) yield data;
      }
    }
    if (buffer.trim().length > 0) {
      const data = parseEventBlock(buffer);
      if (data && data !== "[DONE]") yield data;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* noop */
    }
  }
}

function parseEventBlock(block: string): string | undefined {
  const dataLines: string[] = [];
  for (const rawLine of block.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  if (dataLines.length === 0) return undefined;
  return dataLines.join("\n");
}

/**
 * Walks a JSON value via a dot-separated path with `[n]` array indexing,
 * returning `undefined` if any segment is missing. Used by the custom-HTTP
 * adapter to extract response content.
 *
 * @example pickPath(obj, "choices[0].message.content")
 */
export function pickPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  const tokens = path.split(/[.[\]]+/).filter(Boolean);
  let cur: unknown = obj;
  for (const tok of tokens) {
    if (cur == null) return undefined;
    const idx = Number(tok);
    if (Number.isFinite(idx) && Array.isArray(cur)) {
      cur = cur[idx];
    } else if (typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[tok];
    } else {
      return undefined;
    }
  }
  return cur;
}
