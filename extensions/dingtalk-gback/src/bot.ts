import axios from "axios";
import type { ClawdbotConfig, RuntimeEnv } from "openclaw/plugin-sdk";
import { getOapiAccessToken } from "./auth.js";
import { resolveDingTalkAccount } from "./config.js";
import { buildMediaSystemPrompt, processLocalImages } from "./media.js";
import { createDingTalkReplyDispatcher } from "./reply-dispatcher.js";
import { getDingTalkRuntime } from "./runtime.js";
import { getSessionKey, isNewSessionCommand } from "./session.js";
import type {
  AICardInstance,
  AICardTarget,
  DingtalkAccountConfig,
  DingTalkLogger,
} from "./types.js";

// ============ Constants ============

const DINGTALK_API = "https://api.dingtalk.com";
const AI_CARD_TEMPLATE_ID = "382e4302-551d-4880-bf29-a30acfab2e71.schema";

const AICardStatus = {
  PROCESSING: "1",
  INPUTING: "2",
  FINISHED: "3",
} as const;

// ============ AI Card Management ============

/**
 * Creates a DingTalk AI Card instance for a specific target (user or group).
 * @param config DingTalk account configuration carrying credentials
 * @param target The user or group to send the AI card to
 * @param log Optional DingTalk logger
 * @returns The created AI Card instance references or null on failure
 */
