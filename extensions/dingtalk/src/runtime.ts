import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setDingTalkRuntime(rt: PluginRuntime): void {
  runtime = rt;
}

export function getDingTalkRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("DingTalk runtime not initialized");
  }
  return runtime;
}
