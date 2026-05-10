import { describe, it, expect } from "vitest";
import type { ChatMessage } from "../src/shared/types";
import {
  hasImages,
  imageAttachments,
  toAnthropicImageBlocks,
  toGeminiParts,
  toOpenAIContentBlocks,
} from "../src/core/providers/util/multimodal";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVQI12P4//8/AAj+Av7N+0xqAAAAAElFTkSuQmCC";

function userWithImages(): ChatMessage {
  return {
    id: "u1",
    role: "user",
    content: "what is in this image?",
    ts: 1,
    attachments: [
      { kind: "image", mimeType: "image/png", dataBase64: PNG, name: "tiny.png" },
      { kind: "file", path: "/foo.ts" },
      { kind: "image", dataBase64: PNG },
    ],
  };
}

function plainUser(): ChatMessage {
  return { id: "u2", role: "user", content: "hello", ts: 2 };
}

describe("multimodal helpers", () => {
  it("imageAttachments only returns kind=image with non-empty dataBase64", () => {
    const u = userWithImages();
    expect(imageAttachments(u)).toHaveLength(2);
    expect(imageAttachments(plainUser())).toHaveLength(0);
  });

  it("hasImages reflects whether any inline image is present", () => {
    expect(hasImages(userWithImages())).toBe(true);
    expect(hasImages(plainUser())).toBe(false);
  });

  it("toOpenAIContentBlocks emits text first, then image_url data URLs", () => {
    const blocks = toOpenAIContentBlocks(userWithImages());
    expect(blocks[0]).toEqual({ type: "text", text: "what is in this image?" });
    expect(blocks).toHaveLength(3);
    expect(blocks[1]).toEqual({
      type: "image_url",
      image_url: { url: `data:image/png;base64,${PNG}` },
    });
    // Second image had no mimeType; defaults to PNG.
    expect(blocks[2]).toEqual({
      type: "image_url",
      image_url: { url: `data:image/png;base64,${PNG}` },
    });
  });

  it("toOpenAIContentBlocks omits the text block when content is empty", () => {
    const u = userWithImages();
    u.content = "";
    const blocks = toOpenAIContentBlocks(u);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe("image_url");
  });

  it("toAnthropicImageBlocks emits base64 source blocks", () => {
    const blocks = toAnthropicImageBlocks(userWithImages());
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: PNG },
    });
  });

  it("toGeminiParts emits the prompt text first, then inline images", () => {
    const parts = toGeminiParts(userWithImages());
    expect(parts).toHaveLength(3);
    expect(parts[0]).toEqual({ text: "what is in this image?" });
    expect(parts[1]).toEqual({ inlineData: { mimeType: "image/png", data: PNG } });
    expect(parts[2]).toEqual({ inlineData: { mimeType: "image/png", data: PNG } });
  });
});