export async function createAICardForTarget(
  config: DingtalkAccountConfig,
  target: AICardTarget,
  log?: DingTalkLogger,
): Promise<AICardInstance | null> {
  const targetDesc =
    target.type === "group" ? `群聊 ${target.openConversationId}` : `用户 ${target.userId}`;

  try {
    const { getAccessToken } = await import("./auth.js");
    const token = await getAccessToken(config);
    const cardInstanceId = `card_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    const createBody = {
      cardTemplateId: AI_CARD_TEMPLATE_ID,
      outTrackId: cardInstanceId,
      cardData: { cardParamMap: {} },
      callbackType: "STREAM",
      imGroupOpenSpaceModel: { supportForward: true },
      imRobotOpenSpaceModel: { supportForward: true },
    };

    await axios.post(`${DINGTALK_API}/v1.0/card/instances`, createBody, {
      headers: { "x-acs-dingtalk-access-token": token, "Content-Type": "application/json" },
    });

    const base = { outTrackId: cardInstanceId, userIdType: 1 };
    let deliverBody: Record<string, unknown>;

    if (target.type === "group") {
      deliverBody = {
        ...base,
        openSpaceId: `dtv1.card//IM_GROUP.${target.openConversationId}`,
        imGroupOpenDeliverModel: { robotCode: config.clientId },
      };
    } else {
      deliverBody = {
        ...base,
        openSpaceId: `dtv1.card//IM_ROBOT.${target.userId}`,
        imRobotOpenDeliverModel: { spaceType: "IM_ROBOT" },
      };
    }

    await axios.post(`${DINGTALK_API}/v1.0/card/instances/deliver`, deliverBody, {
      headers: { "x-acs-dingtalk-access-token": token, "Content-Type": "application/json" },
    });

    return { cardInstanceId, accessToken: token, inputingStarted: false };
  } catch (err: unknown) {
    log?.error?.(
      `[DingTalk][AICard] 创建卡片失败: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/**
 * Streams partial content to an existing AI Card and pushes updates
 * via the DingTalk streaming API.
 */
async function streamAICard(
  card: AICardInstance,
  content: string,
  finished: boolean = false,
  log?: DingTalkLogger,
): Promise<void> {
  if (!card.inputingStarted) {
    const statusBody = {
      outTrackId: card.cardInstanceId,
      cardData: {
        cardParamMap: {
          flowStatus: AICardStatus.INPUTING,
          msgContent: "",
          staticMsgContent: "",
          sys_full_json_obj: JSON.stringify({ order: ["msgContent"] }),
        },
      },
    };
    try {
      await axios.put(`${DINGTALK_API}/v1.0/card/instances`, statusBody, {
        headers: {
          "x-acs-dingtalk-access-token": card.accessToken,
          "Content-Type": "application/json",
        },
      });
    } catch {}
    card.inputingStarted = true;
  }

  const body = {
    outTrackId: card.cardInstanceId,
    guid: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    key: "msgContent",
    content: content,
    isFull: true,
    isFinalize: finished,
    isError: false,
  };

  try {
    await axios.put(`${DINGTALK_API}/v1.0/card/streaming`, body, {
      headers: {
        "x-acs-dingtalk-access-token": card.accessToken,
        "Content-Type": "application/json",
      },
    });
  } catch {}
}

/**
 * Marks the AI Card stream as finished and sets its final content state.
 */
export async function finishAICard(
  card: AICardInstance,
  content: string,
  log?: DingTalkLogger,
): Promise<void> {
  console.log("finishAICard", card, content);
  await streamAICard(card, content, true, log);

  const body = {
    outTrackId: card.cardInstanceId,
    cardData: {
      cardParamMap: {
        flowStatus: AICardStatus.FINISHED,
        msgContent: content,
        staticMsgContent: "",
        sys_full_json_obj: JSON.stringify({ order: ["msgContent"] }),
      },
    },
  };
  try {
    await axios.put(`${DINGTALK_API}/v1.0/card/instances`, body, {
      headers: {
        "x-acs-dingtalk-access-token": card.accessToken,
        "Content-Type": "application/json",
      },
    });
  } catch {}
}

// ============ Message Content Extraction ============

/**
 * Extracts plain text and native message type from arbitrary DingTalk incoming message payloads.
 * Evaluates raw text, rich text matrices, voice recognition text, and structural file names.
 */
export function extractMessageContent(data: Record<string, any>): {
  text: string;
  messageType: string;
} {
  const msgtype = data.msgtype || "text";
  switch (msgtype) {
    case "text":
      return { text: data.text?.content?.trim() || "", messageType: "text" };
    case "richText": {
      const parts = data.content?.richText || [];
      const text = parts
        .filter((p: Record<string, string>) => p.type === "text")
        .map((p: Record<string, string>) => p.text)
        .join("");
      return { text: text || "[richText]", messageType: "richText" };
    }
    case "picture":
      return { text: "[picture]", messageType: "picture" };
    case "audio":
      return { text: data.content?.recognition || "[audio]", messageType: "audio" };
    case "video":
      return { text: "[video]", messageType: "video" };
    case "file":
      return { text: `[file: ${data.content?.fileName || "file"}]`, messageType: "file" };
    default:
      return { text: data.text?.content?.trim() || `[${msgtype}]`, messageType: msgtype };
  }
}

// ============ Main DingTalk Message Flow ============

/**
 * The main entry point for processing inbound webhook payload requests from DingTalk.
 * This function converts platform-specific envelope details into OpenClaw-compatible contexts,
 * identifies resolving routes and agents, wraps the payload, and dispatches the request logic into the OpenClaw Engine.
 */
export async function handleDingTalkMessage(params: {
  cfg: ClawdbotConfig;
  accountId: string;
  data: Record<string, any>;
  sessionWebhook: string;
  log?: DingTalkLogger;
  dingtalkConfig: DingtalkAccountConfig;
  runtime?: RuntimeEnv;
}): Promise<void> {
  const { cfg, accountId, data, log, dingtalkConfig, runtime } = params;
  const core = getDingTalkRuntime();

  const content = extractMessageContent(data);
  if (!content.text) return;

  const isDirect = data.conversationType === "1";
  const senderId = data.senderStaffId || data.senderId;
  const senderNick = data.senderNick || senderId;
  const conversationId = data.conversationId;

  log?.info?.(`[DingTalk] incoming: ${content.text}`);

  // Handle new session commands
  const sessionTimeout = dingtalkConfig.sessionTimeout ?? 1800000;
  const forceNewSession = isNewSessionCommand(content.text);
  if (forceNewSession) {
    getSessionKey(senderId, true, sessionTimeout, log);
    return;
  }

  // Resolve agent route
  const route = core.channel.routing.resolveAgentRoute({
    cfg,
    channel: "dingtalk",
    accountId,
    peer: {
      kind: isDirect ? "direct" : "group",
      id: isDirect ? senderId : conversationId,
    },
  });

  // Build envelope and inbound context
  const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(cfg);
  const dingtalkFrom = `dingtalk:${senderId}`;
  const dingtalkTo = isDirect ? `user:${senderId}` : `group:${conversationId}`;

  const messageBody = `${senderNick}: ${content.text}`;

  const body = core.channel.reply.formatAgentEnvelope({
    channel: "DingTalk",
    from: isDirect ? senderId : `${conversationId}:${senderId}`,
    timestamp: new Date(),
    envelope: envelopeOptions,
    body: messageBody,
  });

  const shouldComputeCommandAuthorized = core.channel.commands.shouldComputeCommandAuthorized(
    content.text,
    cfg,
  );

  const commandAuthorized = shouldComputeCommandAuthorized
    ? core.channel.commands.resolveCommandAuthorizedFromAuthorizers({
        useAccessGroups: cfg.commands?.useAccessGroups !== false,
        authorizers: [],
      })
    : undefined;

  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: body,
    BodyForAgent: content.text,
    RawBody: content.text,
    CommandBody: content.text,
    From: dingtalkFrom,
    To: dingtalkTo,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: isDirect ? "direct" : "group",
    GroupSubject: isDirect ? undefined : conversationId,
    SenderName: senderNick,
    SenderId: senderId,
    Provider: "dingtalk" as const,
    Surface: "dingtalk" as const,
    MessageSid: `dingtalk:${data.msgId || Date.now()}`,
    Timestamp: Date.now(),
    WasMentioned: false,
    CommandAuthorized: commandAuthorized,
    OriginatingChannel: "dingtalk" as const,
    OriginatingTo: dingtalkTo,
  });

  // Create reply dispatcher
  const { dispatcher, replyOptions, markDispatchIdle } = createDingTalkReplyDispatcher({
    cfg,
    agentId: route.agentId,
    runtime: runtime as RuntimeEnv,
    senderId,
    isDirect,
    conversationId,
    accountId,
    dingtalkConfig,
    log,
  });

  const preview = content.text.replace(/\s+/g, " ").slice(0, 160);
  const inboundLabel = isDirect
    ? `DingTalk[${accountId}] DM from ${senderId}`
    : `DingTalk[${accountId}] message in group ${conversationId}`;

  core.system.enqueueSystemEvent(`${inboundLabel}: ${preview}`, {
    sessionKey: route.sessionKey,
    contextKey: `dingtalk:message:${data.msgId || Date.now()}`,
  });

  log?.info?.(`dingtalk[${accountId}]: dispatching to agent (session=${route.sessionKey})`);

  try {
    await core.channel.reply.dispatchReplyFromConfig({
      ctx: ctxPayload,
      cfg,
      dispatcher,
      replyOptions,
    });

    markDispatchIdle();

    log?.info?.(`dingtalk[${accountId}]: dispatch complete`);
  } catch (err) {
    log?.error?.(`dingtalk[${accountId}]: failed to dispatch message: ${String(err)}`);
  }
}
