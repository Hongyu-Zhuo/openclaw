import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { dingtalkPlugin } from "./channel.js";
import type { ResolvedDingtalkAccount } from "./types.js";

vi.mock("dingtalk-stream", () => ({
  DWClient: vi.fn().mockImplementation(() => ({
    registerCallbackListener: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    socketCallBackResponse: vi.fn(),
  })),
  TOPIC_ROBOT: "/v1.0/im/bot/messages/get",
}));
vi.mock("./bot.js");
vi.mock("./session.js");
vi.mock("./send.js");
vi.mock("./config.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./config.js")>();
  return {
    ...original,
  };
});

const emptyCfg = { channels: {} } as unknown as OpenClawConfig;

const flatCfg = {
  channels: {
    dingtalk: { clientId: "test", clientSecret: "secret" },
  },
} as unknown as OpenClawConfig;

const multiAccountCfg = {
  channels: {
    dingtalk: {
      accounts: {
        prod: { clientId: "p-id", clientSecret: "p-secret" },
        dev: { clientId: "d-id", clientSecret: "d-secret" },
      },
    },
  },
} as unknown as OpenClawConfig;

function makeAccount(overrides: Partial<ResolvedDingtalkAccount> = {}): ResolvedDingtalkAccount {
  return {
    accountId: "default",
    config: { clientId: "id", clientSecret: "secret" },
    enabled: true,
    configured: true,
    ...overrides,
  };
}

