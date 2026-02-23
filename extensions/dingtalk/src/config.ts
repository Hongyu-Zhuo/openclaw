import type { ClawdbotConfig } from "openclaw/plugin-sdk";
import { DingtalkAccountConfig, ResolvedDingtalkAccount } from "./types.js";

export function getDingTalkConfigs(
  cfg: ClawdbotConfig,
): Record<string, DingtalkAccountConfig> | null {
  return (cfg.channels as { dingtalk?: Record<string, DingtalkAccountConfig> })?.dingtalk || null;
}

export function isConfigured(cfg: ClawdbotConfig): boolean {
  const config = getDingTalkConfigs(cfg) as DingtalkAccountConfig | undefined;
  return Boolean(config?.clientId && config?.clientSecret);
}

export function resolveDingTalkAccount(
  cfg: ClawdbotConfig,
  accountId?: string | null,
): ResolvedDingtalkAccount {
  const config = getDingTalkConfigs(cfg) as
    | ({ accounts?: Record<string, DingtalkAccountConfig> } & DingtalkAccountConfig)
    | undefined;
  const id = accountId || "default";

  if (config?.accounts?.[id]) {
    return {
      accountId: id,
      config: config.accounts[id],
      enabled: config.accounts[id].enabled !== false,
      configured: Boolean(config.accounts[id].clientId && config.accounts[id].clientSecret),
    };
  }
  return {
    accountId: "default",
    config: config || {},
    enabled: config?.enabled !== false,
    configured: Boolean(config?.clientId && config?.clientSecret),
  };
}
