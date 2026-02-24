import type { ClawdbotConfig } from "openclaw/plugin-sdk";

// ============ Type Definitions ============

/** Standard logger facade adopted throughout the plugin execution paths */
export interface DingTalkLogger {
  info?: (msg: string) => void;
  warn?: (msg: string) => void;
  error?: (msg: string) => void;
  debug?: (msg: string) => void;
}

/** User's DingTalk account configuration payload merged from global credentials */
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

/** Processed integration account configurations bridging raw state with execution availability checks */
export interface ResolvedDingtalkAccount {
  accountId: string;
  config: DingtalkAccountConfig;
  enabled: boolean;
  configured: boolean;
}

export type DingTalkMsgType = "text" | "markdown" | "link" | "actionCard" | "image";

/** Tracks structural indicators returning transmission status to parent callers */
export interface SendResult {
  ok: boolean;
  processQueryKey?: string;
  cardInstanceId?: string;
  error?: string;
  usedAICard?: boolean;
}

/** General target addressing resolution required when launching specific APIs or Proactive queries */
export interface ProactiveSendOptions {
  msgType?: DingTalkMsgType;
  title?: string;
  log?: DingTalkLogger;
  useAICard?: boolean;
  fallbackToNormal?: boolean;
}

/** Defines whether an AI card delivery targets a unified conversational loop or explicitly addresses discrete users */
export type AICardTarget =
  | { type: "user"; userId: string }
  | { type: "group"; openConversationId: string };

/** State representation containing access tokens and transaction identifiers for an active interactive card */
export interface AICardInstance {
  cardInstanceId: string;
  accessToken: string;
  inputingStarted: boolean;
}
