import axios from "axios";
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as auth from "./auth.js";
import { handleDingTalkMessage, createAICardForTarget, extractMessageContent } from "./bot.js";
import { setDingTalkRuntime } from "./runtime.js";

vi.mock("axios");

function createMockRuntime() {
  const mockDispatcher = vi.fn();
  const mockReplyOptions = {};
  const mockMarkDispatchIdle = vi.fn();

  return {
    version: "test",
    config: {
      loadConfig: vi.fn(),
      writeConfigFile: vi.fn(),
    },
    system: {
      enqueueSystemEvent: vi.fn(),
      runCommandWithTimeout: vi.fn(),
      formatNativeDependencyHint: vi.fn(),
    },
    media: {
      loadWebMedia: vi.fn(),
      detectMime: vi.fn(),
      mediaKindFromMime: vi.fn(),
      isVoiceCompatibleAudio: vi.fn(),
      getImageMetadata: vi.fn(),
      resizeToJpeg: vi.fn(),
    },
    tts: { textToSpeechTelephony: vi.fn() },
    tools: {
      createMemoryGetTool: vi.fn(),
      createMemorySearchTool: vi.fn(),
      registerMemoryCli: vi.fn(),
    },
    channel: {
      text: {
        chunkByNewline: vi.fn(),
        chunkMarkdownText: vi.fn(),
        chunkMarkdownTextWithMode: vi.fn(),
        chunkText: vi.fn(),
        chunkTextWithMode: vi.fn((text: string) => [text]),
        resolveChunkMode: vi.fn().mockReturnValue("default"),
        resolveTextChunkLimit: vi.fn().mockReturnValue(4000),
        hasControlCommand: vi.fn(),
        resolveMarkdownTableMode: vi.fn(),
        convertMarkdownTables: vi.fn(),
      },
      reply: {
        dispatchReplyWithBufferedBlockDispatcher: vi.fn(),
        createReplyDispatcherWithTyping: vi.fn().mockReturnValue({
          dispatcher: mockDispatcher,
          replyOptions: mockReplyOptions,
          markDispatchIdle: mockMarkDispatchIdle,
        }),
        resolveEffectiveMessagesConfig: vi.fn(),
        resolveHumanDelayConfig: vi.fn().mockReturnValue({}),
        dispatchReplyFromConfig: vi.fn().mockResolvedValue({
          queuedFinal: false,
          counts: { final: 1 },
        }),
        finalizeInboundContext: vi.fn().mockImplementation((ctx: Record<string, unknown>) => ctx),
        formatAgentEnvelope: vi.fn().mockImplementation(({ body }: { body: string }) => body),
        formatInboundEnvelope: vi.fn(),
        resolveEnvelopeFormatOptions: vi.fn().mockReturnValue({}),
      },
      routing: {
        resolveAgentRoute: vi.fn().mockReturnValue({
          sessionKey: "dingtalk-test-session",
          accountId: "test_account",
          agentId: "default",
          matchedBy: "default",
        }),
      },
      pairing: {
        buildPairingReply: vi.fn(),
        readAllowFromStore: vi.fn(),
        upsertPairingRequest: vi.fn(),
      },
      media: {
        fetchRemoteMedia: vi.fn(),
        saveMediaBuffer: vi.fn(),
      },
      activity: {
        record: vi.fn(),
        get: vi.fn(),
      },
      session: {
        resolveStorePath: vi.fn(),
        readSessionUpdatedAt: vi.fn(),
        recordSessionMetaFromInbound: vi.fn(),
        recordInboundSession: vi.fn(),
        updateLastRoute: vi.fn(),
      },
      mentions: {
        buildMentionRegexes: vi.fn(),
        matchesMentionPatterns: vi.fn(),
        matchesMentionWithExplicit: vi.fn(),
      },
      reactions: {
        shouldAckReaction: vi.fn(),
        removeAckReactionAfterReply: vi.fn(),
      },
      groups: {
        resolveGroupPolicy: vi.fn(),
        resolveRequireMention: vi.fn(),
      },
      debounce: {
        createInboundDebouncer: vi.fn(),
        resolveInboundDebounceMs: vi.fn(),
      },
      commands: {
        resolveCommandAuthorizedFromAuthorizers: vi.fn(),
        isControlCommandMessage: vi.fn(),
        shouldComputeCommandAuthorized: vi.fn().mockReturnValue(false),
        shouldHandleTextCommands: vi.fn(),
      },
    },
    logging: {
      shouldLogVerbose: vi.fn(),
      getChildLogger: vi.fn(),
    },
    state: {
      resolveStateDir: vi.fn(),
    },
  } as any;
}

