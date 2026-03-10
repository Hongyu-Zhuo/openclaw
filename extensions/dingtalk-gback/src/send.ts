import axios from "axios";
import { getAccessToken, getOapiAccessToken } from "./auth.js";
import { createAICardForTarget, finishAICard } from "./bot.js";
import {
  processLocalImages,
  processVideoMarkers,
  processAudioMarkers,
  processFileMarkers,
} from "./media.js";
import {
  AICardTarget,
  DingTalkMsgType,
  ProactiveSendOptions,
  SendResult,
  DingtalkAccountConfig,
  DingTalkLogger,
} from "./types.js";

// ============ Constants ============

const DINGTALK_API = "https://api.dingtalk.com";

// ============ Basic Message Sending ============

/** Formats and pushes standard Markdown message payloads using legacy webhooks based on access tokens */
export async function sendMarkdownMessage(
  config: DingtalkAccountConfig,
  sessionWebhook: string,
  title: string,
  markdown: string,
  options: Record<string, unknown> = {},
): Promise<unknown> {
  const token = await getAccessToken(config);
  let text = markdown;
  if (options.atUserId) text = `${text} @${options.atUserId}`;

  const body: Record<string, unknown> = {
    msgtype: "markdown",
    markdown: { title: title || "Message", text },
  };
  if (options.atUserId) body.at = { atUserIds: [options.atUserId], isAtAll: false };

  return (
    await axios.post(sessionWebhook, body, {
      headers: { "x-acs-dingtalk-access-token": token, "Content-Type": "application/json" },
    })
  ).data;
}

/** Directly pushes an explicit ordinary text message format payload using webhook endpoints */
export async function sendTextMessage(
  config: DingtalkAccountConfig,
  sessionWebhook: string,
  text: string,
  options: Record<string, unknown> = {},
): Promise<unknown> {
  const token = await getAccessToken(config);
  const body: Record<string, unknown> = { msgtype: "text", text: { content: text } };
  if (options.atUserId) body.at = { atUserIds: [options.atUserId], isAtAll: false };

  return (
    await axios.post(sessionWebhook, body, {
      headers: { "x-acs-dingtalk-access-token": token, "Content-Type": "application/json" },
    })
  ).data;
}

/**
 * Generic abstraction automatically delegating content to `sendMarkdownMessage` or `sendTextMessage`
 * depending on formatting heuristics.
 */
