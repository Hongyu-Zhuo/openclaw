import type {
  ChannelOnboardingAdapter,
  ChannelOnboardingDmPolicy,
  ClawdbotConfig,
  DmPolicy,
  WizardPrompter,
} from "openclaw/plugin-sdk";
import { addWildcardAllowFrom, DEFAULT_ACCOUNT_ID, formatDocsLink } from "openclaw/plugin-sdk";
import { isConfigured } from "./config.js";
import type { DingtalkAccountConfig } from "./types.js";

// ============ Constants ============

const channel = "dingtalk" as const;

// ============ Configuration Wizard ============

/** Utility function to pull dingtalk settings specifically from the root config object */
function getDingtalkConfig(cfg: ClawdbotConfig): DingtalkAccountConfig | undefined {
  return (cfg.channels as { dingtalk?: DingtalkAccountConfig })?.dingtalk ?? undefined;
}

function setDingtalkDmPolicy(cfg: ClawdbotConfig, dmPolicy: DmPolicy): ClawdbotConfig {
  const allowFrom =
    dmPolicy === "open"
      ? addWildcardAllowFrom(cfg.channels?.dingtalk?.allowFrom)?.map((entry) => String(entry))
      : undefined;
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      dingtalk: {
        ...cfg.channels?.dingtalk,
        dmPolicy,
        ...(allowFrom ? { allowFrom } : {}),
      },
    },
  };
}

function setDingtalkAllowFrom(cfg: ClawdbotConfig, allowFrom: string[]): ClawdbotConfig {
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      dingtalk: {
        ...cfg.channels?.dingtalk,
        allowFrom,
      },
    },
  };
}

// ============ Interactive Prompt Wizard ============

/** Transforms raw allow-list inputs separated by spaces/newlines into clean string arrays */
function parseAllowFromInput(raw: string): string[] {
  return raw
    .split(/[\n,;]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}
/**
 * Onboarding step requesting allowed specific chat-ID sources for gating DingTalk bot interactions.
 */
async function promptDingtalkAllowFrom(params: {
  cfg: ClawdbotConfig;
  prompter: WizardPrompter;
}): Promise<ClawdbotConfig> {
  const existing = params.cfg.channels?.dingtalk?.allowFrom ?? [];
  await params.prompter.note(
    [
      "使用钉钉 userId 来配置 DM 白名单。",
      "你可以在钉钉开放平台管理后台或通过 API 获取 userId。",
      "示例：",
      "- manager1234",
      "- staff5678",
    ].join("\n"),
    "DingTalk 白名单",
  );

  while (true) {
    const entry = await params.prompter.text({
      message: "DingTalk AllowFrom (userId 列表)",
      placeholder: "userId1, userId2",
      initialValue: existing[0] ? String(existing[0]) : undefined,
      validate: (value) => (String(value ?? "").trim() ? undefined : "必填"),
    });
    const parts = parseAllowFromInput(String(entry));
    if (parts.length === 0) {
      await params.prompter.note("请输入至少一个用户。", "DingTalk 白名单");
      continue;
    }

    const unique = [
      ...new Set([
        ...existing.map((v: string | number) => String(v).trim()).filter(Boolean),
        ...parts,
      ]),
    ];
    return setDingtalkAllowFrom(params.cfg, unique);
  }
}

async function noteCredentialHelp(prompter: WizardPrompter): Promise<void> {
  await prompter.note(
    [
      "1) 登录钉钉开放平台 (open.dingtalk.com)",
      "2) 创建一个企业内部应用 → 机器人类型",
      '3) 在"应用信息"页面获取 AppKey (Client ID) 和 AppSecret (Client Secret)',
      '4) 在"消息推送"中选择 Stream 模式',
      "5) 发布应用并在群中添加机器人",
      "提示：也可以设置 DINGTALK_CLIENT_ID / DINGTALK_CLIENT_SECRET 环境变量。",
      `文档: ${formatDocsLink("/channels/dingtalk", "dingtalk")}`,
    ].join("\n"),
    "钉钉应用凭证",
  );
}

async function promptCredentials(prompter: WizardPrompter): Promise<{
  clientId: string;
  clientSecret: string;
}> {
  const clientId = String(
    await prompter.text({
      message: "输入钉钉 AppKey (Client ID)",
      validate: (value) => (value?.trim() ? undefined : "必填"),
    }),
  ).trim();
  const clientSecret = String(
    await prompter.text({
      message: "输入钉钉 AppSecret (Client Secret)",
      validate: (value) => (value?.trim() ? undefined : "必填"),
    }),
  ).trim();
  return { clientId, clientSecret };
}

function setDingtalkGroupPolicy(
  cfg: ClawdbotConfig,
  groupPolicy: "open" | "allowlist",
): ClawdbotConfig {
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      dingtalk: {
        ...cfg.channels?.dingtalk,
        enabled: true,
        groupPolicy,
      },
    },
  };
}

