import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { dingtalkPlugin } from "./src/channel.js";
import { resolveDingTalkAccount } from "./src/config.js";
import { setDingTalkRuntime } from "./src/runtime.js";
import {
  sendToUser,
  sendToGroup,
  sendProactive,
  sendMessage,
  sendTextMessage,
  sendMarkdownMessage,
} from "./src/send.js";

interface CustomGatewayOpts {
  respond: (ok: boolean, payload?: any, error?: any) => void;
  cfg: OpenClawConfig;
  params?: Record<string, any>;
  log?: (msg: string) => void;
  context?: any;
}

const plugin = {
  id: "dingtalk",
  name: "DingTalk Channel",
  description: "DingTalk (钉钉) messaging channel via Stream mode with AI Card streaming",
  configSchema: {
    type: "object",
    additionalProperties: true,
    properties: { enabled: { type: "boolean", default: true } },
  },
  register(api: OpenClawPluginApi) {
    setDingTalkRuntime(api.runtime);
    api.registerChannel({ plugin: dingtalkPlugin });

    api.registerGatewayMethod("dingtalk.status", async (opts) => {
      const { respond, cfg } = opts as unknown as CustomGatewayOpts;
      const account = resolveDingTalkAccount(cfg);
      const result = await dingtalkPlugin.status?.probeAccount?.({ account, timeoutMs: 5000, cfg });
      respond(true, result);
    });

    api.registerGatewayMethod("dingtalk.probe", async (opts) => {
      const { respond, cfg } = opts as unknown as CustomGatewayOpts;
      const account = resolveDingTalkAccount(cfg);
      const result = await dingtalkPlugin.status?.probeAccount?.({ account, timeoutMs: 5000, cfg });
      respond((result as any)?.ok ?? false, result);
    });

    api.registerGatewayMethod("dingtalk.sendToUser", async (opts) => {
      const { respond, cfg, params, log } = opts as unknown as CustomGatewayOpts;
      const { userId, userIds, content, msgType, title, useAICard, fallbackToNormal, accountId } =
        params || {};
      const account = resolveDingTalkAccount(cfg, accountId);

      if (!account.config?.clientId) return respond(false, { error: "DingTalk not configured" });

      const targetUserIds = userIds || (userId ? [userId] : []);
      if (targetUserIds.length === 0)
        return respond(false, { error: "userId or userIds is required" });
      if (!content) return respond(false, { error: "content is required" });

      const result = await sendToUser(account.config, targetUserIds, Object.assign({}, content), {
        msgType,
        title,
        log: log as any,
        useAICard: useAICard !== false,
        fallbackToNormal: fallbackToNormal !== false,
      });
      respond((result as any).ok, result);
    });

    api.registerGatewayMethod("dingtalk.sendToGroup", async (opts) => {
      const { respond, cfg, params, log } = opts as unknown as CustomGatewayOpts;
      const {
        openConversationId,
        content,
        msgType,
        title,
        useAICard,
        fallbackToNormal,
        accountId,
      } = params || {};
      const account = resolveDingTalkAccount(cfg, accountId);

      if (!account.config?.clientId) return respond(false, { error: "DingTalk not configured" });
      if (!openConversationId) return respond(false, { error: "openConversationId is required" });
      if (!content) return respond(false, { error: "content is required" });

      const result = await sendToGroup(
        account.config,
        openConversationId,
        Object.assign({}, content),
        {
          msgType,
          title,
          log: log as any,
          useAICard: useAICard !== false,
          fallbackToNormal: fallbackToNormal !== false,
        },
      );
      respond((result as any).ok, result);
    });

    api.registerGatewayMethod("dingtalk.send", async (opts) => {
      const { respond, cfg, params, log } = opts as unknown as CustomGatewayOpts;
      const { target, content, message, msgType, title, useAICard, fallbackToNormal, accountId } =
        params || {};
      const actualContent = content || message;
      const account = resolveDingTalkAccount(cfg, accountId);

      if (!account.config?.clientId) return respond(false, { error: "DingTalk not configured" });
      if (!target)
        return respond(false, {
          error: "target is required (format: user:<userId> or group:<openConversationId>)",
        });
      if (!actualContent) return respond(false, { error: "content is required" });

      const targetStr = String(target);
      let sendTarget: { userId?: string; openConversationId?: string };

      if (targetStr.startsWith("user:")) sendTarget = { userId: targetStr.slice(5) };
      else if (targetStr.startsWith("group:"))
        sendTarget = { openConversationId: targetStr.slice(6) };
      else sendTarget = { userId: targetStr };

      const result = await sendProactive(
        account.config,
        sendTarget,
        Object.assign({}, actualContent),
        {
          msgType,
          title,
          log: log as any,
          useAICard: useAICard !== false,
          fallbackToNormal: fallbackToNormal !== false,
        },
      );
      respond((result as any).ok, result);
    });

    api.logger?.info("[DingTalk] 插件已注册（支持主动发送 AI Card 消息）");
  },
};

export default plugin;
export {
  dingtalkPlugin,
  sendMessage,
  sendTextMessage,
  sendMarkdownMessage,
  sendToUser,
  sendToGroup,
  sendProactive,
};