describe("channel plugin", () => {
  describe("plugin metadata", () => {
    it("has correct id", () => {
      expect(dingtalkPlugin.id).toBe("dingtalk");
    });

    it("has correct meta labels", () => {
      expect(dingtalkPlugin.meta.label).toBe("DingTalk");
      expect(dingtalkPlugin.meta.selectionLabel).toContain("钉钉");
    });

    it("includes aliases", () => {
      expect(dingtalkPlugin.meta.aliases).toContain("dd");
      expect(dingtalkPlugin.meta.aliases).toContain("ding");
    });

    it("has docs path", () => {
      expect(dingtalkPlugin.meta.docsPath).toBe("/channels/dingtalk");
    });
  });

  describe("capabilities", () => {
    it("supports direct and group chat", () => {
      expect(dingtalkPlugin.capabilities.chatTypes).toContain("direct");
      expect(dingtalkPlugin.capabilities.chatTypes).toContain("group");
    });

    it("supports media", () => {
      expect(dingtalkPlugin.capabilities.media).toBe(true);
    });

    it("does not support reactions or threads", () => {
      expect(dingtalkPlugin.capabilities.reactions).toBe(false);
      expect(dingtalkPlugin.capabilities.threads).toBe(false);
    });
  });

  describe("config", () => {
    it("returns empty when dingtalk config is missing", () => {
      const ids = dingtalkPlugin.config.listAccountIds(emptyCfg);
      expect(ids).toEqual([]);
    });

    it('returns ["default"] when flat config exists', () => {
      const ids = dingtalkPlugin.config.listAccountIds(flatCfg);
      expect(ids).toEqual(["default"]);
    });

    it("returns account keys when accounts object exists", () => {
      const ids = dingtalkPlugin.config.listAccountIds(multiAccountCfg);
      expect(ids).toEqual(expect.arrayContaining(["prod", "dev"]));
      expect(ids).toHaveLength(2);
    });

    it("resolves account correctly", () => {
      const account = dingtalkPlugin.config.resolveAccount(multiAccountCfg, "prod");
      expect(account.accountId).toBe("prod");
      expect(account.config?.clientId).toBe("p-id");
    });

    it("returns default accountId", () => {
      expect(dingtalkPlugin.config.defaultAccountId!(emptyCfg)).toBe("default");
    });

    it("detects configured account", () => {
      const account = makeAccount();
      expect(dingtalkPlugin.config.isConfigured!(account, emptyCfg)).toBe(true);
    });

    it("detects unconfigured account", () => {
      const account = makeAccount({ config: {}, configured: false });
      expect(dingtalkPlugin.config.isConfigured!(account, emptyCfg)).toBe(false);
    });

    it("describes account correctly", () => {
      const account = makeAccount({
        accountId: "prod",
        config: { clientId: "app-id", name: "Production Bot" },
      });
      const desc = dingtalkPlugin.config.describeAccount!(account, emptyCfg);
      expect(desc.accountId).toBe("prod");
      expect(desc.name).toBe("Production Bot");
      expect(desc.enabled).toBe(true);
    });
  });

  describe("security", () => {
    it("resolves DM policy from account config", () => {
      const account = makeAccount({ config: { dmPolicy: "allowlist", allowFrom: ["user1"] } });
      const policy = dingtalkPlugin.security!.resolveDmPolicy!({
        account,
        cfg: emptyCfg,
      } as Parameters<
        NonNullable<NonNullable<typeof dingtalkPlugin.security>["resolveDmPolicy"]>
      >[0]);
      expect(policy!.policy).toBe("allowlist");
      expect(policy!.allowFrom).toEqual(["user1"]);
    });

    it("defaults to open DM policy", () => {
      const account = makeAccount({ config: {} });
      const policy = dingtalkPlugin.security!.resolveDmPolicy!({
        account,
        cfg: emptyCfg,
      } as Parameters<
        NonNullable<NonNullable<typeof dingtalkPlugin.security>["resolveDmPolicy"]>
      >[0]);
      expect(policy!.policy).toBe("open");
    });

    it("normalizes entry by stripping channel prefix", () => {
      const account = makeAccount({ config: {} });
      const policy = dingtalkPlugin.security!.resolveDmPolicy!({
        account,
        cfg: emptyCfg,
      } as Parameters<
        NonNullable<NonNullable<typeof dingtalkPlugin.security>["resolveDmPolicy"]>
      >[0]);
      expect(policy!.normalizeEntry!("dingtalk:user123")).toBe("user123");
      expect(policy!.normalizeEntry!("dd:user123")).toBe("user123");
      expect(policy!.normalizeEntry!("ding:user123")).toBe("user123");
    });
  });

  describe("messaging", () => {
    it("normalizes target by trimming and stripping channel prefix", () => {
      expect(dingtalkPlugin.messaging!.normalizeTarget!("  dingtalk:user123  ")).toBe("user123");
      expect(dingtalkPlugin.messaging!.normalizeTarget!("dd:user123")).toBe("user123");
    });

    it("returns undefined for empty target", () => {
      expect(dingtalkPlugin.messaging!.normalizeTarget!("")).toBeUndefined();
    });

    it("validates user id format", () => {
      expect(dingtalkPlugin.messaging!.targetResolver!.looksLikeId!("user:abc123")).toBe(true);
      expect(dingtalkPlugin.messaging!.targetResolver!.looksLikeId!("group:conv123")).toBe(true);
      expect(dingtalkPlugin.messaging!.targetResolver!.looksLikeId!("abc123")).toBe(true);
      expect(dingtalkPlugin.messaging!.targetResolver!.looksLikeId!("")).toBe(false);
    });
  });

  describe("outbound", () => {
    it("has direct delivery mode", () => {
      expect(dingtalkPlugin.outbound!.deliveryMode).toBe("direct");
    });

    it("has text chunk limit of 4000", () => {
      expect(dingtalkPlugin.outbound!.textChunkLimit).toBe(4000);
    });
  });

  describe("status", () => {
    it("returns ok false when account is not configured", async () => {
      const result = await dingtalkPlugin.status!.probeAccount!({
        account: makeAccount({ configured: false, config: {} }),
        timeoutMs: 5000,
        cfg: emptyCfg,
      });
      expect((result as { ok: boolean }).ok).toBe(false);
      expect((result as { error: string }).error).toContain("Not configured");
    });

    it("returns ok true when account is configured", async () => {
      const result = await dingtalkPlugin.status!.probeAccount!({
        account: makeAccount({ config: { clientId: "test-id" } }),
        timeoutMs: 5000,
        cfg: emptyCfg,
      });
      expect((result as { ok: boolean }).ok).toBe(true);
      expect((result as { details: unknown }).details).toEqual({ clientId: "test-id" });
    });

    it("builds channel summary from snapshot", () => {
      const summary = dingtalkPlugin.status!.buildChannelSummary!({
        account: makeAccount(),
        cfg: emptyCfg,
        defaultAccountId: "default",
        snapshot: {
          configured: true,
          running: true,
          lastStartAt: "2026-01-01",
          lastStopAt: null,
          lastError: null,
        } as any,
      });
      expect((summary as { configured: boolean }).configured).toBe(true);
      expect((summary as { running: boolean }).running).toBe(true);
    });

    it("builds default summary when snapshot is missing", () => {
      const summary = dingtalkPlugin.status!.buildChannelSummary!({
        account: makeAccount(),
        cfg: emptyCfg,
        defaultAccountId: "default",
        snapshot: undefined as any,
      });
      expect((summary as { configured: boolean }).configured).toBe(false);
      expect((summary as { running: boolean }).running).toBe(false);
    });
  });

  describe("configSchema", () => {
    it("requires clientId and clientSecret", () => {
      const schema = dingtalkPlugin.configSchema!.schema as { required?: string[] };
      expect(schema.required).toContain("clientId");
      expect(schema.required).toContain("clientSecret");
    });

    it("has dmPolicy with enum values", () => {
      const schema = dingtalkPlugin.configSchema!.schema as {
        properties?: Record<string, { enum?: string[] }>;
      };
      const dmProp = schema.properties!.dmPolicy;
      expect(dmProp.enum).toContain("open");
      expect(dmProp.enum).toContain("pairing");
      expect(dmProp.enum).toContain("allowlist");
    });

    it("marks clientSecret as sensitive in uiHints", () => {
      expect(dingtalkPlugin.configSchema!.uiHints!.clientSecret.sensitive).toBe(true);
    });
  });
});
