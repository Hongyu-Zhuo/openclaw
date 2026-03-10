import { describe, it, expect, vi, beforeEach } from "vitest";
import * as bot from "./bot.js";
import { createDingTalkReplyDispatcher } from "./reply-dispatcher.js";
import * as runtime from "./runtime.js";
import * as send from "./send.js";

vi.mock("./bot.js", () => ({
  createAICardForTarget: vi.fn(),
  finishAICard: vi.fn(),
}));

vi.mock("./send.js", () => ({
  sendToUser: vi.fn(),
  sendToGroup: vi.fn(),
}));

describe("createDingTalkReplyDispatcher", () => {
  let mockRuntime: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockRuntime = {
      channel: {
        text: {
          resolveTextChunkLimit: vi.fn().mockReturnValue(4000),
          resolveChunkMode: vi.fn().mockReturnValue("default"),
          chunkTextWithMode: vi.fn().mockImplementation((text) => [text]),
        },
        reply: {
          resolveHumanDelayConfig: vi.fn().mockReturnValue({}),
          createReplyDispatcherWithTyping: vi.fn().mockImplementation((config) => {
            return {
              dispatcher: async (payload: any, info: any) => {
                await config.deliver(payload, info);
              },
              replyOptions: {},
              markDispatchIdle: vi.fn(),
            };
          }),
        },
      },
      log: vi.fn(),
      error: vi.fn(),
    };

    vi.spyOn(runtime, "getDingTalkRuntime").mockReturnValue(mockRuntime);
  });

  const baseParams = {
    cfg: {} as any,
    agentId: "agent_123",
    runtime: { log: vi.fn(), error: vi.fn() } as any,
    accountId: "account_123",
    dingtalkConfig: { clientId: "client_123" } as any,
  };

  function getTriggers() {
    const call = mockRuntime.channel.reply.createReplyDispatcherWithTyping.mock.calls[0];
    const config = call[0];
    return {
      _triggerStart: config.onReplyStart,
      _triggerError: config.onError,
    };
  }

  it("creates AICard on reply start and uses it for delivery", async () => {
    const mockCard = { cardInstanceId: "card_123", accessToken: "token", inputingStarted: false };
    const createAICardSpy = vi.spyOn(bot, "createAICardForTarget").mockResolvedValue(mockCard);
    const finishAICardSpy = vi.spyOn(bot, "finishAICard").mockResolvedValue(undefined);

    const params = {
      ...baseParams,
      senderId: "user_1",
      isDirect: true,
    };

    const { dispatcher } = createDingTalkReplyDispatcher(params) as any;
    const { _triggerStart } = getTriggers();

    // Trigger onReplyStart which should create the AI card
    _triggerStart();

    // Since card creation is async but not awaited directly in onReplyStart, we can await a brief moment
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(createAICardSpy).toHaveBeenCalledWith(
      params.dingtalkConfig,
      { type: "user", userId: "user_1" },
      undefined,
    );

    // Deliver a chunk
    await dispatcher({ text: "Hello AI Card" }, { kind: "final" });

    // Since card exists, it should use finishAICard
    expect(finishAICardSpy).toHaveBeenCalledWith(mockCard, "Hello AI Card", undefined);
    // Should NOT fallback to sendToUser
    expect(send.sendToUser).not.toHaveBeenCalled();
  });

  it("falls back to sendToUser if AICard creation fails", async () => {
    const createAICardSpy = vi
      .spyOn(bot, "createAICardForTarget")
      .mockRejectedValue(new Error("Failed"));
    const sendToUserSpy = vi.spyOn(send, "sendToUser").mockResolvedValue({ ok: true } as any);

    const params = {
      ...baseParams,
      senderId: "user_1",
      isDirect: true,
    };

    const { dispatcher } = createDingTalkReplyDispatcher(params) as any;
    const { _triggerStart } = getTriggers();

    _triggerStart();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(createAICardSpy).toHaveBeenCalled();

    // Deliver a chunk
    await dispatcher({ text: "Hello Fallback" }, { kind: "final" });

    // Should fallback to sendToUser because card is null
    expect(sendToUserSpy).toHaveBeenCalledWith(
      params.dingtalkConfig,
      "user_1",
      "Hello Fallback",
      {},
    );
  });

  it("falls back to sendToGroup if AICard creation returns null in group", async () => {
    const createAICardSpy = vi.spyOn(bot, "createAICardForTarget").mockResolvedValue(null);
    const sendToGroupSpy = vi.spyOn(send, "sendToGroup").mockResolvedValue({ ok: true } as any);

    const params = {
      ...baseParams,
      senderId: "user_1",
      isDirect: false,
      conversationId: "conv_123",
    };

    const { dispatcher } = createDingTalkReplyDispatcher(params) as any;
    const { _triggerStart } = getTriggers();

    _triggerStart();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(createAICardSpy).toHaveBeenCalledWith(
      params.dingtalkConfig,
      { type: "group", openConversationId: "conv_123" },
      undefined,
    );

    // Deliver a chunk
    await dispatcher({ text: "Hello Group Fallback" }, { kind: "final" });

    // Should fallback to sendToGroup
    expect(sendToGroupSpy).toHaveBeenCalledWith(
      params.dingtalkConfig,
      "conv_123",
      "Hello Group Fallback",
      {},
    );
  });

  it("handles empty text delivery gracefully", async () => {
    const createAICardSpy = vi.spyOn(bot, "createAICardForTarget").mockResolvedValue(null);

    const params = {
      ...baseParams,
      senderId: "user_1",
      isDirect: true,
    };

    const { dispatcher } = createDingTalkReplyDispatcher(params) as any;

    await dispatcher({ text: "   " }, { kind: "final" });

    // Should not try to send anything
    expect(createAICardSpy).not.toHaveBeenCalled();
    expect(send.sendToUser).not.toHaveBeenCalled();
  });

  it("closes card with error message when onError is triggered", async () => {
    const mockCard = { cardInstanceId: "card_123", accessToken: "token", inputingStarted: false };
    vi.spyOn(bot, "createAICardForTarget").mockResolvedValue(mockCard);
    const finishAICardSpy = vi.spyOn(bot, "finishAICard").mockResolvedValue(undefined);

    const params = {
      ...baseParams,
      senderId: "user_1",
      isDirect: true,
    };

    createDingTalkReplyDispatcher(params);
    const { _triggerStart, _triggerError } = getTriggers();

    _triggerStart();
    await new Promise((resolve) => setTimeout(resolve, 10));

    await _triggerError(new Error("Test Error"), { kind: "final" });

    expect(finishAICardSpy).toHaveBeenCalledWith(mockCard, "Error: Error: Test Error", undefined);
  });
});
