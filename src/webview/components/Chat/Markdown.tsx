import { useState } from "react";

/**
 * Lightweight markdown renderer for chat messages. Supports:
 *   - fenced code blocks (``` lang) with copy-to-clipboard
 *   - inline code
 *   - bold (**x**), italic (*x*)
 *   - bullet lists (- )
 *   - headers (# / ## / ###)
 *
 * We deliberately avoid pulling in marked/markdown-it to keep the webview
 * bundle small. Full GFM is overkill for our message format.
 */
export function Markdown({ content }: { content: string }) {
  const blocks = splitIntoBlocks(content);
  return (
    <div className="markdown space-y-2">
      {blocks.map((b, i) => {
        if (b.type === "code") {
          return <CodeBlock key={i} language={b.language} code={b.code} />;
        }
        return <InlineBlock key={i} text={b.text} />;
      })}
    </div>
  );
}

interface CodeFence {
  type: "code";
  language?: string;
  code: string;
}
interface TextBlock {
  type: "text";
  text: string;
}
type Block = CodeFence | TextBlock;

function splitIntoBlocks(input: string): Block[] {
  const out: Block[] = [];
  const lines = input.split(/\r?\n/);
  let i = 0;
  let buffer: string[] = [];
  const flushText = () => {
    if (buffer.length === 0) return;
    out.push({ type: "text", text: buffer.join("\n") });
    buffer = [];
  };
  while (i < lines.length) {
    const line = lines[i];
    const fence = /^```\s*([A-Za-z0-9_-]+)?\s*$/.exec(line);
    if (fence) {
      flushText();
      const language = fence[1];
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      out.push({ type: "code", language, code: codeLines.join("\n") });
      i++;
      continue;
    }
    buffer.push(line);
    i++;
  }
  flushText();
  return out;
}

function CodeBlock({ language, code }: { language?: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };
  return (
    <div className="relative rounded-md border border-nexus-border bg-nexus-surface-2 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-nexus-border bg-nexus-surface text-[11px] uppercase tracking-wide text-nexus-muted">
        <span>{language ?? "code"}</span>
        <button
          className="text-nexus-fg/70 hover:text-nexus-fg transition-colors"
          onClick={onCopy}
          aria-label="Copy code"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="p-3 text-xs overflow-auto"><code>{code}</code></pre>
    </div>
  );
}

function InlineBlock({ text }: { text: string }) {
  // Block-level: header, bullet, or paragraph.
  const segments: Array<{ type: "h1" | "h2" | "h3" | "li" | "p"; text: string }> = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const h3 = /^###\s+(.+)$/.exec(line);
    const h2 = /^##\s+(.+)$/.exec(line);
    const h1 = /^#\s+(.+)$/.exec(line);
    const li = /^[-*]\s+(.+)$/.exec(line);
    if (h3) segments.push({ type: "h3", text: h3[1] });
    else if (h2) segments.push({ type: "h2", text: h2[1] });
    else if (h1) segments.push({ type: "h1", text: h1[1] });
    else if (li) segments.push({ type: "li", text: li[1] });
    else segments.push({ type: "p", text: line });
  }
  // Group consecutive li into a single ul.
  const out: JSX.Element[] = [];
  let liBuffer: string[] = [];
  const flushLi = () => {
    if (liBuffer.length === 0) return;
    out.push(
      <ul key={out.length} className="list-disc pl-5 space-y-0.5">
        {liBuffer.map((t, i) => (
          <li key={i}>{renderInline(t)}</li>
        ))}
      </ul>,
    );
    liBuffer = [];
  };
  for (const s of segments) {
    if (s.type === "li") {
      liBuffer.push(s.text);
      continue;
    }
    flushLi();
    if (s.type === "h1") out.push(<h1 key={out.length} className="text-base font-semibold">{renderInline(s.text)}</h1>);
    else if (s.type === "h2") out.push(<h2 key={out.length} className="text-sm font-semibold">{renderInline(s.text)}</h2>);
    else if (s.type === "h3") out.push(<h3 key={out.length} className="text-xs font-semibold uppercase tracking-wide text-nexus-muted">{renderInline(s.text)}</h3>);
    else if (s.text.trim().length === 0) {
      // skip empty line
    } else {
      out.push(<p key={out.length} className="whitespace-pre-wrap leading-relaxed">{renderInline(s.text)}</p>);
    }
  }
  flushLi();
  return <>{out}</>;
}

function renderInline(text: string): React.ReactNode {
  // Tokenise inline code first (highest priority), then bold/italic.
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  const codeRx = /`([^`]+)`/g;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = codeRx.exec(text)) !== null) {
    if (m.index > cursor) {
      parts.push(<span key={key++}>{renderEmphasis(text.slice(cursor, m.index))}</span>);
    }
    parts.push(
      <code key={key++} className="px-1 py-0.5 rounded bg-nexus-surface-2 text-[0.85em] border border-nexus-border">
        {m[1]}
      </code>,
    );
    cursor = m.index + m[0].length;
  }
  if (cursor < text.length) parts.push(<span key={key++}>{renderEmphasis(text.slice(cursor))}</span>);
  return parts;
}

function renderEmphasis(text: string): React.ReactNode {
  const out: React.ReactNode[] = [];
  let key = 0;
  let cursor = 0;
  const rx = /(\*\*([^*]+)\*\*|\*([^*]+)\*)/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text)) !== null) {
    if (m.index > cursor) out.push(text.slice(cursor, m.index));
    if (m[2]) out.push(<strong key={key++}>{m[2]}</strong>);
    else if (m[3]) out.push(<em key={key++}>{m[3]}</em>);
    cursor = m.index + m[0].length;
  }
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}
