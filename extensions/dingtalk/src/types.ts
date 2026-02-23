import type { ClawdbotConfig } from "openclaw/plugin-sdk";

export interface DingTalkLogger {
  info?: (msg: string) => void;
  warn?: (msg: string) => void;
  error?: (msg: string) => void;
  debug?: (msg: string) => void;
}

export interface DingtalkAccountConfig {
  clientId?: string;
  clientSecret?: string;
  enableMediaUpload?: boolean;
  systemPrompt?: string;
  dmPolicy?: "open" | "pairing" | "allowlist";
  allowFrom?: string[];
  groupPolicy?: "open" | "allowlist";
  groupAllowFrom?: string[];
  gatewayToken?: string;
  gatewayPassword?: string;
  sessionTimeout?: number;
  debug?: boolean;
  name?: string;
  enabled?: boolean;
}

export interface ResolvedDingtalkAccount {
  accountId: string;
  config: DingtalkAccountConfig;
  enabled: boolean;
  configured: boolean;
}

export type DingTalkMsgType = "text" | "markdown" | "link" | "actionCard" | "image";

export interface SendResult {
  ok: boolean;
  processQueryKey?: string;
  cardInstanceId?: string;
  error?: string;
  usedAICard?: boolean;
}

export interface ProactiveSendOptions {
  msgType?: DingTalkMsgType;
  title?: string;
  log?: DingTalkLogger;
  useAICard?: boolean;
  fallbackToNormal?: boolean;
}

export type AICardTarget =
  | { type: "user"; userId: string }
  | { type: "group"; openConversationId: string };

export interface AICardInstance {
  cardInstanceId: string;
  accessToken: string;
  inputingStarted: boolean;
}