describe("bot logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createAICardForTarget", () => {
    it("creates AI card correctly for user", async () => {
      vi.spyOn(auth, "getAccessToken").mockResolvedValue("mock-token");
      (axios.post as any).mockResolvedValue({ data: {} });

      const config = { clientId: "client_123", clientSecret: "secret" } as any;
      const target = { type: "user" as const, userId: "user_123" };

      const result = await createAICardForTarget(config, target);

      expect(result).not.toBeNull();
      expect(result?.accessToken).toBe("mock-token");
      expect(axios.post).toHaveBeenCalledTimes(2); // One for instance, one for deliver
    });
  });

  describe("extractMessageContent", () => {
    it("extracts text content", () => {
      const result = extractMessageContent({
        msgtype: "text",
        text: { content: "  hello world  " },
      });
      expect(result.text).toBe("hello world");
      expect(result.messageType).toBe("text");
    });

    it("extracts richText content", () => {
      const result = extractMessageContent({
        msgtype: "richText",
        content: {
          richText: [
            { type: "text", text: "part1" },
            { type: "image", url: "..." },
            { type: "text", text: "part2" },
          ],
        },
      });
      expect(result.text).toBe("part1part2");
      expect(result.messageType).toBe("richText");
    });

    it("handles picture message", () => {
      const result = extractMessageContent({ msgtype: "picture" });
      expect(result.text).toBe("[picture]");
    });

    it("handles audio message with recognition", () => {
      const result = extractMessageContent({
        msgtype: "audio",
        content: { recognition: "recognized text" },
      });
      expect(result.text).toBe("recognized text");
    });

    it("handles unknown message type", () => {
      const result = extractMessageContent({
        msgtype: "custom",
        text: { content: "fallback" },
      });
      expect(result.text).toBe("fallback");
      expect(result.messageType).toBe("custom");
    });
  });

  describe("handleDingTalkMessage", () => {
    it("dispatches message via core reply pipeline", async () => {
      const mockRuntime = createMockRuntime();
      setDingTalkRuntime(mockRuntime);

      (axios.post as any).mockResolvedValue({ data: {} });
      (axios.put as any).mockResolvedValue({ data: {} });
      vi.spyOn(auth, "getAccessToken").mockResolvedValue("mock-token");

      const params = {
        cfg: {} as any,
        accountId: "test_account",
        data: {
          msgtype: "text",
          text: { content: "hello agent" },
          conversationType: "1",
          senderId: "user_1",
          senderNick: "TestUser",
          msgId: "msg_123",
        },
        sessionWebhook: "",
        dingtalkConfig: { clientId: "mock_client" } as any,
        runtime: { log: vi.fn(), error: vi.fn() } as any,
      };

      await handleDingTalkMessage(params);

      // Verify core pipeline was used
      expect(mockRuntime.channel.routing.resolveAgentRoute).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "dingtalk",
          accountId: "test_account",
        }),
      );
      expect(mockRuntime.channel.reply.formatAgentEnvelope).toHaveBeenCalled();
      expect(mockRuntime.channel.reply.finalizeInboundContext).toHaveBeenCalledWith(
        expect.objectContaining({
          Provider: "dingtalk",
          Surface: "dingtalk",
          SenderId: "user_1",
          ChatType: "direct",
        }),
      );
      expect(mockRuntime.channel.reply.dispatchReplyFromConfig).toHaveBeenCalled();
      expect(mockRuntime.system.enqueueSystemEvent).toHaveBeenCalled();
    });

    it("skips empty messages", async () => {
      const mockRuntime = createMockRuntime();
      setDingTalkRuntime(mockRuntime);

      const params = {
        cfg: {} as any,
        accountId: "test_account",
        data: {
          msgtype: "text",
          text: { content: "" },
          conversationType: "1",
          senderId: "user_1",
        },
        sessionWebhook: "",
        dingtalkConfig: { clientId: "mock_client" } as any,
      };

      await handleDingTalkMessage(params);

      // Should not reach dispatch
      expect(mockRuntime.channel.routing.resolveAgentRoute).not.toHaveBeenCalled();
    });

    it("handles group messages with correct routing", async () => {
      const mockRuntime = createMockRuntime();
      setDingTalkRuntime(mockRuntime);

      (axios.post as any).mockResolvedValue({ data: {} });
      (axios.put as any).mockResolvedValue({ data: {} });
      vi.spyOn(auth, "getAccessToken").mockResolvedValue("mock-token");

      const params = {
        cfg: {} as any,
        accountId: "test_account",
        data: {
          msgtype: "text",
          text: { content: "hello group" },
          conversationType: "2",
          senderId: "user_2",
          senderNick: "GroupUser",
          conversationId: "conv_abc",
          msgId: "msg_456",
        },
        sessionWebhook: "",
        dingtalkConfig: { clientId: "mock_client" } as any,
        runtime: { log: vi.fn(), error: vi.fn() } as any,
      };

      await handleDingTalkMessage(params);

      expect(mockRuntime.channel.routing.resolveAgentRoute).toHaveBeenCalledWith(
        expect.objectContaining({
          peer: expect.objectContaining({
            kind: "group",
            id: "conv_abc",
          }),
        }),
      );
      expect(mockRuntime.channel.reply.finalizeInboundContext).toHaveBeenCalledWith(
        expect.objectContaining({
          ChatType: "group",
          GroupSubject: "conv_abc",
        }),
      );
    });
  });
});
