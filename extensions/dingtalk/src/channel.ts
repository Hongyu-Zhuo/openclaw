import { DWClient, TOPIC_ROBOT } from "dingtalk-stream";
import type { ChannelPlugin, ClawdbotConfig } from "openclaw/plugin-sdk";
import { handleDingTalkMessage } from "./bot.js";
import { getDingTalkConfigs, isConfigured, resolveDingTalkAccount } from "./config.js";
import { dingtalkOnboardingAdapter } from "./onboarding.js";
import { getDingTalkRuntime } from "./runtime.js";
import { sendToUser, sendToGroup } from "./send.js";
import { isMessageProcessed, markMessageProcessed } from "./session.js";
import type { ResolvedDingtalkAccount, DingtalkAccountConfig } from "./types.js";

export const dingtalkPlugin: ChannelPlugin<ResolvedDingtalkAccount> = {
  id: "dingtalk",
  meta: {
    id: "dingtalk",
    label: "DingTalk",
    selectionLabel: "DingTalk (钉钉)",
    docsPath: "/channels/dingtalk",
    docsLabel: "dingtalk",
    blurb: "钉钉企业内部机器人，使用 Stream 模式，无需公网 IP，支持 AI Card 流式响应。",
    order: 70,
    aliases: ["dd", "ding"],
  },
  capabilities: {
    chatTypes: ["direct", "group"],
    reactions: false,
    threads: false,
    media: true,
    nativeCommands: false,
    blockStreaming: false,
  },
  reload: { configPrefixes: ["channels.dingtalk"] },
  onboarding: dingtalkOnboardingAdapter,
  configSchema: {
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        enabled: { type: "boolean", default: true },
        clientId: { type: "string", description: "DingTalk App Key (Client ID)" },
        clientSecret: { type: "string", description: "DingTalk App Secret (Client Secret)" },
        enableMediaUpload: { type: "boolean", default: true },
        systemPrompt: { type: "string", default: "" },
        dmPolicy: { type: "string", enum: ["open", "pairing", "allowlist"], default: "open" },
        allowFrom: { type: "array", items: { type: "string" } },
        groupPolicy: { type: "string", enum: ["open", "allowlist"], default: "open" },
        gatewayToken: { type: "string", default: "" },
        gatewayPassword: { type: "string", default: "" },
        sessionTimeout: { type: "number", default: 1800000 },
        debug: { type: "boolean", default: false },
      },
      required: ["clientId", "clientSecret"],
    },
    uiHints: {
      enabled: { label: "Enable DingTalk" },
      clientId: { label: "App Key", sensitive: false },
      clientSecret: { label: "App Secret", sensitive: true },
      dmPolicy: { label: "DM Policy" },
      groupPolicy: { label: "Group Policy" },
    },
  },
  config: {
    listAccountIds: (cfg: ClawdbotConfig) => {
      const config = getDingTalkConfigs(cfg);
      return config?.accounts ? Object.keys(config.accounts) : isConfigured(cfg) ? ["default"] : [];
    },
    resolveAccount: (cfg: ClawdbotConfig, accountId?: string | null) => {
      return resolveDingTalkAccount(cfg, accountId);
    },
    defaultAccountId: () => "default",
    isConfigured: (account: ResolvedDingtalkAccount) =>
      Boolean(account.config?.clientId && account.config?.clientSecret),
    describeAccount: (account: ResolvedDingtalkAccount) => ({
      accountId: account.accountId,
      name: account.config?.name || "DingTalk",
      enabled: account.enabled,
      configured: Boolean(account.config?.clientId),
    }),
  },
  security: {
    resolveDmPolicy: ({ account }: { account: ResolvedDingtalkAccount }) => ({
      policy: account.config?.dmPolicy || "open",
      allowFrom: account.config?.allowFrom || [],
      policyPath: "channels.dingtalk.dmPolicy",
      allowFromPath: "channels.dingtalk.allowFrom",
      approveHint: "使用 /allow dingtalk:<userId> 批准用户",
      normalizeEntry: (raw: string) => raw.replace(/^(dingtalk|dd|ding):/i, ""),
    }),
  },
  groups: {
    resolveRequireMention: ({ cfg }: { cfg: ClawdbotConfig }) => {
      const config = getDingTalkConfigs(cfg) as DingtalkAccountConfig | undefined;
      return config?.groupPolicy !== "open";
    },
  },
  messaging: {
    normalizeTarget: (raw: string) => {
      if (!raw) return undefined;
      return raw.trim().replace(/^(dingtalk|dd|ding):/i, "");
    },
    targetResolver: {
      looksLikeId: (id: string) => /^(user:|group:)?[\w+/=-]+$/.test(id),
      hint: "user:<userId> 或 group:<conversationId>",
    },
  },
  outbound: {
    deliveryMode: "direct" as const,
    textChunkLimit: 4000,
    sendText: async (ctx) => {
      const { cfg, to, text, accountId } = ctx;
      const account = resolveDingTalkAccount(cfg, accountId);
      const config = account.config;

      if (!config?.clientId || !config?.clientSecret) throw new Error("DingTalk not configured");
      if (!to) throw new Error("Target is required.");

      const targetStr = String(to);
      let result;

      if (targetStr.startsWith("user:"))
        result = await sendToUser(config, targetStr.slice(5), text, {});
      else if (targetStr.startsWith("group:"))
        result = await sendToGroup(config, targetStr.slice(6), text, {});
      else result = await sendToUser(config, targetStr, text, {});

      if (result.ok) return { channel: "dingtalk", messageId: result.processQueryKey || "unknown" };
      throw new Error(result.error || "Failed to send message");
    },
    sendMedia: async (ctx) => {
      const { cfg, to, text, mediaUrl, accountId } = ctx;
      const account = resolveDingTalkAccount(cfg, accountId);
      const config = account.config;

      if (!config?.clientId || !config?.clientSecret) throw new Error("DingTalk not configured");
      if (!to) throw new Error("Target is required.");

      const targetStr = String(to);
      let result;

      if (mediaUrl) {
        if (targetStr.startsWith("user:"))
          result = await sendToUser(config, targetStr.slice(5), mediaUrl, { msgType: "image" });
        else if (targetStr.startsWith("group:"))
          result = await sendToGroup(config, targetStr.slice(6), mediaUrl, { msgType: "image" });
        else result = await sendToUser(config, targetStr, mediaUrl, { msgType: "image" });
      } else {
        if (targetStr.startsWith("user:"))
          result = await sendToUser(config, targetStr.slice(5), text || "", {});
        else if (targetStr.startsWith("group:"))
          result = await sendToGroup(config, targetStr.slice(6), text || "", {});
        else result = await sendToUser(config, targetStr, text || "", {});
      }

      if (result.ok) return { channel: "dingtalk", messageId: result.processQueryKey || "unknown" };
      throw new Error(result.error || "Failed to send media");
    },
  },
  gateway: {
    startAccount: async (ctx) => {
      const { account, cfg, abortSignal } = ctx;
      const config = account.config;

      if (!config.clientId || !config.clientSecret)
        throw new Error("DingTalk clientId and clientSecret are required");

      ctx.log?.info(`[${account.accountId}] 启动钉钉 Stream 客户端...`);

      const client = new DWClient({
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        debug: config.debug || false,
      });

      client.registerCallbackListener(
        TOPIC_ROBOT,
        async (res: { headers?: { messageId?: string }; data: string }) => {
          const messageId = res.headers?.messageId;

          if (messageId) {
            client.socketCallBackResponse(messageId, { success: true });
          }

          if (messageId && isMessageProcessed(messageId)) return;
          if (messageId) markMessageProcessed(messageId);

          try {
            const data = JSON.parse(res.data);
            await handleDingTalkMessage({
              cfg,
              accountId: account.accountId,
              data,
              sessionWebhook: data.sessionWebhook,
              log: ctx.log,
              dingtalkConfig: config,
              runtime: ctx.runtime,
            });
          } catch (error: unknown) {
            ctx.log?.error?.(
              `[DingTalk] 处理消息异常: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        },
      );

      await client.connect();
      ctx.log?.info(`[${account.accountId}] 钉钉 Stream 客户端已连接`);

      const rt = getDingTalkRuntime();
      rt.channel.activity.record({
        channel: "dingtalk",
        accountId: account.accountId,
        direction: "inbound",
      });

      let stopped = false;
      if (abortSignal) {
        abortSignal.addEventListener("abort", () => {
          if (stopped) return;
          stopped = true;
          client.disconnect();
          rt.channel.activity.record({
            channel: "dingtalk",
            accountId: account.accountId,
            direction: "inbound",
          });
        });
      }

      return {
        stop: () => {
          if (stopped) return;
          stopped = true;
          client.disconnect();
          rt.channel.activity.record({
            channel: "dingtalk",
            accountId: account.accountId,
            direction: "inbound",
          });
        },
      };
    },
  },
  status: {
    defaultRuntime: {
      accountId: "default",
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    probeAccount: async ({ account }) => {
      if (!account.configured) return { ok: false, error: "Not configured" };
      try {
        const config = account.config;
        return { ok: true, details: { clientId: config.clientId } };
      } catch (error: unknown) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot?.configured ?? false,
      running: snapshot?.running ?? false,
      lastStartAt: snapshot?.lastStartAt ?? null,
      lastStopAt: snapshot?.lastStopAt ?? null,
      lastError: snapshot?.lastError ?? null,
    }),
  },
};
