import { describe, it, expect, vi, beforeEach } from "vitest";
import { toLocalPath, buildMediaSystemPrompt, processLocalImages } from "./media.js";

vi.mock("axios");

describe("media", () => {
  describe("buildMediaSystemPrompt", () => {
    it("returns a non-empty string", () => {
      const prompt = buildMediaSystemPrompt();
      expect(typeof prompt).toBe("string");
      expect(prompt.length).toBeGreaterThan(0);
    });

    it("includes image rules", () => {
      const prompt = buildMediaSystemPrompt();
      expect(prompt).toContain("图片");
      expect(prompt).toContain("file:///");
    });

    it("includes video marker format", () => {
      const prompt = buildMediaSystemPrompt();
      expect(prompt).toContain("DINGTALK_VIDEO");
    });

    it("includes audio marker format", () => {
      const prompt = buildMediaSystemPrompt();
      expect(prompt).toContain("DINGTALK_AUDIO");
    });

    it("includes file marker format", () => {
      const prompt = buildMediaSystemPrompt();
      expect(prompt).toContain("DINGTALK_FILE");
    });
  });

  describe("toLocalPath", () => {
    it("strips file:// prefix", () => {
      expect(toLocalPath("file:///tmp/image.jpg")).toBe("/tmp/image.jpg");
    });

    it("strips MEDIA: prefix", () => {
      expect(toLocalPath("MEDIA:/tmp/image.jpg")).toBe("/tmp/image.jpg");
    });

    it("strips attachment:// prefix", () => {
      expect(toLocalPath("attachment:///tmp/image.jpg")).toBe("/tmp/image.jpg");
    });

    it("decodes URL-encoded paths", () => {
      expect(toLocalPath("file:///tmp/my%20image.jpg")).toBe("/tmp/my image.jpg");
    });

    it("returns path as-is if no prefix", () => {
      expect(toLocalPath("/tmp/image.jpg")).toBe("/tmp/image.jpg");
    });

    it("handles Windows-style paths", () => {
      expect(toLocalPath("C:\\Users\\test\\image.jpg")).toBe("C:\\Users\\test\\image.jpg");
    });
  });

  describe("processLocalImages", () => {
    it("returns content unchanged when oapiToken is null", async () => {
      const content = "![alt](file:///tmp/image.jpg)";
      const result = await processLocalImages(content, null);
      expect(result).toBe(content);
    });

    it("returns content unchanged when no local image paths found", async () => {
      const content = "Hello, no images here!";
      const result = await processLocalImages(content, "mock-token");
      expect(result).toBe(content);
    });

    it("returns content unchanged for http images", async () => {
      const content = "![alt](https://example.com/image.jpg)";
      const result = await processLocalImages(content, "mock-token");
      expect(result).toBe(content);
    });
  });
});
