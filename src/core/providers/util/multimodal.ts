import type { AttachmentRef, ChatMessage } from "../../../shared/types";

/**
 * Returns the image attachments on a chat message that have inline byte data
 * (i.e. are servable to a vision-capable model). Other attachment kinds
 * (selection ranges, file paths, URLs without inline bytes) are filtered out
 * here — the prompt builder is responsible for surfacing those as text.
 */
export function imageAttachments(m: ChatMessage): AttachmentRef[] {
  return (m.attachments ?? []).filter(
    (a) => a.kind === "image" && typeof a.dataBase64 === "string" && a.dataBase64.length > 0,
  );
}

export function hasImages(m: ChatMessage): boolean {
  return imageAttachments(m).length > 0;
}

/** Defaults a missing mime type to PNG (the most common paste format). */
export function imageMime(att: AttachmentRef): string {
  return att.mimeType && att.mimeType.length > 0 ? att.mimeType : "image/png";
}

/**
 * OpenAI Chat Completions multimodal user-content blocks. When a user message
 * has image attachments, callers should swap `content: string` for an array
 * mixing `{ type: "text", text }` and `{ type: "image_url", image_url: { url } }`.
 */
export type OpenAIContentBlock =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export function toOpenAIContentBlocks(m: ChatMessage): OpenAIContentBlock[] {
  const blocks: OpenAIContentBlock[] = [];
  if (m.content && m.content.length > 0) {
    blocks.push({ type: "text", text: m.content });
  }
  for (const att of imageAttachments(m)) {
    blocks.push({
      type: "image_url",
      image_url: { url: `data:${imageMime(att)};base64,${att.dataBase64}` },
    });
  }
  return blocks;
}

/**
 * Anthropic Messages content blocks. Image blocks use base64 sources
 * (https://docs.anthropic.com/en/api/messages-examples#vision).
 */
export type AnthropicImageBlock = {
  type: "image";
  source: { type: "base64"; media_type: string; data: string };
};

export function toAnthropicImageBlocks(m: ChatMessage): AnthropicImageBlock[] {
  return imageAttachments(m).map((att) => ({
    type: "image",
    source: {
      type: "base64",
      media_type: imageMime(att),
      data: att.dataBase64!,
    },
  }));
}

/**
 * Google Gemini `parts` entries. Inline images use `inlineData.mimeType` +
 * base64 `inlineData.data`.
 */
export type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

export function toGeminiParts(m: ChatMessage): GeminiPart[] {
  const parts: GeminiPart[] = [];
  if (m.content && m.content.length > 0) parts.push({ text: m.content });
  for (const att of imageAttachments(m)) {
    parts.push({ inlineData: { mimeType: imageMime(att), data: att.dataBase64! } });
  }
  return parts;
}
