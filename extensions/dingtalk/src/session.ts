// ============ Session Data Structure ============

/**
 * User session state: tracks last activity time and current session identifier
 */
interface UserSession {
  lastActivity: number;
  sessionId: string; // Format: dingtalk-connector:<senderId> or dingtalk-connector:<senderId>:<timestamp>
}

/** User session cache Map<senderId, UserSession> */
const userSessions = new Map<string, UserSession>();

/** Message deduplication cache Map<messageId, timestamp> - prevents duplicate processing of the same message */
const processedMessages = new Map<string, number>();

/** Message deduplication cache expiration time (5 minutes) */
const MESSAGE_DEDUP_TTL = 5 * 60 * 1000;

// ============ Message Deduplication Handling ============

/**
 * Cleans up expired message data from the deduplication cache
 */
function cleanupProcessedMessages(): void {
  const now = Date.now();
  for (const [msgId, timestamp] of processedMessages.entries()) {
    if (now - timestamp > MESSAGE_DEDUP_TTL) {
      processedMessages.delete(msgId);
    }
  }
}

/**
 * Checks if a message has already been processed (deduplication check)
 * @param messageId The unique ID of the message
 * @returns true if the message is already processed
 */
export function isMessageProcessed(messageId: string): boolean {
  if (!messageId) return false;
  return processedMessages.has(messageId);
}

/**
 * Marks a message as processed. Automatically cleans up the cache
 * when the size reaches a given threshold (100).
 * @param messageId The unique ID of the message
 */
export function markMessageProcessed(messageId: string): void {
  if (!messageId) return;
  processedMessages.set(messageId, Date.now());
  if (processedMessages.size >= 100) {
    cleanupProcessedMessages();
  }
}

// ============ Session Commands Parsing ============

/** Commands triggering a new session */
const NEW_SESSION_COMMANDS = ["/new", "/reset", "/clear", "新会话", "重新开始", "清空对话"];

/**
 * Checks if the message content matches a new session command
 */
export function isNewSessionCommand(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  return NEW_SESSION_COMMANDS.some((cmd) => trimmed === cmd.toLowerCase());
}

// ============ Unified Session Retrieval ============

/**
 * Gets or creates a user session key mapping.
 * Handles automatic timeout reset and forced new sessions.
 * @param senderId The user ID
 * @param forceNew Whether to forcefully reset the session
 * @param sessionTimeout The session timeout duration in milliseconds
 * @param log Optional logger
 * @returns An object containing the derived sessionKey and a boolean indicating if it's new
 */
export function getSessionKey(
  senderId: string,
  forceNew: boolean,
  sessionTimeout: number,
  log?: any,
): { sessionKey: string; isNew: boolean } {
  const now = Date.now();
  const existing = userSessions.get(senderId);

  if (forceNew) {
    const sessionId = `dingtalk-connector:${senderId}:${now}`;
    userSessions.set(senderId, { lastActivity: now, sessionId });
    log?.info?.(`[DingTalk][Session] 用户主动开启新会话: ${senderId}`);
    return { sessionKey: sessionId, isNew: true };
  }

  if (existing) {
    const elapsed = now - existing.lastActivity;
    if (elapsed > sessionTimeout) {
      const sessionId = `dingtalk-connector:${senderId}:${now}`;
      userSessions.set(senderId, { lastActivity: now, sessionId });
      log?.info?.(
        `[DingTalk][Session] 会话超时(${Math.round(elapsed / 60000)}分钟)，自动开启新会话: ${senderId}`,
      );
      return { sessionKey: sessionId, isNew: true };
    }
    existing.lastActivity = now;
    return { sessionKey: existing.sessionId, isNew: false };
  }

  const sessionId = `dingtalk-connector:${senderId}`;
  userSessions.set(senderId, { lastActivity: now, sessionId });
  log?.info?.(`[DingTalk][Session] 新用户首次会话: ${senderId}`);
  return { sessionKey: sessionId, isNew: false };
}