function setDingtalkGroupAllowFrom(cfg: ClawdbotConfig, groupAllowFrom: string[]): ClawdbotConfig {
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      dingtalk: {
        ...cfg.channels?.dingtalk,
        groupAllowFrom,
      },
    },
  };
}

// ============ Access Policy Wizard ============

/** Represents DingTalk access policy requirements to configure group / DM boundaries */
const dmPolicy: ChannelOnboardingDmPolicy = {
  label: "DingTalk",
  channel,
  policyKey: "channels.dingtalk.dmPolicy",
  allowFromKey: "channels.dingtalk.allowFrom",
  getCurrent: (cfg) => getDingtalkConfig(cfg)?.dmPolicy ?? "open",
  setPolicy: (cfg, policy) => setDingtalkDmPolicy(cfg, policy),
  promptAllowFrom: promptDingtalkAllowFrom,
};

// ============ Onboarding Adapter ============

/**
 * Encapsulates the complete DingTalk integration onboarding suite connecting UI components
 * to required state changes.
 */
export const dingtalkOnboardingAdapter: ChannelOnboardingAdapter = {
  channel,

  getStatus: async ({ cfg }) => {
    const configured = isConfigured(cfg);
    const dingtalkCfg = getDingtalkConfig(cfg);

    const statusLines: string[] = [];
    if (!configured) {
      statusLines.push("DingTalk: 需要应用凭证");
    } else {
      statusLines.push(
        `DingTalk: 已配置 (AppKey: ${dingtalkCfg?.clientId?.slice(0, 8) ?? "?"}...)`,
      );
    }

    return {
      channel,
      configured,
      statusLines,
      selectionHint: configured ? "已配置" : "需要应用凭证",
      quickstartScore: configured ? 2 : 0,
    };
  },

  configure: async ({ cfg, prompter }) => {
    const dingtalkCfg = getDingtalkConfig(cfg);
    const hasConfigCreds = Boolean(
      dingtalkCfg?.clientId?.trim() && dingtalkCfg?.clientSecret?.trim(),
    );
    const canUseEnv = Boolean(
      !hasConfigCreds &&
      process.env.DINGTALK_CLIENT_ID?.trim() &&
      process.env.DINGTALK_CLIENT_SECRET?.trim(),
    );

    let next = cfg;
    let clientId: string | null = null;
    let clientSecret: string | null = null;

    if (!hasConfigCreds && !canUseEnv) {
      await noteCredentialHelp(prompter);
    }

    if (canUseEnv) {
      const keepEnv = await prompter.confirm({
        message: "检测到 DINGTALK_CLIENT_ID + DINGTALK_CLIENT_SECRET 环境变量，使用环境变量？",
        initialValue: true,
      });
      if (keepEnv) {
        next = {
          ...next,
          channels: {
            ...next.channels,
            dingtalk: { ...next.channels?.dingtalk, enabled: true },
          },
        };
      } else {
        const entered = await promptCredentials(prompter);
        clientId = entered.clientId;
        clientSecret = entered.clientSecret;
      }
    } else if (hasConfigCreds) {
      const keep = await prompter.confirm({
        message: "钉钉凭证已配置，是否保留当前凭证？",
        initialValue: true,
      });
      if (!keep) {
        const entered = await promptCredentials(prompter);
        clientId = entered.clientId;
        clientSecret = entered.clientSecret;
      }
    } else {
      const entered = await promptCredentials(prompter);
      clientId = entered.clientId;
      clientSecret = entered.clientSecret;
    }

    if (clientId && clientSecret) {
      next = {
        ...next,
        channels: {
          ...next.channels,
          dingtalk: {
            ...next.channels?.dingtalk,
            enabled: true,
            clientId,
            clientSecret,
          },
        },
      };
    }

    // Group policy
    const groupPolicy = await prompter.select({
      message: "群聊策略",
      options: [
        { value: "open", label: "Open — 在所有群中响应（需要 @机器人）" },
        { value: "allowlist", label: "Allowlist — 仅在指定群中响应" },
      ],
      initialValue: getDingtalkConfig(next)?.groupPolicy ?? "open",
    });
    if (groupPolicy) {
      next = setDingtalkGroupPolicy(next, groupPolicy as "open" | "allowlist");
    }

    // Group allowlist
    if (groupPolicy === "allowlist") {
      const existing = getDingtalkConfig(next)?.groupAllowFrom ?? [];
      const entry = await prompter.text({
        message: "群聊白名单 (openConversationId 列表)",
        placeholder: "cid1, cid2",
        initialValue: existing.length > 0 ? existing.map(String).join(", ") : undefined,
      });
      if (entry) {
        const parts = parseAllowFromInput(String(entry));
        if (parts.length > 0) {
          next = setDingtalkGroupAllowFrom(next, parts);
        }
      }
    }

    return { cfg: next, accountId: DEFAULT_ACCOUNT_ID };
  },

  dmPolicy,

  disable: (cfg) => ({
    ...cfg,
    channels: {
      ...cfg.channels,
      dingtalk: { ...cfg.channels?.dingtalk, enabled: false },
    },
  }),
};
