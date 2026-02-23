import {
  createReplyPrefixContext,
  createTypingCallbacks,
  logTypingFailure,
  type ClawdbotConfig,
  type ReplyPayload,
  type RuntimeEnv,
} from "openclaw/plugin-sdk";
import { createAICardForTarget, finishAICard } from "./bot.js";
import { getDingTalkRuntime } from "./runtime.js";
import { sendToUser, sendToGroup } from "./send.js";
import type {
  AICardInstance,
  AICardTarget,
  DingtalkAccountConfig,
  DingTalkLogger,
} from "./types.js";

export type CreateDingTalkReplyDispatcherParams = {
  cfg: ClawdbotConfig;
  agentId: string;
  runtime: RuntimeEnv;
  senderId: string;
  isDirect: boolean;
  conversationId?: string;
  accountId?: string;
  dingtalkConfig: DingtalkAccountConfig;
  log?: DingTalkLogger;
};

export function createDingTalkReplyDispatcher(params: CreateDingTalkReplyDispatcherParams) {
  const core = getDingTalkRuntime();
  const { cfg, agentId, senderId, isDirect, conversationId, accountId, dingtalkConfig, log } =
    params;
  const prefixContext = createReplyPrefixContext({ cfg, agentId });

  const textChunkLimit = core.channel.text.resolveTextChunkLimit(cfg, "dingtalk", accountId, {
    fallbackLimit: 4000,
  });
  const chunkMode = core.channel.text.resolveChunkMode(cfg, "dingtalk");

  // AI Card state for streaming
  let card: AICardInstance | null = null;
  let cardCreationPromise: Promise<void> | null = null;

  const target: AICardTarget = isDirect
    ? { type: "user", userId: senderId }
    : { type: "group", openConversationId: conversationId! };

  const startCard = () => {
    if (cardCreationPromise || card) {
      return;
    }
    cardCreationPromise = (async () => {
      try {
        card = await createAICardForTarget(dingtalkConfig, target, log);
      } catch (err) {
        log?.error?.(
          `[DingTalk] AI Card creation failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        card = null;
      }
    })();
  };

  const closeCard = async (finalText: string) => {
    if (cardCreationPromise) {
      await cardCreationPromise;
    }
    if (card) {
      await finishAICard(card, finalText || "Done", log);
      card = null;
    }
    cardCreationPromise = null;
  };

  // Fallback: send plain text via DingTalk API
  const sendPlainText = async (text: string) => {
    if (isDirect) {
      await sendToUser(dingtalkConfig, senderId, text, {});
    } else {
      await sendToGroup(dingtalkConfig, conversationId!, text, {});
    }
  };

  const typingCallbacks = createTypingCallbacks({
    start: async () => {
      // DingTalk doesn't have a native typing indicator, use AI Card INPUTING state instead
      startCard();
    },
    stop: async () => {
      // No-op: card finalization is handled in deliver
    },
    onStartError: (err) =>
      logTypingFailure({
        log: (message) => params.runtime.log?.(message),
        channel: "dingtalk",
        action: "start",
        error: err,
      }),
    onStopError: (err) =>
      logTypingFailure({
        log: (message) => params.runtime.log?.(message),
        channel: "dingtalk",
        action: "stop",
        error: err,
      }),
  });

  const { dispatcher, replyOptions, markDispatchIdle } =
    core.channel.reply.createReplyDispatcherWithTyping({
      responsePrefix: prefixContext.responsePrefix,
      responsePrefixContextProvider: prefixContext.responsePrefixContextProvider,
      humanDelay: core.channel.reply.resolveHumanDelayConfig(cfg, agentId),
      onReplyStart: () => {
        startCard();
        void typingCallbacks.onReplyStart?.();
      },
      deliver: async (payload: ReplyPayload, info) => {
        const text = payload.text ?? "";
        if (!text.trim()) {
          return;
        }

        // Wait for card creation to finish
        if (cardCreationPromise) {
          await cardCreationPromise;
        }

        if (card) {
          // Use AI Card for delivery
          if (info?.kind === "final") {
            await closeCard(text);
          }
          // For non-final chunks, streaming updates are handled via onPartialReply
          return;
        }

        // Fallback to plain text delivery (chunked)
        for (const chunk of core.channel.text.chunkTextWithMode(text, textChunkLimit, chunkMode)) {
          await sendPlainText(chunk);
        }
      },
      onError: async (error, info) => {
        params.runtime.error?.(
          `dingtalk[${accountId}] ${info.kind} reply failed: ${String(error)}`,
        );
        await closeCard(`Error: ${String(error)}`);
        typingCallbacks.onIdle?.();
      },
      onIdle: async () => {
        typingCallbacks.onIdle?.();
      },
      onCleanup: () => {
        typingCallbacks.onCleanup?.();
      },
    });

  return {
    dispatcher,
    replyOptions: {
      ...replyOptions,
      onModelSelected: prefixContext.onModelSelected,
      onPartialReply: (payload: ReplyPayload) => {
        if (!payload.text) {
          return;
        }
        // AI Card streaming updates are handled by the card streaming API
        // We could update the card with partial content here if needed
      },
    },
    markDispatchIdle,
  };
}
