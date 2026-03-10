import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isMessageProcessed,
  markMessageProcessed,
  isNewSessionCommand,
  getSessionKey,
} from "./session.js";

describe("session", () => {
  describe("isNewSessionCommand", () => {
    it.each(["/new", "/reset", "/clear", "新会话", "重新开始", "清空对话"])(
      'recognizes "%s" as new session command',
      (cmd) => {
        expect(isNewSessionCommand(cmd)).toBe(true);
      },
    );

    it.each(["/NEW", "/Reset", "  /new  "])(
      'recognizes case-insensitive/whitespace variant "%s"',
      (cmd) => {
        expect(isNewSessionCommand(cmd)).toBe(true);
      },
    );

    it.each(["hello", "/help", "新消息", "", "/newSession"])(
      'rejects non-command text "%s"',
      (text) => {
        expect(isNewSessionCommand(text)).toBe(false);
      },
    );
  });

  describe("message deduplication", () => {
    it("marks and detects processed messages", () => {
      const msgId = `test-msg-${Date.now()}`;
      expect(isMessageProcessed(msgId)).toBe(false);
      markMessageProcessed(msgId);
      expect(isMessageProcessed(msgId)).toBe(true);
    });

    it("returns false for empty messageId", () => {
      expect(isMessageProcessed("")).toBe(false);
    });

    it("does not throw on marking empty messageId", () => {
      expect(() => markMessageProcessed("")).not.toThrow();
    });
  });

  describe("getSessionKey", () => {
    const SESSION_TIMEOUT = 1800000; // 30 min

    it("creates a new session for first-time user", () => {
      const senderId = `first-user-${Date.now()}`;
      const result = getSessionKey(senderId, false, SESSION_TIMEOUT);
      expect(result.sessionKey).toContain("dingtalk-connector:");
      expect(result.sessionKey).toContain(senderId);
      // First session is not flagged as "new" (it's "initial")
      expect(result.isNew).toBe(false);
    });

    it("reuses existing session within timeout window", () => {
      const senderId = `reuse-user-${Date.now()}`;
      const first = getSessionKey(senderId, false, SESSION_TIMEOUT);
      const second = getSessionKey(senderId, false, SESSION_TIMEOUT);
      expect(second.sessionKey).toBe(first.sessionKey);
      expect(second.isNew).toBe(false);
    });

    it("forces new session when forceNew is true", () => {
      const senderId = `force-user-${Date.now()}`;
      const first = getSessionKey(senderId, false, SESSION_TIMEOUT);
      const forced = getSessionKey(senderId, true, SESSION_TIMEOUT);
      expect(forced.sessionKey).not.toBe(first.sessionKey);
      expect(forced.isNew).toBe(true);
    });

    it("creates new session after timeout expires", () => {
      const senderId = `timeout-user-${Date.now()}`;
      const first = getSessionKey(senderId, false, SESSION_TIMEOUT);

      // Use negative timeout so elapsed (>=0) is always greater than sessionTimeout
      const expired = getSessionKey(senderId, false, -1);
      expect(expired.sessionKey).not.toBe(first.sessionKey);
      expect(expired.isNew).toBe(true);
    });

    it("passes log to session operations", () => {
      const senderId = `log-user-${Date.now()}`;
      const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      getSessionKey(senderId, false, SESSION_TIMEOUT, log);
      expect(log.info).toHaveBeenCalled();
    });
  });
});
