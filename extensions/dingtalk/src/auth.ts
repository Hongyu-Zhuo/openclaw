import axios from "axios";

// ============ Auth Cache ============

/** Cached access token avoiding repetitive generation requests */
let accessToken: string | null = null;
/** Expiration timestamp for the cached token */
let accessTokenExpiry = 0;
import { DingtalkAccountConfig } from "./types.js";

// ============ Token Management ============

/**
 * Securely retrieves or generates a new DingTalk API token for general application capabilities.
 * Incorporates a 60-second caching safety margin before expiration.
 * @param config DingTalk account credentials configuration
 */
export async function getAccessToken(config: DingtalkAccountConfig): Promise<string> {
  const now = Date.now();
  if (accessToken && accessTokenExpiry > now + 60_000) {
    return accessToken;
  }

  const response = await axios.post("https://api.dingtalk.com/v1.0/oauth2/accessToken", {
    appKey: config.clientId,
    appSecret: config.clientSecret,
  });

  accessToken = response.data.accessToken;
  accessTokenExpiry = now + response.data.expireIn * 1000;
  return accessToken!;
}

/**
 * Securely retrieves an OAPI access token typically used for old-style or media DingTalk APIs.
 * This interacts with the legacy oapi.dingtalk.com endpoints.
 */
export async function getOapiAccessToken(config: DingtalkAccountConfig): Promise<string | null> {
  try {
    const resp = await axios.get("https://oapi.dingtalk.com/gettoken", {
      params: { appkey: config.clientId, appsecret: config.clientSecret },
    });
    if (resp.data?.errcode === 0) return resp.data.access_token;
    return null;
  } catch {
    return null;
  }
}