export async function sendMessage(
  config: DingtalkAccountConfig,
  sessionWebhook: string,
  text: string,
  options: Record<string, unknown> = {},
): Promise<unknown> {
  const hasMarkdown = /^[#*>-]|[*_`#\[\]]/.test(text) || text.includes("\n");
  const useMarkdown = options.useMarkdown !== false && (options.useMarkdown || hasMarkdown);
  console.log("sendMessage", config, sessionWebhook, text, options);

  if (useMarkdown) {
    const title =
      (options.title as string) ||
      text
        .split("\n")[0]
        .replace(/^[#*\s\->]+/, "")
        .slice(0, 20) ||
      "Message";
    return sendMarkdownMessage(config, sessionWebhook, title, text, options);
  }
  return sendTextMessage(config, sessionWebhook, text, options);
}

// ============ Message Construction and Broadcasting ============

/** Translates abstract semantic types (markdown, link, generic text) into DingTalk's specific nested JSON property requirements */
function buildMsgPayload(
  msgType: DingTalkMsgType,
  content: string,
  title?: string,
): { msgKey: string; msgParam: unknown } | { error: string } {
  switch (msgType) {
    case "markdown":
      return { msgKey: "sampleMarkdown", msgParam: { title: title || "Message", text: content } };
    case "link":
    case "actionCard":
      try {
        return {
          msgKey: msgType === "link" ? "sampleLink" : "sampleActionCard",
          msgParam: typeof content === "string" ? JSON.parse(content) : content,
        };
      } catch {
        return { error: `Invalid ${msgType} message format` };
      }
    case "image":
      return { msgKey: "sampleImageMsg", msgParam: { photoURL: content } };
    case "text":
    default:
      return { msgKey: "sampleText", msgParam: { content } };
  }
}

/** Implements internal batch sending loops mapping over arrays of designated direct user targets */
async function sendNormalToUser(
  config: DingtalkAccountConfig,
  userIds: string | string[],
  content: string,
  options: ProactiveSendOptions = {},
): Promise<SendResult> {
  const { msgType = "text", title } = options;
  const userIdArray = Array.isArray(userIds) ? userIds : [userIds];
  const payload = buildMsgPayload(msgType, content, title);
  if ("error" in payload) return { ok: false, error: payload.error, usedAICard: false };

  try {
    const token = await getAccessToken(config);
    const body = {
      robotCode: config.clientId,
      userIds: userIdArray,
      msgKey: payload.msgKey,
      msgParam: JSON.stringify(payload.msgParam),
    };

    const resp = await axios.post(`${DINGTALK_API}/v1.0/robot/oToMessages/batchSend`, body, {
      headers: { "x-acs-dingtalk-access-token": token, "Content-Type": "application/json" },
      timeout: 10_000,
    });

    if (resp.data?.processQueryKey)
      return { ok: true, processQueryKey: resp.data.processQueryKey, usedAICard: false };
    return { ok: false, error: resp.data?.message || "Unknown error", usedAICard: false };
  } catch (err: unknown) {
    const errorDetails = err as { response?: { data?: { message?: string } }; message?: string };
    return {
      ok: false,
      error: errorDetails.response?.data?.message || errorDetails.message || "Unknown error",
      usedAICard: false,
    };
  }
}

/** Routes target content generically to standard groups enforcing batch-sending API structure */
async function sendNormalToGroup(
  config: DingtalkAccountConfig,
  openConversationId: string,
  content: string,
  options: ProactiveSendOptions = {},
): Promise<SendResult> {
  const { msgType = "text", title } = options;
  const payload = buildMsgPayload(msgType, content, title);
  if ("error" in payload) return { ok: false, error: payload.error, usedAICard: false };

  try {
    const token = await getAccessToken(config);
    const body = {
      robotCode: config.clientId,
      openConversationId,
      msgKey: payload.msgKey,
      msgParam: JSON.stringify(payload.msgParam),
    };

    const resp = await axios.post(`${DINGTALK_API}/v1.0/robot/groupMessages/send`, body, {
      headers: { "x-acs-dingtalk-access-token": token, "Content-Type": "application/json" },
      timeout: 10_000,
    });

    if (resp.data?.processQueryKey)
      return { ok: true, processQueryKey: resp.data.processQueryKey, usedAICard: false };
    return { ok: false, error: resp.data?.message || "Unknown error", usedAICard: false };
  } catch (err: unknown) {
    const errorDetails = err as { response?: { data?: { message?: string } }; message?: string };
    return {
      ok: false,
      error: errorDetails.response?.data?.message || errorDetails.message || "Unknown error",
      usedAICard: false,
    };
  }
}

// ============ AI Card Message Sending ============

/**
 * Executes a sequence uploading necessary interactive files,
 * instantiating an AI-card container, and transmitting the aggregated formatted sequence.
 */
async function sendAICardInternal(
  config: DingtalkAccountConfig,
  target: AICardTarget,
  content: string,
  log?: DingTalkLogger,
): Promise<SendResult> {
  try {
    const oapiToken = await getOapiAccessToken(config);
    let processedContent = content;

    if (oapiToken) {
      processedContent = await processLocalImages(processedContent, oapiToken, log);
      processedContent = await processVideoMarkers(
        processedContent,
        "",
        config,
        oapiToken,
        log,
        true,
        target,
      );
      processedContent = await processAudioMarkers(
        processedContent,
        "",
        config,
        oapiToken,
        log,
        true,
        target,
      );
      processedContent = await processFileMarkers(
        processedContent,
        "",
        config,
        oapiToken,
        log,
        true,
        target,
      );
    }

    if (!processedContent.trim()) return { ok: true, usedAICard: false };

    const card = await createAICardForTarget(config, target, log);
    if (!card) return { ok: false, error: "Failed to create AI Card", usedAICard: false };

    await finishAICard(card, processedContent, log);
    return { ok: true, cardInstanceId: card.cardInstanceId, usedAICard: true };
  } catch (err: unknown) {
    const errorDetails = err as { response?: { data?: { message?: string } }; message?: string };
    return {
      ok: false,
      error: errorDetails.response?.data?.message || errorDetails.message || "Unknown error",
      usedAICard: false,
    };
  }
}

// ============ Platform Exposed API ============

/**
 * Top-level function mediating dispatching direct-messages to specific users,
 * preferring AI Cards first, falling back symmetrically to standard plain/markdown configurations.
 */
export async function sendToUser(
  config: DingtalkAccountConfig,
  userIds: string | string[],
  content: string,
  options: ProactiveSendOptions = {},
): Promise<SendResult> {
  const { log, useAICard = true, fallbackToNormal = true } = options;
  const userIdArray = Array.isArray(userIds) ? userIds : [userIds];

  if (useAICard && userIdArray.length === 1) {
    const cardResult = await sendAICardInternal(
      config,
      { type: "user", userId: userIdArray[0] },
      content,
      log,
    );
    if (cardResult.ok || !fallbackToNormal) return cardResult;
  }
  return sendNormalToUser(config, userIdArray, content, options);
}

/**
 * Broad capability function mediating payload delivery targeted toward open conversation groups (chats).
 */
export async function sendToGroup(
  config: DingtalkAccountConfig,
  openConversationId: string,
  content: string,
  options: ProactiveSendOptions = {},
): Promise<SendResult> {
  const { log, useAICard = true, fallbackToNormal = true } = options;

  if (useAICard) {
    const cardResult = await sendAICardInternal(
      config,
      { type: "group", openConversationId },
      content,
      log,
    );
    if (cardResult.ok || !fallbackToNormal) return cardResult;
  }
  return sendNormalToGroup(config, openConversationId, content, options);
}

/**
 * Handles proactive system sends targeting abstract peer IDs. Normalizes targets routing to individual users vs group chats.
 */
export async function sendProactive(
  config: DingtalkAccountConfig,
  target: { userId?: string; userIds?: string[]; openConversationId?: string },
  content: string,
  options: ProactiveSendOptions = {},
): Promise<SendResult> {
  if (!options.msgType && (/^[#*>-]|[*_`#\[\]]/.test(content) || content.includes("\n"))) {
    options.msgType = "markdown";
  }

  if (target.userId || target.userIds) {
    return sendToUser(config, target.userIds || [target.userId!], content, options);
  }
  if (target.openConversationId) {
    return sendToGroup(config, target.openConversationId, content, options);
  }
  return {
    ok: false,
    error: "Must specify userId, userIds, or openConversationId",
    usedAICard: false,
  };
}
