import type { PluginRuntime } from "openclaw/plugin-sdk";

// ============ Runtime Instance ============

/** Global reference caching the PluginRuntime object established during mount */
let runtime: PluginRuntime | null = null;

export function setDingTalkRuntime(rt: PluginRuntime): void {
  runtime = rt;
}

/** Asserts initialization and retrieves the active DingTalk runtime environment */
export function getDingTalkRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("DingTalk runtime not initialized");
  }
  return runtime;
}
