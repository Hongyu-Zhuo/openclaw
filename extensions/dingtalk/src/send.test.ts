import axios from "axios";
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as auth from "./auth.js";
import * as bot from "./bot.js";
import * as media from "./media.js";
import { sendToUser, sendToGroup, sendProactive } from "./send.js";
import type { DingtalkAccountConfig } from "./types.js";

vi.mock("axios");
vi.mock("./auth.js");
vi.mock("./media.js");
vi.mock("./bot.js");

const mockConfig: DingtalkAccountConfig = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
};

describe("send", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth.getAccessToken).mockResolvedValue("mock-access-token");
    vi.mocked(auth.getOapiAccessToken).mockResolvedValue("mock-oapi-token");
    vi.mocked(media.processLocalImages).mockImplementation(async (content) => content);
    vi.mocked(media.processVideoMarkers).mockImplementation(async (content) => content);
    vi.mocked(media.processAudioMarkers).mockImplementation(async (content) => content);
    vi.mocked(media.processFileMarkers).mockImplementation(async (content) => content);
  });

  describe("sendToUser", () => {
    it("sends AI card to single user by default", async () => {
      vi.mocked(bot.createAICardForTarget).mockResolvedValue({
        cardInstanceId: "card-123",
        accessToken: "mock-token",
        inputingStarted: false,
      });
      vi.mocked(bot.finishAICard).mockResolvedValue();

      const result = await sendToUser(mockConfig, "user-1", "Hello");
      expect(result.ok).toBe(true);
      expect(result.usedAICard).toBe(true);
      expect(bot.createAICardForTarget).toHaveBeenCalledWith(
        mockConfig,
        { type: "user", userId: "user-1" },
        undefined,
      );
    });

    it("falls back to normal send when AI card fails", async () => {
      vi.mocked(bot.createAICardForTarget).mockResolvedValue(null);
      vi.mocked(axios.post).mockResolvedValue({
        data: { processQueryKey: "query-key-123" },
      });

      const result = await sendToUser(mockConfig, "user-1", "Hello");
      expect(result.ok).toBe(true);
      expect(result.usedAICard).toBe(false);
      expect(result.processQueryKey).toBe("query-key-123");
    });

    it("does not fallback when fallbackToNormal is false", async () => {
      vi.mocked(bot.createAICardForTarget).mockResolvedValue(null);

      const result = await sendToUser(mockConfig, "user-1", "Hello", { fallbackToNormal: false });
      expect(result.ok).toBe(false);
      expect(result.usedAICard).toBe(false);
    });

    it("skips AI card for multiple users", async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: { processQueryKey: "batch-key" },
      });

      const result = await sendToUser(mockConfig, ["user-1", "user-2"], "Hello");
      expect(bot.createAICardForTarget).not.toHaveBeenCalled();
      expect(result.ok).toBe(true);
    });

    it("skips AI card when useAICard is false", async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: { processQueryKey: "normal-key" },
      });

      const result = await sendToUser(mockConfig, "user-1", "Hello", { useAICard: false });
      expect(bot.createAICardForTarget).not.toHaveBeenCalled();
      expect(result.ok).toBe(true);
    });
  });

  describe("sendToGroup", () => {
    it("sends AI card to group by default", async () => {
      vi.mocked(bot.createAICardForTarget).mockResolvedValue({
        cardInstanceId: "card-456",
        accessToken: "mock-token",
        inputingStarted: false,
      });
      vi.mocked(bot.finishAICard).mockResolvedValue();

      const result = await sendToGroup(mockConfig, "conv-id-1", "Hello Group");
      expect(result.ok).toBe(true);
      expect(result.usedAICard).toBe(true);
      expect(bot.createAICardForTarget).toHaveBeenCalledWith(
        mockConfig,
        { type: "group", openConversationId: "conv-id-1" },
        undefined,
      );
    });

    it("falls back to normal send when AI card creation fails", async () => {
      vi.mocked(bot.createAICardForTarget).mockResolvedValue(null);
      vi.mocked(axios.post).mockResolvedValue({
        data: { processQueryKey: "group-query-key" },
      });

      const result = await sendToGroup(mockConfig, "conv-id-1", "Hello Group");
      expect(result.ok).toBe(true);
      expect(result.usedAICard).toBe(false);
    });
  });

  describe("sendProactive", () => {
    it("routes to user when userId is provided", async () => {
      vi.mocked(bot.createAICardForTarget).mockResolvedValue({
        cardInstanceId: "card-789",
        accessToken: "mock-token",
        inputingStarted: false,
      });
      vi.mocked(bot.finishAICard).mockResolvedValue();

      const result = await sendProactive(mockConfig, { userId: "user-1" }, "Proactive message");
      expect(result.ok).toBe(true);
    });

    it("routes to group when openConversationId is provided", async () => {
      vi.mocked(bot.createAICardForTarget).mockResolvedValue({
        cardInstanceId: "card-abc",
        accessToken: "mock-token",
        inputingStarted: false,
      });
      vi.mocked(bot.finishAICard).mockResolvedValue();

      const result = await sendProactive(
        mockConfig,
        { openConversationId: "conv-123" },
        "Group notification",
      );
      expect(result.ok).toBe(true);
    });

    it("returns error when no target is specified", async () => {
      const result = await sendProactive(mockConfig, {}, "No target");
      expect(result.ok).toBe(false);
      expect(result.error).toContain("Must specify");
    });

    it("auto-detects markdown content", async () => {
      vi.mocked(bot.createAICardForTarget).mockResolvedValue({
        cardInstanceId: "card-md",
        accessToken: "mock-token",
        inputingStarted: false,
      });
      vi.mocked(bot.finishAICard).mockResolvedValue();

      const result = await sendProactive(
        mockConfig,
        { userId: "user-1" },
        "# Title\n\nSome **bold** text",
      );
      expect(result.ok).toBe(true);
    });
  });
});
